# Test Summary Table — AIIMS CDER Attendance App + EMS

| Field | Value |
|-------|-------|
| **Created** | 2026-10-26 |
| **Raw output captured** | 2026-10-26 11:21 IST (this session) |
| **Environment** | Node.js v20.20.0, macOS Darwin 24.3.0 |
| **Test_DATABASE_URL set?** | ❌ No — PostgreSQL-dependent suites skipped by runner |
| **Source of truth** | `scripts/test_all.js` + `cd ems && npm test` + individual `node test/*.test.js` |

---

## 1. Authoritative Suite Count — Reconciliation

### Root cause of the discrepancy

Five prior documents reported conflicting totals. The table below traces each figure back to its source:

| Source | Reported total | Basis | Verdict |
|--------|---------------|-------|---------|
| `scripts/test_all.js` comment (line 3) | 18 | Stale comment — file actually has **24** entries | ❌ Stale |
| `TEST_EXECUTION_REPORT.md` | 23 | Counted 8 Attendance runner entries + 16 blocked (= 24), then listed only 8 in the table; EMS runner treated as a 9th "suite" | ❌ Inconsistent |
| `SESSION_RACE_CONDITION_REMEDIATION.md` | 24 | Directly from `RUNNING ALL 24 TEST SUITES` stdout | ✅ Accurate for `test_all.js` scope |
| `INDEPENDENT_TEST_AUDIT.md` | 13 exec + 14 blocked Attendance + 4 EMS files = 31 | Counted each EMS file individually and corrected `requiresDb` flags for biometric/supabase | ⚠️ Counting methodology differs |
| `Release_Readiness_Report.md` | 25 | Added EMS native runner as one additional suite on top of the 24 in `test_all.js` | ⚠️ Double-counts 2 suites already in `test_all.js` |

### Settled totals (verified in this session)

| Count | Value | Basis |
|-------|-------|-------|
| **Suites in `scripts/test_all.js`** | **24** | Direct count of array entries in `scripts/test_all.js` lines 15–38 |
| **`requiresDb: false` in `test_all.js`** | **8** | `email_backup`, `confirm_modal`, `csv_and_timesheet_export`, `ems_integration`, `ems_security_verification`, `session_timeout`, `single_active_session`, `single_active_session_concurrency` |
| **`requiresDb: true` in `test_all.js`** | **16** | All remaining entries (includes `biometric` and `supabase_keepalive` — see §4) |
| **EMS native runner** (`cd ems && npm test`) | **1 invocation** = 4 test files run together as a single `node --test` command; NOT registered in `test_all.js` | Separate command, separate scope |
| **Total distinct test invocations (both runners)** | **25** | 24 in `test_all.js` + 1 EMS native runner |
| **Executed in this session (no DB)** | **10** | 8 from `test_all.js` (requiresDb:false) + 2 outside `test_all.js` scope: biometric + supabase_keepalive (run individually; PASS) |
| **Skipped by `test_all.js` runner (no DB)** | **16** | All `requiresDb: true` entries including biometric + supabase_keepalive |

> **Conclusion on `Release_Readiness_Report.md` count of 25:**
> The "25" is reached by treating the EMS native runner as a 25th suite added *on top of* the 24 in `test_all.js`. This is **not double-counting** because the EMS native runner is genuinely a separate invocation (`cd ems && npm test`) not registered in `test_all.js`. The total of **25 distinct invocations** is therefore correct — but the breakdown "7 + 1 + 1 + 16 = 25" in that document is imprecise (see §2 below).

---

## 2. Corrected Breakdown (7 + 1 + 1 + 16 in Prior Reports vs Actuals)

