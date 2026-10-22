// server/services/LeaveRuleEngine.js
const db = require('../database/db');
const LeaveLedgerService = require('./LeaveLedgerService');

class LeaveRuleEngine {
  /**
   * 1. Get all leave types applicable for a specific employee
   */
  static getApplicableLeaveTypes(employee) {
    if (!employee) return [];
    
    // Fetch active leave types from database
    const allTypes = db.prepare(`
      SELECT * FROM leave_types 
      WHERE is_active = 1 
      ORDER BY id ASC
    `).all();

    return allTypes.filter(lt => {
      // Check if there is an active rule version for this employee's attributes
      const rule = this.getApplicableRule(employee, lt.id);
      return rule !== null;
    });
  }

  /**
   * 2. Get applicable rule and active rule version for an employee, leave type, and reference date
   * Strictly resolves by effective date range: effective_from <= date AND (effective_to IS NULL OR effective_to >= date)
   */
  static getApplicableRule(employee, leaveTypeId, date = new Date()) {
    const targetDate = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    const dept = (employee && employee.department) ? employee.department : 'ALL';
    const isNum = typeof leaveTypeId === 'number';
    const codeStr = typeof leaveTypeId === 'string' ? leaveTypeId : '';

    const rule = db.prepare(`
      SELECT r.*, lt.code as leave_type_code, v.id as version_id, v.version_number, v.effective_from, v.effective_to, v.config_json
      FROM leave_rules r
      JOIN leave_types lt ON lt.id = r.leave_type_id
      JOIN leave_rule_versions v ON v.leave_rule_id = r.id
      WHERE (
        (? = 1 AND r.leave_type_id = ?) OR
        (? = 0 AND (lt.code = ? OR (lt.code IN ('CO', 'COMP_OFF') AND ? IN ('CO', 'COMP_OFF'))))
      )
        AND r.is_active = 1
        AND v.status = 'ACTIVE'
        AND v.effective_from <= ?
        AND (v.effective_to IS NULL OR v.effective_to >= ?)
      ORDER BY 
        CASE 
          WHEN r.applicable_department = ? THEN 1
          WHEN r.applicable_department = 'ALL' THEN 2
          ELSE 3
        END ASC,
        v.version_number DESC
      LIMIT 1
    `).get(
      isNum ? 1 : 0,
      isNum ? leaveTypeId : 0,
      isNum ? 1 : 0,
      codeStr,
      codeStr,
      targetDate,
      targetDate,
      dept
    );

    if (!rule) return null;

    try {
      rule.config = JSON.parse(rule.config_json);
    } catch (e) {
      rule.config = {};
    }

    return rule;
  }

