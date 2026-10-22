// server/controllers/compOffController.js
const db = require('../database/db');
const LeaveRuleEngine = require('../services/LeaveRuleEngine');
const LeaveLedgerService = require('../services/LeaveLedgerService');
const NotificationService = require('../services/NotificationService');
const AuditService = require('../services/AuditService');

exports.getRecords = (req, res) => {
  try {
    const { employeeId, status } = req.query;
    let sql = `
      SELECT c.*, e.name as employee_name, e.department, e.is_field_worker
      FROM comp_off_records c
      JOIN employees e ON e.employee_id = c.employee_id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'EMPLOYEE') {
      sql += ` AND c.employee_id = ?`;
      params.push(req.user.employee_id);
    } else if (employeeId && employeeId !== 'ALL') {
      sql += ` AND c.employee_id = ?`;
      params.push(employeeId);
    }

    if (status && status !== 'ALL') {
      sql += ` AND c.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY c.id DESC`;
    const records = db.prepare(sql).all(...params);

    res.json({ records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.claimCompOff = (req, res) => {
  try {
    const { worked_date, qualifying_day_type = 'SUNDAY', reason } = req.body;

    const empId = req.user.role === 'ADMIN' && req.body.employee_id ? req.body.employee_id : req.user.employee_id;
    if (!empId || !worked_date || !reason) {
      return res.status(400).json({ error: 'Worked date and reason are required.' });
    }

    const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(empId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Evaluate Comp-Off eligibility using Rule Engine
    const evalResult = LeaveRuleEngine.calculateCompOff(employee, worked_date, qualifying_day_type);
    if (!evalResult.eligible) {
      return res.status(400).json({ error: evalResult.reason });
    }

    const stmt = db.prepare(`
      INSERT INTO comp_off_records (
        employee_id, worked_date, qualifying_day_type, credited_days,
        reason, approval_status, expiry_date, status
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 'PENDING')
    `);

    const result = stmt.run(
      empId,
      worked_date,
      qualifying_day_type,
      evalResult.creditedDays,
      reason.trim(),
      evalResult.expiryDate
    );

    const record = db.prepare('SELECT * FROM comp_off_records WHERE id = ?').get(result.lastInsertRowid);

    AuditService.log({
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      action: 'CLAIM_COMP_OFF',
      entityType: 'COMP_OFF',
      entityId: record.id,
      newValues: record,
      remarks: `Claimed Comp-Off for duty on ${worked_date}`
    });

    res.status(201).json({
      success: true,
      message: 'Comp-Off claim submitted for administrative approval.',
      record
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.reviewClaim = (req, res) => {
  try {
    const { id } = req.params;
    const { action, remarks } = req.body; // 'APPROVE' or 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
    }

    const claim = db.prepare(`
      SELECT c.*, e.name as employee_name, u.id as user_id
      FROM comp_off_records c
      JOIN employees e ON e.employee_id = c.employee_id
      LEFT JOIN users u ON u.employee_id = c.employee_id
      WHERE c.id = ?
    `).get(id);

    if (!claim) {
      return res.status(404).json({ error: 'Comp-off record not found.' });
    }

    if (claim.approval_status !== 'PENDING') {
      return res.status(400).json({ error: `Record is already in status ${claim.approval_status}.` });
    }

    const reviewTransaction = db.transaction(() => {
      const isApproved = action === 'APPROVE';
      const newStatus = isApproved ? 'AVAILABLE' : 'REJECTED';
      const approvalStatus = isApproved ? 'APPROVED' : 'REJECTED';
      const creditedDate = isApproved ? new Date().toISOString().split('T')[0] : null;

      db.prepare(`
        UPDATE comp_off_records SET
          approval_status = ?,
          approved_by = ?,
          credited_date = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(approvalStatus, req.user.email, creditedDate, newStatus, id);

      // If approved, credit into leave transactions ledger if a Comp-Off leave type exists
      if (isApproved) {
        let compOffType = db.prepare(`SELECT id FROM leave_types WHERE code = 'COMP_OFF'`).get();
        if (!compOffType) {
          // Auto create or check if general comp off
          const resLt = db.prepare(`
            INSERT INTO leave_types (code, name, description, is_paid, requires_approval, is_active)
            VALUES ('COMP_OFF', 'Compensatory Off', 'Compensatory leave credited for field duty on weekly offs or holidays.', 1, 1, 1)
          `).run();
          compOffType = { id: resLt.lastInsertRowid };
        }

        LeaveLedgerService.recordTransaction({
          employeeId: claim.employee_id,
          leaveTypeId: compOffType.id,
          transactionType: 'COMP_OFF_CREDIT',
          amount: claim.credited_days,
          referenceId: `COMP_OFF_${claim.id}`,
          remarks: `Comp-Off approved for duty on ${claim.worked_date} (${claim.qualifying_day_type}). ${remarks || ''}`,
          createdBy: req.user.email
        });

        if (claim.user_id) {
          NotificationService.dispatch('COMP_OFF_CREDITED', claim.user_id, {
            days: claim.credited_days,
            worked_date: claim.worked_date
          });
        }
      }

      AuditService.log({
        actorUserId: req.user.id,
        actorEmail: req.user.email,
        action: `COMP_OFF_${action}`,
        entityType: 'COMP_OFF',
        entityId: claim.id,
        newValues: { approval_status: approvalStatus, status: newStatus, remarks },
        remarks: `Comp-Off claim for ${claim.employee_name} was ${approvalStatus.toLowerCase()}.`
      });
    });

    reviewTransaction();

    res.json({
      success: true,
      message: `Comp-off claim ${action.toLowerCase()}d successfully.`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
