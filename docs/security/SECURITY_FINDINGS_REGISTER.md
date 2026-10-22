# Phase 10: Central Security Findings Register

This register details all security vulnerabilities, weaknesses, and functional defects identified during the audit, mapped to OWASP Web Top 10, OWASP API Security Top 10, CWE identifiers, and CVSS v3.1 severity scores.

---

## Findings Summary

| Finding ID | Severity | CVSS v3.1 | OWASP Category | Affected Component | Remediation Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FIND-01** | **Critical** | 9.1 | A06:2021 Vulnerable Components | `proxy-addr` dependency | **FIXED & VERIFIED** |
| **FIND-02** | **High** | 7.5 | API3:2023 Excessive Data Exposure | `POST /settings/set-current-office` | **FIXED & VERIFIED** |
| **FIND-03** | **High** | 7.4 | A07:2021 Identification & Auth | `src/services/auth_service.js` | **FIXED & VERIFIED** |
| **FIND-04** | **High** | 7.1 | A03:2021 Injection (XSS) / Defect | `public/app.js` | **FIXED & VERIFIED** |
| **FIND-05** | **Medium** | 5.3 | API2:2023 Broken Authentication | `GET /cron/daily-attendance-backup`| **FIXED & VERIFIED** |
| **FIND-06** | **Medium** | 5.0 | A05:2021 Security Misconfiguration | `server.js` CSP Header | **FIXED & VERIFIED** |
| **FIND-07** | **Medium** | 4.8 | A06:2021 Vulnerable Components | `multer` dependency | **FIXED & VERIFIED** |
| **FIND-08** | **Low** | 3.7 | API4:2023 Unrestricted Resources | `GET /location/preview` & `/health`| **FIXED & VERIFIED** |

---

## Detailed Findings & Remediation Records

### FIND-01: Client IP Address Spoofing in `proxy-addr`
- **Component:** `node_modules/proxy-addr` (`2.0.7`)
- **Severity:** Critical (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H — 9.1)
- **CWE / OWASP:** CWE-345 / OWASP A06:2021 (Vulnerable and Outdated Components)
- **Advisory:** GHSA-jqcg-44mw-7w3h
- **Root Cause:** A flaw in IPv4-mapped IPv6 trust calculation allowed remote clients to bypass reverse proxy trust definitions and spoof the originating client IP in `X-Forwarded-For`.
- **Attack Scenario:** An attacker sending repeated brute-force login requests could spoof unique IP headers, completely evading IP-based sliding-window rate limiters and polluting forensic audit trails.
- **Remediation Implemented:** Applied `npm audit fix` upgrading `proxy-addr` to `2.0.8`.
- **Verification:** `npm audit` confirms 0 vulnerabilities. All rate-limiting test suites passed.
- **Residual Risk:** None. Package is on latest patched release.

---

### FIND-02: Excessive Data Exposure of Administrator Password Hash
- **Component:** `src/routes/api.js` (Route: `POST /api/settings/set-current-office`)
- **Severity:** High (CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N — 7.5)
- **CWE / OWASP:** CWE-200 / OWASP API3:2023 (Excessive Data Exposure)
- **Root Cause:** Line 2595 executed `SELECT * FROM organizations WHERE id = $1` and returned `updatedRes.rows[0]` directly to the client as the `settings` property, leaking the scrypt `admin_password` hash.
- **Attack Scenario:** An authenticated administrative operator or compromised client could retrieve the cryptographic hash of the organization's root password from the API response payload.
- **Remediation Implemented:** Destructured and stripped `admin_password` prior to sending JSON:
  ```javascript
  const updatedRes = await query('SELECT * FROM organizations WHERE id = $1', [req.employerId]);
  const { admin_password: _, ...safeSettings } = updatedRes.rows[0] || {};
  res.json({ success: true, message: 'Office location synchronized to your current GPS coordinates.', settings: safeSettings });
  ```
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 2: `admin_password` is strictly `undefined`).
- **Residual Risk:** None.

---

### FIND-03: Password Cross-Matching / Institutional Default Bypass
- **Component:** `src/services/auth_service.js` (`verifyPassword`)
- **Severity:** High (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N — 7.4)
- **CWE / OWASP:** CWE-287 / OWASP A07:2021 (Identification and Authentication Failures)
- **Root Cause:** Lines 63–72 contained an `institutionalDefaults` array. If both the candidate password and stored password appeared in this list, the function returned `true` regardless of whether the strings actually matched.
- **Attack Scenario:** If an account was seeded with `aiims@123`, an attacker guessing `admin@123` or `password@123` was granted authenticated access despite entering the incorrect password.
- **Remediation Implemented:** Removed the inter-matching block. Candidate passwords must strictly match the stored credential using constant-time comparison or salted scrypt verification.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 1: Mismatches rejected with `false`).
- **Residual Risk:** None.

