// server/controllers/leaveRequestController.js
const db = require('../database/db');
const LeaveRuleEngine = require('../services/LeaveRuleEngine');
const LeaveLedgerService = require('../services/LeaveLedgerService');
const NotificationService = require('../services/NotificationService');
const AuditService = require('../services/AuditService');

/**
 * 1. Live Calculation & Eligibility Preview (Authoritative backend calculation)
 */
exports.calculatePreview = (req, res) => {
  try {
    const { employeeId, leaveTypeId, fromDate, toDate, isHalfDay, halfDaySession } = req.body;

    const empId = req.user.role === 'ADMIN' && employeeId ? employeeId : req.user.employee_id;
    if (!empId) {
      return res.status(400).json({ error: 'Employee identifier is required.' });
    }

    const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(empId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const leaveType = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(leaveTypeId);
    if (!leaveType) {
      return res.status(404).json({ error: 'Leave type not found.' });
    }

    const validation = LeaveRuleEngine.validateLeaveEligibility(
      employee,
      leaveType,
      fromDate,
      toDate,
      { isHalfDay: Boolean(isHalfDay), halfDaySession }
    );

    res.json({
      success: true,
      isValid: validation.isValid,
      errors: validation.errors,
      calculation: validation.calculation,
      balanceInfo: validation.balanceInfo,
      rule: validation.rule ? {
        id: validation.rule.id,
        rule_name: validation.rule.rule_name,
        rule_code: validation.rule.rule_code,
        version_number: validation.rule.version_number
      } : null
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * 2. Submit Leave Request
 */
exports.submitRequest = (req, res) => {
  try {
    const { leaveTypeId, fromDate, toDate, isHalfDay, halfDaySession, reason, remarks } = req.body;

    const empId = req.user.role === 'ADMIN' && req.body.employeeId ? req.body.employeeId : req.user.employee_id;
    if (!empId) {
      return res.status(400).json({ error: 'Employee ID required.' });
    }

    if (!leaveTypeId || !fromDate || !toDate || !reason) {
      return res.status(400).json({ error: 'Leave type, start date, end date, and reason are required.' });
    }

    const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(empId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const leaveType = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(leaveTypeId);
    if (!leaveType) {
      return res.status(404).json({ error: 'Leave type not found.' });
    }

    // Authoritative backend validation
    const validation = LeaveRuleEngine.validateLeaveEligibility(
      employee,
      leaveType,
      fromDate,
      toDate,
      { isHalfDay: Boolean(isHalfDay), halfDaySession }
    );

    if (!validation.isValid) {
      return res.status(422).json({
        error: 'Leave validation failed.',
        details: validation.errors
      });
    }

    const calc = validation.calculation;
    const year = new Date().getFullYear();
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM leave_requests WHERE strftime('%Y', created_at) = ?`).get(String(year));
    const requestNumber = `LR-${year}-${String(countRow.count + 1).padStart(4, '0')}`;

    // Generate immutable calculation snapshot
    const snapshotJson = LeaveRuleEngine.generateCalculationSnapshot(
      employee,
      leaveType,
      calc,
      validation.balanceInfo.current_balance
    );

    let createdRequest;

    const submitTransaction = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO leave_requests (
          request_number, employee_id, leave_type_id, from_date, to_date,
          is_half_day, half_day_session, requested_calendar_days,
          weekly_off_days, holiday_days, sandwich_days, chargeable_days,
          reason, remarks, status, rule_version_id, calculation_snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `);

      const result = stmt.run(
        requestNumber,
        employee.employee_id,
        leaveType.id,
        fromDate,
        toDate,
        isHalfDay ? 1 : 0,
        isHalfDay ? halfDaySession : null,
        calc.calendarDays,
        calc.weeklyOffDays,
        calc.holidayDays,
        calc.sandwichDays,
        calc.chargeableDays,
        reason.trim(),
        remarks ? remarks.trim() : null,
        calc.ruleVersionId,
        snapshotJson
      );

      const requestId = result.lastInsertRowid;

      // Status history entry
      db.prepare(`
        INSERT INTO leave_request_status_history (leave_request_id, from_status, to_status, changed_by, remarks)
        VALUES (?, NULL, 'PENDING', ?, 'Leave request submitted by employee')
      `).run(requestId, req.user.email);

      createdRequest = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(requestId);

      // Notification
      NotificationService.dispatch('LEAVE_SUBMITTED', req.user.id, {
        request_number: requestNumber,
        leave_type: leaveType.code,
        from_date: fromDate,
        to_date: toDate,
        chargeable_days: calc.chargeableDays
      });

      // Audit log
      AuditService.log({
        actorUserId: req.user.id,
        actorEmail: req.user.email,
        action: 'SUBMIT_LEAVE_REQUEST',
        entityType: 'LEAVE_REQUEST',
        entityId: requestNumber,
        newValues: createdRequest,
        remarks: `Submitted leave request ${requestNumber} for ${calc.chargeableDays} days.`
      });
    });

    submitTransaction();

    res.status(201).json({
      success: true,
      message: `Leave request ${requestNumber} submitted successfully.`,
      request: createdRequest
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * 3. Review Leave Request (Admin Action: Approve, Reject, Hold, Cancel)
 */
exports.reviewRequest = (req, res) => {
  try {
    const { id } = req.params;
    const { action, remarks } = req.body; // action: 'APPROVE', 'REJECT', 'HOLD', 'CANCEL'

    if (!['APPROVE', 'REJECT', 'HOLD', 'CANCEL'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be APPROVE, REJECT, HOLD, or CANCEL.' });
    }

    const request = db.prepare(`
      SELECT lr.*, lt.code as leave_code, lt.name as leave_name, e.name as employee_name, u.id as employee_user_id
      FROM leave_requests lr
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      JOIN employees e ON e.employee_id = lr.employee_id
      LEFT JOIN users u ON u.employee_id = lr.employee_id
      WHERE lr.id = ?
    `).get(id);

    if (!request) {
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    // Anti-self-approval: administrators cannot action their own leave requests.
    // Compare the reviewer's employee_id against the request owner's employee_id.
    if (req.user.employee_id && String(req.user.employee_id) === String(request.employee_id)) {
      return res.status(403).json({
        error: 'Forbidden: You cannot approve, reject, or modify your own leave request. A peer or senior administrator must action it.'
      });
    }

    const previousStatus = request.status;
    let newStatus = previousStatus;


    if (action === 'APPROVE') {
      if (previousStatus === 'APPROVED') {
        return res.status(400).json({ error: 'Leave request is already approved.' });
      }
      newStatus = 'APPROVED';
    } else if (action === 'REJECT') {
      if (previousStatus === 'APPROVED') {
        return res.status(400).json({ error: 'Approved requests cannot be rejected directly; use cancel to reverse.' });
      }
      newStatus = 'REJECTED';
    } else if (action === 'HOLD') {
      newStatus = 'HOLD';
    } else if (action === 'CANCEL') {
      newStatus = 'CANCELLED';
    }

    const reviewTransaction = db.transaction(() => {
      // If approving, record ledger deduction
      if (newStatus === 'APPROVED') {
        // Double check balance before deducting
        const balance = LeaveLedgerService.getBalance(request.employee_id, request.leave_type_id);
        if (balance.current_balance < request.chargeable_days) {
          throw new Error(`Cannot approve: Insufficient balance. Available: ${balance.current_balance}, Required: ${request.chargeable_days}`);
        }

        LeaveLedgerService.recordTransaction({
          employeeId: request.employee_id,
          leaveTypeId: request.leave_type_id,
          transactionType: 'LEAVE_DEDUCTION',
          amount: -request.chargeable_days,
          referenceId: request.request_number,
          ruleVersionId: request.rule_version_id,
          remarks: `Leave Approved: ${request.from_date} to ${request.to_date} (${remarks || 'Approved by Admin'})`,
          createdBy: req.user.email
        });
      }

      // If reversing an already APPROVED request via CANCEL
      if (previousStatus === 'APPROVED' && newStatus === 'CANCELLED') {
        LeaveLedgerService.recordTransaction({
          employeeId: request.employee_id,
          leaveTypeId: request.leave_type_id,
          transactionType: 'LEAVE_REVERSAL',
          amount: request.chargeable_days,
          referenceId: request.request_number,
          ruleVersionId: request.rule_version_id,
          remarks: `Leave Cancellation & Reversal: ${request.request_number} (${remarks || 'Cancelled by Admin'})`,
          createdBy: req.user.email
        });
      }

      // Update request status
      db.prepare(`
        UPDATE leave_requests SET
          status = ?,
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          review_remarks = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newStatus, req.user.email, remarks || null, id);

      // Record in status history
      db.prepare(`
        INSERT INTO leave_request_status_history (leave_request_id, from_status, to_status, changed_by, remarks)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, previousStatus, newStatus, req.user.email, remarks || `Status changed to ${newStatus}`);

      // Notifications
      if (request.employee_user_id) {
        let eventCode = 'LEAVE_APPROVED';
        if (newStatus === 'REJECTED') eventCode = 'LEAVE_REJECTED';
        if (newStatus === 'HOLD') eventCode = 'LEAVE_HOLD';
        if (newStatus === 'CANCELLED') eventCode = 'LEAVE_CANCELLED';

        NotificationService.dispatch(eventCode, request.employee_user_id, {
          request_number: request.request_number,
          leave_type: request.leave_code,
          chargeable_days: request.chargeable_days,
          remarks: remarks || 'No remarks provided'
        });
      }

      // Audit log
      AuditService.log({
        actorUserId: req.user.id,
        actorEmail: req.user.email,
        action: `LEAVE_REQUEST_${newStatus}`,
        entityType: 'LEAVE_REQUEST',
        entityId: request.request_number,
        oldValues: { status: previousStatus },
        newValues: { status: newStatus, remarks },
        remarks: `Admin changed request ${request.request_number} status from ${previousStatus} to ${newStatus}`
      });
    });

    reviewTransaction();

    const updated = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);

    res.json({
      success: true,
      message: `Leave request ${request.request_number} has been ${newStatus.toLowerCase()}.`,
      request: updated
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * 4. List requests for logged-in employee or with filters for admin
 */
exports.getRequests = (req, res) => {
  try {
    const { employeeId, status, leaveTypeId, fromDate, toDate, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT 
        lr.*,
        e.name as employee_name,
        e.department,
        e.designation,
        e.is_field_worker,
        lt.code as leave_code,
        lt.name as leave_name,
        v.version_number as rule_version_number
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN leave_rule_versions v ON v.id = lr.rule_version_id
      WHERE 1=1
    `;
    const params = [];

    // Scope check: If employee role, force employeeId
    if (req.user.role === 'EMPLOYEE') {
      sql += ` AND lr.employee_id = ?`;
      params.push(req.user.employee_id);
    } else if (employeeId && employeeId !== 'ALL') {
      sql += ` AND lr.employee_id = ?`;
      params.push(employeeId);
    }

    if (status && status !== 'ALL') {
      sql += ` AND lr.status = ?`;
      params.push(status);
    }
    if (leaveTypeId && leaveTypeId !== 'ALL') {
      sql += ` AND lr.leave_type_id = ?`;
      params.push(leaveTypeId);
    }
    if (fromDate) {
      sql += ` AND lr.from_date >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      sql += ` AND lr.to_date <= ?`;
      params.push(toDate);
    }

    sql += ` ORDER BY lr.id DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const requests = db.prepare(sql).all(...params);

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 5. Get Single Request Details + Status Timeline + Snapshot
 */
exports.getRequestDetails = (req, res) => {
  try {
    const { id } = req.params;
    const request = db.prepare(`
      SELECT 
        lr.*,
        e.name as employee_name,
        e.department,
        e.designation,
        e.email as employee_email,
        e.mobile as employee_mobile,
        lt.code as leave_code,
        lt.name as leave_name,
        v.version_number as rule_version_number,
        v.config_json as rule_config_json
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN leave_rule_versions v ON v.id = lr.rule_version_id
      WHERE lr.id = ? OR lr.request_number = ?
    `).get(id, id);

    if (!request) {
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    // Role check: Employee can only see their own
    if (req.user.role === 'EMPLOYEE' && request.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const timeline = db.prepare(`
      SELECT * FROM leave_request_status_history 
      WHERE leave_request_id = ? 
      ORDER BY id ASC
    `).all(request.id);

    let snapshot = null;
    try {
      snapshot = JSON.parse(request.calculation_snapshot_json);
    } catch (e) {}

    res.json({
      request: {
        ...request,
        snapshot,
        timeline
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
