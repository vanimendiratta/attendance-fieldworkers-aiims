# EMS Deployment and Operations Guide

## 1. Environment & Architecture Overview

The integrated application runs as a unified Node.js Express 5 service hosted on **Render** under the web service name:
`attendance-fieldworkers-aiims`.

The backend handles both the parent attendance APIs and the EMS leave governance engine.

---

## 2. Environment Variables

Configure these variables in your deployment dashboard (e.g., Render Environment settings). **Never commit actual production values to Git.**

| Variable Name | Required | Default / Description |
| :--- | :---: | :--- |
| `PORT` | Optional | `3000` (Assigned dynamically by Render). |
| `NODE_ENV` | Recommended | `production` |
| `DATABASE_URL` | Optional | PostgreSQL connection string for parent attendance records. |
| `EMS_DB_PATH` | Optional | Path to SQLite database file. Default: `./ems/data/ems.sqlite`. |
| `JWT_SECRET` | Required | Cryptographic secret for signing session and auth tokens. |
| `EMS_JWT_SECRET` | Optional | Falls back to `JWT_SECRET` if not specified. |
| `SESSION_SECRET` | Optional | Used for legacy session signing if enabled. |

---

## 3. Database Persistence & Storage on Render

Because Render web services use ephemeral file systems by default, persistent storage must be configured for the SQLite database:

1. **Persistent Disk Attachment**:
   - In Render dashboard, navigate to **Disks** -> **Add Disk**.
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB to 5 GB (sufficient for years of leave and ledger audit logs).
2. **Environment Variable Configuration**:
   - Set `EMS_DB_PATH=/var/data/ems.sqlite`.
3. **Automated Migration on Startup**:
   - `server.js` calls `runMigrations()` and `seedMasterPolicies()` automatically during startup.
   - All migrations are strictly idempotent and safe to run across deployments without resetting data.

---

## 4. Backup & Disaster Recovery Procedures

### 4.1 Automated SQLite Backups
SQLite database backups should be created using the official online backup API or safe copy mode while in WAL mode:

```bash
# Safe live backup of SQLite database
sqlite3 ems/data/ems.sqlite ".backup 'backups/ems_backup_$(date +%Y%m%d_%H%M%S).sqlite'"
```

### 4.2 Restoring from Backup
In case of catastrophic corruption:
1. Stop the Node.js application process.
2. Copy the verified backup file over the active database file:
   ```bash
   cp backups/ems_backup_YYYYMMDD_HHMMSS.sqlite ems/data/ems.sqlite
   ```
3. Restart the service.

---

## 5. Health Checks & Monitoring

- **Service Health Check**: `GET /health` returns `200 OK` with system uptime and database connectivity status.
- **Log Monitoring**: Server logs print structured events for all authentication bridging events, migrations, and leave reviews.
- **Error Handling**: Uncaught exceptions are intercepted by Express error-handling middleware, returning standardized JSON responses without leaking stack traces.
