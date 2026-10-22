# Phase 7: Dependency & Software Supply Chain Audit

## 1. Ecosystem & Manifest Inventory

The project relies on Node.js npm with locked transitive dependencies recorded in `package-lock.json`:

- **Node Engine:** `>= 18.0.0`
- **npm Engine:** `>= 9.0.0`
- **Lockfile Version:** 3 (`package-lock.json`)
- **Direct Runtime Dependencies:** 6
- **Direct Development Dependencies:** 1 (`typescript ^7.0.2`)
- **Total Audited Packages:** 97 packages

---

## 2. Supply Chain Vulnerability Scan & Remediation

### 2.1 Initial Pre-Audit Vulnerabilities Detected
Running `npm audit` against the initial repository lockfile identified **2 vulnerabilities** (1 Critical, 1 Moderate):

| Package | Severity | Advisory ID | Vulnerability Summary | Affected Range | Fixed Version |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`proxy-addr`** | **Critical** | GHSA-jqcg-44mw-7w3h | Client IP spoofing via IPv4-mapped IPv6 trust subnet | `1.1.0 - 2.0.7` | `2.0.8` |
| **`multer`** | **Moderate** | GHSA-3pph-fpjx-jg34 | Denial of Service via orphaned disk writes on aborted uploads | `2.2.0 - 2.3.0` | `2.4.0` |

### 2.2 Threat Analysis & Impact
1. **`proxy-addr` (Critical):**
   - In Express applications behind reverse proxies (Render, Cloudflare, AWS), `req.ip` and `req.ips` depend on `proxy-addr`.
   - The vulnerability permitted an attacker sending requests with IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1`) to bypass trusted proxy configuration and spoof `x-forwarded-for`, potentially circumventing IP-based rate limiting and falsifying forensic audit log IP records.
2. **`multer` (Moderate):**
   - Aborted file upload requests could leave orphaned file handles on local disks, potentially causing resource exhaustion over time.

### 2.3 Safe Remediation Applied
- Executed `npm audit fix`, cleanly upgrading `proxy-addr` to `2.0.8` and `multer` to `2.4.0` with zero breaking changes.
- **Post-Remediation Verification:**
  ```bash
  $ npm audit
  found 0 vulnerabilities
  ```
- All 13 automated test suites and production build scripts were rerun and verified passing.

---

## 3. Dependency Trust & Maintenance Review

Each direct dependency was reviewed for maintenance health, licensing, and security hygiene:

| Dependency | License | Version | Known CVEs | Assessment |
| :--- | :--- | :--- | :--- | :--- |
| `express` | MIT | 5.2.1 | 0 | Latest major release; secure error handling implemented. |
| `pg` | MIT | 8.13.3 | 0 | Standard Node PostgreSQL driver; parameterized queries used. |
| `cors` | MIT | 2.8.6 | 0 | Configured with explicit origin allowlist. |
| `dotenv` | BSD-2-Clause | 17.4.2 | 0 | Standard environment loader; .env git-ignored. |
| `multer` | MIT | 2.4.0 | 0 | Patched version; payload limits restricted to 20MB. |
| `nodemailer` | MIT | 10.0.10 | 0 | Standard SMTP transport; credentials isolated in environment. |

---

## 4. Lifecycle Scripts & CI/CD Security Review

### 4.1 `package.json` Lifecycle Scripts
- Scanned for malicious preinstall/postinstall hooks.
- **Result:** No `preinstall`, `postinstall`, or untrusted execution hooks exist.
- All scripts are standard direct Node invocations (`node server.js`, `node test/api.test.js`, `node scripts/build.js`).

### 4.2 GitHub Actions Security (`.github/workflows/supabase-keepalive.yml`)
- Scanned for workflow permissions and secret hygiene:
  - `permissions: contents: read` (Enforces least privilege; workflow cannot write or push to repository).
  - Secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`) are read exclusively from GitHub Actions Encrypted Secrets (`${{ secrets.* }}`).
  - Workflow steps execute pinned actions (`actions/checkout@v4`, `actions/setup-node@v4`).
