// server/services/LeaveLedgerService.js
const db = require('../database/db');

class LeaveLedgerService {
  /**
   * Get current leave balance for an employee and leave type for a given calendar year
   */
  static getBalance(employeeId, leaveTypeId, year = new Date().getFullYear()) {
    const row = db.prepare(`
      SELECT * FROM leave_balances 
      WHERE employee_id = ? AND leave_type_id = ? AND year = ?
    `).get(employeeId, leaveTypeId, year);

    if (!row) {
      // Calculate directly from transactions if cached record not yet initialized
      const txSum = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type IN ('INITIAL_CREDIT', 'PERIODIC_CREDIT', 'COMP_OFF_CREDIT') THEN amount ELSE 0 END), 0) AS total_credited,
          COALESCE(SUM(CASE WHEN transaction_type IN ('LEAVE_DEDUCTION') THEN ABS(amount) ELSE 0 END), 0) AS total_used,
          COALESCE(SUM(CASE WHEN transaction_type IN ('ADMIN_ADJUSTMENT', 'CORRECTION') THEN amount ELSE 0 END), 0) AS total_adjusted,
          COALESCE(SUM(CASE WHEN transaction_type IN ('EXPIRY') THEN ABS(amount) ELSE 0 END), 0) AS total_expired,
          COALESCE(SUM(amount), 0) AS net_balance
        FROM leave_transactions
        WHERE employee_id = ? AND leave_type_id = ? AND strftime('%Y', created_at) = ?
      `).get(employeeId, leaveTypeId, String(year));

      return {
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        year,
        opening_balance: 0,
        credited_amount: txSum.total_credited,
        used_amount: txSum.total_used,
        pending_amount: 0,
        adjusted_amount: txSum.total_adjusted,
        current_balance: txSum.net_balance
      };
    }

    // Also get any pending requested days that hold balance
    const pendingSum = db.prepare(`
      SELECT COALESCE(SUM(chargeable_days), 0) as pending_days
      FROM leave_requests
      WHERE employee_id = ? AND leave_type_id = ? AND status IN ('PENDING', 'HOLD')
        AND (strftime('%Y', from_date) = ? OR strftime('%Y', to_date) = ?)
    `).get(employeeId, leaveTypeId, String(year), String(year));

    return {
      ...row,
      pending_amount: pendingSum ? pendingSum.pending_days : 0,
      available_balance: Math.max(0, row.current_balance - (pendingSum ? pendingSum.pending_days : 0))
    };
  }

  /**
   * Get all leave balances for an employee
   */
  static getAllBalancesForEmployee(employeeId, year = new Date().getFullYear()) {
    const leaveTypes = db.prepare(`SELECT * FROM leave_types WHERE is_active = 1`).all();
    return leaveTypes.map(lt => {
      const balance = this.getBalance(employeeId, lt.id, year);
      return {
        leave_type_id: lt.id,
        leave_type_code: lt.code,
        leave_type_name: lt.name,
        is_paid: lt.is_paid,
        year,
        opening_balance: balance.opening_balance || 0,
        credited_amount: balance.credited_amount || 0,
        used_amount: balance.used_amount || 0,
        pending_amount: balance.pending_amount || 0,
        adjusted_amount: balance.adjusted_amount || 0,
        current_balance: balance.current_balance || 0,
        available_balance: balance.available_balance !== undefined ? balance.available_balance : balance.current_balance
      };
    });
  }

  /**
   * Record a transaction in the leave ledger and update cached balance atomically
   */
  static recordTransaction({
    employeeId,
    leaveTypeId,
    transactionType,
    amount, // Signed: positive for additions/credits, negative for deductions
    referenceId = null,
    ruleVersionId = null,
    remarks = null,
    createdBy = 'SYSTEM',
    year = new Date().getFullYear()
  }) {
    const recordTx = db.transaction(() => {
      // 1. Fetch current cached balance or initialize
      let currentBalRecord = db.prepare(`
        SELECT * FROM leave_balances 
        WHERE employee_id = ? AND leave_type_id = ? AND year = ?
      `).get(employeeId, leaveTypeId, year);

      let prevBalance = 0;
      if (currentBalRecord) {
        prevBalance = currentBalRecord.current_balance;
      }

      const newBalance = Number((prevBalance + amount).toFixed(2));

      // 2. Insert into leave_transactions
      const insertTx = db.prepare(`
        INSERT INTO leave_transactions (
          employee_id, leave_type_id, transaction_type, amount,
          running_balance, reference_id, rule_version_id, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const txResult = insertTx.run(
        employeeId,
        leaveTypeId,
        transactionType,
        amount,
        newBalance,
        referenceId,
        ruleVersionId,
        remarks,
        createdBy
      );

      const txId = txResult.lastInsertRowid;

      // 3. Update or Insert leave_balances
      if (currentBalRecord) {
        let credited = currentBalRecord.credited_amount;
        let used = currentBalRecord.used_amount;
        let adjusted = currentBalRecord.adjusted_amount;

        if (['INITIAL_CREDIT', 'PERIODIC_CREDIT', 'COMP_OFF_CREDIT'].includes(transactionType)) {
          credited = Number((credited + amount).toFixed(2));
        } else if (transactionType === 'LEAVE_DEDUCTION') {
          used = Number((used + Math.abs(amount)).toFixed(2));
        } else if (transactionType === 'LEAVE_REVERSAL') {
          used = Number((used - Math.abs(amount)).toFixed(2));
        } else if (['ADMIN_ADJUSTMENT', 'CORRECTION'].includes(transactionType)) {
          adjusted = Number((adjusted + amount).toFixed(2));
        }

        db.prepare(`
          UPDATE leave_balances SET
            credited_amount = ?,
            used_amount = ?,
            adjusted_amount = ?,
            current_balance = ?,
            last_transaction_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(credited, used, adjusted, newBalance, txId, currentBalRecord.id);
      } else {
        const isCredit = ['INITIAL_CREDIT', 'PERIODIC_CREDIT', 'COMP_OFF_CREDIT'].includes(transactionType);
        const isDeduction = transactionType === 'LEAVE_DEDUCTION';
        const isAdj = ['ADMIN_ADJUSTMENT', 'CORRECTION'].includes(transactionType);

        db.prepare(`
          INSERT INTO leave_balances (
            employee_id, leave_type_id, year, opening_balance,
            credited_amount, used_amount, pending_amount, adjusted_amount,
            current_balance, last_transaction_id
          ) VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?, ?)
        `).run(
          employeeId,
          leaveTypeId,
          year,
          isCredit ? amount : 0,
          isDeduction ? Math.abs(amount) : 0,
          isAdj ? amount : 0,
          newBalance,
          txId
        );
      }

      return {
        transaction_id: txId,
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        transaction_type: transactionType,
        amount,
        running_balance: newBalance
      };
    });

    return recordTx();
  }

  /**
   * Get complete transaction ledger history for an employee or leave type
   */
  static getLedgerHistory(filters = {}) {
    let sql = `
      SELECT 
        lt.id,
        lt.employee_id,
        e.name as employee_name,
        e.department,
        ltp.code as leave_type_code,
        ltp.name as leave_type_name,
        lt.transaction_type,
        lt.amount,
        lt.running_balance,
        lt.reference_id,
        lt.rule_version_id,
        lt.remarks,
        lt.created_by,
        lt.created_at
      FROM leave_transactions lt
      JOIN employees e ON e.employee_id = lt.employee_id
      JOIN leave_types ltp ON ltp.id = lt.leave_type_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.employee_id) {
      sql += ` AND lt.employee_id = ?`;
      params.push(filters.employee_id);
    }
    if (filters.leave_type_id) {
      sql += ` AND lt.leave_type_id = ?`;
      params.push(filters.leave_type_id);
    }
    if (filters.transaction_type) {
      sql += ` AND lt.transaction_type = ?`;
      params.push(filters.transaction_type);
    }
    if (filters.year) {
      sql += ` AND strftime('%Y', lt.created_at) = ?`;
      params.push(String(filters.year));
    }

    sql += ` ORDER BY lt.id DESC`;

    return db.prepare(sql).all(...params);
  }

  /**
   * Audit ledger balance integrity against the sum of all transactions
   */
  static verifyLedgerIntegrity(employeeId, leaveTypeId) {
    const cached = db.prepare(`
      SELECT current_balance FROM leave_balances 
      WHERE employee_id = ? AND leave_type_id = ?
    `).get(employeeId, leaveTypeId);

    const actual = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as calculated_sum 
      FROM leave_transactions 
      WHERE employee_id = ? AND leave_type_id = ?
    `).get(employeeId, leaveTypeId);

    const cachedBalance = cached ? cached.current_balance : 0;
    const isConsistent = Math.abs(cachedBalance - actual.calculated_sum) < 0.001;

    return {
      employeeId,
      leaveTypeId,
      cachedBalance,
      calculatedSum: actual.calculated_sum,
      isConsistent
    };
  }
}

module.exports = LeaveLedgerService;
