// server/services/LeaveCreditScheduler.js
const db = require('../database/db');
const LeaveRuleEngine = require('./LeaveRuleEngine');
const LeaveLedgerService = require('./LeaveLedgerService');
const AuditService = require('./AuditService');

class LeaveCreditScheduler {
  /**
   * Run credit schedule for a specific date (or current date)
   * Strictly idempotent: will not credit the same cycle key twice!
   * Respects Date of Joining (DOJ): only credits employees who joined on or before target date.
   */
  static processSchedule(scheduleId, executionDate = new Date(), options = {}) {
    const targetDate = typeof executionDate === 'string' ? new Date(executionDate) : executionDate;
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const mmdd = `${month}-${day}`;
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const schedule = db.prepare(`
      SELECT s.*, lt.code as leave_code, lt.name as leave_name
      FROM leave_credit_schedules s
      JOIN leave_types lt ON lt.id = s.leave_type_id
      WHERE s.id = ? AND s.is_active = 1
    `).get(scheduleId);

    if (!schedule) {
      throw new Error(`Active credit schedule with ID ${scheduleId} not found.`);
    }

    // Determine cycle key for idempotency
    let cycleKey = `${schedule.leave_code}_${schedule.schedule_type}_${year}_${schedule.credit_month_day || mmdd}`;
    if (options.customCycleKey) {
      cycleKey = options.customCycleKey;
    }

    // 1. Check cycle-level idempotency: Has this cycle already executed?
    const existingExecution = db.prepare(`
      SELECT * FROM credit_schedule_executions WHERE cycle_key = ?
    `).get(cycleKey);

    if (existingExecution && !options.force) {
      return {
        alreadyExecuted: true,
        cycleKey,
        executedAt: existingExecution.executed_at,
        employeesCreditedCount: existingExecution.employees_credited_count,
        message: `Schedule '${schedule.schedule_name}' has already been executed for cycle ${cycleKey}.`
      };
    }

    // 2. Fetch active employees who joined on or before this cycle's credit date
    const employees = db.prepare(`
      SELECT * FROM employees 
      WHERE status = 'ACTIVE' AND date_of_joining <= ?
    `).all(targetDateStr);

    const creditResults = [];

    const processTransaction = db.transaction(() => {
      for (const emp of employees) {
        // Individual idempotency check: employee must not have already received credit for this cycle
        const existingTx = db.prepare(`
          SELECT id FROM leave_transactions
          WHERE employee_id = ? AND leave_type_id = ? AND reference_id = ?
        `).get(emp.employee_id, schedule.leave_type_id, cycleKey);

        if (existingTx && !options.force) {
          continue;
        }

        // Calculate dynamic periodic credit using Rule Engine
        const periodicResult = LeaveRuleEngine.calculatePeriodicCredit(emp, schedule.leave_type_id, targetDate);
        const creditAmount = typeof periodicResult === 'object' ? periodicResult.creditAmount : periodicResult;
        const ruleVersionId = typeof periodicResult === 'object' ? periodicResult.ruleVersionId : null;

        if (creditAmount > 0) {
          const tx = LeaveLedgerService.recordTransaction({
            employeeId: emp.employee_id,
            leaveTypeId: schedule.leave_type_id,
            transactionType: 'PERIODIC_CREDIT',
            amount: creditAmount,
            referenceId: cycleKey,
            ruleVersionId,
            remarks: `Automated Scheduled Credit: ${schedule.schedule_name} (${cycleKey})`,
            createdBy: 'SYSTEM_SCHEDULER',
            year
          });

          creditResults.push({
            employeeId: emp.employee_id,
            name: emp.name,
            credited: creditAmount,
            runningBalance: tx.running_balance
          });
        }
      }

      // Record execution record in credit_schedule_executions
      db.prepare(`
        INSERT INTO credit_schedule_executions (schedule_id, cycle_key, employees_credited_count, details_json)
        VALUES (?, ?, ?, ?)
      `).run(
        schedule.id,
        cycleKey,
        creditResults.length,
        JSON.stringify({ summary: `Credited ${creditResults.length} employees`, timestamp: new Date().toISOString() })
      );

      // Update last_run_at on schedule
      db.prepare(`UPDATE leave_credit_schedules SET last_run_at = CURRENT_TIMESTAMP WHERE id = ?`).run(schedule.id);

      // Log audit
      AuditService.log({
        actorEmail: 'SYSTEM_SCHEDULER',
        action: 'EXECUTE_LEAVE_CREDIT_SCHEDULE',
        entityType: 'CREDIT_SCHEDULE',
        entityId: schedule.id,
        newValues: { cycleKey, employeesCredited: creditResults.length },
        remarks: `Executed schedule ${schedule.schedule_name} for cycle ${cycleKey}`
      });
    });

    processTransaction();

    return {
      success: true,
      alreadyExecuted: false,
      cycleKey,
      scheduleName: schedule.schedule_name,
      leaveType: schedule.leave_code,
      employeesCreditedCount: creditResults.length,
      details: creditResults
    };
  }

  /**
   * Run credit upon employee creation / onboarding based on DOJ and active rules
   * Strictly idempotent per employee and leave type
   */
  static processJoiningCredit(employee, creatorEmail = 'SYSTEM') {
    const applicableTypes = LeaveRuleEngine.getApplicableLeaveTypes(employee);
    const credits = [];

    const doj = new Date(employee.date_of_joining);
    const year = doj.getFullYear();

    for (const lt of applicableTypes) {
      // Check if joining credit already recorded
      const referenceId = `JOINING_${employee.employee_id}`;
      const existingTx = db.prepare(`
        SELECT id FROM leave_transactions 
        WHERE employee_id = ? AND leave_type_id = ? AND reference_id = ?
      `).get(employee.employee_id, lt.id, referenceId);

      if (existingTx) {
        continue;
      }

      const initial = LeaveRuleEngine.calculateInitialCredit(employee, lt.id, doj);

      if (initial.amount > 0) {
        const tx = LeaveLedgerService.recordTransaction({
          employeeId: employee.employee_id,
          leaveTypeId: lt.id,
          transactionType: 'INITIAL_CREDIT',
          amount: initial.amount,
          referenceId,
          ruleVersionId: initial.ruleVersionId,
          remarks: `Initial Entitlement on Joining (DOJ: ${employee.date_of_joining}, Formula: ${initial.formula})`,
          createdBy: creatorEmail,
          year
        });

        credits.push({
          leaveType: lt.code,
          name: lt.name,
          amount: initial.amount,
          formula: initial.formula,
          balance: tx.running_balance
        });
      }
    }

    return credits;
  }
}

module.exports = LeaveCreditScheduler;
