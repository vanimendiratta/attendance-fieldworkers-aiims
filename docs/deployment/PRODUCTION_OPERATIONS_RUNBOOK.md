# Production Operations Runbook
## AIIMS CDER Real-Time Attendance & EMS System

**Document Version:** 1.0.0 | **Audience:** DevOps Engineers, System Administrators, CDER IT Operations

---

## 1. Quick Reference & Service Commands

| Action | Command |
|---|---|
| **Check App Status** | `sudo systemctl status attendance.service` |
| **Restart Application** | `sudo systemctl restart attendance.service` |
| **Stop Application** | `sudo systemctl stop attendance.service` |
| **Inspect Live Logs** | `sudo journalctl -u attendance.service -f` |
| **Inspect Recent Errors** | `sudo journalctl -u attendance.service -p err -n 50` |
| **Check Nginx Status** | `sudo systemctl status nginx` |
| **Reload Nginx (No Downtime)**| `sudo nginx -t && sudo systemctl reload nginx` |
| **Check PostgreSQL Status**| `sudo systemctl status postgresql` |
| **Run Health Check** | `/usr/local/bin/attendance-healthcheck.sh` |
| **Trigger Immediate Backup** | `sudo /usr/local/bin/attendance-backup.sh` |

---

## 2. Health & Performance Monitoring

### 2.1 Automated Health Endpoint
The application exposes a health check endpoint at `/api/health`:

```bash
# Internal check
curl -s http://127.0.0.1:3000/api/health | jq .
```

Expected Output:
```json
{
  "status": "healthy",
  "database": "connected",
  "organizations": 1,
  "employees": 250,
  "serverTime": "2026-10-29T11:00:00.000Z"
}
```

### 2.2 EMS Sub-Module Health Check
```bash
curl -s http://127.0.0.1:3000/api/ems/system/info | jq .
```

Expected Output:
```json
{
  "environment": "production",
  "isDevelopment": false,
  "version": "1.0.0"
}
```

---

## 3. Log Inspection & Analysis

### 3.1 Application Logs (`journalctl`)
```bash
# Follow logs in real-time
sudo journalctl -u attendance.service -f

# View last 200 lines
sudo journalctl -u attendance.service -n 200 --no-pager

# View logs since 1 hour ago
sudo journalctl -u attendance.service --since "1 hour ago"
```

### 3.2 Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

### 3.3 PostgreSQL Logs
```bash
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```

---

## 4. Routine Maintenance Procedures

### 4.1 Daily Backup Verification
Check that the 02:00 AM backup completed successfully:

```bash
ls -lh /var/backups/attendance/daily/
```

Verify that today's `.sql.gz` and `.sqlite.gz` files exist and are non-empty.

### 4.2 Storage & Disk Space Monitoring
```bash
# Check filesystem utilization
df -h / /var /var/www

# Check size of uploads directory
du -sh /var/www/attendance/uploads/*

# Check size of SQLite EMS database
ls -lh /var/www/attendance/ems/data/
```

### 4.3 Database Maintenance
Perform monthly vacuum and index maintenance during off-hours (e.g., 03:00 AM Sunday):

```bash
# PostgreSQL VACUUM ANALYZE
sudo -u postgres psql -d attendance_prod -c "VACUUM ANALYZE;"

# SQLite VACUUM & Integrity Check
sudo systemctl stop attendance.service
sqlite3 /var/www/attendance/ems/data/ems.sqlite "VACUUM; PRAGMA integrity_check;"
sudo systemctl start attendance.service
```

### 4.4 SSL/TLS Certificate Renewal
Certbot automatically renews certificates via `certbot.timer`. Verify manual renewal status monthly:

```bash
sudo certbot renew --dry-run
```

---

## 5. Incident Response Playbooks

### Incident 1: `attendance.service` Fails to Start (`CrashLoopBackOff` or Exit Code 1)
1. **Inspect failure logs:**
   ```bash
   sudo journalctl -u attendance.service -n 50 --no-pager
   ```
2. **Common Causes & Remediation:**
   - **`[SERVER_FATAL] Missing mandatory environment variable(s)`**: Check `/etc/attendance/attendance.env`. Ensure `DATABASE_URL` and `JWT_SECRET` are defined.
   - **`[DB] FATAL: Cannot connect to PostgreSQL`**: Verify PostgreSQL service: `sudo systemctl status postgresql`. Test connection: `psql -h localhost -U attendance_user -d attendance_prod`.
   - **`EADDRINUSE: address already in use :::3000`**: Identify and terminate rogue process:
     ```bash
     sudo lsof -i :3000
     sudo kill -9 <PID>
     sudo systemctl restart attendance.service
     ```

### Incident 2: High Memory or CPU Spikes
1. Check process usage:
   ```bash
   top -b -n 1 | grep node
   ```
2. If memory exceeds 2 GB due to high upload volume:
   ```bash
   # Restart cleanly to free V8 heap
   sudo systemctl restart attendance.service
   ```
3. Check Nginx rate-limiting to confirm traffic is not an unauthorized denial-of-service attempt.

### Incident 3: Disk Full Alert (>85% Storage Consumed)
1. Identify large directories:
   ```bash
   du -ah /var/www/attendance | sort -rh | head -n 20
   ```
2. Archive older check-in photos (>90 days) to external or secondary storage:
   ```bash
   find /var/www/attendance/uploads/checkins -type f -mtime +90 -exec tar -rvf /var/backups/attendance/archive_checkins_90d.tar {} +
   find /var/www/attendance/uploads/checkins -type f -mtime +90 -delete
   ```

### Incident 4: Security Alert – Compromised Account or Stolen Token
1. **Revoke Active User Sessions Immediately:**
   ```bash
   # For PostgreSQL Attendance Sessions:
   sudo -u postgres psql -d attendance_prod -c "
   UPDATE sessions SET is_revoked = true WHERE employee_id = 'COMPROMISED_EMPLOYEE_ID';
   "
   
   # For EMS SQLite Sessions:
   sqlite3 /var/www/attendance/ems/data/ems.sqlite "
   UPDATE user_sessions SET is_revoked = 1 WHERE employee_id = 'COMPROMISED_EMPLOYEE_ID';
   "
   ```
2. **Global Emergency Invalidation (All Sessions):**
   Rotate `JWT_SECRET` and `SESSION_SECRET` in `/etc/attendance/attendance.env` and restart the service:
   ```bash
   sudo nano /etc/attendance/attendance.env  # update JWT_SECRET and SESSION_SECRET
   sudo systemctl restart attendance.service
   ```

