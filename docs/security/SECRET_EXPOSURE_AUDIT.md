# Phase 5: Secret Exposure & Sensitive Data Audit

## 1. Audit Scope & Methodology

A complete secret-exposure assessment was conducted across:
1. **Tracked Repository Files:** All active files across `src/`, `public/`, `scripts/`, `supabase/`, `.github/`, and root configuration.
2. **Untracked & Local Files:** `.gitignore` rules, `attendance.db` SQLite local databases, and temporary artifacts.
3. **Historical Git Commits:** Git revision log diffs and historical commit objects.
4. **Client-Side Bundles:** Public JavaScript assets (`public/app.js`, `public/admin.js`, `public/face_biometric_client.js`, `public/states_districts_client.js`, `public/icons.js`).
5. **CI/CD Workflows:** `.github/workflows/supabase-keepalive.yml`.

---

## 2. Active Source Code & Bundle Audit Results

### 2.1 Tracked Source Code & Configuration
- **Hardcoded API Keys:** 0 found in active code.
- **Hardcoded JWT / Session Secrets:** 0 found. Cryptographic random tokens (`crypto.randomBytes(32).toString('hex')`) are dynamically generated per session and stored with SHA-256 indexes in the database.
- **Database Connection Strings:** Never hardcoded. Dynamically read from `process.env.DATABASE_URL` (production) or `process.env.TEST_DATABASE_URL` (tests).
- **Service Role Secrets:** `SUPABASE_SERVICE_ROLE_KEY` is referenced exclusively in server-side `src/services/storage_service.js` and `scripts/supabase-keepalive.js`. Never loaded or referenced in `public/`.
- **Environment Template (`.env.example`):** Verified to contain only placeholder values:
  - `DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].pooler.supabase.com:6543/postgres`
  - `ADMIN_PASSWORD=` (empty placeholder)
  - `SUPABASE_ANON_KEY=` (empty placeholder)
  - `SUPABASE_SERVICE_ROLE_KEY=` (empty placeholder)
  - `SMTP_PASS=your-16-char-app-password` (placeholder)

### 2.2 Client-Side Bundle Inspection
- Scanned all 10 assets in `public/`.
- Verified that **no database strings, SMTP credentials, or service-role keys** are present in client scripts.
- Verified that `localStorage` only caches public employee metadata and transient session tokens.

---

## 3. Git History Analysis & Historical Findings

### 3.1 Historical Seed Credentials in Early Commits
- **Finding ID:** `FINDING-SEC-01`
- **Location:** Early commit historical diffs in legacy SQLite files (`server.js` and `database.js` prior to the Supabase PostgreSQL migration).
- **Redacted Details:**
  - Early commits included default mock test strings for seed organizations (e.g. `admin_password` default `admin123` / `Password@123` and `EMP-1001` test passwords).
- **Current Status:**
  - Fully superseded in current codebase by modern PostgreSQL schema with salted `scrypt` hashing.
  - Active seed (`src/db/database.js`) enforces `ADMIN_PASSWORD` from environment variables and scrypt-hashes it before insertion.
- **Mandatory Production Recommendation:**
  - Institutional administrators must supply unique, strong passwords via `ADMIN_PASSWORD` during deployment.
  - Historical seed credentials must never be reused in any staging or production environment.

---

## 4. Exclusion & `.gitignore` Integrity Review

The repository's `.gitignore` contains the following rules:
```gitignore
node_modules/
*.db
*.db-journal
*.db-shm
*.db-wal
.env
.DS_Store
*.log
uploads/*
!uploads/.gitkeep
!uploads/checkins/.gitkeep
!uploads/checkouts/.gitkeep
scratch/
```

- **Verification:**
  - Local database files (`attendance.db`, `attendance.db-shm`, `attendance.db-wal`) are untracked and excluded.
  - Local `.env` files are excluded.
  - Uploaded attendance photos (`uploads/checkins/*`, `uploads/checkouts/*`) are excluded, preserving repository privacy.

---

## 5. Credential Rotation & Protection Guidelines

Before deploying to production infrastructure:
1. **Rotate Supabase Service Role Key:** If the Supabase project was created or tested with development tokens, rotate the Service Role key in the Supabase Dashboard.
2. **Configure Database Secrets on Hosting Provider:** On Vercel or Render, set `DATABASE_URL` via encrypted environment variables.
3. **Configure Gmail / SMTP App Password:** Store `SMTP_PASS` securely in hosting dashboard environment variables. Never commit `.env`.
4. **Set `CRON_SECRET`:** Generate a high-entropy secret (`openssl rand -hex 32`) and assign to `CRON_SECRET` on Vercel and in monitoring runners.
