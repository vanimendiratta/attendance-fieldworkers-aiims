#!/usr/bin/env bash
# ==============================================================================
# AIIMS CDER Attendance & EMS Operational Health Check
# Target Server: Ubuntu 26.04 LTS (IP: 192.168.14.224)
# Usage:
#   ./healthcheck.sh                            # checks local loopback: http://127.0.0.1:3000
#   ./healthcheck.sh http://192.168.14.224       # checks Nginx reverse proxy on private IP
# ==============================================================================

set -euo pipefail

TARGET_HOST="${1:-http://127.0.0.1:3000}"
TIMEOUT=5

echo "Checking Attendance + EMS health at: ${TARGET_HOST}..."

# 1. Check Primary Attendance API Health
HEALTH_URL="${TARGET_HOST}/api/health"
HTTP_RESPONSE=$(curl -s -m "${TIMEOUT}" -w "\n%{http_code}" "${HEALTH_URL}" || echo "FAILED\n000")

BODY=$(echo "${HTTP_RESPONSE}" | sed '$d')
STATUS_CODE=$(echo "${HTTP_RESPONSE}" | tail -n1)

if [ "${STATUS_CODE}" -ne 200 ]; then
    echo "❌ Health check FAILED: ${HEALTH_URL} returned HTTP ${STATUS_CODE}"
    echo "Response body: ${BODY}"
    exit 1
fi

# Check that JSON indicates healthy and connected database
if echo "${BODY}" | grep -q '"status":"healthy"' && echo "${BODY}" | grep -q '"database":"connected"'; then
    echo "✓ Attendance Backend & PostgreSQL: HEALTHY (HTTP 200)"
else
    echo "❌ Attendance Health JSON indicates degraded state: ${BODY}"
    exit 1
fi

# 2. Check EMS Router Status
# /api/ems/system/info returns HTTP 200 when the EMS router loaded successfully.
# It does not query the SQLite database; it returns Node env info only.
# A 200 response confirms the EMS module initialised without a native-module crash.
EMS_INFO_URL="${TARGET_HOST}/api/ems/system/info"
EMS_RESPONSE=$(curl -s -m "${TIMEOUT}" -w "\n%{http_code}" "${EMS_INFO_URL}" || echo "FAILED\n000")
EMS_BODY=$(echo "${EMS_RESPONSE}" | sed '$d')
EMS_STATUS_CODE=$(echo "${EMS_RESPONSE}" | tail -n1)

if [ "${EMS_STATUS_CODE}" -ne 200 ]; then
    echo "WARNING: EMS system info endpoint returned HTTP ${EMS_STATUS_CODE}: ${EMS_BODY}"
    echo "  Possible causes: better-sqlite3 ABI mismatch, EMS router load failure, or startup error."
    echo "  Check: sudo journalctl -u attendance -n 50 --no-pager"
    exit 1
fi

echo "OK EMS Router: initialised and reachable (HTTP 200)"
echo "   Note: /api/ems/system/info confirms router load only, not SQLite data integrity."
echo "   For SQLite integrity: sqlite3 /var/www/attendance/ems/data/ems.sqlite 'PRAGMA integrity_check;'"
echo "ALL CHECKS PASSED."
exit 0