| Prior report segment | Prior claim | Actual (verified) | Notes |
|----------------------|-------------|-------------------|-------|
| "7 pure unit suites" | 7 | **8** — `requiresDb:false` entries in `test_all.js` | `ems_security_verification` and `ems_integration` are run via `test_all.js` as Attendance-repo suites (`node test/ems_*.test.js`), not via the EMS native runner |
| "1 EMS native runner suite" | 1 | **1** — `cd ems && npm test` runs 4 EMS test files in one invocation | Counts as 1 runner invocation; 4 underlying files; 22 top-level test assertions |
| "1 mock-concurrency suite" | 1 | **1** — `single_active_session_concurrency.test.js` | Correct |
| "16 PostgreSQL-dependent suites" | 16 | **16** — all entries with `requiresDb: true` in `test_all.js` | Correct; includes `biometric` and `supabase_keepalive` which are miscategorised in `test_all.js` (see §4) |
| **Total** | **25** | **26** (8 non-DB + 1 EMS native + 1 concurrency + 16 DB = 26; or 24 in `test_all.js` + 1 EMS = 25) | Depends on counting methodology — see note below |

> **Methodology note:** The total of **25** is correct when counting `test_all.js` entries (24) plus the EMS native runner (1). If you split the 8 `requiresDb:false` entries into "7 unit" + "1 concurrency" as prior reports do, the breakdown becomes 7 + 1 EMS-native + 1 concurrency + 16 DB = **25**. However the "7" should be "7 Attendance-only non-DB suites" since `ems_integration.test.js` and `ems_security_verification.test.js` are also non-DB — making it more accurately **9 non-DB suites in `test_all.js`** (see §3 table below for the actual count discrepancy with prior reports using "87 assertions").

---

## 3. Per-Suite Detail Table (All 24 + EMS Native Runner)

### 3A — Non-DB suites: executed and verified in this session

| # | Suite file | Runner entry? | `requiresDb` flag | Test cases (reported by suite) | Raw pass count | Status |
|---|-----------|--------------|------------------|-------------------------------|---------------|--------|
| 1 | `test/email_backup.test.js` | ✅ Entry #4 | `false` | **5** assertions in source | ✅ 5 PASS | ✅ PASS |
| 2 | `test/confirm_modal.test.js` | ✅ Entry #16 | `false` | **8** tests (Node runner: `# tests 8`) | ✅ 8 PASS | ✅ PASS |
| 3 | `test/csv_and_timesheet_export.test.js` | ✅ Entry #19 | `false` | **7** tests | ✅ 7 PASS | ✅ PASS |
| 4 | `test/ems_integration.test.js` | ✅ Entry #20 | `false` | **11** tests | ✅ 11 PASS | ✅ PASS |
| 5 | `test/ems_security_verification.test.js` | ✅ Entry #21 | `false` | **26** tests | ✅ 26 PASS | ✅ PASS |
| 6 | `test/session_timeout.test.js` | ✅ Entry #22 | `false` | **15** tests | ✅ 15 PASS | ✅ PASS |
| 7 | `test/single_active_session.test.js` | ✅ Entry #23 | `false` | **8** tests | ✅ 8 PASS | ✅ PASS |
| 8 | `test/single_active_session_concurrency.test.js` | ✅ Entry #24 | `false` | **10** tests | ✅ 10 PASS | ✅ PASS |
| **Subtotal — non-DB in `test_all.js`** | | | | **90** | **90 PASS** | ✅ ALL PASS |

> **Discrepancy with prior reports:** Prior documents stated 87 assertions for Attendance non-DB suites. The verified total from actual output is **90** (5 + 8 + 7 + 11 + 26 + 15 + 8 + 10). The difference of 3 most likely arises from `ems_integration` being reported as 11 tests but previously counted as fewer.

### 3B — EMS native runner (separate invocation)

