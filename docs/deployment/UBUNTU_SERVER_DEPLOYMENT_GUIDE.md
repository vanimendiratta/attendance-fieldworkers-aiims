# Ubuntu Server 24.04 LTS Production Deployment Guide
## AIIMS CDER Real-Time Attendance + EMS System

**Document Version:** 1.0.0 | **Target OS:** Ubuntu 24.04 LTS (Noble Numbat) | **Runtime:** Node.js 20.x LTS

---

## 1. System Architecture & Prerequisites

### 1.1 Process & Network Architecture
The Attendance + Employee Management System (EMS) runs as a single integrated Express.js application behind an Nginx reverse proxy.
- **Frontend:** Server-rendered and static Single Page Application (SPA) assets served directly from `public/` (Attendance portal at `/`) and `ems/public/` (EMS portal at `/ems`).
- **Backend:** Express REST APIs mounted at `/api` (Attendance) and `/api/ems` (EMS).
- **Process Manager:** `systemd` managing `node server.js` as the `www-data` user listening on loopback port `127.0.0.1:3000`.
- **Reverse Proxy & TLS:** Nginx terminating TLS (HTTPS on port 443) and redirecting HTTP (port 80).
- **Databases:**
  - **Attendance:** PostgreSQL 16 database running locally or on an isolated managed network.
  - **EMS:** SQLite database with Write-Ahead Logging (WAL) enabled, located at `/var/www/attendance/ems/data/ems.sqlite`.

```
 Internet (HTTPS:443 / HTTP:80)
           │
           ▼
     [ Nginx Proxy ]
     (SSL Termination, Gzip, 20MB Payload)
           │
           ▼ (HTTP loopback 127.0.0.1:3000)
    [ systemd: attendance.service ]
    [ Node.js 20 Express Application ]
           │
   ┌───────┴────────────────────────┐
   ▼                                ▼
[ PostgreSQL 16 ]            [ SQLite WAL ]
(Attendance DB)             (EMS Leave DB)
```

### 1.2 Recommended Server Sizing
| Resource | Minimum (Up to 250 Fieldworkers) | Recommended (250–1500 Fieldworkers) | Rationale |
|---|---|---|---|
| **vCPU** | 2 vCPUs | 4 vCPUs | Handles concurrent biometric image hashing, geolocation math, and JWT validations. |
| **RAM** | 4 GB | 8 GB | Supports PostgreSQL connection buffer, Node.js V8 heap, and SQLite in-memory page cache. |
| **Storage** | 40 GB SSD (NVMe preferred) | 80+ GB SSD | Accommodates OS, PostgreSQL write logs, SQLite WAL files, and photo check-in uploads. |
| **Bandwidth** | 100 Mbps | 1 Gbps | Facilitates photo check-in uploads (~100–300 KB compressed WebP/PNG per punch). |

---

## 2. Server Preparation & Base Security (Ubuntu 24.04)

Execute all commands as a user with `sudo` privileges.

### 2.1 System Update & Essential Tools
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw unattended-upgrades \
                    ca-certificates gnupg lsb-release sqlite3 libsqlite3-dev
```

### 2.2 Configure Firewall (UFW)
Open SSH (port 22) and Web traffic (ports 80 and 443). Do not expose PostgreSQL (port 5432) or Node (port 3000) to the public internet.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

---

## 3. Runtime Installation

### 3.1 Install Node.js 20.x LTS
```bash
# Add NodeSource official GPG key and repository
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

NODE_MAJOR=20
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt update
sudo apt install -y nodejs

# Verify versions
node -v   # Expected: v20.x.x
npm -v    # Expected: 10.x.x or higher
```

### 3.2 Install and Configure PostgreSQL 16
```bash
sudo apt install -y postgresql postgresql-contrib

# Verify PostgreSQL service is active
sudo systemctl enable postgresql
sudo systemctl status postgresql --no-pager