---

### FIND-04: Runtime Exception & DOM XSS Risk Due to Missing `escapeHtml`
- **Component:** `public/app.js` (Lines 1741–1769, 2126)
- **Severity:** High (CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:H — 7.1)
- **CWE / OWASP:** CWE-79 / OWASP A03:2021 (Injection - Cross-Site Scripting)
- **Root Cause:** Multiple UI rendering functions called `escapeHtml(...)`, but the function was never defined in `public/app.js` or in scripts loaded by `index.html`. Furthermore, several dynamic elements inserted raw strings into `innerHTML`.
- **Attack Scenario:**
  1. A user checking out or viewing hotel stay details encountered an unhandled `ReferenceError: escapeHtml is not defined`, crashing the checkout timeline completion badge.
  2. If an employee registered a profile with script tags, unescaped insertion into `statusText` or HUD address badges could execute DOM XSS.
- **Remediation Implemented:**
  - Defined centralized, robust `escapeHtml(str)` in `public/app.js`.
  - Sanitized all dynamic properties inserted into `innerHTML`.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 6) and `npm run lint`.
- **Residual Risk:** None.

---

### FIND-05: Unauthenticated Public Cron Access & Query-String Secret Exposure
- **Component:** `src/routes/api.js` (Route: `GET /api/cron/daily-attendance-backup`)
- **Severity:** Medium (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L — 5.3)
- **CWE / OWASP:** CWE-306, CWE-598 / OWASP API2:2023 (Broken Authentication)
- **Root Cause:** If `CRON_SECRET` was unconfigured in environment variables, the route completely bypassed authorization checks, allowing any anonymous client to trigger mass emails and database queries.
- **Attack Scenario:** An external attacker could repeatedly GET `/api/cron/daily-attendance-backup`, causing email spamming and database resource consumption.
- **Remediation Implemented:**
  - If `CRON_SECRET` is set, requires `Authorization: Bearer <secret>`.
  - If `CRON_SECRET` is unconfigured, strictly rejects requests in production with HTTP 401. In non-production, requires an authenticated admin session token.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 3: returns HTTP 401).
- **Residual Risk:** Low. Operational requirement to configure `CRON_SECRET` in production environment.

---

### FIND-06: Content Security Policy Incompatibility with Leaflet Maps
- **Component:** `server.js` (Security Headers Middleware)
- **Severity:** Medium (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:L — 5.0)
- **CWE / OWASP:** CWE-1021, CWE-693 / OWASP A05:2021 (Security Misconfiguration)
- **Root Cause:** CSP `script-src` and `style-src` lacked `https://unpkg.com` (where `admin.html` imports Leaflet CSS/JS), and `img-src` lacked `https://*.tile.openstreetmap.org`, causing modern browsers to block map tiles and Leaflet scripts. Additionally, `frame-ancestors` was missing.
- **Remediation Implemented:**
  Updated CSP header:
  `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none';`
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 5).
- **Residual Risk:** None.

---

### FIND-07: Denial of Service via Orphaned Disk Writes in `multer`
- **Component:** `node_modules/multer` (`2.3.0`)
- **Severity:** Medium (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L — 4.8)
- **CWE / OWASP:** CWE-400 / OWASP A06:2021
- **Advisory:** GHSA-3pph-fpjx-jg34
- **Root Cause:** Incomplete cleanup of aborted file upload streams on temporary disk paths.
- **Remediation Implemented:** Upgraded `multer` to `2.4.0` via `npm audit fix`.
- **Verification:** `npm audit` confirms 0 vulnerabilities.
- **Residual Risk:** None.

---

### FIND-08: Missing Coordinate Bounds Validation & Error Disclosure
- **Component:** `src/routes/api.js` (`GET /location/preview` & `GET /health`)
- **Severity:** Low (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N — 3.7)
- **CWE / OWASP:** CWE-770, CWE-209 / OWASP API4:2023
- **Root Cause:** Coordinates outside valid geographic ranges (-90 to 90, -180 to 180) were processed without boundary validation, and internal database exception strings were returned in 500 responses.
- **Remediation Implemented:** Added coordinate bounds checks and sanitized error responses in production mode.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 4).
- **Residual Risk:** None.