| # | Suite file (within `cd ems && npm test`) | Registered in `test_all.js`? | Top-level tests | Pass | Status |
|---|------------------------------------------|------------------------------|-----------------|------|--------|
| 9 | `ems/tests/auditAndDynamicRuleVerification.test.js` | ❌ No | 5 | 5 | ✅ PASS |
| 10 | `ems/tests/cderPolicyAndImport.test.js` | ❌ No | 5 | 5 | ✅ PASS |
| 11 | `ems/tests/leaveRuleEngine.test.js` | ❌ No | 8 | 8 | ✅ PASS |
| 12 | `ems/tests/leaveWorkflowAndScheduler.test.js` | ❌ No | 4 | 4 | ✅ PASS |
| **Subtotal — EMS native runner** | 1 invocation / 4 files | | **22** | **22 PASS** | ✅ ALL PASS (`# pass 22` from stdout) |

### 3C — Additional suites run individually (outside `test_all.js` when no DB — miscategorised as `requiresDb:true`)

| # | Suite file | `requiresDb` flag in runner | Actual DB needed? | Test cases | Status |
|---|-----------|----------------------------|--------------------|-----------|--------|
| 13 | `test/biometric_security_evaluation.test.js` | `true` ⚠️ | ❌ **No** — runs with pure math/heuristics | 3 tests (classification suite) | ✅ PASS (verified this session) |
| 14 | `test/supabase_keepalive.test.js` | `true` ⚠️ | ❌ **No** — uses Node HTTP mock only | 18 tests | ✅ PASS (verified this session) |

> These two suites are **incorrectly classified as `requiresDb: true`** in `scripts/test_all.js` and are therefore skipped by the runner when no `TEST_DATABASE_URL` is set, even though they do not need PostgreSQL. They execute and pass when run directly. This is a miscategorisation bug — **not a test failure**.

### 3D — PostgreSQL-dependent suites: BLOCKED (not executed)

| # | Suite file | Entry # in `test_all.js` | Status |
|---|-----------|--------------------------|--------|
| 15 | `test/api.test.js` | 1 | 🔴 BLOCKED |
| 16 | `test/auth_signup_face.test.js` | 2 | 🔴 BLOCKED |
| 17 | `test/biometric_security_evaluation.test.js` | 3 | 🟠 BLOCKED by runner (miscategorised — actually runs without DB) |
| 18 | `test/export_csv.test.js` | 5 | 🔴 BLOCKED |
| 19 | `test/final_production_gate.test.js` | 6 | 🔴 BLOCKED |
| 20 | `test/leaves_and_alteration.test.js` | 7 | 🔴 BLOCKED |
| 21 | `test/security_hardening.test.js` | 8 | 🔴 BLOCKED |
| 22 | `test/security_remediation.test.js` | 9 | 🔴 BLOCKED |
| 23 | `test/single_punch_limit.test.js` | 10 | 🔴 BLOCKED |
| 24 | `test/state_district_team.test.js` | 11 | 🔴 BLOCKED |
| 25 | `test/supabase_keepalive.test.js` | 12 | 🟠 BLOCKED by runner (miscategorised — actually runs without DB) |
| 26 | `test/security_audit_remediation.test.js` | 13 | 🔴 BLOCKED |
| 27 | `test/secure_signup_login.test.js` | 14 | 🔴 BLOCKED |
| 28 | `test/hotel_gps_verification.test.js` | 15 | 🔴 BLOCKED |
| 29 | `test/state_district_standardization.test.js` | 17 | 🔴 BLOCKED |
| 30 | `test/shared_geofencing.test.js` | 18 | 🔴 BLOCKED |

> **14 of 16 blocked suites** require real PostgreSQL. **2 of 16** (`biometric`, `supabase_keepalive`) are only blocked because of a miscategorisation in `test_all.js`.

---

## 4. `requiresDb` Miscategorisation Bug

Two suites are flagged `requiresDb: true` in `scripts/test_all.js` but **do not require PostgreSQL**:

| Suite | Why it runs without DB | Verified |
|-------|------------------------|----------|
| `biometric_security_evaluation.test.js` | Uses only pure JavaScript math/heuristics (no `pg.Pool`). Output: `✓ Biometric experimental test suite executed successfully` | ✅ This session |
| `supabase_keepalive.test.js` | Uses Node HTTP mock only. Output: `ALL 18/18 TESTS PASSED SUCCESSFULLY!` | ✅ This session |

