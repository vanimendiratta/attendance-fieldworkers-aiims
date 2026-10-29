# Production Operations Runbook
## AIIMS CDER Real-Time Attendance & EMS System

**Document Version:** 3.0.0 | **Target Server:** Ubuntu 26.04 LTS (IP: `192.168.14.224`, 4 GB RAM, 100 GB HDD) | **Runtime:** Node.js 22 LTS

---

## 1. Quick Reference Commands

| Action | Command |
|---|---|
| **Check App Status** | `sudo systemctl status attendance.service` |
| **Restart Application** | `sudo systemctl restart attendance.service` |
| **Inspect Live Logs** | `sudo journalctl -u attendance.service -f` |
| **Inspect Recent Errors** | `sudo journalctl -u attendance.service -p err -n 50` |
| **Check Nginx Status** | `sudo systemctl status nginx` |
| **Reload Nginx (No Downtime)**| `sudo nginx -t && sudo systemctl reload nginx` |
| **Check PostgreSQL Status**| `sudo systemctl status postgresql` |
| **Check Memory & Swap** | `free -h && swapon --show` |
| **Check Disk Utilization** | `df -h / /var /var/backups /var/www` |
| **Run Health Check (Loopback)**| `/usr/local/bin/attendance-healthcheck.sh` |
| **Run Intranet Health Check**| `/usr/local/bin/attendance-healthcheck.sh http://192.168.14.224` |
| **Trigger Immediate Backup** | `sudo /usr/local/bin/attendance-backup.sh` |
| **Verify Off-Host Backup Sync**| `ssh backup-operator@aiims-nas.internal "ls -lh /volume1/cder-backups/"` |

---

## 2. Health & Performance Monitoring

### 2.1 Internal Health Check (Loopback)
```bash
curl -s http://127.0.0.1:3000/api/health | jq .
```

Expected Response:
```json
{
  "status": "healthy",
  "database": "connected",
  "organizations": 1,
  "employees": 250,
  "serverTime": "2026-10-29T12:00:00.000Z"
}
```

### 2.2 Intranet Health Check (Private IP: 192.168.14.224)
```bash
curl -s http://192.168.14.224/api/health | jq .
```

---

## 3. Resource Monitoring for 4 GB RAM / 100 GB HDD

### 3.1 Memory & Swap Utilization
```bash
free -h
```
- **Normal Operating Range:**
  - `Mem: used`: 1.8 GB – 2.8 GB
  - `Swap: used`: 50 MB – 300 MB
- **Warning Threshold:**
  - If `Mem: free` < 200 MB and `Swap: used` > 2 GB, the server is under memory pressure.
  - Review top memory consumers: `ps aux --sort=-%mem | head -10`.
  - **Important:** 4 GB swap space is a safety net against OOM termination, not a substitute for physical RAM. If load tests demonstrate sustained swap thrashing (>50 MB/s swap in/out via `vmstat 1`), physical RAM upgrade to 8 GB must be requested.

### 3.2 Rotational HDD Disk Space & I/O Monitoring
```bash
# Check filesystem utilization
df -h / /var/backups /var/www

# Check disk I/O activity and wait times (iostat requires sysstat package)
iostat -xz 1 5
```
- **Key Metrics for Rotational HDD:**
  - `%util` > 85% sustained indicates disk I/O saturation.
  - `await` > 50 ms indicates queued rotational seek operations.
- **Remediation for High Disk I/O:**
  - Verify if a large backup or photo export is running.
  - Check Nginx access logs for scraping or burst requests.

---

## 4. Routine Maintenance Procedures

### 4.1 Daily Backup Verification & Off-Host Sync
Check that the 02:00 AM cron backup completed locally and synchronized off-host:
```bash
# 1. Local backup check
ls -lh /var/backups/attendance/daily/

# 2. Trigger off-host replication to AIIMS central NAS
rsync -avz -e ssh /var/backups/attendance/daily/ backup-operator@aiims-nas.internal:/volume1/cder-backups/
```
Confirm today's `attendance_pg_*.sql.gz` and `ems_sqlite_*.sqlite.gz` exist, are non-empty, and replicated.

### 4.2 Log Rotation & Journald Cap
Prevent system logs from consuming the 100 GB HDD:

```bash
# Enforce 1 GB cap on systemd journal
sudo sed -i 's/#SystemMaxUse=/SystemMaxUse=1G/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald

# Check journal disk consumption
journalctl --disk-usage
```

### 4.3 Database Maintenance (Monthly Off-Hours)
```bash
# 1. PostgreSQL Maintenance
sudo -u postgres psql -d attendance_prod -c "VACUUM ANALYZE;"

# 2. SQLite Maintenance (Schedule during non-operational hours, e.g. Sunday 03:00 AM)
sudo systemctl stop attendance.service
sqlite3 /var/www/attendance/ems/data/ems.sqlite "VACUUM; PRAGMA integrity_check;"
sudo systemctl start attendance.service
```

### 4.4 Check-in Photo Archiving (Every 6 Months)
To prevent the 100 GB HDD from filling up over time, archive photos older than 180 days:

```bash
# Archive photos older than 180 days to external storage or backup directory
mkdir -p /var/backups/attendance/photo_archives
find /var/www/attendance/uploads/checkins -type f -mtime +180 -exec tar -rvf /var/backups/attendance/photo_archives/checkins_archive_$(date +%Y%m).tar {} +
find /var/www/attendance/uploads/checkins -type f -mtime +180 -delete
```

---

## 5. Incident Response Playbooks

### Incident 1: `attendance.service` Terminated by Linux OOM Killer
- **Symptoms:** Service abruptly stops; `journalctl -u attendance` ends abruptly; `dmesg -T` reports `Out of memory: Killed process <PID> (node)`.
- **Root Cause:** Node.js V8 heap or PostgreSQL exceeded physical RAM during concurrent photo processing without sufficient swap.
- **Immediate Action:**
  1. Restart service: `sudo systemctl restart attendance.service`.
  2. Verify swapfile is active: `swapon --show`. If missing, recreate 4 GB swapfile.
  3. Ensure `--max-old-space-size=1536` is in `/etc/systemd/system/attendance.service`.

### Incident 2: Disk Full (>90% Storage Consumed on 100 GB HDD)
- **Symptoms:** PostgreSQL fails to write WAL logs; SQLite reports `disk I/O error` or `database or disk is full`.
- **Immediate Action:**
  1. Find largest files: `du -ah /var | sort -rh | head -20`.
  2. Prune old backups: `find /var/backups/attendance/daily -type f -mtime +7 -delete`.
  3. Vacuum systemd logs: `sudo journalctl --vacuum-size=200M`.
  4. Restart application and database: `sudo systemctl restart postgresql attendance.service`.

### Incident 3: High I/O Wait Causing Slow API Responses
- **Symptoms:** API response times exceed 5 seconds; CPU shows high `%iowait` in `top`.
- **Root Cause:** Rotational HDD head thrashing between photo writes, PostgreSQL checkpoints, and SQLite WAL updates.
- **Immediate Action:**
  1. Check if backup script is currently running: `pgrep -a attendance-backup` or `pgrep pg_dump`.
  2. Temporarily pause heavy background jobs: verify no bulk CSV exports are running.
  3. Check Nginx connections: `netstat -an | grep :80 | wc -l`.
