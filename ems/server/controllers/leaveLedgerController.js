// server/controllers/leaveLedgerController.js
const db = require('../database/db');
const LeaveLedgerService = require('../services/LeaveLedgerService');
const LeaveCreditScheduler = require('../services/LeaveCreditScheduler');
const AuditService = require('../services/AuditService');

exports.getBalances = (req, res) => {
  try {
    const { employeeId, year } = req.query;
    const targetEmpId = req.user.role === 'ADMIN' ? (employeeId || null) : req.user.employee_id;

    if (!targetEmpId) {
      if (req.user.role === 'ADMIN') {
        return res.json({
          employee_id: null,
          year: year ? parseInt(year, 10) : new Date().getFullYear(),
          balances: []
        });
      }
      return res.status(400).json({ error: 'Employee ID is required.' });
    }

    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const balances = LeaveLedgerService.getAllBalancesForEmployee(targetEmpId, targetYear);

    res.json({
      employee_id: targetEmpId,
      year: targetYear,
      balances
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTransactions = (req, res) => {
  try {
    const { employeeId, leaveTypeId, transactionType, year } = req.query;
    const targetEmpId = req.user.role === 'ADMIN' ? (employeeId || null) : req.user.employee_id;

    const filters = {
      employee_id: targetEmpId,
      leave_type_id: leaveTypeId,
      transaction_type: transactionType,
      year: year ? parseInt(year, 10) : null
    };

    const transactions = LeaveLedgerService.getLedgerHistory(filters);
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.manualAdjustment = (req, res) => {
  try {
    const { employeeId, leaveTypeId, amount, remarks } = req.body;

    if (!employeeId || !leaveTypeId || amount === undefined || !remarks) {
      return res.status(400).json({ error: 'Employee ID, leave type ID, amount, and reason/remarks are required.' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount === 0) {
      return res.status(400).json({ error: 'Amount must be a non-zero number.' });
    }

    const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const leaveType = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(leaveTypeId);
    if (!leaveType) {
      return res.status(404).json({ error: 'Leave type not found.' });
    }

    const year = new Date().getFullYear();
    const balanceBefore = LeaveLedgerService.getBalance(employeeId, leaveTypeId, year);

    const tx = LeaveLedgerService.recordTransaction({
      employeeId,
      leaveTypeId,
      transactionType: 'ADMIN_ADJUSTMENT',
      amount: numAmount,
      remarks: remarks.trim(),
      createdBy: req.user.email,
      year
    });

    const balanceAfter = LeaveLedgerService.getBalance(employeeId, leaveTypeId, year);

    AuditService.log({
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'MANUAL_LEAVE_ADJUSTMENT',
      entityType: 'LEAVE_TRANSACTION',
      entityId: tx.transaction_id,
      oldValues: { balance: balanceBefore.current_balance },
      newValues: { balance: balanceAfter.current_balance, adjustment: numAmount, remarks },
      remarks: `Manual adjustment of ${numAmount} days on ${leaveType.code} for ${employee.name} (${employeeId}). Reason: ${remarks}`
    });

    res.json({
      success: true,
      message: `Manual adjustment of ${numAmount > 0 ? '+' : ''}${numAmount} days recorded successfully.`,
      transaction: tx,
      currentBalance: balanceAfter.current_balance
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getSchedules = (req, res) => {
  try {
    const schedules = db.prepare(`
      SELECT s.*, lt.code as leave_code, lt.name as leave_name
      FROM leave_credit_schedules s
      JOIN leave_types lt ON lt.id = s.leave_type_id
      ORDER BY s.id ASC
    `).all();

    const executions = db.prepare(`
      SELECT e.*, s.schedule_name, lt.code as leave_code
      FROM credit_schedule_executions e
      JOIN leave_credit_schedules s ON s.id = e.schedule_id
      JOIN leave_types lt ON lt.id = s.leave_type_id
      ORDER BY e.id DESC
      LIMIT 20
    `).all();

    res.json({ schedules, executions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.runSchedule = (req, res) => {
  try {
    const { scheduleId, executionDate, force } = req.body;
    if (!scheduleId) {
      return res.status(400).json({ error: 'Schedule ID is required.' });
    }

    const result = LeaveCreditScheduler.processSchedule(scheduleId, executionDate || new Date(), { force: Boolean(force) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.verifyIntegrity = (req, res) => {
  try {
    const { employeeId, leaveTypeId } = req.query;
    if (!employeeId || !leaveTypeId) {
      return res.status(400).json({ error: 'employeeId and leaveTypeId are required.' });
    }

    const result = LeaveLedgerService.verifyLedgerIntegrity(employeeId, leaveTypeId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
