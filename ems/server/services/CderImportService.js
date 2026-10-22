// server/services/CderImportService.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const LeaveLedgerService = require('./LeaveLedgerService');
const AuthService = require('./AuthService');

class CderImportService {
  /**
   * Parse date in DD/MM/YYYY format to YYYY-MM-DD
   */
  static parseDate(dStr) {
    if (!dStr) return null;
    const parts = dStr.trim().split(/[-/]/);
    if (parts.length !== 3) return dStr;
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    // DD/MM/YYYY
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }

  /**
   * Main import routine: Idempotent and auditable
   */
  static importOfficialCderData(options = {}) {
    const jsonPath = options.jsonPath || path.resolve(__dirname, '../../data/cder_extracted_data.json');
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`CDER extracted data not found at ${jsonPath}. Run extract_cder_docx.py first.`);
    }

    const cderData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const staffList = cderData.staff || [];
    const leaveRecordsList = cderData.leave_records || [];

    // Map leave records by S.No
    const recordsBySno = {};
    for (const r of leaveRecordsList) {
      recordsBySno[r.sno] = r;
    }

    // Leave Types
    const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();
    const elType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'EL'`).get();
    const rhType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'RH'`).get();
    const coType = db.prepare(`SELECT id, code FROM leave_types WHERE code IN ('CO', 'COMP_OFF')`).get();

    if (!clType || !elType || !rhType || !coType) {
      throw new Error('Required leave types (CL, EL, RH, CO) are not fully seeded in the database.');
    }

    // Leave Rules
    const clRule = db.prepare(`SELECT id FROM leave_rules WHERE rule_code = 'CL_RULE_CDER_2026'`).get();
    const elRule = db.prepare(`SELECT id FROM leave_rules WHERE rule_code = 'EL_RULE_CDER_2026'`).get();
    const rhRule = db.prepare(`SELECT id FROM leave_rules WHERE rule_code = 'RH_RULE_CDER_2026'`).get();
    const coRule = db.prepare(`SELECT id FROM leave_rules WHERE rule_code = 'COMP_OFF_RULE_CDER_2026'`).get();

    const clRuleVer = clRule ? db.prepare(`SELECT id FROM leave_rule_versions WHERE leave_rule_id = ? AND status = 'ACTIVE' LIMIT 1`).get(clRule.id) : null;
    const elRuleVer = elRule ? db.prepare(`SELECT id FROM leave_rule_versions WHERE leave_rule_id = ? AND status = 'ACTIVE' LIMIT 1`).get(elRule.id) : null;
    const rhRuleVer = rhRule ? db.prepare(`SELECT id FROM leave_rule_versions WHERE leave_rule_id = ? AND status = 'ACTIVE' LIMIT 1`).get(rhRule.id) : null;
    const coRuleVer = coRule ? db.prepare(`SELECT id FROM leave_rule_versions WHERE leave_rule_id = ? AND status = 'ACTIVE' LIMIT 1`).get(coRule.id) : null;

    const stats = {
      totalFoundInDoc: staffList.length,
      employeesImported: 0,
      employeesExistingReused: 0,
      duplicatesDetected: [],
      accountsCreated: 0,
      accountsExisting: 0,
      transactionsCreated: 0,
      transactionsSkippedExisting: 0,
      missingFields: [
        'official_employee_id',
        'gender',
        'date_of_birth',
        'department_sub_unit',
        'field_worker_status',
        'employee_category',
        'manager_approver',
        'individual_historical_leave_dates'
      ]
    };

    // Track repeated names in document (e.g. Vinay Kumar S.No 10 vs S.No 36)
    const nameOccurrences = {};
    for (const s of staffList) {
      nameOccurrences[s.name] = (nameOccurrences[s.name] || 0) + 1;
    }
    for (const [name, count] of Object.entries(nameOccurrences)) {
      if (count > 1) {
        const matches = staffList.filter(s => s.name === name);
        stats.duplicatesDetected.push({
          name,
          count,
          occurrences: matches.map(m => ({
            sno: m.sno,
            designation: m.designation,
            contact: m.contact,
            email: m.email,
            joining_date: m.joining_date
          })),
          resolution: 'Separated by unique system-generated identifier, email, mobile, and joining date. Not merged.'
        });
      }
    }

    const importTransaction = db.transaction(() => {
      for (const staff of staffList) {
        const sno = staff.sno;
        const sysEmpId = `SYS-CDER-${String(sno).padStart(3, '0')}`;
        const officialEmpId = `CDER-${String(sno).padStart(2, '0')}`;
        const importKey = `CDER_SNO_${sno}`;
        const dojIso = this.parseDate(staff.joining_date);
        const lRec = recordsBySno[sno] || {};

        // 1. Employee Upsert / Idempotent Check
        let emp = db.prepare(`SELECT * FROM employees WHERE import_key = ? OR email = ?`).get(importKey, staff.email);
        if (!emp) {
          db.prepare(`
            INSERT INTO employees (
              employee_id, official_employee_id, name, gender, mobile, email,
              date_of_joining, date_of_birth, department, designation, employee_category,
              is_field_worker, field_worker_status, status, import_source, import_key, is_demo
            ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, 'CDER', ?, 'PENDING_CONFIGURATION', 0, 'PENDING_CONFIGURATION', 'ACTIVE', 'CDER_DOCX_2026', ?, 0)
          `).run(
            sysEmpId,
            officialEmpId,
            staff.name,
            staff.contact,
            staff.email,
            dojIso,
            staff.designation,
            importKey
          );

          emp = db.prepare(`SELECT * FROM employees WHERE employee_id = ?`).get(sysEmpId);
          stats.employeesImported += 1;
        } else {
          if (!emp.official_employee_id) {
            db.prepare(`UPDATE employees SET official_employee_id = ? WHERE id = ?`).run(officialEmpId, emp.id);
            emp.official_employee_id = officialEmpId;
          }
          stats.employeesExistingReused += 1;
        }

        const employeeId = emp.employee_id;

        // 2. User Account Creation (Default password: First 3 letters of name + @ + ID, must_change_password=0)
        let user = db.prepare(`SELECT id FROM users WHERE email = ? OR employee_id = ?`).get(staff.email, employeeId);
        const defaultPassword = AuthService.generateDefaultPassword(staff.name, officialEmpId);
        const pHash = bcrypt.hashSync(defaultPassword, 10);

        if (!user) {
          db.prepare(`
            INSERT INTO users (
              employee_id, email, password_hash, role, must_change_password, is_active
            ) VALUES (?, ?, ?, 'EMPLOYEE', 0, 1)
          `).run(employeeId, staff.email, pHash);

          stats.accountsCreated += 1;
        } else {
          db.prepare(`
            UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?
          `).run(pHash, user.id);
          stats.accountsExisting += 1;
        }

        // Helper to record idempotent transaction
        const recordLedgerTx = (leaveTypeId, txType, amount, refSuffix, remarks, ruleVerId) => {
          const refId = `CDER_IMPORT_2026_10_01_${refSuffix}_${employeeId}`;
          const existingTx = db.prepare(`SELECT id FROM leave_transactions WHERE reference_id = ?`).get(refId);
          if (existingTx) {
            stats.transactionsSkippedExisting += 1;
            return;
          }

          LeaveLedgerService.recordTransaction({
            employeeId,
            leaveTypeId,
            transactionType: txType,
            amount,
            referenceId: refId,
            ruleVersionId: ruleVerId ? ruleVerId.id : null,
            remarks,
            createdBy: 'CDER_DOCX_IMPORT',
            year: 2026
          });
          stats.transactionsCreated += 1;
        };

        // 3. Casual Leave (CL) Transactions
        const clEntitled = Number(lRec.cl_entitled || 0);
        const clBalance = Number(lRec.cl_balance || 0);
        const clAvailed = Number((clEntitled - clBalance).toFixed(2));

        // Credit
        recordLedgerTx(
          clType.id,
          'INITIAL_CREDIT',
          clEntitled,
          'CL_CREDIT',
          'Policy entitlement for CDER 2026-2027 tenure up to 31/03/2027',
          clRuleVer
        );

        // Historical deduction as of 01/10/2026
        if (clAvailed > 0) {
          recordLedgerTx(
            clType.id,
            'LEAVE_DEDUCTION',
            -clAvailed,
            'CL_DEDUCT',
            'Imported from CDER Staff Details & Leave Rules & Record — balance snapshot as of 01/10/2026',
            clRuleVer
          );
        }

        // 4. Earned Leave (EL) Transactions
        // Note: Column in docx is labeled 'EL availed', representing accrued EL credit as of 01/10/2026 (15 for 6 months, 2.5 for 1 month)
        const elAccruedCredit = Number(lRec.el_availed_raw || 0);
        const elBalance = Number(lRec.el_balance || 0);
        const elAvailed = Number((elAccruedCredit - elBalance).toFixed(2));

        // Credit
        recordLedgerTx(
          elType.id,
          'PERIODIC_CREDIT',
          elAccruedCredit,
          'EL_CREDIT',
          'EL accrued credit up to 01/10/2026 (2.5 days/month) under CDER policy',
          elRuleVer
        );

        // Historical deduction as of 01/10/2026
        if (elAvailed > 0) {
          recordLedgerTx(
            elType.id,
            'LEAVE_DEDUCTION',
            -elAvailed,
            'EL_DEDUCT',
            'Imported from CDER Staff Details & Leave Rules & Record — balance snapshot as of 01/10/2026',
            elRuleVer
          );
        }

        // 5. Restricted Holiday (RH) Transactions
        const rhEntitled = Number(lRec.rh_entitled || 0);
        const rhBalance = Number(lRec.rh_balance || 0);
        const rhAvailed = Number((rhEntitled - rhBalance).toFixed(2));

        // Credit
        recordLedgerTx(
          rhType.id,
          'INITIAL_CREDIT',
          rhEntitled,
          'RH_CREDIT',
          'Policy entitlement for CDER 2026-2027 tenure up to 31/03/2027',
          rhRuleVer
        );

        // Historical deduction as of 01/10/2026
        if (rhAvailed > 0) {
          recordLedgerTx(
            rhType.id,
            'LEAVE_DEDUCTION',
            -rhAvailed,
            'RH_DEDUCT',
            'Imported from CDER Staff Details & Leave Rules & Record — balance snapshot as of 01/10/2026',
            rhRuleVer
          );
        }

        // 6. Compensatory Off (CO) Transactions
        const coBalance = Number(lRec.co_balance || 0);
        if (coBalance > 0) {
          recordLedgerTx(
            coType.id,
            'COMP_OFF_CREDIT',
            coBalance,
            'CO_CREDIT',
            'Imported from CDER Staff Details & Leave Rules & Record — balance snapshot as of 01/10/2026',
            coRuleVer
          );
        }
      }
    });

    importTransaction();

    // 7. Balance Reconciliation
    const reconciliation = this.runReconciliation();

    return {
      stats,
      reconciliation
    };
  }

  /**
   * Verify all 44 employees against the document snapshot
   */
  static runReconciliation(options = {}) {
    const jsonPath = options.jsonPath || path.resolve(__dirname, '../../data/cder_extracted_data.json');
    const cderData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const staffList = cderData.staff || [];
    const recordsList = cderData.leave_records || [];

    const recordsBySno = {};
    for (const r of recordsList) {
      recordsBySno[r.sno] = r;
    }

    const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
    const elType = db.prepare(`SELECT id FROM leave_types WHERE code = 'EL'`).get();
    const rhType = db.prepare(`SELECT id FROM leave_types WHERE code = 'RH'`).get();
    const coType = db.prepare(`SELECT id FROM leave_types WHERE code IN ('CO', 'COMP_OFF')`).get();

    const results = [];
    let matchCount = 0;
    let mismatchCount = 0;
    let reviewRequiredCount = 0;

    for (const staff of staffList) {
      const sno = staff.sno;
      const sysEmpId = `SYS-CDER-${String(sno).padStart(3, '0')}`;
      const docRec = recordsBySno[sno] || {};

      const checkLeave = (leaveCode, leaveTypeId, docEntitled, docBalance, docAvailedRaw) => {
        // Cached balance
        const cached = db.prepare(`
          SELECT current_balance, credited_amount, used_amount 
          FROM leave_balances 
          WHERE employee_id = ? AND leave_type_id = ? AND year = 2026
        `).get(sysEmpId, leaveTypeId);

        // Ledger sum
        const ledger = db.prepare(`
          SELECT 
            COALESCE(SUM(amount), 0) as net_balance,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_credits,
            COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as total_deductions
          FROM leave_transactions
          WHERE employee_id = ? AND leave_type_id = ?
        `).get(sysEmpId, leaveTypeId);

        const expectedBal = Number(docBalance || 0);
        const ledgerBal = ledger ? Number(ledger.net_balance.toFixed(2)) : 0;
        const cachedBal = cached ? Number(cached.current_balance.toFixed(2)) : 0;
        const diff = Number(Math.abs(expectedBal - ledgerBal).toFixed(4));
        const diffCached = Number(Math.abs(ledgerBal - cachedBal).toFixed(4));

        let status = 'MATCH';
        if (diff > 0.001 || diffCached > 0.001) {
          status = 'MISMATCH';
          mismatchCount += 1;
        } else {
          matchCount += 1;
        }

        results.push({
          sno,
          employeeId: sysEmpId,
          name: staff.name,
          designation: staff.designation,
          leaveType: leaveCode,
          documentedEntitlement: docEntitled,
          documentedBalance: expectedBal,
          documentedAvailedRaw: docAvailedRaw,
          importedLedgerCredit: ledger ? ledger.total_credits : 0,
          importedLedgerDeduction: ledger ? ledger.total_deductions : 0,
          calculatedLedgerBalance: ledgerBal,
          cachedBalance: cachedBal,
          difference: diff,
          status
        });
      };

      // CL
      checkLeave('CL', clType.id, docRec.cl_entitled, docRec.cl_balance, (docRec.cl_entitled - docRec.cl_balance));
      // EL
      checkLeave('EL', elType.id, docRec.el_availed_raw, docRec.el_balance, (docRec.el_availed_raw - docRec.el_balance));
      // RH
      checkLeave('RH', rhType.id, docRec.rh_entitled, docRec.rh_balance, (docRec.rh_entitled - docRec.rh_balance));
      // CO
      checkLeave('CO', coType.id, docRec.co_balance, docRec.co_balance, 0);
    }

    return {
      totalRecordsAudited: results.length,
      matchCount,
      mismatchCount,
      reviewRequiredCount,
      isFullyReconciled: mismatchCount === 0,
      records: results
    };
  }
}

module.exports = CderImportService;
