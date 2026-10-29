# Production Environment Variables Inventory
## AIIMS CDER Attendance & EMS System

**Document Version:** 3.0.0 | **Last Updated:** 2026-10-29 | **Target Server:** Ubuntu 26.04 LTS (IP: `192.168.14.224`, 4 GB RAM, 4 CPU cores, 100 GB HDD)  
**Runtime:** Node.js 22 LTS (Active LTS; replaces EOL Node 20)

---

## 1. Overview & File Security

All production environment variables are configured in `/etc/attendance/attendance.env`:
- **Owner:** `root`
- **Group:** `www-data`
- **File Mode:** `0640` (`-rw-r-----`)

> [!IMPORTANT]
> Never commit `.env` or production credentials to Git. The repository `.gitignore` strictly excludes all `.env` files.
> The application enforces an automated startup check in production mode (`NODE_ENV=production`) that immediately aborts if `DATABASE_URL` or `JWT_SECRET` is missing or contains insecure development defaults (`secret`, `admin`, `123456`, etc.).

---

## 2. Runtime Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | **22 LTS** (Active LTS) | Node 20 is End-of-Life (April 2026). Install via `nvm install 22` or NodeSource. Verify: `node --version` → `v22.x.x`. |
| **npm** | ≥ 10 | Bundled with Node 22. |
| **PostgreSQL** | 14–16 | Attendance RDBMS. |
| **SQLite** | ≥ 3.40 | EMS WAL database (`better-sqlite3` native module — must be rebuilt via `npm rebuild better-sqlite3` after any Node upgrade). |

> [!IMPORTANT]
> After any Node.js version upgrade on the server, run `npm rebuild better-sqlite3` inside both `/var/www/attendance` and `/var/www/attendance/ems` to rebuild the native C++ bindings for the new ABI. Failure to do so will cause the EMS service to crash at startup with a `NODE_MODULE_VERSION` mismatch error.

---

## 3. Environment Variable Inventory & Sizing Guidelines

| Variable | Scope | Type | Required? | Default / Sizing Recommendation | Purpose & Security Guidelines |
|---|---|---|---|---|---|
| `PORT` | Attendance & EMS | Integer | Optional | `3000` | Local port for Express listener on `127.0.0.1`. |
| `NODE_ENV` | Application | String | **Mandatory** | `production` | Set to `production` to activate security headers, mask internal database errors from API clients, and enforce fail-closed startup validation. |
| `APP_ENV` | Application | String | Optional | `production` | Secondary environment flag. |
| `DATABASE_URL` | Attendance DB | URI | **Mandatory** | — | Local PostgreSQL connection string: `postgresql://attendance_user:<password>@127.0.0.1:5432/attendance_prod`. Must never listen on a public IP. |
| `DATABASE_URL_SSL_MODE` | Attendance DB | String | Optional | Auto | SSL verification mode for remote PostgreSQL. Loopback (127.0.0.1) uses no SSL. Remote DBs default to strict CA verification (`verify-ca`). Set to `no-verify` only for temporary self-signed dev testing; set to `disable` for unencrypted LAN DBs. |
| `DATABASE_SSL_CA` | Attendance DB | Filepath | Optional | — | Absolute path to institutional custom CA bundle (e.g. `/etc/ssl/certs/aiims-ca.crt`) used to verify remote PostgreSQL TLS certificates. |
| `DB_POOL_MAX` | Attendance DB | Integer | Optional | `8` | Maximum connections in `pg.Pool`. Sized for 4 GB RAM server (avoids exhausting memory; 8 connections * ~10 MB each = ~80 MB). |
| `JWT_SECRET` | EMS Auth | String | **Mandatory** | — | Cryptographic secret for signing and verifying EMS JWT tokens. Minimum 64-character hex string. |
| `SESSION_SECRET` | Attendance Auth | String | **Mandatory** | SHA-256 of DB URL | HMAC secret for attendance session signatures. Recommended 64-character hex string. |
| `HOTEL_VERIFY_SECRET`| Hotel Module | String | Optional | `JWT_SECRET` | Cryptographic secret for signing hotel stay offline verification hashes. |
| `EMS_DB_PATH` | EMS DB | Filepath | Optional | `/var/www/attendance/ems/data/ems.sqlite` | Absolute path to EMS SQLite file on persistent disk. |
| `EMS_REQUIRE_EXISTING_DB` | EMS DB | Boolean | Optional | `false` | When `true`, prevents automatic schema creation on start if file is missing. Leave `false` for initial deployment. |
| `UPLOADS_PATH` | Storage | Directory path | Optional | `/var/www/attendance/uploads` | Absolute path for stored employee check-in photos and leave documents on the 100 GB HDD. |
| `ALLOWED_ORIGINS` | CORS Security | CSV List | **Mandatory** | Intranet IPs & Hostnames | Comma-separated list: `http://192.168.14.224,https://192.168.14.224,http://192.168.14.224:3000,http://attendance.cder.aiims.internal`. |
| `SMTP_HOST` | Notifications | Hostname | Optional | `smtp.aiims.edu` | FQDN or IP of internal AIIMS SMTP relay. |
| `SMTP_PORT` | Notifications | Integer | Optional | `587` | Port for SMTP relay (`587` for STARTTLS, `25` for internal open relay). |
| `SMTP_SECURE` | Notifications | Boolean | Optional | `false` | `false` for STARTTLS. |
| `SMTP_USER` | Notifications | String | Optional | — | Authorized hospital service account. |
| `SMTP_PASS` | Notifications | String | Optional | — | SMTP service account password or app token. |
| `BACKUP_EMAIL_RECIPIENT`| Notifications | Email | Optional | `attendance-reports@aiims.edu` | Destination administrative email for daily CSV export dispatch at 23:55. |

