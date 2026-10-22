// server/database/seed.js
const bcrypt = require('bcryptjs');
const db = require('./db');
const { runMigrations } = require('./migrate');

/**
 * Seed foundational master configuration and initial policies
 * Strictly independent of any demo or employee records
 */
function seedMasterPolicies() {
  runMigrations();
  console.log('[SEED] Seeding foundational policy masters and system rules...');

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (setting_key, setting_value, category, description)
    VALUES (?, ?, ?, ?)
  `);

  const insertHoliday = db.prepare(`
    INSERT OR IGNORE INTO holidays (holiday_date, holiday_name, holiday_type, location, department, applicable_category)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertWeeklyOff = db.prepare(`
    INSERT OR IGNORE INTO weekly_off_rules (rule_name, pattern_json, department, applicable_category, is_active)
    VALUES (?, ?, ?, ?, 1)
  `);

  const insertLeaveType = db.prepare(`
    INSERT OR IGNORE INTO leave_types (code, name, description, is_paid, requires_approval, allow_half_day, allow_hourly, min_days_per_request, max_days_per_request, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const insertLeaveRule = db.prepare(`
    INSERT OR IGNORE INTO leave_rules (leave_type_id, rule_code, rule_name, description, applicable_department, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const insertRuleVersion = db.prepare(`
    INSERT OR IGNORE INTO leave_rule_versions (leave_rule_id, version_number, effective_from, effective_to, status, config_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCreditSchedule = db.prepare(`
    INSERT OR IGNORE INTO leave_credit_schedules (leave_type_id, schedule_name, schedule_type, credit_month_day, credit_amount, calculation_rule_key, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const insertSandwichRule = db.prepare(`
    INSERT OR IGNORE INTO sandwich_rules (rule_name, version, applicable_leave_types_json, include_weekly_offs, include_public_holidays, charge_intervening_days, condition_description, is_active, effective_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO notification_templates (event_code, subject_template, body_template, is_active)
    VALUES (?, ?, ?, 1)
  `);

  const seedTransaction = db.transaction(() => {
    // 1. System Settings & Configuration Defaults
    insertSetting.run('ORG_NAME', 'National Health & Employee Administration', 'ORGANIZATION', 'Organization display name');
    insertSetting.run('LEAVE_CALENDAR_YEAR_START', '01-01', 'LEAVE_POLICY', 'Leave cycle start month and day (MM-DD)');
    insertSetting.run('DEFAULT_WEEKLY_OFF_PATTERN', JSON.stringify({ days: [0, 6] }), 'LEAVE_POLICY', 'Default weekly off days (0=Sunday, 6=Saturday)');
    insertSetting.run('COMP_OFF_VALIDITY_DAYS', '60', 'COMP_OFF', 'Number of days within which earned comp-off must be availed');
    insertSetting.run('COMP_OFF_CREDIT_RATE', '1.0', 'COMP_OFF', 'Days credited per qualifying duty day');
    insertSetting.run('COMP_OFF_ELIGIBLE_CATEGORIES', 'FIELD_WORKER', 'COMP_OFF', 'Comma-separated employee categories eligible for comp-off');

    // 2. Weekly Off Rules
    insertWeeklyOff.run('General Staff 5-Day Week', JSON.stringify({ days: [0, 6] }), 'ALL', 'GENERAL');
    insertWeeklyOff.run('Field Worker 6-Day Week', JSON.stringify({ days: [0] }), 'ALL', 'FIELD_WORKER');

    // 3. Holidays Master List (Official 17 Gazetted/National Holidays + 22 Central Govt Restricted Holidays)
    const currentYear = new Date().getFullYear();
    const holidays = [
      // --- Gazetted / National / Public Holidays (17 Days) ---
      [`${currentYear}-01-26`, 'Republic Day', 'NATIONAL', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-02-17`, 'Maha Shivratri', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-03-21`, 'Id-ul-Fitr', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-03-25`, 'Holi', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-03-31`, 'Mahavir Jayanti', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-04-03`, 'Good Friday', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-04-14`, 'Dr. B.R. Ambedkar Jayanti', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-05-01`, 'Buddha Purnima', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-05-28`, 'Id-ul-Zuha (Bakrid)', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-06-27`, 'Muharram', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-08-15`, 'Independence Day', 'NATIONAL', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-08-26`, 'Milad-un-Nabi (Id-e-Milad)', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-02`, 'Mahatma Gandhi Jayanti', 'NATIONAL', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-20`, 'Dussehra (Vijay Dashami)', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-31`, 'Diwali (Deepavali)', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-11-24`, 'Guru Nanak Jayanti', 'PUBLIC', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-12-25`, 'Christmas Day', 'PUBLIC', 'ALL', 'ALL', 'ALL'],

      // --- Central Government Restricted Holidays (RH - 22 Days) ---
      [`${currentYear}-01-01`, "New Year's Day", 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-01-05`, 'Guru Gobind Singh Jayanti', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-01-14`, 'Makar Sankranti / Pongal', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-01-23`, 'Basant Panchami / Sri Panchami', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-02-01`, 'Guru Ravidas Jayanti', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-02-19`, 'Shivaji Jayanti', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-03-24`, 'Holika Dahan', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-04-05`, 'Easter Sunday', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-07-16`, 'Rath Yatra', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-08-28`, 'Raksha Bandhan', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-09-04`, 'Janmashtami (Smarta)', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-09-14`, 'Ganesh Chaturthi / Vinayaka Chaturthi', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-09-25`, 'Onam', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-18`, 'Dussehra (Maha Saptami / Ashtami)', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-19`, 'Dussehra (Maha Navami)', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-26`, 'Maharishi Valmiki Jayanti', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-10-29`, 'Karaka Chaturthi (Karwa Chauth)', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-11-11`, 'Govardhan Puja', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-11-12`, 'Bhai Duj', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-11-15`, 'Chhath Puja', 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-12-14`, "Guru Teg Bahadur's Martyrdom Day", 'RESTRICTED', 'ALL', 'ALL', 'ALL'],
      [`${currentYear}-12-24`, 'Christmas Eve', 'RESTRICTED', 'ALL', 'ALL', 'ALL']
    ];

    for (const h of holidays) {
      insertHoliday.run(...h);
    }

    // 4. Leave Types & Rules
    // --- Casual Leave (CL) ---
    insertLeaveType.run(
      'CL',
      'Casual Leave',
      'Casual leave for unforeseen personal contingencies or short casual absence.',
      1, // is_paid
      1, // requires_approval
      1, // allow_half_day
      0, // allow_hourly
      0.5, // min_days
      5.0  // max_days
    );
    const clType = db.prepare('SELECT id FROM leave_types WHERE code = ?').get('CL');

    insertLeaveRule.run(
      clType.id,
      'CL_RULE_CENTRAL_GOV',
      'Central Government Casual Leave Policy',
      'Configurable annual entitlement, alternate entitlement, max continuous days, and mid-year joining treatment.',
      'ALL'
    );
    const clRule = db.prepare('SELECT id FROM leave_rules WHERE rule_code = ?').get('CL_RULE_CENTRAL_GOV');

    // Configurable CL policy in database
    const clConfig = {
      annual_entitlement: 8.0,
      alternate_entitlement: 10.0,
      alternate_category: 'STAFF_WITHOUT_17_HOLIDAYS',
      max_continuous_days: 5.0,
      mid_year_treatment: 'PRO_RATA', // Configurable: 'PRO_RATA', 'FULL_CREDIT', 'COMPLETED_MONTHS', 'DEPARTMENTAL_DISCRETION', 'NOT_APPLICABLE'
      pro_rata_basis: 'REMAINING_MONTHS',
      exclude_weekly_offs: true,
      exclude_public_holidays: true,
      can_combine_with: ['SPECIAL_CASUAL_LEAVE'],
      cannot_combine_with: ['EL', 'HPL', 'COMMUTED_LEAVE'],
      carry_forward: false,
      accumulation_ceiling: 8.0
    };

    insertRuleVersion.run(
      clRule.id,
      1,
      '2024-01-01',
      null,
      'ACTIVE',
      JSON.stringify(clConfig),
      'SYSTEM'
    );

    insertCreditSchedule.run(
      clType.id,
      'CL Annual Credit (1 January)',
      'ANNUAL',
      '01-01',
      8.0,
      'ANNUAL_FULL_OR_PRO_RATA'
    );

    // --- Earned Leave (EL) ---
    insertLeaveType.run(
      'EL',
      'Earned Leave',
      'Earned leave credited semi-annually in advance at 15 days on 1 January and 15 days on 1 July.',
      1,
      1,
      1,
      0,
      1.0,
      180.0
    );
    const elType = db.prepare('SELECT id FROM leave_types WHERE code = ?').get('EL');

    insertLeaveRule.run(
      elType.id,
      'EL_RULE_CENTRAL_GOV',
      'Central Government Earned Leave Policy',
      'Annual 30 days, credited 15 days on 1 Jan and 15 days on 1 July. Ceiling 300 days. Continuous availment max 180 days.',
      'ALL'
    );
    const elRule = db.prepare('SELECT id FROM leave_rules WHERE rule_code = ?').get('EL_RULE_CENTRAL_GOV');

    const elConfig = {
      annual_entitlement: 30.0,
      semi_annual_credit: 15.0,
      cycle_type: 'HALF_YEARLY',
      credit_dates: ['01-01', '07-01'],
      accumulation_ceiling: 300.0,
      max_continuous_days: 180.0,
      completed_month_rate: 2.5,
      mid_year_treatment: 'COMPLETED_MONTHS_RATE',
      encashment_supported: true,
      encashment_max_at_retirement: 300.0,
      exclude_weekly_offs: true,
      exclude_public_holidays: true,
      sandwich_applicable: false
    };

    insertRuleVersion.run(
      elRule.id,
      1,
      '2024-01-01',
      null,
      'ACTIVE',
      JSON.stringify(elConfig),
      'SYSTEM'
    );

    insertCreditSchedule.run(
      elType.id,
      'EL Half-Yearly Credit (1 January)',
      'BI_ANNUAL',
      '01-01',
      15.0,
      'EL_SEMI_ANNUAL_CREDIT'
    );
    insertCreditSchedule.run(
      elType.id,
      'EL Half-Yearly Credit (1 July)',
      'BI_ANNUAL',
      '07-01',
      15.0,
      'EL_SEMI_ANNUAL_CREDIT'
    );

    // --- Restricted Holiday (RH) ---
    insertLeaveType.run(
      'RH',
      'Restricted Holiday',
      'Restricted Holiday: 02 per year / 01 per six months.',
      1,
      1,
      0,
      0,
      1.0,
      1.0
    );
    const rhType = db.prepare('SELECT id FROM leave_types WHERE code = ?').get('RH');

    // --- Compensatory Off (CO) ---
    insertLeaveType.run(
      'CO',
      'Compensatory Off',
      'Compensatory Off for Sunday/Gazetted Holiday duty; to be availed within one month.',
      1,
      1,
      1,
      0,
      0.5,
      10.0
    );
    const coType = db.prepare('SELECT id FROM leave_types WHERE code = ?').get('CO');

    // --- CDER Specific Policies (Department: CDER, Common Tenure: 01/04/2026 to 31/03/2027) ---
    // 1. CDER Casual Leave (CL = (8/12) * eligible months, 25th cutoff, nearest 0.5 rounding)
    insertLeaveRule.run(
      clType.id,
      'CL_RULE_CDER_2026',
      'CDER Casual Leave Policy 2026-2027',
      'CL = (8 ÷ 12) × eligible months. 25th cut-off. Nearest 0.5 rounding. Tenure 01/04/2026 to 31/03/2027.',
      'CDER'
    );
    const cderClRule = db.prepare('SELECT id FROM leave_rules WHERE rule_code = ?').get('CL_RULE_CDER_2026');
    if (cderClRule) {
      insertRuleVersion.run(
        cderClRule.id,
        1,
        '2026-04-01',
        '2027-03-31',
        'ACTIVE',
        JSON.stringify({
          policy_name: 'CDER Staff Leave Rules 2026-2027',
          policy_period_start: '2026-04-01',
          policy_period_end: '2027-03-31',
          annual_entitlement: 8.0,
          monthly_calculation: '(annual_entitlement / 12) * eligible_months',
          mid_year_treatment: 'CDER_JOINING_CUTOFF',
          joining_cutoff_day: 25,
          leave_start_rule: 'IF_DOJ_LE_CUTOFF_SAME_MONTH_FIRST_ELSE_NEXT_MONTH_FIRST',
          rounding_method: 'NEAREST_HALF_DAY',
          exclude_weekly_offs: true,
          exclude_public_holidays: true,
          max_continuous_days: 5.0
        }),
        'SYSTEM'
      );
    }

    // 2. CDER Earned Leave (EL = 2.5 * completed eligible months, 25th cutoff)
    insertLeaveRule.run(
      elType.id,
      'EL_RULE_CDER_2026',
      'CDER Earned Leave Policy 2026-2027',
      'EL = 2.5 × completed eligible months. 25th cut-off. Tenure 01/04/2026 to 31/03/2027.',
      'CDER'
    );
    const cderElRule = db.prepare('SELECT id FROM leave_rules WHERE rule_code = ?').get('EL_RULE_CDER_2026');
    if (cderElRule) {
      insertRuleVersion.run(
        cderElRule.id,
        1,
        '2026-04-01',
        '2027-03-31',
        'ACTIVE',
        JSON.stringify({
          policy_name: 'CDER Staff Leave Rules 2026-2027',
          policy_period_start: '2026-04-01',
          policy_period_end: '2027-03-31',
          annual_entitlement: 30.0,
          completed_month_rate: 2.5,
          mid_year_treatment: 'CDER_JOINING_CUTOFF',
          joining_cutoff_day: 25,
          leave_start_rule: 'IF_DOJ_LE_CUTOFF_SAME_MONTH_FIRST_ELSE_NEXT_MONTH_FIRST',
          rounding_method: 'NEAREST_HALF_DAY',
          accumulation_ceiling: 300.0,
          exclude_weekly_offs: true,
          exclude_public_holidays: true
        }),
        'SYSTEM'
      );
    }

    // 3. CDER Restricted Holiday (02 per year / 01 per six months)
    if (rhType) {
      insertLeaveRule.run(
        rhType.id,
        'RH_RULE_CDER_2026',
        'CDER Restricted Holiday Policy 2026-2027',
        '02 RH during one year and 01 RH during six months. Tenure 01/04/2026 to 31/03/2027.',
        'CDER'
      );
      const cderRhRule = db.prepare('SELECT id FROM leave_rules WHERE rule_code = ?').get('RH_RULE_CDER_2026');
      if (cderRhRule) {
        insertRuleVersion.run(
          cderRhRule.id,
          1,
          '2026-04-01',
          '2027-03-31',
          'ACTIVE',
          JSON.stringify({
            policy_name: 'CDER Staff Leave Rules 2026-2027',
            policy_period_start: '2026-04-01',
            policy_period_end: '2027-03-31',
            annual_entitlement: 2.0,
            six_month_entitlement: 1.0,
            mid_year_treatment: 'CDER_JOINING_CUTOFF',
            joining_cutoff_day: 25,
            leave_start_rule: 'IF_DOJ_LE_CUTOFF_SAME_MONTH_FIRST_ELSE_NEXT_MONTH_FIRST',
            exclude_weekly_offs: true,
            exclude_public_holidays: true
          }),
          'SYSTEM'
        );
      }
    }

    // 4. CDER Compensatory Off (Sunday/Gazetted Holiday, valid within 1 month)
    if (coType) {
      insertLeaveRule.run(
        coType.id,
        'COMP_OFF_RULE_CDER_2026',
        'CDER Compensatory Off Policy 2026-2027',
        'Eligible for Sunday or Gazetted Holiday duty; to be availed within one month of accumulation.',
        'CDER'
      );
      const cderCoRule = db.prepare('SELECT id FROM leave_rules WHERE rule_code = ?').get('COMP_OFF_RULE_CDER_2026');
      if (cderCoRule) {
        insertRuleVersion.run(
          cderCoRule.id,
          1,
          '2026-04-01',
          '2027-03-31',
          'ACTIVE',
          JSON.stringify({
            policy_name: 'CDER Staff Leave Rules 2026-2027',
            policy_period_start: '2026-04-01',
            policy_period_end: '2027-03-31',
            validity_days: 30,
            validity_period: 'ONE_MONTH',
            credit_rate: 1.0,
            eligible_duty_types: ['SUNDAY', 'GAZETTED_HOLIDAY', 'HOLIDAY'],
            requires_qualifying_duty: true
          }),
          'SYSTEM'
        );
      }
    }

    // 5. Sandwich Rule initial configuration
    insertSandwichRule.run(
      'Standard Sandwich Policy',
      1,
      JSON.stringify(['EL']),
      1, // include_weekly_offs
      1, // include_public_holidays
      0, // by default not charging intervening days
      'Intervening weekly offs and holidays are counted only if sandwich policy is actively enabled for the leave type.',
      '2024-01-01'
    );

    // 6. Notification Templates
    insertTemplate.run('LEAVE_SUBMITTED', 'Leave Request Submitted: {request_number}', 'Your leave request for {leave_type} from {from_date} to {to_date} ({chargeable_days} days) has been submitted for review.');
    insertTemplate.run('LEAVE_APPROVED', 'Leave Request Approved: {request_number}', 'Your leave request for {leave_type} ({chargeable_days} days) has been APPROVED by the administrator.');
    insertTemplate.run('LEAVE_REJECTED', 'Leave Request Rejected: {request_number}', 'Your leave request for {leave_type} has been REJECTED. Remarks: {remarks}');
    insertTemplate.run('LEAVE_HOLD', 'Leave Request Placed on Hold: {request_number}', 'Your leave request for {leave_type} has been placed on HOLD pending further details. Remarks: {remarks}');
    insertTemplate.run('LEAVE_CANCELLED', 'Leave Request Cancelled: {request_number}', 'Your leave request for {leave_type} has been cancelled.');
    insertTemplate.run('COMP_OFF_CREDITED', 'Comp-Off Credited', 'A compensatory off of {days} day(s) for work on {worked_date} has been credited to your account.');

    // 7. Initial Admin Account
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@ems.gov.in';
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@EMS2026!';
    const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
    const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
    if (!existingAdmin) {
      db.prepare(`
        INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
        VALUES (NULL, ?, ?, 'ADMIN', 0, 1)
      `).run(adminEmail, adminPasswordHash);
      console.log(`[SEED] Initialized Admin account: ${adminEmail}`);
    }
  });

  seedTransaction();
  console.log('[SEED] Master policies seeded successfully.');
}

/**
 * Seed optional Development / Demo data
 * Strictly separated from production; only executes in development when requested
 */
function seedDevelopmentDemoData() {
  if (process.env.NODE_ENV === 'production') {
    console.log('[SEED] Skipping demo data in production environment.');
    return;
  }

  console.log('[SEED] Seeding development demo employees and transactions...');

  const demoTransaction = db.transaction(() => {
    // Demo Employee 1: Dr. Rajesh Kumar (General Staff, Full-Year)
    const emp1 = db.prepare('SELECT id FROM employees WHERE employee_id = ?').get('EMP001');
    if (!emp1) {
      db.prepare(`
        INSERT INTO employees (
          employee_id, name, gender, mobile, email, date_of_joining, date_of_birth,
          department, designation, employee_category, is_field_worker, status
        ) VALUES ('EMP001', 'Dr. Rajesh Kumar', 'MALE', '+91 9876543210', 'rajesh.kumar@ems.gov.in',
                  '2024-01-15', '1988-06-20', 'Health Administration', 'Senior Medical Officer',
                  'GENERAL', 0, 'ACTIVE')
      `).run();

      const pHash1 = bcrypt.hashSync(process.env.DEMO_PASSWORD || 'Emp@123456', 10);
      db.prepare(`
        INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
        VALUES ('EMP001', 'rajesh.kumar@ems.gov.in', ?, 'EMPLOYEE', 0, 1)
      `).run(pHash1);

      const clT = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
      const elT = db.prepare(`SELECT id FROM leave_types WHERE code = 'EL'`).get();

      // CL Credit (8 days)
      db.prepare(`
        INSERT INTO leave_transactions (employee_id, leave_type_id, transaction_type, amount, running_balance, remarks, created_by)
        VALUES ('EMP001', ?, 'INITIAL_CREDIT', 8.0, 8.0, 'Annual CL Entitlement 2026', 'SYSTEM')
      `).run(clT.id);
      db.prepare(`
        INSERT INTO leave_balances (employee_id, leave_type_id, year, opening_balance, credited_amount, current_balance)
        VALUES ('EMP001', ?, 2026, 0, 8.0, 8.0)
      `).run(clT.id);

      // EL Credit (30 days)
      db.prepare(`
        INSERT INTO leave_transactions (employee_id, leave_type_id, transaction_type, amount, running_balance, remarks, created_by)
        VALUES ('EMP001', ?, 'PERIODIC_CREDIT', 30.0, 30.0, 'Annual EL Entitlement 2026', 'SYSTEM')
      `).run(elT.id);
      db.prepare(`
        INSERT INTO leave_balances (employee_id, leave_type_id, year, opening_balance, credited_amount, current_balance)
        VALUES ('EMP001', ?, 2026, 0, 30.0, 30.0)
      `).run(elT.id);
    }

    // Demo Employee 2: Anita Sharma (Field Worker, Mid-Year)
    const emp2 = db.prepare('SELECT id FROM employees WHERE employee_id = ?').get('EMP002');
    if (!emp2) {
      db.prepare(`
        INSERT INTO employees (
          employee_id, name, gender, mobile, email, date_of_joining, date_of_birth,
          department, designation, employee_category, is_field_worker, status
        ) VALUES ('EMP002', 'Anita Sharma', 'FEMALE', '+91 9812345678', 'anita.sharma@ems.gov.in',
                  '2026-07-01', '1993-11-04', 'Surveillance & Field Operations', 'Field Epidemiologist',
                  'FIELD_WORKER', 1, 'ACTIVE')
      `).run();

      const pHash2 = bcrypt.hashSync(process.env.DEMO_PASSWORD || 'Emp@123456', 10);
      db.prepare(`
        INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
        VALUES ('EMP002', 'anita.sharma@ems.gov.in', ?, 'EMPLOYEE', 0, 1)
      `).run(pHash2);

      const clT = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
      // Mid-year credit
      db.prepare(`
        INSERT INTO leave_transactions (employee_id, leave_type_id, transaction_type, amount, running_balance, remarks, created_by)
        VALUES ('EMP002', ?, 'INITIAL_CREDIT', 4.0, 4.0, 'Pro-rata CL Entitlement (Joined July 1)', 'SYSTEM')
      `).run(clT.id);
      db.prepare(`
        INSERT INTO leave_balances (employee_id, leave_type_id, year, opening_balance, credited_amount, current_balance)
        VALUES ('EMP002', ?, 2026, 0, 4.0, 4.0)
      `).run(clT.id);

      db.prepare(`
        INSERT INTO comp_off_records (employee_id, worked_date, qualifying_day_type, credited_days, reason, approval_status, status)
        VALUES ('EMP002', '2026-08-09', 'SUNDAY', 1.0, 'Field outbreak investigation on Sunday', 'PENDING', 'PENDING')
      `).run();
    }
  });

  demoTransaction();
  console.log('[SEED] Demo employees seeded for development testing.');
}

function seedDatabase() {
  seedMasterPolicies();
  if (process.env.SEED_DEMO === 'true') {
    seedDevelopmentDemoData();
  }
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedMasterPolicies, seedDevelopmentDemoData, seedDatabase };