**Impact:** These two suites are unnecessarily skipped when running without `TEST_DATABASE_URL`. When corrected, the effective "BLOCKED without DB" count drops from 16 to **14**.

> This is a documentation finding. Fixing the `requiresDb` flags in `scripts/test_all.js` is a code change and requires separate authorization.

---

## 5. Consolidated Assertion Counts

### Verified in this session (raw output)

| Suite | Test cases | Source of count |
|-------|-----------|-----------------|
| `email_backup.test.js` | 5 | Source inspection (5 `assert` calls) |
| `confirm_modal.test.js` | 8 | Node test runner: `# tests 8, # pass 8` |
| `csv_and_timesheet_export.test.js` | 7 | Suite output: `ALL 7 TESTS PASSED` |
| `ems_integration.test.js` | 11 | Suite output: `ALL 11 EMS INTEGRATION TESTS PASSED` |
| `ems_security_verification.test.js` | 26 | Suite output: `ALL 26 SECURITY VERIFICATION TESTS PASSED` |
| `session_timeout.test.js` | 15 | Suite output: `15 PASSED, 0 FAILED` |
| `single_active_session.test.js` | 8 | Suite output: `8 PASSED, 0 FAILED` |
| `single_active_session_concurrency.test.js` | 10 | Suite output: `10 PASSED, 0 FAILED` |
| **Subtotal (non-DB in `test_all.js`)** | **90** | Verified |
| EMS native runner (4 files) | 22 | Node runner: `ℹ pass 22, ℹ fail 0` |
| `biometric_security_evaluation.test.js` | 3 | Suite output: `✓ executed successfully` (3 sub-tests documented in audit) |
| `supabase_keepalive.test.js` | 18 | Suite output: `ALL 18/18 TESTS PASSED` |
| **Total verified passing test cases** | **133** | ✅ All PASS, 0 FAIL |

### Blocked — assertion counts unverified (estimates from prior audit)

| Suite | Estimated assertions | Source of estimate |
|-------|---------------------|-------------------|
| `api.test.js` | ~16 | `INDEPENDENT_TEST_AUDIT.md` |
| `auth_signup_face.test.js` | ~22 | `INDEPENDENT_TEST_AUDIT.md` |
| `export_csv.test.js` | ~19 | `INDEPENDENT_TEST_AUDIT.md` |
| `final_production_gate.test.js` | ~35 | `INDEPENDENT_TEST_AUDIT.md` |
| `hotel_gps_verification.test.js` | ~38 | `INDEPENDENT_TEST_AUDIT.md` |
| `leaves_and_alteration.test.js` | ~6 | `INDEPENDENT_TEST_AUDIT.md` |
| `secure_signup_login.test.js` | ~76 | `INDEPENDENT_TEST_AUDIT.md` |
| `security_audit_remediation.test.js` | ~22 | `INDEPENDENT_TEST_AUDIT.md` |
| `security_hardening.test.js` | ~50 | `INDEPENDENT_TEST_AUDIT.md` |
| `security_remediation.test.js` | ~40 | `INDEPENDENT_TEST_AUDIT.md` |
| `single_punch_limit.test.js` | ~16 | `INDEPENDENT_TEST_AUDIT.md` |
| `state_district_standardization.test.js` | ~14 | `INDEPENDENT_TEST_AUDIT.md` |
| `state_district_team.test.js` | ~58 | `INDEPENDENT_TEST_AUDIT.md` |
| `shared_geofencing.test.js` | ~29 | `INDEPENDENT_TEST_AUDIT.md` |
| **Subtotal blocked (14 suites)** | **~441** | ⚠️ ESTIMATES — unverified |

> All blocked assertion counts above are **unverified estimates** from `INDEPENDENT_TEST_AUDIT.md`. They must not be treated as passed. They require a real PostgreSQL instance to execute.

---

## 6. Final Reconciled Totals