---

## 3. Cryptographic Secret Generation Commands

Generate cryptographically secure 256-bit entropy keys on the server:

```bash
# Generate JWT_SECRET
openssl rand -hex 32

# Generate SESSION_SECRET
openssl rand -hex 32

# Generate HOTEL_VERIFY_SECRET
openssl rand -hex 32

# Generate PostgreSQL Password
openssl rand -base64 24 | tr -d '/+='
```

---

## 4. Production Environment Template (`/etc/attendance/attendance.env`)

```ini
# ==============================================================================
# AIIMS CDER Real-Time Attendance + EMS Production Configuration
# Target: Ubuntu 26.04 LTS (192.168.14.224) | Mode: 0640 root:www-data
# ==============================================================================

# 1. Core Runtime
PORT=3000
NODE_ENV=production
APP_ENV=production

# 2. Database Connections (Tuned for 4 GB RAM)
DATABASE_URL=postgresql://attendance_user:CHANGE_ME_TO_STRONG_PG_PASSWORD@127.0.0.1:5432/attendance_prod
DB_POOL_MAX=8

EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
EMS_REQUIRE_EXISTING_DB=false

# 3. Security & Token Cryptography
# Generate on server via: openssl rand -hex 32
JWT_SECRET=CHANGE_ME_64_CHAR_HEX_KEY_1
SESSION_SECRET=CHANGE_ME_64_CHAR_HEX_KEY_2
HOTEL_VERIFY_SECRET=CHANGE_ME_64_CHAR_HEX_KEY_3

# 4. Storage & Uploads (100 GB HDD)
UPLOADS_PATH=/var/www/attendance/uploads

# 5. Access Control & Cross-Origin Resource Sharing (Intranet IP)
ALLOWED_ORIGINS=http://192.168.14.224,https://192.168.14.224,http://192.168.14.224:3000,http://attendance.cder.aiims.internal

# 6. Email Delivery & Automated Daily Backups (AIIMS Internal Relay)
SMTP_HOST=smtp.aiims.edu
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=cder-attendance@aiims.edu
SMTP_PASS=CHANGE_ME_SMTP_PASSWORD
BACKUP_EMAIL_RECIPIENT=attendance-reports@aiims.edu
```

---

## 5. Build-Time vs Runtime Variables

- **Build-Time (`npm run build`):** No database connections or secrets are required. The build step performs static file validation on vanilla JavaScript, HTML, and CSS assets and verifies storage directory structures. Run with Node.js 22 LTS (`node --version` → `v22.x.x`).
- **Runtime (`node server.js` / systemd):** All database strings, JWT secrets, and CORS origins are loaded dynamically by systemd from `/etc/attendance/attendance.env` when the service starts.
  - The systemd unit (`deployment/attendance.service`) starts Node with `ExecStart=/usr/bin/node --max-old-space-size=1536 server.js`. Verify the Node 22 binary location on the target server with `which node` after installation; update the `ExecStart` path in the unit file if the binary is installed to a non-standard location (e.g., `/usr/local/bin/node` via NodeSource).