# Create production database user and database
# Replace 'STRONG_PG_PASSWORD_HERE' with a secure 32+ character random string
sudo -u postgres psql <<EOF
CREATE ROLE attendance_user WITH LOGIN PASSWORD 'STRONG_PG_PASSWORD_HERE';
CREATE DATABASE attendance_prod OWNER attendance_user;
GRANT ALL PRIVILEGES ON DATABASE attendance_prod TO attendance_user;
\c attendance_prod
GRANT ALL ON SCHEMA public TO attendance_user;
EOF
```

---

## 4. Application Deployment & Setup

### 4.1 Deploy Application Files
Clone the application into `/var/www/attendance`:

```bash
sudo mkdir -p /var/www/attendance
sudo chown -R $USER:$USER /var/www/attendance

# Clone repository
git clone https://github.com/vanimendiratta/attendance-fieldworkers-aiims.git /var/www/attendance
cd /var/www/attendance

# Ensure correct branch
git checkout main
```

### 4.2 Install Production Dependencies
```bash
cd /var/www/attendance
npm ci --omit=dev
```

### 4.3 Configure Dedicated Storage & Permissions
Create upload storage directories and EMS data directory. The service runs under user `www-data`.

```bash
# Upload directories
sudo mkdir -p /var/www/attendance/uploads/checkins
sudo mkdir -p /var/www/attendance/uploads/checkouts
sudo mkdir -p /var/www/attendance/uploads/leave_documents

# EMS SQLite data directory
sudo mkdir -p /var/www/attendance/ems/data

# Set strict permissions
sudo chown -R www-data:www-data /var/www/attendance
sudo chmod -R 750 /var/www/attendance
sudo chmod -R 770 /var/www/attendance/uploads
sudo chmod -R 770 /var/www/attendance/ems/data
```

---

## 5. Production Environment Configuration

Create a secure directory for environment files accessible only by `root` and readable by `www-data`.

```bash
sudo mkdir -p /etc/attendance
sudo install -m 640 -o root -g www-data /dev/null /etc/attendance/attendance.env
```

Edit `/etc/attendance/attendance.env` using `sudo nano /etc/attendance/attendance.env` and supply production values:

```ini
# Core Configuration
PORT=3000
NODE_ENV=production
APP_ENV=production

# PostgreSQL Connection String
DATABASE_URL=postgresql://attendance_user:STRONG_PG_PASSWORD_HERE@localhost:5432/attendance_prod
DB_POOL_MAX=10

# Cryptographic Secrets (Generate using: openssl rand -hex 32)
JWT_SECRET=GENERATED_64_CHAR_HEX_SECRET_FOR_JWT
SESSION_SECRET=GENERATED_64_CHAR_HEX_SECRET_FOR_SESSION
HOTEL_VERIFY_SECRET=GENERATED_64_CHAR_HEX_SECRET_FOR_HOTEL

# EMS SQLite Configuration
EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
EMS_REQUIRE_EXISTING_DB=false

# Upload Storage Directory
UPLOADS_PATH=/var/www/attendance/uploads

# CORS Whitelist (Include your official domain)
ALLOWED_ORIGINS=https://attendance.your-domain.gov.in

# Production SMTP Email Service (AIIMS CDER Relay)
SMTP_HOST=smtp.your-server.gov.in
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=attendance-notifications@your-domain.gov.in
SMTP_PASS=STRONG_SMTP_PASSWORD
BACKUP_EMAIL_RECIPIENT=admin-attendance@your-domain.gov.in
```

Verify permissions:
```bash
sudo chmod 640 /etc/attendance/attendance.env
sudo chown root:www-data /etc/attendance/attendance.env
```

---

## 6. Database Migration & Initialization

Run database migrations to initialize Attendance tables in PostgreSQL and EMS tables in SQLite:

```bash
cd /var/www/attendance

# Run asset and build check
npm run build

