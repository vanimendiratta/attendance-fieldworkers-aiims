const db = require('../db/database');
const { STATE_DISTRICTS_MAP, getDistrictsForState } = require('../data/india_states_districts');
const { v4: uuidv4 } = require('uuid');

class TeamService {
  /**
   * List all teams for an employer, optionally filtered by state and district
   */
  listTeams(employerId, filterState = null, filterDistrict = null) {
    let sql = `
      SELECT t.*, 
        COUNT(DISTINCT e.id) AS member_count,
        COUNT(DISTINCT CASE WHEN a.attendance_status IN ('CHECKED_IN', 'ON_BREAK') THEN a.id END) AS active_attendance_count
      FROM teams t
      LEFT JOIN employees e ON e.team_id = t.id AND e.is_active = 1
      LEFT JOIN attendance a ON a.team_id = t.id AND a.attendance_status IN ('CHECKED_IN', 'ON_BREAK') 
        AND date(a.created_at) = date('now')
      WHERE t.employer_id = ?
    `;
    const params = [employerId];

    if (filterState && filterState !== 'ALL') {
      sql += ' AND t.state = ?';
      params.push(filterState);
    }
    if (filterDistrict && filterDistrict !== 'ALL') {
      sql += ' AND t.district = ?';
      params.push(filterDistrict);
    }

    sql += ' GROUP BY t.id ORDER BY t.state ASC, t.district ASC, t.name ASC';

    return db.prepare(sql).all(...params);
  }

  /**
   * Create a new team assigned to a specific State and District
   */
  createTeam(employerId, { name, state, district, description }) {
    if (!name || !name.trim()) {
      throw new Error('Team name is required.');
    }
    if (!state || !state.trim()) {
      throw new Error('State/UT is required.');
    }
    if (!district || !district.trim()) {
      throw new Error('District is required.');
    }

    // Verify district belongs to state
    const validDistricts = getDistrictsForState(state.trim());
    if (validDistricts.length === 0) {
      throw new Error(`Unrecognized Indian State or Union Territory: "${state}".`);
    }

    const matchedDist = validDistricts.find(
      d => d.toLowerCase() === district.trim().toLowerCase()
    );
    if (!matchedDist) {
      throw new Error(`District "${district}" does not belong to State "${state}".`);
    }

    const teamId = `TEAM-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO teams (id, employer_id, name, state, district, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      teamId,
      employerId,
      name.trim(),
      state.trim(),
      matchedDist,
      description ? description.trim() : null,
      now
    );

    return db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  }

  /**
   * Assign an employee to a team (syncs team_id, state, and district)
   */
  assignEmployeeTeam(employerId, employeeId, teamId) {
    const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND employer_id = ?').get(employeeId, employerId);
    if (!employee) {
      throw new Error('Employee not found for this employer.');
    }

    if (!teamId) {
      // Clear team assignment
      db.prepare('UPDATE employees SET team_id = NULL, state = NULL, district = NULL WHERE id = ?').run(employeeId);
      return { success: true, message: 'Employee unassigned from team.' };
    }

    const team = db.prepare('SELECT * FROM teams WHERE id = ? AND employer_id = ?').get(teamId, employerId);
    if (!team) {
      throw new Error('Team not found for this employer.');
    }

    db.prepare(`
      UPDATE employees 
      SET team_id = ?, state = ?, district = ?
      WHERE id = ?
    `).run(team.id, team.state, team.district, employeeId);

    return {
      success: true,
      employee_id: employeeId,
      team_id: team.id,
      team_name: team.name,
      state: team.state,
      district: team.district
    };
  }

  /**
   * Multi-State and Multi-District Real-Time Attendance Matrix
   * Aggregates live attendance counts simultaneously across states and districts
   */
  getMultiStateAttendanceMatrix(employerId, dateStr = null) {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);

    // Get all attendance rows for employer on target date with employee & team details
    const rows = db.prepare(`
      SELECT 
        COALESCE(a.state, e.state, t.state, 'Unassigned') AS state,
        COALESCE(a.district, e.district, t.district, 'Unassigned') AS district,
        COALESCE(t.name, 'Direct Assignment') AS team_name,
        a.attendance_status,
        a.work_mode,
        COUNT(a.id) AS count
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      WHERE a.employer_id = ? AND date(a.created_at) = ?
      GROUP BY 1, 2, 3, 4, 5
    `).all(employerId, targetDate);

    // Also get all defined teams to show regional territories even if 0 check-ins yet today
    const allTeams = db.prepare(`
      SELECT id, name, state, district 
      FROM teams 
      WHERE employer_id = ?
      ORDER BY state ASC, district ASC, name ASC
    `).all(employerId);

    // Build structured multi-state hierarchy
    const stateMap = {};

    // First, populate all known teams
    allTeams.forEach(team => {
      if (!stateMap[team.state]) {
        stateMap[team.state] = {
          state: team.state,
          total_active: 0,
          total_completed: 0,
          total_records: 0,
          districts: {}
        };
      }
      if (!stateMap[team.state].districts[team.district]) {
        stateMap[team.state].districts[team.district] = {
          district: team.district,
          active: 0,
          on_break: 0,
          completed: 0,
          field_work_active: 0,
          office_active: 0,
          teams: []
        };
      }
      stateMap[team.state].districts[team.district].teams.push({
        id: team.id,
        name: team.name
      });
    });

    // Merge active attendance records
    rows.forEach(r => {
      const st = r.state;
      const dst = r.district;

      if (!stateMap[st]) {
        stateMap[st] = {
          state: st,
          total_active: 0,
          total_completed: 0,
          total_records: 0,
          districts: {}
        };
      }
      if (!stateMap[st].districts[dst]) {
        stateMap[st].districts[dst] = {
          district: dst,
          active: 0,
          on_break: 0,
          completed: 0,
          field_work_active: 0,
          office_active: 0,
          teams: []
        };
      }

      const distObj = stateMap[st].districts[dst];
      const count = Number(r.count) || 0;

      if (r.attendance_status === 'CHECKED_IN') {
        distObj.active += count;
        stateMap[st].total_active += count;
        if (r.work_mode === 'FIELD_WORK') distObj.field_work_active += count;
        else distObj.office_active += count;
      } else if (r.attendance_status === 'ON_BREAK') {
        distObj.on_break += count;
        stateMap[st].total_active += count;
      } else if (r.attendance_status === 'COMPLETED') {
        distObj.completed += count;
        stateMap[st].total_completed += count;
      }

      stateMap[st].total_records += count;
    });

    // Format into sorted arrays for straightforward frontend rendering
    const stateList = Object.values(stateMap).map(s => {
      return {
        state: s.state,
        total_active: s.total_active,
        total_completed: s.total_completed,
        total_records: s.total_records,
        districts: Object.values(s.districts)
      };
    }).sort((a, b) => b.total_active - a.total_active || a.state.localeCompare(b.state));

    const totalActiveCount = stateList.reduce((sum, s) => sum + s.total_active, 0);

    return {
      date: targetDate,
      total_active: totalActiveCount,
      total_states_active: stateList.filter(s => s.total_active > 0).length,
      states: stateList
    };
  }
}

module.exports = new TeamService();
