# Production Environment Variables Inventory
## AIIMS CDER Attendance & EMS System

**Document Version:** 1.0.0 | **Classification:** Configuration Reference

---

## 1. Overview & Security Rules

All production environment variables must be stored in `/etc/attendance/attendance.env` with strict permissions:
- **Owner:** `root`
- **Group:** `www-data`
- **Mode:** `0640` (`-rw-r-----`)

> [!IMPORTANT]
> Never commit `.env` or production credentials to Git. The repository `.gitignore` explicitly excludes `.env`, `*.env`, and `*.local`.
> Never use weak or predictable values (`admin`, `secret`, `123456`) in production. The application enforces a startup check in production mode (`NODE_ENV=production`) that fails if `DATABASE_URL` or `JWT_SECRET` is missing or set to an insecure default.

---

## 2. Complete Environment Variable Inventory

| Variable | Scope | Type | Required? | Default in Code | Purpose & Security Guidelines |
|---|---|---|---|---|---|
| `PORT` | Attendance & EMS | Integer | Optional | `3000` | Local port for Express HTTP listener behind Nginx. |
| `NODE_ENV` | Application | String | **Mandatory** | `development` | Set to `production` to activate HSTS headers, disable stack-trace leaks in HTTP 500 responses, and enforce strict startup gates. |
| `APP_ENV` | Application | String | Optional | — | Alternate environment tag. Set to `production`. |
| `DATABASE_URL` | Attendance DB | URI | **Mandatory** | — | PostgreSQL connection string (`postgresql://<user>:<password>@<host>:<port>/<dbname>`). Must be restricted to local loopback or private subnet. |
| `DB_POOL_MAX` | Attendance DB | Integer | Optional | `2` (prod) / `10` (dev) | Maximum PostgreSQL connections in `pg.Pool`. Keep between 5 and 10 on traditional Linux servers. |
| `JWT_SECRET` | EMS Auth | String | **Mandatory** | — | Cryptographic secret for signing and verifying EMS JWT tokens. Minimum 64-character hex string. |
| `SESSION_SECRET` | Attendance Auth | String | **Mandatory** | SHA-256 of DB URL | HMAC secret for attendance session signatures. Recommended 64-character hex string. |
| `HOTEL_VERIFY_SECRET`| Hotel Module | String | Optional | `JWT_SECRET` | Cryptographic secret for signing hotel stay offline verification hashes. |
| `EMS_DB_PATH` | EMS DB | Filepath | Optional | `ems/data/ems.sqlite` | Absolute path to EMS SQLite file. Recommended: `/var/www/attendance/ems/data/ems.sqlite`. |
| `EMS_REQUIRE_EXISTING_DB` | EMS DB | Boolean | Optional | `false` | When `true`, prevents automatic schema creation on start if file is missing. Leave `false` for initial deployment. |
| `UPLOADS_PATH` | Storage | Directory path | Optional | `uploads/` | Absolute path for stored employee check-in photos and leave documents. Recommended: `/var/www/attendance/uploads`. |
| `ALLOWED_ORIGINS` | CORS Security | CSV List | **Mandatory** | Netlify/Render hosts | Comma-separated list of approved web origins (e.g. `https://attendance.your-domain.gov.in`). |
| `SMTP_HOST` | Notifications | Hostname | Optional | — | FQDN or IP of SMTP relay (e.g. `smtp.aiims.edu` or institutional relay). |
| `SMTP_PORT` | Notifications | Integer | Optional | `587` | Port for SMTP relay (`587` for STARTTLS, `465` for SSL, `25` for internal). |
| `SMTP_SECURE` | Notifications | Boolean | Optional | `false` | `true` if port 465 SSL, `false` if STARTTLS (587). |
| `SMTP_USER` | Notifications | String | Optional | — | SMTP username / authorized sending account. |
| `SMTP_PASS` | Notifications | String | Optional | — | SMTP password or app-specific token. |
| `BACKUP_EMAIL_RECIPIENT`| Notifications | Email | Optional | `vanicder01@gmail.com` | Destination email for daily attendance CSV dispatch at 23:55. Must be set to an official administrative distribution group in production. |
| `REDCAP_API_URL` | Integration | URL | Optional | — | AIIMS CDER REDCap server endpoint for field data dictionary sync. |
| `REDCAP_API_TOKEN` | Integration | String | Optional | — | 32-character hexadecimal REDCap API access token. |

---

## 3. Cryptographic Secret Generation Commands

Generate cryptographically secure 256-bit entropy keys using OpenSSL:

```bash
# Generate JWT_SECRET
openssl rand -hex 32

# Generate SESSION_SECRET
openssl rand -hex 32

# Generate HOTEL_VERIFY_SECRET
openssl rand -hex 32

# Generate Strong PostgreSQL Password
openssl rand -base64 24 | tr -d '/+='
```

---

## 4. Production Environment Template (`/etc/attendance/attendance.env`)

```ini
# ==============================================================================
# AIIMS CDER Real-Time Attendance + EMS Production Configuration
# File: /etc/attendance/attendance.env (Permissions: 0640, Owner: root:www-data)
# ==============================================================================

# 1. Core Runtime
PORT=3000
NODE_ENV=production
APP_ENV=production

# 2. Database Connections
DATABASE_URL=postgresql://attendance_user:CHANGE_ME_TO_STRONG_PG_PASSWORD@127.0.0.1:5432/attendance_prod
DB_POOL_MAX=10

EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
EMS_REQUIRE_EXISTING_DB=false

# 3. Security & Token Cryptography
# Generate via: openssl rand -hex 32
JWT_SECRET=CHANGE_ME_64_CHAR_HEX_KEY_1
SESSION_SECRET=CHANGE_ME_64_CHAR_HEX_KEY_2
HOTEL_VERIFY_SECRET=CHANGE_ME_64_CHAR_HEX_KEY_3

# 4. Storage & Uploads
UPLOADS_PATH=/var/www/attendance/uploads

# 5. Access Control & Cross-Origin Resource Sharing
ALLOWED_ORIGINS=https://attendance.your-domain.gov.in

# 6. Email Delivery & Automated Daily Backups
SMTP_HOST=smtp.your-server.gov.in
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=attendance-service@your-domain.gov.in
SMTP_PASS=CHANGE_ME_SMTP_PASSWORD
BACKUP_EMAIL_RECIPIENT=attendance-reports@your-domain.gov.in

# 7. Optional REDCap Synchronization
# REDCAP_API_URL=https://redcap.cder.aiims.edu/api/
# REDCAP_API_TOKEN=32_HEX_DIGIT_TOKEN
```

---

## 5. Build-Time vs Runtime Variables

| Category | Variables | When Loaded | Impact |
|---|---|---|---|
| **Build-Time** | None required | `npm run build` | Assets and public files are static vanilla JS/CSS. `npm run build` validates directory structures and public files without needing production secrets. |
| **Runtime** | `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, `SMTP_*`, etc. | `node server.js` / systemd | Loaded at process initialization via `dotenv` or systemd `EnvironmentFile`. |

