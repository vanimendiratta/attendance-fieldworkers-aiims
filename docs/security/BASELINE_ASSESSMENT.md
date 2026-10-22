# Phase 1: Baseline Architecture & Pre-Audit Assessment

## 1. System Architecture Overview

The **AIIMS Fieldworker Attendance Application** is an enterprise-grade web application built on Node.js and Express, designed for deployment on serverless environments (Vercel) or containerized/standalone virtual servers (Render/Linux VM), backed by a Supabase PostgreSQL transactional database.

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT TIER                                       |
|  +-------------------------------------+   +------------------------------------+  |
|  |    Employee Mobile Field Portal     |   |      Operations Admin Console      |  |
|  |  (HTML5, Vanilla JS, CSS3, Camera)  |   | (Leaflet Map, Editorial Dashboard) |  |
|  +-------------------------------------+   +------------------------------------+  |
+------------------------------------------+----------------------------------------+
                                           | HTTPS / JSON API
+------------------------------------------v----------------------------------------+
|                                APPLICATION SERVER                                 |
|  server.js (Express 5.2.1, Security Headers, CORS, Strict CSP)                    |
|                                                                                   |
|  +-------------------+  +--------------------+  +------------------------------+  |
|  | Auth Middleware   |  | Attendance Service |  | Rate Limiter (DB-backed)     |  |
|  | - Session Tokens  |  | - Single punch/day |  | - Sliding window             |  |
|  | - Role checks     |  | - GPS geofencing   |  | - IP / credential scope      |  |
|  | - Tenant boundary |  | - Anti-replay SHA  |  |                              |  |
|  +-------------------+  +--------------------+  +------------------------------+  |
|                                                                                   |
|  +-------------------+  +--------------------+  +------------------------------+  |
|  | Photo Service     |  | Geo Service        |  | Email & Backup Service       |  |
|  | - Magic bytes     |  | - Haversine calc   |  | - Nodemailer SMTP            |  |
|  | - Size limit      |  | - Velocity anomaly |  | - Automated Cron / Keepalive |  |
|  +-------------------+  +--------------------+  +------------------------------+  |
+------------------------------------------+----------------------------------------+
                                           | Parameterized SQL (node-postgres / pg)
+------------------------------------------v----------------------------------------+
|                               PERSISTENCE TIER                                    |
|   Supabase PostgreSQL (AWS Transaction Pooler on port 6543 / Session on port 5432) |
|   - Multi-tenant organization isolation (employer_id)                              |
|   - Salted scrypt password hashing                                                |
|   - Automated schema migrations (001_initial_schema.sql, 002_leaves.sql)          |
|   - Centralized session token store (auth_sessions)                               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Technology Stack & Runtime Configuration

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `>= 18.0.0` | Server runtime environment |
| **Web Framework** | Express | `^5.2.1` | HTTP routing, middleware, and API dispatch |
| **Database Engine** | PostgreSQL (Supabase) | `15+` via `pg ^8.13.3` | Relational persistence, connection pooling |
| **Authentication** | Node.js `crypto` (`scrypt`) | Native | Salted cryptographic password hashing and verification |
| **Session Store** | Database-backed (`auth_sessions`) | Custom | 7-day TTL tokens, revocation on logout/deletion |
| **File Handling** | Multer | `^2.4.0` | Multipart request handling with DoS mitigation |
| **Email Backup** | Nodemailer | `^10.0.10` | Daily attendance archive delivery |
| **Client Frontend** | Vanilla HTML5 / CSS3 / ES6 | Native | Zero client build dependencies, instant responsiveness |
| **Mapping Library** | Leaflet.js | `1.9.4` (CDN) | Interactive administrative GPS verification map |

---

## 3. Git Status & Working Tree Baseline

- **Repository Branch:** `main`
- **Remote Origin:** `origin/main` (Up to date)
- **Starting Commit:** `9335971` (*feat(infra): add automated Supabase keep-alive workflow and health check suite*)
- **Baseline Working Tree:** Clean prior to audit commencement.
- **Git Tracking Rules:**
  - Database files (`attendance.db`, SQLite journal/wal files) are untracked and excluded in `.gitignore`.
  - `.env` excluded from source control.
  - Test suites enforce a strict safety rule: Integration tests require `TEST_DATABASE_URL` pointing to localhost and refuse execution against remote Supabase production URLs.

---

## 4. Entry Points Inventory

### 4.1 Client Web Interfaces
1. `/` or `/index.html` — Employee Attendance & Sign In/Up Portal (Mobile Web)
2. `/admin.html` or `/admin` — Operations Management & Administrative Timeline Dashboard

### 4.2 Background & External Jobs
1. `GET /api/cron/daily-attendance-backup` — Scheduled daily attendance CSV email dispatch (invoked by cron with secret or admin authentication).
2. Standalone Background Scheduler in `server.js` — Checks every 60 seconds and triggers daily email backup at 23:55 local time.
3. Automated Keep-Alive (`scripts/supabase-keepalive.js`) — Runs every 3 days via GitHub Actions (`.github/workflows/supabase-keepalive.yml`) to prevent Supabase auto-pause.

### 4.3 External Integration Points
1. **OpenStreetMap Nominatim Reverse Geocoding:** `https://nominatim.openstreetmap.org/reverse` (Invoked server-side with strict 3.5s timeout, coordinate bounds validation, and fallback).
2. **SMTP Relay:** Configurable outbound email connection (e.g. Gmail App Password on port 465).
3. **REDCap Clinical Data Export:** Mock generator and RFC 4180 CSV export endpoint (`/api/admin/redcap/data-dictionary.csv`).

---

## 5. Pre-Audit Baseline Test Status

Prior to vulnerability remediation, the test runner was executed:
- `npm run lint` — PASSED (34 JavaScript files verified, 0 emojis).
- `npm run test:all` — 12 test suites executed.
  - Section 1 unit tests passed.
  - Section 2 integration tests require `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/attendance_test"`.
  - When provided with `TEST_DATABASE_URL`, 12/12 existing test suites passed.
  - Identified exit hang in `test/api.test.js` where database pool was not closed on test completion, resolved via explicit `closePool()` and `process.exit(0)`.