# Run database schema migrations using the environment file
sudo -u www-data env $(sudo cat /etc/attendance/attendance.env | grep -v '^#' | xargs) node -e "
const { runMigrations } = require('./ems/server/database/migrate');
const { seedMasterPolicies } = require('./ems/server/database/seed');
runMigrations();
seedMasterPolicies();
console.log('✓ EMS SQLite migrations and policies seeded.');
"
```

---

## 7. Systemd Service Configuration

Install the systemd unit file to manage the Node.js process:

```bash
sudo cp /var/www/attendance/deployment/attendance.service /etc/systemd/system/attendance.service
sudo systemctl daemon-reload
sudo systemctl enable attendance.service
sudo systemctl start attendance.service
```

### Verify Service Status
```bash
sudo systemctl status attendance.service --no-pager
```

Inspect live application logs:
```bash
sudo journalctl -u attendance -f
```

---

## 8. Nginx Reverse Proxy & TLS Configuration

### 8.1 Install Nginx & Certbot
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 8.2 Install Nginx Configuration
```bash
sudo cp /var/www/attendance/deployment/nginx-attendance.conf /etc/nginx/sites-available/attendance.conf

# Replace placeholder with your real domain
sudo sed -i 's/your-domain.gov.in/attendance.your-domain.gov.in/g' /etc/nginx/sites-available/attendance.conf

# Enable the site and disable default
sudo ln -sf /etc/nginx/sites-available/attendance.conf /etc/nginx/sites-enabled/attendance.conf
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t
sudo systemctl reload nginx
```

### 8.3 Obtain Let's Encrypt SSL/TLS Certificate
```bash
sudo certbot --nginx -d attendance.your-domain.gov.in --non-interactive --agree-tos -m admin-cder@your-domain.gov.in
```

Certbot automatically configures auto-renewal. Test the renewal timer:
```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

---

## 9. Automated Backups & Operational Maintenance

Install the backup script in `/usr/local/bin`:

```bash
sudo cp /var/www/attendance/deployment/backup.sh /usr/local/bin/attendance-backup.sh
sudo chmod +x /usr/local/bin/attendance-backup.sh
sudo chown root:root /usr/local/bin/attendance-backup.sh

# Test a backup run
sudo /usr/local/bin/attendance-backup.sh
```

Configure a daily cron job at 02:00 AM:
```bash
echo "0 2 * * * root /usr/local/bin/attendance-backup.sh >> /var/log/attendance-backup.log 2>&1" | sudo tee /etc/cron.d/attendance-backup
sudo chmod 644 /etc/cron.d/attendance-backup
```

---

## 10. Smoke Test & Go-Live Verification

Run the operational health check:
```bash
/var/www/attendance/deployment/healthcheck.sh http://127.0.0.1:3000
```

Verify from the public domain:
```bash
curl -I https://attendance.your-domain.gov.in/api/health
```

Expected response:
```http
HTTP/2 200 
content-type: application/json; charset=utf-8
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
```

---

## 11. Application Upgrades & Zero-Downtime Reload

To deploy new releases from GitHub:

```bash
cd /var/www/attendance

# Pull latest validated commit
sudo -u www-data git pull origin main

# Install dependencies if package.json changed
sudo -u www-data npm ci --omit=dev

# Run production build asset check
sudo -u www-data npm run build

# Restart the application service cleanly
sudo systemctl restart attendance.service

# Verify health status
/var/www/attendance/deployment/healthcheck.sh http://127.0.0.1:3000
```

---

## 12. Rollback Procedure

If a failure is detected post-deployment:
1. **Revert Git revision:**
   ```bash
   cd /var/www/attendance
   sudo -u www-data git checkout <PREVIOUS_STABLE_COMMIT_HASH>
   sudo -u www-data npm ci --omit=dev
   sudo systemctl restart attendance.service
   ```
2. **Restore Database from Backup (if schema corruption occurred):**
   ```bash
   # Find latest backup
   LATEST_PG=$(ls -t /var/backups/attendance/daily/attendance_pg_*.sql.gz | head -1)
   gunzip -c "$LATEST_PG" | PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod
   sudo systemctl restart attendance.service
   ```

