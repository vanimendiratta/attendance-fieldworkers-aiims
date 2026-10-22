# Phase 6: Deployment Security Checklist & Operational Pre-Flight

This checklist outlines the mandatory security controls, environment variables, hosting configurations, and operational safeguards required before cutover to production.

---

## 1. Hosting & Network Configuration

- [x] **HTTPS & TLS Enforcement:**
  - Automated TLS 1.3 certificate management enabled via Render / Netlify / Vercel.
  - HTTP-to-HTTPS redirect enforced automatically at edge proxy.
- [x] **HTTP Strict Transport Security (HSTS):**
  - Enabled in `server.js` when `NODE_ENV=production`: `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- [x] **Content Security Policy (CSP):**
  - Enforced in `server.js`:
    ```
    default-src 'self';
    script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org;
    connect-src 'self';
    frame-ancestors 'none';
    ```
- [x] **Clickjacking Mitigation:**
  - `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` prevent unauthorized embedding in iframes.
- [x] **MIME Sniffing Prevention:**
  - `X-Content-Type-Options: nosniff` header active.
- [x] **Referrer Policy:**
  - `Referrer-Policy: strict-origin-when-cross-origin` active.
- [x] **Cross-Origin Resource Sharing (CORS):**
  - Configured with strict origin allowlist (`ALLOWED_ORIGINS`). Arbitrary external domains are rejected.

---

## 2. Environment Variables & Secret Provisioning

Configure the following encrypted environment variables in the cloud hosting dashboard (Render / Vercel):

| Variable Name | Required | Example / Recommended Setting | Security Rule |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | **YES** | `production` | Masks stack traces, activates HSTS and secure cookies. |
| `DATABASE_URL` | **YES** | `postgresql://postgres:[PASS]@[REF].pooler.supabase.com:6543/postgres` | Use Transaction Pooler on port 6543 for Vercel. |
| `ADMIN_PASSWORD` | **YES** | High-entropy string (16+ chars) | Unique administrative password for `aiims_admin`. |
| `ADMIN_USERNAME` | **YES** | `aiims_admin` | Operational root administrator account. |
| `CRON_SECRET` | **YES** | `openssl rand -hex 32` | Mandatory for authenticating `/api/cron/*` endpoints. |
| `ALLOWED_ORIGINS`| **YES** | `https://checkin-checkout-aiims.netlify.app` | Comma-separated list of approved web domains. |
| `DB_POOL_MAX` | Optional | `2` (Vercel) / `10` (Render) | Prevents exhausting Supabase connection limits. |
| `SMTP_HOST` | Optional | `smtp.gmail.com` | Mail server hostname. |
| `SMTP_PORT` | Optional | `465` | SSL SMTP port. |
| `SMTP_USER` | Optional | `notifications@aiims.edu` | Sending mailbox account. |
| `SMTP_PASS` | Optional | `16-char app password` | Never use standard user account password. |
| `BACKUP_EMAIL_RECIPIENT`| Optional | `authorized.recipient@aiims.edu` | Recipient for automated daily backup CSV archives. |

---

## 3. Database Persistence & Connection Architecture

- [x] **Persistence Strategy:**
  - Application persistence is fully decoupled from ephemeral web dynos/containers and hosted on managed Supabase PostgreSQL.
  - Redeploying the web dyno will not cause data loss.
- [x] **Connection Pool Limits:**
  - Serverless functions (Vercel) automatically constrain `poolMax = 1` or `2` to prevent connection exhaustion.
  - Transaction Pooler (PgBouncer) on port 6543 handles high concurrency.
- [x] **Automated Supabase Keep-Alive:**
  - GitHub Actions workflow (`.github/workflows/supabase-keepalive.yml`) runs every 3 days to query Supabase REST and prevent inactivity pausing.

---

## 4. File Storage & Upload Hardening

- [x] **Upload Payload Size Limits:**
  - `express.json` and `express.urlencoded` body limits constrained to `20mb`.
  - Photo service enforces strict `8 MB` maximum and binary magic byte inspection.
- [x] **Path Traversal Mitigation:**
  - Filenames generated using `crypto.randomBytes(6).toString('hex')` with fixed subdirectories (`checkins`, `checkouts`). User-supplied filenames are never written to disk.
- [x] **Orphaned File Mitigation:**
  - `multer` upgraded to `2.4.0` resolving GHSA-3pph-fpjx-jg34.
- [x] **Cloud Storage Private Buckets:**
  - When Supabase Storage is configured, files are stored in a private bucket (`attendance-photos`) and accessed via time-limited signed URLs (`3600s`).

---

## 5. Monitoring, Health Checks & Rollback Readiness

- [x] **Health Check Endpoint:**
  - `GET /api/health` returns HTTP 200 with database connectivity and employee headcount.
  - In production, internal database connection error strings are masked.
- [x] **Forensic Audit Logging:**
  - Centralized table `audit_logs` records all authentication attempts, attendance submissions, and administrative updates with timestamp, IP address, user-agent, and status (`SUCCESS`, `BLOCKED`, `ANOMALY`).
- [x] **Rollback Readiness:**
  - Database schema changes in `supabase/migrations/` are purely additive (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`).
  - Deployments can be reverted to previous git tags without schema incompatibilities.
