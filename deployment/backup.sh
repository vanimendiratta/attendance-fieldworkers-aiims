#!/usr/bin/env bash
# ==============================================================================
# AIIMS CDER Attendance & EMS Automated Daily Backup Script
# Target Server: Ubuntu 26.04 LTS (IP: 192.168.14.224, 100 GB HDD)
# Location: /usr/local/bin/attendance-backup.sh
# Cron configuration: 0 2 * * * /usr/local/bin/attendance-backup.sh >> /var/log/attendance-backup.log 2>&1
# ==============================================================================

set -euo pipefail

# Configuration
BACKUP_ROOT="/var/backups/attendance"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RETENTION_DAYS=14
MIN_FREE_KB=5242880 # 5 GB safety buffer on 100 GB HDD
LOG_PREFIX="[ATTENDANCE_BACKUP $(date --iso-8601=seconds)]"

# Source environment variables if available
ENV_FILE="/etc/attendance/attendance.env"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a
    source "$ENV_FILE"
    set +a
fi

DB_NAME="${PGDATABASE:-attendance_prod}"
DB_USER="${PGUSER:-attendance_user}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"

SQLITE_PATH="${EMS_DB_PATH:-/var/www/attendance/ems/data/ems.sqlite}"
UPLOADS_DIR="${UPLOADS_PATH:-/var/www/attendance/uploads}"

echo "${LOG_PREFIX} Starting scheduled backup on Ubuntu 26.04 server (192.168.14.224)..."

# Pre-backup Safety Check: Verify free disk space on 100 GB HDD
FREE_KB=$(df -k /var/backups 2>/dev/null | tail -1 | awk '{print $4}' || df -k / | tail -1 | awk '{print $4}')
if [ "${FREE_KB}" -lt "${MIN_FREE_KB}" ]; then
    echo "${LOG_PREFIX} ❌ CRITICAL: Less than 5 GB free disk space available (${FREE_KB} KB free). Aborting backup to protect server operations!" >&2
    exit 1
fi

mkdir -p "${BACKUP_ROOT}/daily" "${BACKUP_ROOT}/logs"
chmod 700 "${BACKUP_ROOT}" "${BACKUP_ROOT}/daily" "${BACKUP_ROOT}/logs"

# 1. PostgreSQL Backup (nice + gzip to minimize HDD seek starvation)
PG_BACKUP_FILE="${BACKUP_ROOT}/daily/attendance_pg_${TIMESTAMP}.sql.gz"
echo "${LOG_PREFIX} Backing up PostgreSQL database (${DB_NAME})..."
if PGPASSWORD="${PGPASSWORD:-}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${PG_BACKUP_FILE}"; then
    PG_SIZE=$(du -h "${PG_BACKUP_FILE}" | cut -f1)
    echo "${LOG_PREFIX} ✓ PostgreSQL backup created: ${PG_BACKUP_FILE} (${PG_SIZE})"
else
    echo "${LOG_PREFIX} ❌ PostgreSQL backup failed!" >&2
    exit 1
fi

# 2. EMS SQLite Backup (Atomic backup via sqlite3 CLI)
if [ -f "${SQLITE_PATH}" ]; then
    SQLITE_BACKUP_FILE="${BACKUP_ROOT}/daily/ems_sqlite_${TIMESTAMP}.sqlite"
    echo "${LOG_PREFIX} Backing up EMS SQLite database (${SQLITE_PATH})..."
    if sqlite3 "${SQLITE_PATH}" ".backup '${SQLITE_BACKUP_FILE}'"; then
        gzip -f "${SQLITE_BACKUP_FILE}"
        SQLITE_SIZE=$(du -h "${SQLITE_BACKUP_FILE}.gz" | cut -f1)
        echo "${LOG_PREFIX} ✓ EMS SQLite backup created: ${SQLITE_BACKUP_FILE}.gz (${SQLITE_SIZE})"
    else
        echo "${LOG_PREFIX} ⚠️ EMS SQLite backup failed or sqlite3 CLI missing!" >&2
    fi
else
    echo "${LOG_PREFIX} Notice: EMS SQLite file not found at ${SQLITE_PATH}, skipping SQLite backup."
fi

# 3. Uploaded Attachments & Proofs Archive (Incremental / tar)
if [ -d "${UPLOADS_DIR}" ]; then
    UPLOADS_BACKUP_FILE="${BACKUP_ROOT}/daily/uploads_${TIMESTAMP}.tar.gz"
    echo "${LOG_PREFIX} Archiving uploaded files from ${UPLOADS_DIR}..."
    if tar -czf "${UPLOADS_BACKUP_FILE}" -C "$(dirname "${UPLOADS_DIR}")" "$(basename "${UPLOADS_DIR}")"; then
        UPLOADS_SIZE=$(du -h "${UPLOADS_BACKUP_FILE}" | cut -f1)
        echo "${LOG_PREFIX} ✓ Uploads archive created: ${UPLOADS_BACKUP_FILE} (${UPLOADS_SIZE})"
    else
        echo "${LOG_PREFIX} ⚠️ Uploads archiving encountered warnings."
    fi
fi

# 4. Cleanup Backups Older than Retention Window & Enforce Permissions
echo "${LOG_PREFIX} Enforcing 0600 permissions on backup archives..."
chmod -R go-rwx "${BACKUP_ROOT}/daily"

echo "${LOG_PREFIX} Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_ROOT}/daily" -type f -name "attendance_*" -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_ROOT}/daily" -type f -name "ems_*" -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_ROOT}/daily" -type f -name "uploads_*" -mtime +"${RETENTION_DAYS}" -delete

echo "${LOG_PREFIX} ✓ Backup routine completed successfully."
exit 0
