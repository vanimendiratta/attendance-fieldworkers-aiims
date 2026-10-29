#!/usr/bin/env bash
# ==============================================================================
# AIIMS CDER Attendance & EMS Operational Health Check
# Location: /usr/local/bin/attendance-healthcheck.sh
# Can be used with monitoring tools (Uptime Kuma, Zabbix, Datadog, cron)
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

# 2. Check EMS Sub-module Status
EMS_INFO_URL="${TARGET_HOST}/api/ems/system/info"
EMS_RESPONSE=$(curl -s -m "${TIMEOUT}" -w "\n%{http_code}" "${EMS_INFO_URL}" || echo "FAILED\n000")
EMS_BODY=$(echo "${EMS_RESPONSE}" | sed '$d')
EMS_STATUS_CODE=$(echo "${EMS_RESPONSE}" | tail -n1)

if [ "${EMS_STATUS_CODE}" -ne 200 ]; then
    echo "⚠️ Warning: EMS system info returned HTTP ${EMS_STATUS_CODE}: ${EMS_BODY}"
    exit 1
fi

echo "✓ EMS Sub-module: HEALTHY (HTTP 200)"
echo "🎉 All services reporting operational."
exit 0

