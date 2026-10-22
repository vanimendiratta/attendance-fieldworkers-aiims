'use strict';

const { query }                              = require('../db/database');
const { STATE_DISTRICTS_MAP, getDistrictsForState, normalizeStateName } = require('../data/india_states_districts');

/**
 * Team Service (PostgreSQL async version)
 *
 * Date-function fix:
 *   SQLite: date(a.created_at) = date('now')
 *   PostgreSQL: a.created_at::date = CURRENT_DATE
 *
 * All methods are async.
 */
class TeamService {
  /**
   * List all teams for an employer, optionally filtered by state and district.
   * @returns {Promise<Array>}
   */
  async listTeams(employerId, filterState = null, filterDistrict = null) {
    const params = [employerId];
    let sql = `
      SELECT t.*,
        COUNT(DISTINCT e.id) AS member_count,
        COUNT(DISTINCT CASE WHEN a.attendance_status IN ('CHECKED_IN', 'ON_BREAK') THEN a.id END) AS active_attendance_count
      FROM teams t
      LEFT JOIN employees e ON e.team_id = t.id AND e.is_active = 1
      LEFT JOIN attendance a ON a.team_id = t.id AND a.attendance_status IN ('CHECKED_IN', 'ON_BREAK')
        AND a.created_at::date = CURRENT_DATE
      WHERE t.employer_id = $1
    `;

    if (filterState && filterState !== 'ALL') {
      params.push(filterState);
      sql += ` AND t.state = $${params.length}`;
    }
    if (filterDistrict && filterDistrict !== 'ALL') {
      params.push(filterDistrict);
      sql += ` AND t.district = $${params.length}`;
    }

    sql += ' GROUP BY t.id ORDER BY t.state ASC, t.district ASC, t.name ASC';

    const result = await query(sql, params);
    return result.rows;
  }

  /**
   * Create a new team assigned to a specific State and District.
   * @returns {Promise<Object>}
   */
  async createTeam(employerId, { name, state, district, description }) {
    if (!name || !name.trim())     throw new Error('Team name is required.');
    if (!state || !state.trim())   throw new Error('State/UT is required.');
    if (!district || !district.trim()) throw new Error('District is required.');

    const canonicalState = normalizeStateName(state);
    const validDistricts = getDistrictsForState(canonicalState);
    if (validDistricts.length === 0) {
      throw new Error(`Unrecognized Indian State or Union Territory: "${state}".`);
    }

    const matchedDist = validDistricts.find(
      d => d.toLowerCase() === district.trim().toLowerCase()
    );
    if (!matchedDist) {
      throw new Error(`District "${district}" does not belong to State "${canonicalState}".`);
    }

    const teamId = `TEAM-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
    const now    = new Date().toISOString();

    await query(
      `INSERT INTO teams (id, employer_id, name, state, district, description, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [teamId, employerId, name.trim(), canonicalState, matchedDist, description ? description.trim() : null, now]
    );

    const result = await query('SELECT * FROM teams WHERE id = $1', [teamId]);
    return result.rows[0];
  }

  /**
   * Assign an employee to a team (syncs team_id, state, and district).
   * @returns {Promise<Object>}
   */
  async assignEmployeeTeam(employerId, employeeId, teamId) {
    const empResult = await query(
      'SELECT * FROM employees WHERE id = $1 AND employer_id = $2',
      [employeeId, employerId]
    );
    if (empResult.rows.length === 0) {
      throw new Error('Employee not found for this employer.');
    }

    if (!teamId) {
      // Clear team assignment
      await query(
        'UPDATE employees SET team_id = NULL, state = NULL, district = NULL WHERE id = $1',
        [employeeId]
      );
      return { success: true, message: 'Employee unassigned from team.' };
    }

    const teamResult = await query(
      'SELECT * FROM teams WHERE id = $1 AND employer_id = $2',
      [teamId, employerId]
    );
    if (teamResult.rows.length === 0) {
      throw new Error('Team not found for this employer.');
    }

    const team = teamResult.rows[0];
    await query(
      'UPDATE employees SET team_id = $1, state = $2, district = $3 WHERE id = $4',
      [team.id, team.state, team.district, employeeId]
    );

    return {
      success:   true,
      employee_id: employeeId,
      team_id:   team.id,
      team_name: team.name,
      state:     team.state,
      district:  team.district
    };
  }