  /**
   * 3. Calculate initial credit when an employee joins or when leave cycle starts
   * Evaluates Employee attributes + Date of Joining + Applicable Rule Version + Rule Configuration
   * Supports: FULL_CREDIT, PRO_RATA, COMPLETED_MONTHS, DEPARTMENTAL_DISCRETION, CUSTOM_FORMULA, NOT_APPLICABLE
   */
  static calculateInitialCredit(employee, leaveTypeId, cycleDate = new Date()) {
    const rule = this.getApplicableRule(employee, leaveTypeId, cycleDate);
    if (!rule || !rule.config) {
      return { amount: 0, formula: 'NO_RULE_CONFIGURED', ruleVersionId: null };
    }

    const cfg = rule.config;
    const doj = new Date(employee.date_of_joining);
    const cycleYear = typeof cycleDate === 'string' ? new Date(cycleDate).getFullYear() : cycleDate.getFullYear();
    const dojYear = doj.getFullYear();

    // Check alternate entitlement for employee categories configured in the rule
    let baseEntitlement = Number(cfg.annual_entitlement || 0);
    if (cfg.alternate_entitlement && employee.employee_category === cfg.alternate_category) {
      baseEntitlement = Number(cfg.alternate_entitlement);
    }

    const treatment = cfg.mid_year_treatment || cfg.mid_year_joining_method || 'NOT_APPLICABLE';

    // Priority: CDER Joining Date Cutoff Policy (Tenure e.g. 01/04/2026 to 31/03/2027)
    if (treatment === 'CDER_JOINING_CUTOFF' || cfg.policy_name?.includes('CDER')) {
      const pStartParts = (cfg.policy_period_start || '2026-04-01').split('-').map(Number);
      const pEndParts = (cfg.policy_period_end || '2027-03-31').split('-').map(Number);
      const cutoffDay = Number(cfg.joining_cutoff_day !== undefined ? cfg.joining_cutoff_day : 25);

      const dojStr = String(employee.date_of_joining).trim();
      const dojParts = dojStr.split(/[-/]/).map(Number);
      const dYear = dojParts[0] > 1000 ? dojParts[0] : dojParts[2];
      const dMonth = dojParts[0] > 1000 ? dojParts[1] : dojParts[1]; // 1-indexed
      const dDay = dojParts[0] > 1000 ? dojParts[2] : dojParts[0];

      let startYear = dYear;
      let startMonth = dMonth;

      const isBeforeOrOnStart = (dYear < pStartParts[0]) || 
        (dYear === pStartParts[0] && dMonth < pStartParts[1]) || 
        (dYear === pStartParts[0] && dMonth === pStartParts[1] && dDay <= pStartParts[2]);

      if (isBeforeOrOnStart) {
        startYear = pStartParts[0];
        startMonth = pStartParts[1];
      } else {
        if (dDay <= cutoffDay) {
          startMonth = dMonth;
          startYear = dYear;
        } else {
          startMonth = dMonth + 1;
          startYear = dYear;
          if (startMonth > 12) {
            startMonth = 1;
            startYear += 1;
          }
        }
      }

      const leaveStartDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
      const endYear = pEndParts[0];
      const endMonth = pEndParts[1];
      const eligibleMonths = Math.max(0, (endYear - startYear) * 12 + (endMonth - startMonth) + 1);
      const leaveTypeCode = rule.leave_type_code || cfg.leave_type;

      if (leaveTypeCode === 'CL') {
        const annual = Number(cfg.annual_entitlement || 8.0);
        const rawCL = (annual / 12) * eligibleMonths;
        let roundedCL = rawCL;
        if (cfg.rounding_method === 'NEAREST_HALF_DAY') {
          roundedCL = Math.round(rawCL * 2) / 2;
        }
        return {
          amount: roundedCL,
          rawAmount: Number(rawCL.toFixed(4)),
          eligibleMonths,
          leaveStartDate,
          formula: `(${annual}/12)*${eligibleMonths}`,
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };
      }

      if (leaveTypeCode === 'EL') {
        const rate = Number(cfg.completed_month_rate || 2.5);
        const totalEL = Number((rate * eligibleMonths).toFixed(1));
        return {
          amount: totalEL,
          eligibleMonths,
          leaveStartDate,
          formula: `${rate}*${eligibleMonths}`,
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };
      }

      if (leaveTypeCode === 'RH') {
        const rhAmount = eligibleMonths >= 12
          ? Number(cfg.annual_entitlement || 2.0)
          : Number(cfg.six_month_entitlement || 1.0);
        return {
          amount: rhAmount,
          eligibleMonths,
          leaveStartDate,
          formula: eligibleMonths >= 12 ? 'ANNUAL_2' : 'SIX_MONTH_1',
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };
      }

      return {
        amount: 0,
        eligibleMonths,
        leaveStartDate,
        formula: 'CDER_UNSUPPORTED_TYPE',
        ruleVersionId: rule.version_id,
        ruleConfig: cfg
      };
    }

    // If employee joined in a prior calendar year, standard full entitlement applies for the new year cycle
    if (dojYear < cycleYear) {
      return {
        amount: baseEntitlement,
        formula: 'FULL_YEAR_ENTITLEMENT',
        ruleVersionId: rule.version_id,
        ruleConfig: cfg
      };
    }
    const dojMonth = doj.getMonth() + 1; // 1-indexed (Jan = 1, Dec = 12)
    const dojDay = doj.getDate();

    switch (treatment) {
      case 'FULL_CREDIT':
        return {
          amount: baseEntitlement,
          formula: 'FULL_CREDIT_POLICY',
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };

      case 'PRO_RATA': {
        const basis = cfg.pro_rata_basis || 'REMAINING_MONTHS';
        if (basis === 'REMAINING_DAYS') {
          // Days remaining in calendar year / 365
          const startOfYear = new Date(cycleYear, 0, 1);
          const endOfYear = new Date(cycleYear, 11, 31);
          const totalDaysInYear = Math.round((endOfYear - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
          const remainingDays = Math.max(0, Math.round((endOfYear - doj) / (1000 * 60 * 60 * 24)) + 1);
          const proRataAmount = Number(((remainingDays / totalDaysInYear) * baseEntitlement).toFixed(1));
          return {
            amount: Math.round(proRataAmount * 2) / 2,
            formula: `PRO_RATA_${remainingDays}_OF_${totalDaysInYear}_DAYS`,
            remainingDays,
            ruleVersionId: rule.version_id,
            ruleConfig: cfg
          };
        } else {
          // Remaining months in calendar year including joining month
          const remainingMonths = Math.max(0, 13 - dojMonth);
          const proRataAmount = Number(((remainingMonths / 12) * baseEntitlement).toFixed(1));
          return {
            amount: Math.round(proRataAmount * 2) / 2, // round to nearest half-day
            formula: `PRO_RATA_${remainingMonths}_OF_12_MONTHS`,
            remainingMonths,
            ruleVersionId: rule.version_id,
            ruleConfig: cfg
          };
        }
      }

      case 'COMPLETED_MONTHS':
      case 'COMPLETED_MONTHS_RATE': {
        // e.g. for EL or custom rate: rate per completed calendar month
        const ratePerMonth = Number(cfg.completed_month_rate || (baseEntitlement > 0 ? baseEntitlement / 12 : 0));
        
        // Determine whether cycle is half-yearly (H1 ends June 30, H2 ends Dec 31) or annual (ends Dec 31)
        const isHalfYearly = cfg.cycle_type === 'HALF_YEARLY' || cfg.semi_annual_credit !== undefined;
        let cycleEndMonth = 12;
        if (isHalfYearly) {
          cycleEndMonth = dojMonth > 6 ? 12 : 6;
        }

        // Completed full months: if joined on the 1st of month, that entire month counts; otherwise full months from next month
        const startMonth = dojDay === 1 ? dojMonth : dojMonth + 1;
        const completedMonths = Math.max(0, cycleEndMonth - startMonth + 1);
        const calculatedCredit = Number((completedMonths * ratePerMonth).toFixed(1));

        return {
          amount: Math.round(calculatedCredit * 2) / 2,
          formula: `COMPLETED_MONTHS_${completedMonths}_AT_${ratePerMonth}_PER_MONTH`,
          completedMonths,
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };
      }

      case 'DEPARTMENTAL_DISCRETION':
        // Policy mandates departmental administrative determination; no automatic credit
        return {
          amount: 0,
          formula: 'DEPARTMENTAL_DISCRETION',
          requiresManualAction: true,
          message: 'Mid-year credit is subject to departmental discretion and manual administrative adjustment.',
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };

      case 'CUSTOM_FORMULA': {
        // Support custom formula expressions or static tiers configured in database
        let customAmount = 0;
        if (typeof cfg.custom_amount === 'number') {
          customAmount = cfg.custom_amount;
        } else if (cfg.quarterly_rate) {
          const quarter = Math.ceil(dojMonth / 3);
          const remainingQuarters = 5 - quarter;
          customAmount = remainingQuarters * Number(cfg.quarterly_rate);
        }
        return {
          amount: customAmount,
          formula: 'CUSTOM_FORMULA',
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };
      }

      case 'NOT_APPLICABLE':
      default:
        // No credit for mid-year joining unless explicitly configured
        return {
          amount: 0,
          formula: 'NOT_APPLICABLE_FOR_MID_YEAR',
          ruleVersionId: rule.version_id,
          ruleConfig: cfg
        };
    }
  }

  /**
   * 4. Calculate periodic credit for an employee on a scheduled credit date (e.g. 1 Jan, 1 July)
   * Strictly reads values from active database rule version; no hardcoded numbers
   */
  static calculatePeriodicCredit(employee, leaveTypeId, creditDate = new Date()) {
    const rule = this.getApplicableRule(employee, leaveTypeId, creditDate);
    if (!rule || !rule.config) {
      return { creditAmount: 0, ruleVersionId: null };
    }

    const cfg = rule.config;
    let standardCredit = 0;

    // Check configured periodic credit amounts from rule configuration
    if (cfg.semi_annual_credit !== undefined) {
      standardCredit = Number(cfg.semi_annual_credit);
    } else if (cfg.annual_entitlement !== undefined && cfg.credit_frequency === 'ANNUAL') {
      standardCredit = Number(cfg.annual_entitlement);
    } else if (cfg.periodic_credit !== undefined) {
      standardCredit = Number(cfg.periodic_credit);
    } else if (cfg.standard_credit !== undefined) {
      standardCredit = Number(cfg.standard_credit);
    } else {
      // Look up credit amount from leave_credit_schedules table if defined
      const sched = db.prepare(`SELECT credit_amount FROM leave_credit_schedules WHERE leave_type_id = ? AND is_active = 1`).get(leaveTypeId);
      if (sched && sched.credit_amount !== null) {
        standardCredit = Number(sched.credit_amount);
      }
    }

    // Check accumulation ceiling from database rule if configured
    let actualCredit = standardCredit;
    let isCapped = false;
    const ceiling = cfg.accumulation_ceiling !== undefined ? Number(cfg.accumulation_ceiling) : null;

    if (ceiling !== null) {
      const currentBalance = this.calculateBalance(employee, leaveTypeId).current_balance;
      if (currentBalance + standardCredit > ceiling) {
        actualCredit = Math.max(0, Number((ceiling - currentBalance).toFixed(2)));
        isCapped = actualCredit < standardCredit;
      }
    }

    return {
      creditAmount: actualCredit,
      standardCredit,
      accumulationCeiling: ceiling,
      isCapped,
      ruleVersionId: rule.version_id
    };
  }

  /**
   * 5. Get applicable weekly-off days for an employee on a specific date
   * Strictly database-driven from weekly_off_rules table
   */
  static isWeeklyOff(date, employee) {
    const d = new Date(date);
    const dayOfWeek = d.getDay(); // 0 is Sunday, 6 is Saturday

    // Find specific weekly-off rule for employee's department/category
    let rule = db.prepare(`
      SELECT pattern_json FROM weekly_off_rules
      WHERE is_active = 1
        AND (applicable_category = ? OR applicable_category = 'ALL')
        AND (department = ? OR department = 'ALL')
      ORDER BY CASE 
        WHEN applicable_category = ? THEN 1
        WHEN department = ? THEN 2
        ELSE 3
      END ASC
      LIMIT 1
    `).get(
      employee.is_field_worker ? 'FIELD_WORKER' : (employee.employee_category || 'GENERAL'),
      employee.department || 'ALL',
      employee.is_field_worker ? 'FIELD_WORKER' : (employee.employee_category || 'GENERAL'),
      employee.department || 'ALL'
    );

    if (rule) {
      try {
        const pattern = JSON.parse(rule.pattern_json);
        if (pattern.days && Array.isArray(pattern.days)) {
          return pattern.days.includes(dayOfWeek);
        }
      } catch (e) {}
    }

    // Check system_settings for organization default weekly-off pattern
    const defaultSetting = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'DEFAULT_WEEKLY_OFF_PATTERN'`).get();
    if (defaultSetting) {
      try {
        const pattern = JSON.parse(defaultSetting.setting_value);
        if (pattern.days && Array.isArray(pattern.days)) {
          return pattern.days.includes(dayOfWeek);
        }
      } catch (e) {}
    }

    // Pure technical fallback if no rule configured: Sunday only
    return dayOfWeek === 0;
  }

  /**
   * 6. Get applicable holidays between two dates for an employee from holidays table
   */
  static getApplicableHolidays(fromDate, toDate, employee) {
    return db.prepare(`
      SELECT * FROM holidays
      WHERE is_active = 1
        AND holiday_date >= ?
        AND holiday_date <= ?
        AND (location = 'ALL' OR location = ?)
        AND (department = 'ALL' OR department = ?)
        AND (applicable_category = 'ALL' OR applicable_category = ?)
      ORDER BY holiday_date ASC
    `).all(
      fromDate,
      toDate,
      employee.location || 'ALL',
      employee.department || 'ALL',
      employee.is_field_worker ? 'FIELD_WORKER' : (employee.employee_category || 'GENERAL')
    );
  }

  /**
   * 7. Check if a single date is an applicable holiday for an employee
   */
  static isHoliday(dateStr, employee, allowRestricted = false) {
    let sql = `
      SELECT id, holiday_name, holiday_type FROM holidays
      WHERE is_active = 1
        AND holiday_date = ?
        AND (location = 'ALL' OR location = ?)
        AND (department = 'ALL' OR department = ?)
        AND (applicable_category = 'ALL' OR applicable_category = ?)
    `;
    if (!allowRestricted) {
      sql += ` AND holiday_type != 'RESTRICTED'`;
    }
    sql += ` LIMIT 1`;

    const holiday = db.prepare(sql).get(
      dateStr,
      employee.location || 'ALL',
      employee.department || 'ALL',
      employee.is_field_worker ? 'FIELD_WORKER' : (employee.employee_category || 'GENERAL')
    );

    return holiday || null;
  }

  /**
   * 8. Evaluate Sandwich Rule
   * Dynamically checks sandwich_rules table and active version configuration
   */
  static evaluateSandwichRule(employee, leaveType, fromDate, toDate) {
    const sandwichRule = db.prepare(`
      SELECT * FROM sandwich_rules 
      WHERE is_active = 1 
        AND effective_from <= ? 
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY version DESC 
      LIMIT 1
    `).get(fromDate, fromDate);

    if (!sandwichRule) {
      return { isSandwichApplicable: false, chargesIntervening: false, reason: 'No active sandwich rule' };
    }

    let applicableTypes = [];
    try {
      applicableTypes = JSON.parse(sandwichRule.applicable_leave_types_json);
    } catch (e) {
      applicableTypes = [];
    }

    if (!applicableTypes.includes(leaveType.code)) {
      return {
        isSandwichApplicable: false,
        chargesIntervening: false,
        reason: `Sandwich rule not applicable to leave type ${leaveType.code}`
      };
    }

    return {
      isSandwichApplicable: true,
      chargesIntervening: sandwichRule.charge_intervening_days === 1,
      includeWeeklyOffs: sandwichRule.include_weekly_offs === 1,
      includeHolidays: sandwichRule.include_public_holidays === 1,
      ruleName: sandwichRule.rule_name,
      version: sandwichRule.version
    };
  }

  /**
   * 9. Calculate calendar days and chargeable days dynamically
   */
  static calculateChargeableDays(employee, leaveType, fromDate, toDate, options = {}) {
    const isHalfDay = Boolean(options.isHalfDay);
    const rule = this.getApplicableRule(employee, leaveType.id, fromDate);
    const ruleConfig = rule ? rule.config : {};

    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw new Error('Invalid date range: fromDate must be on or before toDate');
    }

    if (isHalfDay) {
      return {
        calendarDays: 1,
        weeklyOffDays: 0,
        holidayDays: 0,
        sandwichDays: 0,
        chargeableDays: 0.5,
        breakdown: [{
          date: fromDate,
          isWeeklyOff: false,
          isHoliday: false,
          isChargeable: true,
          chargeableValue: 0.5,
          reason: 'Half Day'
        }],
        ruleVersionId: rule ? rule.version_id : null
      };
    }

    const breakdown = [];
    let calendarDays = 0;
    let weeklyOffDays = 0;
    let holidayDays = 0;
    let chargeableDays = 0;

    const curr = new Date(start);
    while (curr <= end) {
      calendarDays += 1;
      const dateStr = curr.toISOString().split('T')[0];
      const isWOff = this.isWeeklyOff(dateStr, employee);
      const isRhType = Boolean(leaveType && leaveType.code === 'RH');
      const hol = this.isHoliday(dateStr, employee, isRhType);

      let isChargeable = true;
      let chargeValue = 1.0;
      let reason = 'Working Day';

      // Check exclusions configured in database rule
      const excludeWeeklyOffs = ruleConfig.exclude_weekly_offs !== false;
      const excludeHolidays = ruleConfig.exclude_public_holidays !== false;

      if (isWOff && excludeWeeklyOffs) {
        weeklyOffDays += 1;
        isChargeable = false;
        chargeValue = 0;
        reason = 'Weekly Off (Excluded)';
      } else if (hol && excludeHolidays) {
        holidayDays += 1;
        isChargeable = false;
        chargeValue = 0;
        reason = `Holiday: ${hol.holiday_name} (Excluded)`;
      } else {
        chargeableDays += 1;
      }

      breakdown.push({
        date: dateStr,
        isWeeklyOff: isWOff,
        isHoliday: Boolean(hol),
        holidayName: hol ? hol.holiday_name : null,
        isChargeable,
        chargeableValue: chargeValue,
        reason
      });

      curr.setDate(curr.getDate() + 1);
    }

    // Evaluate sandwich rule from database
    const sandwichResult = this.evaluateSandwichRule(employee, leaveType, fromDate, toDate);
    let sandwichDays = 0;

    if (sandwichResult.isSandwichApplicable && sandwichResult.chargesIntervening) {
      breakdown.forEach(item => {
        if (!item.isChargeable) {
          const chargeWOff = item.isWeeklyOff && sandwichResult.includeWeeklyOffs;
          const chargeHol = item.isHoliday && sandwichResult.includeHolidays;

          if (chargeWOff || chargeHol) {
            item.isChargeable = true;
            item.chargeableValue = 1.0;
            item.reason += ' (Charged under Sandwich Rule)';
            chargeableDays += 1;
            sandwichDays += 1;
          }
        }
      });
    }

    return {
      calendarDays,
      weeklyOffDays,
      holidayDays,
      sandwichDays,
      chargeableDays: Number(chargeableDays.toFixed(2)),
      breakdown,
      ruleVersionId: rule ? rule.version_id : null,
      ruleConfig
    };
  }

  /**
   * 10. Validate leave eligibility and constraints before submission or approval
   */
  static validateLeaveEligibility(employee, leaveType, fromDate, toDate, options = {}) {
    const errors = [];

    // 1. Employee Active Status
    if (employee.status !== 'ACTIVE') {
      errors.push(`Employee status is ${employee.status}. Leaves can only be requested by ACTIVE employees.`);
    }

    // 2. Joining date validation: Leave cannot be taken before Date of Joining
    if (new Date(fromDate) < new Date(employee.date_of_joining)) {
      errors.push(`Leave from date (${fromDate}) cannot be earlier than employee's Date of Joining (${employee.date_of_joining}).`);
    }

    // 3. Overlapping leave requests
    // NOTE: excludeRequestId filtering is done in JS after the query (never interpolated into SQL)
    // to eliminate any SQL injection risk from untrusted caller-supplied values.
    let overlappingRaw = db.prepare(`
      SELECT request_number, from_date, to_date, status 
      FROM leave_requests 
      WHERE employee_id = ? 
        AND status IN ('PENDING', 'APPROVED', 'HOLD')
        AND NOT (to_date < ? OR from_date > ?)
    `).all(employee.employee_id, fromDate, toDate);

    const excludeId = options.excludeRequestId ? Number(options.excludeRequestId) : null;
    const overlapping = excludeId
      ? overlappingRaw.filter(r => r.id !== excludeId)
      : overlappingRaw;

    if (overlapping.length > 0) {
      errors.push(`Dates conflict with existing request ${overlapping[0].request_number} (${overlapping[0].from_date} to ${overlapping[0].to_date}) in status ${overlapping[0].status}.`);
    }


    // 4. Calculate dynamic chargeable days
    const calculation = this.calculateChargeableDays(employee, leaveType, fromDate, toDate, options);

    if (calculation.chargeableDays <= 0) {
      errors.push('Calculated chargeable days are 0. The selected period consists entirely of non-working days/holidays.');
    }

    // 5. Min / Max days per request from leave type master
    if (leaveType.min_days_per_request && calculation.chargeableDays < leaveType.min_days_per_request) {
      errors.push(`Minimum days for ${leaveType.name} is ${leaveType.min_days_per_request} day(s).`);
    }
    if (leaveType.max_days_per_request && calculation.chargeableDays > leaveType.max_days_per_request) {
      errors.push(`Maximum continuous days for ${leaveType.name} is ${leaveType.max_days_per_request} day(s).`);
    }

    // 6. Max continuous days from active rule config in database
    const rule = this.getApplicableRule(employee, leaveType.id, fromDate);
    if (rule && rule.config && rule.config.max_continuous_days) {
      if (calculation.chargeableDays > rule.config.max_continuous_days) {
        errors.push(`Active policy (${rule.rule_name} v${rule.version_number}) allows a maximum of ${rule.config.max_continuous_days} continuous days for this leave type.`);
      }
    }

    // 7. Balance check (Opening + Credits + Adjustments - Used - Pending)
    const balanceInfo = LeaveLedgerService.getBalance(employee.employee_id, leaveType.id, new Date(fromDate).getFullYear());
    const availableBalance = balanceInfo.available_balance;

    if (calculation.chargeableDays > availableBalance) {
      errors.push(`Insufficient leave balance. Requested: ${calculation.chargeableDays} days, Available balance: ${availableBalance} days.`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      calculation,
      balanceInfo,
      rule
    };
  }

  /**
   * 11. Calculate Comp-Off for an employee working on a weekly-off or holiday
   */
  static calculateCompOff(employee, workedDate, qualifyingType = 'SUNDAY') {
    // 1. Fetch Comp-Off configuration from database (leave_rules or system_settings)
    const dept = (employee && employee.department) ? employee.department : 'ALL';
    let compOffRule = db.prepare(`
      SELECT v.config_json FROM leave_rules r
      JOIN leave_types lt ON lt.id = r.leave_type_id
      JOIN leave_rule_versions v ON v.leave_rule_id = r.id AND v.status = 'ACTIVE'
      WHERE lt.code IN ('COMP_OFF', 'CO')
      ORDER BY 
        CASE 
          WHEN r.applicable_department = ? THEN 1
          WHEN r.applicable_department = 'ALL' THEN 2
          ELSE 3
        END ASC,
        v.version_number DESC LIMIT 1
    `).get(dept);

    let cfg = {};
    if (compOffRule) {
      try { cfg = JSON.parse(compOffRule.config_json); } catch (e) {}
    }

    // Verify worked date is Sunday or Holiday if policy specifies qualifying duty
    const workedD = new Date(workedDate);
    const dayOfWeek = workedD.getDay(); // 0 = Sunday
    const isSunday = dayOfWeek === 0;
    const isGazettedHol = this.isHoliday(workedDate, employee);

    if (cfg.requires_qualifying_duty && !isSunday && !isGazettedHol) {
      return {
        eligible: false,
        reason: `Worked date (${workedDate}) is not a Sunday or Gazetted Holiday. Comp-Off is only eligible for Sunday or Gazetted Holiday duty.`,
        creditedDays: 0
      };
    }

    // Fallback to system_settings if not in rule version
    const valSetting = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_OFF_VALIDITY_DAYS'`).get();
    const rateSetting = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_OFF_CREDIT_RATE'`).get();
    const catSetting = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_OFF_ELIGIBLE_CATEGORIES'`).get();

    const validityDays = Number(cfg.validity_days || valSetting?.setting_value || 60);
    const creditRate = Number(cfg.credit_rate || rateSetting?.setting_value || 1.0);
    const eligibleCategories = cfg.eligible_categories || (catSetting ? catSetting.setting_value.split(',') : ['FIELD_WORKER']);

    // Check duty assignment on the specific date worked (from the day they were marked YES or NO)
    let isFieldWorkerOnDate = false;
    let dutyPeriod = null;

    try {
      dutyPeriod = db.prepare(`
        SELECT is_field_worker, effective_from, effective_to, remarks
        FROM employee_field_status_history
        WHERE employee_id = ?
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC, id DESC
        LIMIT 1
      `).get(employee.employee_id, workedDate, workedDate);
    } catch (e) {
      // Graceful fallback if history table not present in lightweight test mocks
    }

    if (dutyPeriod) {
      isFieldWorkerOnDate = Boolean(dutyPeriod.is_field_worker === 1);
    } else {
      // Fallback: check if workedDate is before employee date of joining
      if (employee.date_of_joining && workedDate < employee.date_of_joining) {
        return {
          eligible: false,
          reason: `Worked date (${workedDate}) is prior to employee date of joining (${employee.date_of_joining}).`,
          creditedDays: 0
        };
      }
      isFieldWorkerOnDate = Boolean(employee.is_field_worker && Number(employee.is_field_worker) === 1);
    }

    if (!isFieldWorkerOnDate) {
      const dateInfo = dutyPeriod?.effective_from 
        ? ` (marked on Hospital / Desk Duty effective from ${dutyPeriod.effective_from})`
        : '';
      return {
        eligible: false,
        reason: `Comp-Off is not provided: Employee was not on Field Duty on ${workedDate}${dateInfo}. From the day personnel return to hospital duty, Comp-Off is strictly not provided.`,
        creditedDays: 0
      };
    }

    // Check if already claimed for that date
    const existing = db.prepare(`
      SELECT id FROM comp_off_records 
      WHERE employee_id = ? AND worked_date = ? AND status != 'CANCELLED'
    `).get(employee.employee_id, workedDate);

    if (existing) {
      return {
        eligible: false,
        reason: `Comp-Off already registered for ${workedDate}.`,
        creditedDays: 0
      };
    }

    const expDate = new Date(workedDate);
    expDate.setDate(expDate.getDate() + validityDays);

    return {
      eligible: true,
      creditedDays: creditRate,
      expiryDate: expDate.toISOString().split('T')[0],
      qualifyingType
    };
  }

  /**
   * 12. Calculate current leave balance wrapper
   */
  static calculateBalance(employee, leaveTypeId, year = new Date().getFullYear()) {
    return LeaveLedgerService.getBalance(employee.employee_id, leaveTypeId, year);
  }

  /**
   * Generate an immutable snapshot of the leave calculation for audit and historical fidelity
   */
  static generateCalculationSnapshot(employee, leaveType, calculation, balanceBefore, reviewContext = {}) {
    return JSON.stringify({
      employee_id: employee.employee_id,
      employee_name: employee.name,
      date_of_joining: employee.date_of_joining,
      is_field_worker: employee.is_field_worker,
      employee_category: employee.employee_category,
      leave_type_code: leaveType.code,
      leave_type_name: leaveType.name,
      rule_version_id: calculation.ruleVersionId,
      rule_config_snapshot: calculation.ruleConfig,
      calendar_days: calculation.calendarDays,
      weekly_off_days: calculation.weeklyOffDays,
      holiday_days: calculation.holidayDays,
      sandwich_days: calculation.sandwichDays,
      chargeable_days: calculation.chargeableDays,
      date_breakdown: calculation.breakdown,
      balance_before: balanceBefore,
      deduction: calculation.chargeableDays,
      balance_after: Number((balanceBefore - calculation.chargeableDays).toFixed(2)),
      calculated_at: new Date().toISOString(),
      ...reviewContext
    });
  }
}

module.exports = LeaveRuleEngine;