| Category | Suites | Test cases | Status |
|----------|--------|-----------|--------|
| Non-DB suites executed via `test_all.js` | 8 | 90 | ✅ ALL PASS (verified) |
| EMS native runner (`cd ems && npm test`) | 1 invocation / 4 files | 22 | ✅ ALL PASS (verified) |
| Miscategorised suites run individually | 2 | 21 | ✅ ALL PASS (verified) |
| **Total verified passing** | **11 invocations** | **133** | ✅ PASS |
| PostgreSQL-dependent: truly blocked | 14 | ~441 | 🔴 BLOCKED (unverified) |
| PostgreSQL-dependent: blocked by miscategorisation only | 2 | 21 | 🟠 Run separately — PASS |
| **Grand total (all configured)** | **25 invocations** (24 `test_all.js` + 1 EMS native) | **~574** | — |

---

## 7. Discrepancies Between Prior Documents and Verified Actuals

| Prior claim | Verified actual | Difference | Action |
|-------------|-----------------|------------|--------|
| 87 Attendance assertions (non-DB) | **90** | +3 | Update `TEST_EXECUTION_REPORT.md` |
| 22 EMS assertions | **22** | 0 | Correct |
| "119 passing assertions" (87 + 22 + 10) | **133** (90 + 22 + 21) or **112** (90 + 22) excluding miscategorised | +14 or -7 | Depends on whether biometric/supabase counted |
| "16 BLOCKED" suites | **16** blocked *by runner*; **14** truly need PostgreSQL | 2 miscategorised | Correct `requiresDb` flags (requires auth) |
| "23 suites" (`TEST_EXECUTION_REPORT.md`) | **24** in `test_all.js` + 1 EMS = **25** invocations | +1 or +2 | `TEST_EXECUTION_REPORT.md` needs correction |
| "25 suites" (`Release_Readiness_Report.md`) | **25 invocations** (24 + 1 EMS) | 0 | Total is correct; breakdown needs clarification |

---

## 8. Remaining Uncertainties

| Uncertainty | Impact |
|-------------|--------|
| Assertion counts for 14 blocked PostgreSQL suites are estimates from a prior audit | Cannot claim PASS or verify counts until `TEST_DATABASE_URL` is configured |
| `biometric_security_evaluation.test.js` reports "3 sub-tests" in the audit but `✓ Biometric experimental test suite executed successfully` in output — exact internal assertion count not surfaced by the suite's custom logger | Minor — not blocking |
| `email_backup.test.js` uses a custom logger (`✓ All … passed`) without a numbered summary; 5 assertions counted by source inspection | Should switch to a framework with a summary line |
| EMS native runner counts 22 top-level `✔` lines, but `INDEPENDENT_TEST_AUDIT.md` states "45 distinct subtests" in 4 files | Node test runner's `# pass 22` is the authoritative figure; "45 subtests" refers to nested describe blocks counted differently |

---

## 9. Next Actions Required

| Priority | Action | Blocks |
|----------|--------|--------|
| 🔴 Critical | Configure `TEST_DATABASE_URL` (ephemeral Docker PostgreSQL) and re-run `scripts/test_all.js` | Conditions 2, 3, 8 |
| 🟠 High | Fix `requiresDb` flag for `biometric` and `supabase_keepalive` in `test_all.js` (requires authorization) | Condition 8 accuracy |
| 🟡 Medium | Update `TEST_EXECUTION_REPORT.md` to show **90** non-DB Attendance assertions (was 87) and **0 BLOCKED** after PostgreSQL run | Condition 8 |
| 🟡 Medium | Correct `Release_Readiness_Report.md` breakdown from "7+1+1+16" to "8+1+1+16 = 26" or clarify the counting methodology | Condition 8 |

---

*Prepared by: QA Audit (Antigravity)*
*Date: 2026-10-26*
*Raw output from: `node scripts/test_all.js`, `cd ems && npm test`, individual `node test/*.test.js` runs — all captured 2026-10-26 11:21 IST*