  /**
   * Multi-State and Multi-District Real-Time Attendance Matrix.
   *
   * Date handling note:
   *   Timestamps are stored as ISO 8601 TEXT strings (UTC).
   *   We compare dates using ::date cast which uses the database server's
   *   timezone (UTC). The targetDate parameter is always passed as a
   *   YYYY-MM-DD string that the caller derives using the org's Asia/Kolkata
   *   timezone, so the cast is consistent with the application's behavior.
   *
   * @returns {Promise<Object>}
   */
  async getMultiStateAttendanceMatrix(employerId, dateStr = null) {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);

    const rowsResult = await query(
      `SELECT
        COALESCE(a.state, e.state, t.state, 'Unassigned') AS state,
        COALESCE(a.district, e.district, t.district, 'Unassigned') AS district,
        COALESCE(t.name, 'Direct Assignment') AS team_name,
        a.attendance_status,
        a.work_mode,
        COUNT(a.id) AS count
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      WHERE a.employer_id = $1 AND a.created_at::date = $2::date
      GROUP BY 1, 2, 3, 4, 5`,
      [employerId, targetDate]
    );
    const rows = rowsResult.rows;

    const allTeamsResult = await query(
      `SELECT id, name, state, district
       FROM teams
       WHERE employer_id = $1
       ORDER BY state ASC, district ASC, name ASC`,
      [employerId]
    );
    const allTeams = allTeamsResult.rows;

    // Build structured multi-state hierarchy
    const stateMap = {};

    allTeams.forEach(team => {
      if (!stateMap[team.state]) {
        stateMap[team.state] = {
          state: team.state, total_active: 0, total_completed: 0, total_records: 0, districts: {}
        };
      }
      if (!stateMap[team.state].districts[team.district]) {
        stateMap[team.state].districts[team.district] = {
          district: team.district, active: 0, on_break: 0, completed: 0,
          field_work_active: 0, office_active: 0, teams: []
        };
      }
      stateMap[team.state].districts[team.district].teams.push({ id: team.id, name: team.name });
    });

    rows.forEach(r => {
      const st  = r.state;
      const dst = r.district;

      if (!stateMap[st]) {
        stateMap[st] = {
          state: st, total_active: 0, total_completed: 0, total_records: 0, districts: {}
        };
      }
      if (!stateMap[st].districts[dst]) {
        stateMap[st].districts[dst] = {
          district: dst, active: 0, on_break: 0, completed: 0,
          field_work_active: 0, office_active: 0, teams: []
        };
      }

      const distObj = stateMap[st].districts[dst];
      const count   = Number(r.count) || 0;

      if (r.attendance_status === 'CHECKED_IN') {
        distObj.active           += count;
        stateMap[st].total_active += count;
        if (r.work_mode === 'FIELD_WORK') distObj.field_work_active += count;
        else distObj.office_active += count;
      } else if (r.attendance_status === 'ON_BREAK') {
        distObj.on_break          += count;
        stateMap[st].total_active += count;
      } else if (r.attendance_status === 'COMPLETED') {
        distObj.completed           += count;
        stateMap[st].total_completed += count;
      }

      stateMap[st].total_records += count;
    });

    const stateList = Object.values(stateMap).map(s => ({
      state:           s.state,
      total_active:    s.total_active,
      total_completed: s.total_completed,
      total_records:   s.total_records,
      districts:       Object.values(s.districts)
    })).sort((a, b) => b.total_active - a.total_active || a.state.localeCompare(b.state));

    const totalActiveCount = stateList.reduce((sum, s) => sum + s.total_active, 0);

    return {
      date:                targetDate,
      total_active:        totalActiveCount,
      total_states_active: stateList.filter(s => s.total_active > 0).length,
      states:              stateList
    };
  }
}

module.exports = new TeamService();
