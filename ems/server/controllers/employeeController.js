// server/controllers/employeeController.js
const db = require('../database/db');
const AuthService = require('../services/AuthService');
const LeaveCreditScheduler = require('../services/LeaveCreditScheduler');
const AuditService = require('../services/AuditService');

exports.getAllEmployees = (req, res) => {
  try {
    const { department, status, is_field_worker, search } = req.query;
    let sql = `
      SELECT e.*, u.id as user_id, u.last_login_at
      FROM employees e
      LEFT JOIN users u ON u.employee_id = e.employee_id
      WHERE 1=1
    `;
    const params = [];

    if (department && department !== 'ALL') {
      sql += ` AND e.department = ?`;
      params.push(department);
    }
    if (status && status !== 'ALL') {
      sql += ` AND e.status = ?`;
      params.push(status);
    }
    if (is_field_worker !== undefined && is_field_worker !== '') {
      sql += ` AND e.is_field_worker = ?`;
      params.push(is_field_worker === 'true' || is_field_worker === '1' ? 1 : 0);
    }
    if (search) {
      sql += ` AND (e.name LIKE ? OR e.employee_id LIKE ? OR e.official_employee_id LIKE ? OR e.email LIKE ? OR e.mobile LIKE ? OR e.designation LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term);
    }

    sql += ` ORDER BY e.id ASC`;
    const employees = db.prepare(sql).all(...params);

    res.json({ employees });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getEmployeeById = (req, res) => {
  try {
    const { id } = req.params;
    const employee = db.prepare(`
      SELECT e.*, u.id as user_id, u.last_login_at, u.is_active as user_active
      FROM employees e
      LEFT JOIN users u ON u.employee_id = e.employee_id
      WHERE e.id = ? OR e.employee_id = ?
    `).get(id, id);

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    res.json({ employee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createEmployee = (req, res) => {
  try {
    const {
      employee_id,
      name,
      gender,
      mobile,
      email,
      date_of_joining,
      date_of_birth,
      department = 'General',
      designation,
      employee_category = 'GENERAL',
      is_field_worker = 0,
      status = 'ACTIVE',
      temporaryPassword
    } = req.body;

    // Strict validation
    if (!employee_id || !name || !email || !date_of_joining || !date_of_birth || !designation) {
      return res.status(400).json({ error: 'Missing required employee fields.' });
    }

    // Check unique employee_id and email
    const existingEmp = db.prepare('SELECT id FROM employees WHERE employee_id = ? OR email = ?').get(employee_id, email);
    if (existingEmp) {
      return res.status(400).json({ error: 'An employee with this Employee ID or Email already exists.' });
    }

    let createdEmployee;
    let initialCredits = [];
    let userAccount;

    const createTransaction = db.transaction(() => {
      // 1. Insert into employees
      const insertEmp = db.prepare(`
        INSERT INTO employees (
          employee_id, name, gender, mobile, email,
          date_of_joining, date_of_birth, department, designation,
          employee_category, is_field_worker, field_location, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const empResult = insertEmp.run(
        employee_id.trim().toUpperCase(),
        name.trim(),
        gender,
        mobile.trim(),
        email.trim().toLowerCase(),
        date_of_joining,
        date_of_birth,
        department.trim(),
        designation.trim(),
        employee_category,
        is_field_worker ? 1 : 0,
        is_field_worker && req.body.field_location ? req.body.field_location.trim() : null,
        status
      );

      createdEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(empResult.lastInsertRowid);

      // 1b. Record initial field status history
      const effectiveDate = date_of_joining || new Date().toISOString().split('T')[0];
      try {
        db.prepare(`
          INSERT INTO employee_field_status_history (
            employee_id, is_field_worker, field_location, effective_from, effective_to, remarks, changed_by
          ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        `).run(
          createdEmployee.employee_id,
          createdEmployee.is_field_worker,
          createdEmployee.field_location || null,
          effectiveDate,
          createdEmployee.is_field_worker === 1 ? 'Initial appointment on Field Duty' : 'Initial appointment on Hospital/Desk Duty',
          req.user?.email || 'ADMIN'
        );
        db.prepare('UPDATE employees SET field_worker_effective_date = ? WHERE id = ?').run(effectiveDate, createdEmployee.id);
      } catch (e) {}

      // 2. Create User account with secure temporary password
      userAccount = AuthService.createEmployeeAccount(createdEmployee, { temporaryPassword });

      // 3. Process Initial dynamic leave credits based on DOJ and active policy rules
      initialCredits = LeaveCreditScheduler.processJoiningCredit(createdEmployee, req.user?.email || 'ADMIN');

      // 4. Log Audit
      AuditService.log({
        actorUserId: req.user?.id,
        actorEmail: req.user?.email,
        action: 'CREATE_EMPLOYEE',
        entityType: 'EMPLOYEE',
        entityId: createdEmployee.employee_id,
        newValues: {
          employee: createdEmployee,
          initialCredits
        },
        remarks: `Created employee ${createdEmployee.name} (${createdEmployee.employee_id}) with dynamic joining credit.`
      });
    });

    createTransaction();

    res.status(201).json({
      success: true,
      message: 'Employee created successfully with credentials generated and initial leave entitlement credited.',
      employee: createdEmployee,
      userAccount: {
        email: userAccount.email,
        temporaryPassword: userAccount.temporaryPassword
      },
      initialCredits
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateEmployee = (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      gender,
      mobile,
      email,
      official_employee_id,
      emp_id,
      date_of_joining,
      date_of_birth,
      department,
      designation,
      employee_category,
      is_field_worker,
      field_location,
      effective_date,
      field_remarks,
      status
    } = req.body;

    const oldEmployee = db.prepare('SELECT * FROM employees WHERE id = ? OR employee_id = ?').get(id, id);
    if (!oldEmployee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const newFieldWorkerVal = is_field_worker !== undefined
      ? (Number(is_field_worker) === 1 || is_field_worker === true || is_field_worker === 'true' || is_field_worker === '1' ? 1 : 0)
      : null;

    // Determine field_location
    let updatedFieldLocation = oldEmployee.field_location;
    if (newFieldWorkerVal === 0) {
      updatedFieldLocation = null;
    } else if (field_location !== undefined) {
      updatedFieldLocation = field_location && field_location.trim() ? field_location.trim() : null;
    }

    // Determine official_employee_id
    const inputOfficialId = official_employee_id !== undefined ? official_employee_id : emp_id;
    let updatedOfficialId = oldEmployee.official_employee_id;
    if (inputOfficialId !== undefined) {
      updatedOfficialId = inputOfficialId && inputOfficialId.trim() ? inputOfficialId.trim() : null;
    }

    const effectiveDt = effective_date || new Date().toISOString().split('T')[0];

    db.prepare(`
      UPDATE employees SET
        name = COALESCE(?, name),
        official_employee_id = ?,
        gender = COALESCE(?, gender),
        mobile = COALESCE(?, mobile),
        email = COALESCE(?, email),
        date_of_joining = COALESCE(?, date_of_joining),
        date_of_birth = COALESCE(?, date_of_birth),
        department = COALESCE(?, department),
        designation = COALESCE(?, designation),
        employee_category = COALESCE(?, employee_category),
        is_field_worker = COALESCE(?, is_field_worker),
        field_location = ?,
        field_worker_effective_date = CASE WHEN ? IS NOT NULL THEN ? ELSE field_worker_effective_date END,
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ?? null,
      updatedOfficialId,
      gender ?? null,
      mobile ?? null,
      email ?? null,
      date_of_joining ?? null,
      date_of_birth ?? null,
      department ?? null,
      designation ?? null,
      employee_category ?? null,
      newFieldWorkerVal,
      updatedFieldLocation,
      newFieldWorkerVal,
      effectiveDt,
      status ?? null,
      oldEmployee.id
    );

    // If field worker status changed, maintain historical continuity
    if (newFieldWorkerVal !== null && newFieldWorkerVal !== oldEmployee.is_field_worker) {
      try {
        // Close prior open-ended duty period
        db.prepare(`
          UPDATE employee_field_status_history
          SET effective_to = date(?, '-1 day')
          WHERE employee_id = ? AND effective_to IS NULL AND effective_from <= ?
        `).run(effectiveDt, oldEmployee.employee_id, effectiveDt);

        // Record new active duty period from effective date
        db.prepare(`
          INSERT INTO employee_field_status_history (
            employee_id, is_field_worker, field_location, effective_from, effective_to, remarks, changed_by
          ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        `).run(
          oldEmployee.employee_id,
          newFieldWorkerVal,
          newFieldWorkerVal === 1 ? updatedFieldLocation : null,
          effectiveDt,
          field_remarks || (newFieldWorkerVal === 1 
            ? `Assigned to Field Duty from ${effectiveDt}${updatedFieldLocation ? ` (${updatedFieldLocation})` : ''}` 
            : `Returned to Hospital / Desk Duty from ${effectiveDt}`),
          req.user?.email || 'ADMIN'
        );
      } catch (e) {}
    } else if (newFieldWorkerVal === 1 || (newFieldWorkerVal === null && oldEmployee.is_field_worker === 1)) {
      // If field location changed for an active field worker, update current active duty period
      if (field_location !== undefined && updatedFieldLocation !== oldEmployee.field_location) {
        try {
          db.prepare(`
            UPDATE employee_field_status_history
            SET field_location = ?
            WHERE employee_id = ? AND effective_to IS NULL
          `).run(updatedFieldLocation, oldEmployee.employee_id);
        } catch (e) {}
      }
    }

    const updatedEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(oldEmployee.id);

    // If email changed, update in users table as well
    if (email && email !== oldEmployee.email) {
      db.prepare('UPDATE users SET email = ? WHERE employee_id = ?').run(email, oldEmployee.employee_id);
    }

    // If status changed to INACTIVE or RESIGNED, update user is_active flag
    if (status && status !== oldEmployee.status) {
      const isUserActive = status === 'ACTIVE' ? 1 : 0;
      db.prepare('UPDATE users SET is_active = ? WHERE employee_id = ?').run(isUserActive, oldEmployee.employee_id);
    }

    let remark = `Updated employee details for ${oldEmployee.employee_id}`;
    if (newFieldWorkerVal !== null && newFieldWorkerVal !== oldEmployee.is_field_worker) {
      remark = `Changed Field Worker status for ${oldEmployee.name} (${oldEmployee.employee_id}) to ${newFieldWorkerVal === 1 ? 'YES (Field Duty - Comp-Off Active)' : 'NO (Hospital / Desk Duty - Comp-Off Disabled)'} effective from ${effectiveDt}`;
    }

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'UPDATE_EMPLOYEE',
      entityType: 'EMPLOYEE',
      entityId: oldEmployee.employee_id,
      oldValues: oldEmployee,
      newValues: updatedEmployee,
      remarks: remark
    });

    res.json({
      success: true,
      message: newFieldWorkerVal !== null && newFieldWorkerVal !== oldEmployee.is_field_worker
        ? `Field worker status updated to ${newFieldWorkerVal === 1 ? 'YES (Field Duty: Comp-Off Enabled)' : 'NO (Hospital Duty: Comp-Off Not Provided)'} effective from ${effectiveDt}`
        : 'Employee updated successfully.',
      employee: updatedEmployee
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getFieldWorkerHistory = (req, res) => {
  try {
    const { id } = req.params;
    const emp = db.prepare('SELECT employee_id, name, is_field_worker, field_location, field_worker_effective_date, date_of_joining FROM employees WHERE id = ? OR employee_id = ?').get(id, id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });

    let history = [];
    try {
      history = db.prepare(`
        SELECT * FROM employee_field_status_history
        WHERE employee_id = ?
        ORDER BY effective_from DESC, id DESC
      `).all(emp.employee_id);
    } catch (e) {}

    res.json({ employee: emp, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
