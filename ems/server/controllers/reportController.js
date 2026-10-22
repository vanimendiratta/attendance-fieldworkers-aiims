// server/controllers/reportController.js
const db = require('../database/db');

exports.getSummaryMetrics = (req, res) => {
  try {
    const totalEmployees = db.prepare(`SELECT COUNT(*) as count FROM employees WHERE status = 'ACTIVE'`).get().count;
    const totalFieldWorkers = db.prepare(`SELECT COUNT(*) as count FROM employees WHERE status = 'ACTIVE' AND is_field_worker = 1`).get().count;
    const pendingRequests = db.prepare(`SELECT COUNT(*) as count FROM leave_requests WHERE status = 'PENDING'`).get().count;
    const approvedRequests = db.prepare(`SELECT COUNT(*) as count FROM leave_requests WHERE status = 'APPROVED'`).get().count;
    const rejectedRequests = db.prepare(`SELECT COUNT(*) as count FROM leave_requests WHERE status = 'REJECTED'`).get().count;
    const pendingCompOffs = db.prepare(`SELECT COUNT(*) as count FROM comp_off_records WHERE approval_status = 'PENDING'`).get().count;

    // Leave taken by type
    const leaveByType = db.prepare(`
      SELECT lt.code, lt.name, COALESCE(SUM(lr.chargeable_days), 0) as days_taken
      FROM leave_types lt
      LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id AND lr.status = 'APPROVED'
      GROUP BY lt.id
    `).all();

    // Department-wise distribution
    const departmentStats = db.prepare(`
      SELECT department, COUNT(*) as employee_count
      FROM employees
      WHERE status = 'ACTIVE'
      GROUP BY department
    `).all();

    res.json({
      metrics: {
        totalEmployees,
        totalFieldWorkers,
        pendingRequests,
        approvedRequests,
        rejectedRequests,
        pendingCompOffs
      },
      leaveByType,
      departmentStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBalanceReport = (req, res) => {
  try {
    const { department, year } = req.query;
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

    let sql = `
      SELECT 
        e.employee_id,
        e.name as employee_name,
        e.department,
        e.designation,
        e.is_field_worker,
        e.date_of_joining,
        lt.code as leave_type,
        COALESCE(b.opening_balance, 0) as opening_balance,
        COALESCE(b.credited_amount, 0) as credited,
        COALESCE(b.used_amount, 0) as used,
        COALESCE(b.adjusted_amount, 0) as adjusted,
        COALESCE(b.current_balance, 0) as current_balance
      FROM employees e
      CROSS JOIN leave_types lt ON lt.is_active = 1
      LEFT JOIN leave_balances b ON b.employee_id = e.employee_id 
        AND b.leave_type_id = lt.id 
        AND b.year = ?
      WHERE e.status = 'ACTIVE'
    `;
    const params = [targetYear];

    if (department && department !== 'ALL') {
      sql += ` AND e.department = ?`;
      params.push(department);
    }

    sql += ` ORDER BY e.id ASC, lt.id ASC`;
    const rows = db.prepare(sql).all(...params);

    // Group by employee for tabular clarity
    const employeeMap = {};
    rows.forEach(r => {
      if (!employeeMap[r.employee_id]) {
        employeeMap[r.employee_id] = {
          employee_id: r.employee_id,
          name: r.employee_name,
          department: r.department,
          designation: r.designation,
          is_field_worker: r.is_field_worker === 1,
          date_of_joining: r.date_of_joining,
          leaves: {}
        };
      }
      employeeMap[r.employee_id].leaves[r.leave_type] = {
        opening: r.opening_balance,
        credited: r.credited,
        used: r.used,
        adjusted: r.adjusted,
        balance: r.current_balance
      };
    });

    res.json({
      year: targetYear,
      report: Object.values(employeeMap)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Authoritative CDER Staff Leave & Entitlement Register
 * Matches 'CDER Staff Details and Leave Rules & Record.docx' & Document Snapshot
 */
exports.getCderLeaveRegister = (req, res) => {
  try {
    const { search, department, category } = req.query;

    const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
    const elType = db.prepare(`SELECT id FROM leave_types WHERE code = 'EL'`).get();
    const rhType = db.prepare(`SELECT id FROM leave_types WHERE code = 'RH'`).get();
    const coType = db.prepare(`SELECT id FROM leave_types WHERE code IN ('CO', 'COMP_OFF')`).get();

    let sql = `SELECT * FROM employees WHERE status = 'ACTIVE'`;
    const params = [];

    if (department && department !== 'ALL') {
      sql += ` AND department = ?`;
      params.push(department);
    }
    if (category === 'FIELD_WORKER') {
      sql += ` AND is_field_worker = 1`;
    } else if (category === 'GENERAL') {
      sql += ` AND is_field_worker = 0`;
    }
    if (search) {
      sql += ` AND (name LIKE ? OR designation LIKE ? OR employee_id LIKE ? OR official_employee_id LIKE ? OR mobile LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    sql += ` ORDER BY id ASC`;
    const employees = db.prepare(sql).all(...params);

    const getBal = (empId, ltId) => {
      if (!ltId) return { credited_amount: 0, used_amount: 0, current_balance: 0 };
      return db.prepare(`
        SELECT credited_amount, used_amount, current_balance 
        FROM leave_balances 
        WHERE employee_id = ? AND leave_type_id = ? AND year = 2026
      `).get(empId, ltId) || { credited_amount: 0, used_amount: 0, current_balance: 0 };
    };

    let totalClEntitled = 0;
    let totalClBalance = 0;
    let totalElAvailed = 0;
    let totalElBalance = 0;
    let totalRhEntitled = 0;
    let totalRhBalance = 0;
    let totalCoBalance = 0;

    const records = employees.map((e, idx) => {
      const cl = getBal(e.employee_id, clType?.id);
      const el = getBal(e.employee_id, elType?.id);
      const rh = getBal(e.employee_id, rhType?.id);
      const co = getBal(e.employee_id, coType?.id);

      const clEntitled = Number(cl.credited_amount || 0);
      const clBalance = Number(cl.current_balance || 0);
      const elAvailed = Number(el.credited_amount || 0);
      const elBalance = Number(el.current_balance || 0);
      const rhEntitled = Number(rh.credited_amount || 0);
      const rhBalance = Number(rh.current_balance || 0);
      const coBalance = Number(co.current_balance || 0);

      totalClEntitled += clEntitled;
      totalClBalance += clBalance;
      totalElAvailed += elAvailed;
      totalElBalance += elBalance;
      totalRhEntitled += rhEntitled;
      totalRhBalance += rhBalance;
      totalCoBalance += coBalance;

      return {
        sno: idx + 1,
        employee_id: e.employee_id,
        official_employee_id: e.official_employee_id || null,
        name: e.name,
        designation: e.designation,
        department: e.department,
        contact: e.mobile || 'N/A',
        email: e.email,
        date_of_joining: e.date_of_joining,
        is_field_worker: e.is_field_worker === 1,
        field_location: e.field_location || null,
        cl_entitled: clEntitled,
        cl_balance: clBalance,
        el_availed: elAvailed,
        el_balance: elBalance,
        rh_entitled: rhEntitled,
        rh_balance: rhBalance,
        co_balance: coBalance
      };
    });

    res.json({
      title: 'CENTRE FOR DENTAL EDUCATION AND RESEARCH',
      subtitle: 'Staff Details & Individual Leave Entitlement / Balance Record',
      common_tenure: '01/04/2026 to 31/03/2027',
      as_on_date: '01.10.2026',
      totalStaff: records.length,
      totals: {
        cl_entitled: Number(totalClEntitled.toFixed(1)),
        cl_balance: Number(totalClBalance.toFixed(1)),
        el_availed: Number(totalElAvailed.toFixed(1)),
        el_balance: Number(totalElBalance.toFixed(1)),
        rh_entitled: Number(totalRhEntitled.toFixed(1)),
        rh_balance: Number(totalRhBalance.toFixed(1)),
        co_balance: Number(totalCoBalance.toFixed(1))
      },
      records
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCderReconciliation = (req, res) => {
  try {
    const CderImportService = require('../services/CderImportService');
    const result = CderImportService.runReconciliation();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
