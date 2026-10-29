# AIIMS CDER Attendance + EMS — Restricted Institutional VM Deployment Runbook

**Version 1.0.0 | Target: Ubuntu 26.04 LTS | Private IP: 192.168.14.224**

> [!IMPORTANT]
> This runbook is intended for use by an authorized AIIMS IT administrator or sysadmin. All steps assume you have `sudo` access on the target VM. Never share secrets, passwords, or the environment file contents outside of secure institutional channels.

---

## Prerequisites & IT Approvals Required

Before running any commands, the sysadmin must confirm and obtain approval for all of the following:

### System Verification (Confirm with IT Before Proceeding)
- [ ] **OS version**: Confirm Ubuntu 26.04 LTS (Noble Numbat or later) — exact version to be verified with IT
- [ ] **Architecture**: Confirm `x86_64` or `aarch64` — this affects Node.js and PostgreSQL tarball selection for offline installs
- [ ] **Disk layout**: Confirm 100 GB HDD is available (rotational; capacity unverified — verify with `df -h` before proceeding)
- [ ] **Hostname**: Confirm hostname is registered or request IT to register `attendance.cder.aiims.internal` (optional but preferred)
- [ ] **Private IP**: Confirm `192.168.14.224` is statically assigned on the correct interface

### Software Approvals
- [ ] **Node.js 22 LTS installation method**: Agree with IT on one of:
  - Option A: NodeSource apt repository (requires internet or internal apt mirror)
  - Option B: Offline tarball from `nodejs.org/dist/` (for fully air-gapped VMs)
- [ ] **PostgreSQL 16 installation method**: Agree with IT on one of:
  - Option A: `apt` from official Ubuntu/PGDG repository
  - Option B: Offline `.deb` packages pre-downloaded on an approved machine
- [ ] **Nginx installation**: Via `apt` or offline `.deb`

### Security & Network Approvals
- [ ] **TLS certificate strategy**: Agree with IT on one of:
  - **Tier 1 (Preferred)**: Institutional CA-signed certificate for `attendance.cder.aiims.internal` or `192.168.14.224`
  - **Tier 2 (Approved alternative)**: Self-signed certificate with IP SAN (`192.168.14.224`) — users must import CA or accept browser warning
  - **Tier 3 (Last resort — requires explicit approval)**: HTTP-only on port 80, isolated LAN segment only
- [ ] **Firewall rules**: IT must open inbound TCP 80 and 443 from subnet `192.168.14.0/24` only; SSH (port 22) from admin IP only
- [ ] **DNS/hostname registration**: Request `attendance.cder.aiims.internal → 192.168.14.224` in institutional DNS (optional but strongly preferred)
- [ ] **SMTP relay**: Confirm `smtp.aiims.edu` is reachable from `192.168.14.224` on port 587 (for backup email notifications)
- [ ] **Backup off-host transfer**: Arrange USB, NAS, or network share for off-host backup storage with IT

---

## Step 1 — Verify System Baseline

Run the following commands and confirm all output matches expected values before proceeding:

```bash
# Confirm OS and kernel
uname -a
# Expected: Linux <hostname> 6.x.x ... x86_64 GNU/Linux (or aarch64)

lsb_release -a
# Expected: Description: Ubuntu 26.04 LTS

# Verify disk layout — confirm /var has sufficient space (100 GB total, ≥5 GB free required)
df -h
# STOP if any partition hosting /var/www or /var/backups has <5 GB free

# Verify RAM
free -h
# Expected: ~4.0 Gi total

# Confirm IP address on the correct interface
ip addr show
# Expected: 192.168.14.224 visible on the institutional interface (e.g., eth0, ens3)

# Note the interface name for use in Step 12 (firewall)
ip link show
```

> [!WARNING]
> **STOP CONDITION**: If disk free space is less than 5 GB before starting, do not proceed. Contact IT to extend the volume or free space before continuing.

---

## Step 2 — Install Node.js 22 LTS (Restricted Network)

### Option A — NodeSource apt Repository (if internet or internal apt mirror is available)

```bash
# Download and run the NodeSource setup script
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# Install Node.js 22
sudo apt-get install -y nodejs

# Verify versions
node --version   # must be v22.x.x
npm --version    # must be ≥10.x
```

### Option B — Offline Tarball (no internet, no apt mirror)

**On an approved internet-connected machine (matching OS architecture):**

```bash
# Determine the architecture of the target VM (x86_64 or aarch64)
# Download the appropriate Node.js 22 LTS Linux binary from nodejs.org
# Example for x86_64:
curl -O https://nodejs.org/dist/v22.x.x/node-v22.x.x-linux-x64.tar.xz
curl -O https://nodejs.org/dist/v22.x.x/SHASUMS256.txt

# Verify SHA256 checksum before transfer
grep node-v22.x.x-linux-x64.tar.xz SHASUMS256.txt | sha256sum --check
# Must output: node-v22.x.x-linux-x64.tar.xz: OK

# Transfer to target server via scp or approved USB
scp node-v22.x.x-linux-x64.tar.xz <admin_user>@192.168.14.224:/tmp/
```

**On the target VM:**

```bash
# Extract to /usr/local
cd /tmp
sudo tar -xJf node-v22.x.x-linux-x64.tar.xz -C /usr/local --strip-components=1

# Verify installation
node --version   # must be v22.x.x
npm --version    # must be ≥10.x

# Make Node.js available system-wide via /etc/profile.d
sudo tee /etc/profile.d/nodejs.sh << 'EOF'
export PATH=/usr/local/bin:$PATH
EOF

sudo chmod 644 /etc/profile.d/nodejs.sh
source /etc/profile.d/nodejs.sh
```

> [!NOTE]
> For `aarch64` (ARM64), download `node-v22.x.x-linux-arm64.tar.xz` instead. Native modules (e.g., `better-sqlite3`) must be compiled or cross-compiled for the matching OS and architecture.

---

## Step 3 — Install PostgreSQL 16

### Option A — apt (if internet or internal apt mirror is available)

```bash
# Check what PostgreSQL version is available in your configured repositories
apt-cache policy postgresql
# Note: The exact version available may differ; PostgreSQL 16 is preferred.
# If only PostgreSQL 14 or 15 is available, consult IT about the PGDG repository.

# Install PostgreSQL (replace 16 with available version if needed)
sudo apt-get install -y postgresql-16 postgresql-client-16

# Confirm PostgreSQL service is running
sudo systemctl status postgresql
sudo systemctl enable postgresql

# Verify version
psql --version
# Expected: psql (PostgreSQL) 16.x
```

### Option B — Offline `.deb` Packages

```bash
# On an approved internet-connected machine, download the required .deb packages:
# postgresql-16, postgresql-client-16, postgresql-common, libpq-dev, and all dependencies
# Use apt-get download or download from packages.ubuntu.com or apt.postgresql.org

# Transfer .deb files to the target VM via scp or USB
scp postgresql-16_*.deb postgresql-client-16_*.deb <admin_user>@192.168.14.224:/tmp/

# On the target VM, install in dependency order:
sudo dpkg -i /tmp/postgresql-*.deb
sudo apt-get install -f  # fix any missing dependencies if network available

# Start and enable the service
sudo systemctl start postgresql
sudo systemctl enable postgresql
sudo systemctl status postgresql
```

---

## Step 4 — Install Nginx

### Option A — apt

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl status nginx
```

### Option B — Offline `.deb`

```bash
# Transfer nginx and dependency .deb files to /tmp on the target VM
sudo dpkg -i /tmp/nginx*.deb
sudo apt-get install -f
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Step 5 — Create Database and Role (Least Privilege)

```bash
# Connect as the postgres superuser
sudo -u postgres psql
```

Run the following SQL — replace `REPLACE_WITH_STRONG_PASSWORD` with the password generated in Step 8:

```sql
-- Create application role (least privilege)
CREATE ROLE attendance_user WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';

-- Create the production database
CREATE DATABASE attendance_prod
  OWNER attendance_user
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8'
  LC_CTYPE 'en_US.UTF-8'
  TEMPLATE template0;

-- Connect to the new database and configure privileges
\c attendance_prod

GRANT CONNECT ON DATABASE attendance_prod TO attendance_user;
GRANT USAGE ON SCHEMA public TO attendance_user;
GRANT CREATE ON SCHEMA public TO attendance_user;  -- required for initial migrations

-- Set default privileges for future tables and sequences created by migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO attendance_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO attendance_user;

-- Verify
\du attendance_user
\l attendance_prod
\q
```

> [!NOTE]
> After the first successful startup and migration, the `CREATE ON SCHEMA public` privilege can be revoked for additional hardening:
> ```sql
> REVOKE CREATE ON SCHEMA public FROM attendance_user;
> ```
> Only do this after confirming all migrations have completed successfully.

---

## Step 6 — Application Directory and Service Account Setup

The application runs as `www-data`, an existing Ubuntu system account with no login shell. Do not create a new user.

```bash
# Create main application directory
sudo mkdir -p /var/www/attendance
sudo chown www-data:www-data /var/www/attendance
sudo chmod 750 /var/www/attendance

# Create upload directories for check-in/check-out photos
sudo mkdir -p /var/www/attendance/uploads/checkins
sudo mkdir -p /var/www/attendance/uploads/checkouts

# Create EMS SQLite data directory
sudo mkdir -p /var/www/attendance/ems/data

# Set ownership and permissions
sudo chown -R www-data:www-data /var/www/attendance/uploads
sudo chown -R www-data:www-data /var/www/attendance/ems/data
sudo chmod 750 /var/www/attendance/uploads
sudo chmod 750 /var/www/attendance/ems/data
```

---

## Step 7 — Transfer and Install Application

### Create Release Archive (on development machine with git access)

```bash
# On the development machine:
git archive --format=tar HEAD | gzip > attendance_release_$(date +%Y%m%d).tar.gz

# Transfer to the server (replace <admin_user> with your actual admin account name)
scp attendance_release_*.tar.gz <admin_user>@192.168.14.224:/tmp/
```

### Extract Application Files (on the target VM)

```bash
cd /var/www/attendance
sudo tar -xzf /tmp/attendance_release_*.tar.gz
sudo chown -R www-data:www-data /var/www/attendance

# Confirm key files are present
ls /var/www/attendance/server.js
ls /var/www/attendance/deployment/attendance.service
ls /var/www/attendance/deployment/nginx-attendance.conf
```

### Install Production Dependencies — Online (npm registry reachable)

```bash
# Install main application dependencies (production only, no devDependencies)
cd /var/www/attendance
sudo -u www-data npm ci --omit=dev

# Rebuild native modules (better-sqlite3) for the server's Node.js ABI version
sudo -u www-data npm rebuild better-sqlite3

# Install EMS dependencies
cd /var/www/attendance/ems
sudo -u www-data npm ci --omit=dev
sudo -u www-data npm rebuild better-sqlite3
```

### Install Production Dependencies — Offline (no npm registry access)

> [!IMPORTANT]
> Native modules such as `better-sqlite3` contain compiled C++ binaries. They **must** be compiled on a machine with the **same OS and CPU architecture** as the target VM, or cross-compiled. A `node_modules` directory from a macOS or Windows development machine will not work on the Linux VM.

**Option 1 — Pre-packed `node_modules` tarball (same architecture):**

```bash
# On a Linux machine with matching OS and architecture (e.g., Ubuntu 26.04 x86_64):
cd /path/to/attendance
npm ci --omit=dev
npm rebuild better-sqlite3
tar -czf node_modules_release.tar.gz node_modules/

# Transfer to target VM
scp node_modules_release.tar.gz <admin_user>@192.168.14.224:/tmp/

# On target VM:
cd /var/www/attendance
sudo tar -xzf /tmp/node_modules_release.tar.gz
sudo chown -R www-data:www-data /var/www/attendance/node_modules

# Repeat for EMS:
cd /var/www/attendance/ems
# (transfer and extract ems/node_modules_ems_release.tar.gz similarly)
```

**Option 2 — Individual npm pack tarballs:**

```bash
# On internet-connected machine, for each package:
npm pack <package-name>
# Transfer all .tgz files and install:
sudo -u www-data npm install /tmp/<package-name>.tgz
```

---

## Step 8 — Create Production Environment File

### Create the Secure Environment File

```bash
sudo mkdir -p /etc/attendance
sudo touch /etc/attendance/attendance.env
sudo chmod 640 /etc/attendance/attendance.env
sudo chown root:www-data /etc/attendance/attendance.env
```

### Generate Secrets

Run the following on an approved machine with `openssl` available:

```bash
openssl rand -hex 32     # → JWT_SECRET (64 hex characters)
openssl rand -hex 32     # → SESSION_SECRET (64 hex characters)
openssl rand -hex 32     # → HOTEL_VERIFY_SECRET (64 hex characters)
openssl rand -base64 24 | tr -d '/+='   # → PostgreSQL password (URL-safe)
```

### Populate `/etc/attendance/attendance.env`

```bash
sudo nano /etc/attendance/attendance.env
```

Use the following template — replace all placeholder values with real secrets:

```ini
PORT=3000
NODE_ENV=production
APP_ENV=production

# PostgreSQL connection — use 127.0.0.1, not localhost, to force TCP (avoids socket auth issues)
DATABASE_URL=postgresql://attendance_user:STRONG_PG_PASSWORD@127.0.0.1:5432/attendance_prod
DB_POOL_MAX=8

# EMS SQLite database path
EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
EMS_REQUIRE_EXISTING_DB=false

# Secrets — generate with openssl rand -hex 32 (64 hex characters each)
JWT_SECRET=GENERATED_64_CHAR_HEX
SESSION_SECRET=GENERATED_64_CHAR_HEX
HOTEL_VERIFY_SECRET=GENERATED_64_CHAR_HEX

# File uploads
UPLOADS_PATH=/var/www/attendance/uploads

# CORS allowed origins — add institutional hostname if DNS is configured
ALLOWED_ORIGINS=http://192.168.14.224,https://192.168.14.224,http://192.168.14.224:3000,http://attendance.cder.aiims.internal

# SMTP for backup email notifications — confirm relay is reachable from this VM
SMTP_HOST=smtp.aiims.edu
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=cder-attendance@aiims.edu
SMTP_PASS=SMTP_PASSWORD
BACKUP_EMAIL_RECIPIENT=attendance-reports@aiims.edu
```

> [!CAUTION]
> **NEVER commit `/etc/attendance/attendance.env` to version control.** This file contains database passwords and signing secrets. It must exist only on the production server with `chmod 640` and `root:www-data` ownership.

### Verify File Permissions

```bash
ls -la /etc/attendance/attendance.env
# Expected: -rw-r----- 1 root www-data ... /etc/attendance/attendance.env

# Verify www-data can read the file
sudo -u www-data cat /etc/attendance/attendance.env | head -3
```

---

## Step 9 — Run Database Migrations

> [!NOTE]
> The Attendance application runs PostgreSQL schema synchronization automatically on startup (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` — safe and additive). The EMS module runs SQLite migrations via `runMigrations()` called from `server.js`. **No separate manual migration command is required**, but the database and role must exist before the first server start.

### Test Database Connectivity Before First Start

```bash
sudo -u www-data env \
  DATABASE_URL="postgresql://attendance_user:STRONG_PG_PASSWORD@127.0.0.1:5432/attendance_prod" \
  node -e "
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: process.env.DATABASE_URL });
    p.query('SELECT 1')
      .then(() => { console.log('DB OK — connectivity confirmed'); p.end(); })
      .catch(e => { console.error('DB FAIL:', e.message); process.exit(1); });
  "
# Expected: DB OK — connectivity confirmed
```

If this fails:
- Confirm PostgreSQL is running: `sudo systemctl status postgresql`
- Confirm the role and database were created correctly (Step 5)
- Confirm the password in `DATABASE_URL` matches what was used in `CREATE ROLE`
- Confirm PostgreSQL `pg_hba.conf` allows `md5` or `scram-sha-256` auth for `127.0.0.1`

```bash
# Check pg_hba.conf if connectivity fails
sudo -u postgres psql -c "SHOW hba_file;"
sudo cat /etc/postgresql/16/main/pg_hba.conf | grep attendance
# Should have a line allowing: host attendance_prod attendance_user 127.0.0.1/32 scram-sha-256
```

Add the following line to `pg_hba.conf` if missing, then reload PostgreSQL:

```bash
# Add to pg_hba.conf (before the catch-all reject line):
# host    attendance_prod    attendance_user    127.0.0.1/32    scram-sha-256
sudo nano /etc/postgresql/16/main/pg_hba.conf
sudo systemctl reload postgresql
```

---

## Step 10 — Install and Enable Systemd Service

### Install the Service Unit File

```bash
sudo cp /var/www/attendance/deployment/attendance.service /etc/systemd/system/attendance.service
```

### Verify the Node.js Binary Path in the Service File

```bash
which node
# e.g., /usr/bin/node (apt NodeSource install)
#    or /usr/local/bin/node (offline tarball install)
```

If the path differs from what is in the service file, edit it:

```bash
sudo nano /etc/systemd/system/attendance.service
# Find the ExecStart line and update the path to match `which node` output:
# ExecStart=/usr/bin/node --max-old-space-size=1536 server.js
#   → or →
# ExecStart=/usr/local/bin/node --max-old-space-size=1536 server.js
```

### Enable and Start the Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable attendance
sudo systemctl start attendance

# Check status — wait up to 30 seconds for active (running)
sudo systemctl status attendance
```

### Verify Startup Logs

```bash
sudo journalctl -u attendance -n 50 --no-pager
```

Expected log lines:
```
Server listening on http://localhost:3000
PostgreSQL connected
EMS SQLite initialized
```

### Resolve Common Startup Issues

**`NODE_MODULE_VERSION mismatch` for `better-sqlite3`:**

This means `better-sqlite3` was compiled for a different Node.js version. Recompile:

```bash
cd /var/www/attendance
sudo -u www-data npm rebuild better-sqlite3

cd /var/www/attendance/ems
sudo -u www-data npm rebuild better-sqlite3

sudo systemctl restart attendance
sudo journalctl -u attendance -n 20 --no-pager
```

**`Cannot start in production without a database connection`:**

- Recheck `DATABASE_URL` in `/etc/attendance/attendance.env`
- Rerun the connectivity test from Step 9

---

## Step 11 — Install and Configure Nginx

### Install the Nginx Site Configuration

```bash
sudo cp /var/www/attendance/deployment/nginx-attendance.conf /etc/nginx/sites-available/attendance.conf
sudo ln -s /etc/nginx/sites-available/attendance.conf /etc/nginx/sites-enabled/attendance

# Remove the default Nginx site to avoid conflicts
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration syntax before reloading
sudo nginx -t
# Expected output:
#   nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
#   nginx: configuration file /etc/nginx/nginx.conf test is successful
```

> [!WARNING]
> If `nginx -t` reports any errors, **do not proceed**. Fix the configuration error before enabling or restarting Nginx.

### TLS Certificate — Tier 1: Institutional CA (Preferred)

Obtain the certificate and private key from your institutional IT/PKI team:

```bash
sudo cp institutional-cert.crt /etc/ssl/certs/attendance-institutional.crt
sudo cp institutional-cert.key /etc/ssl/private/attendance-institutional.key

sudo chmod 644 /etc/ssl/certs/attendance-institutional.crt
sudo chmod 600 /etc/ssl/private/attendance-institutional.key
sudo chown root:root /etc/ssl/private/attendance-institutional.key
```

### TLS Certificate — Tier 2: Self-Signed with IP SAN (Approved Alternative)

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
  -keyout /etc/ssl/private/attendance-institutional.key \
  -out /etc/ssl/certs/attendance-institutional.crt \
  -subj "/CN=192.168.14.224/O=AIIMS CDER" \
  -addext "subjectAltName=IP:192.168.14.224"

sudo chmod 600 /etc/ssl/private/attendance-institutional.key
sudo chown root:root /etc/ssl/private/attendance-institutional.key
```

> [!WARNING]
> Self-signed certificates will cause browser security warnings. Users must manually accept the certificate or import the CA into their browser/OS trust store. This does **not** provide normally trusted HTTPS. Obtain explicit institutional approval before using in production.

### TLS Certificate — Tier 3: HTTP Only (Last Resort)

Edit `nginx-attendance.conf` to remove the HTTPS (`listen 443 ssl`) server block and serve only on port 80.

> [!CAUTION]
> HTTP provides **no encryption in transit**. Credentials and patient-adjacent data are transmitted in plaintext. Use only on an isolated LAN segment and only with **explicit written institutional approval**.

### Enable and Start Nginx

```bash
sudo systemctl enable nginx
sudo systemctl restart nginx
sudo systemctl status nginx
```

---

## Step 12 — Configure Firewall (ufw)

> [!IMPORTANT]
> Replace `<INTERNAL_INTERFACE>` with the actual interface name from `ip link show` (e.g., `eth0`, `ens3`, `ens160`). Replace `<ADMIN_IP>` with your specific admin workstation IP.

```bash
# Set default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow HTTP from institutional subnet only
sudo ufw allow in on <INTERNAL_INTERFACE> from 192.168.14.0/24 to any port 80

# Allow HTTPS from institutional subnet only
sudo ufw allow in on <INTERNAL_INTERFACE> from 192.168.14.0/24 to any port 443

# Allow SSH only from specific admin IP (replace <ADMIN_IP> with actual IP)
sudo ufw allow in on <INTERNAL_INTERFACE> from <ADMIN_IP>/32 to any port 22

# Enable the firewall
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

> [!CAUTION]
> Enabling `ufw` with an incorrect SSH rule can lock you out of the VM. Confirm your admin IP and interface name before running `ufw enable`. If possible, arrange console access with IT as a fallback before enabling the firewall.

---

## Step 13 — Configure Automatic Backup

### Install the Backup Script

```bash
sudo cp /var/www/attendance/deployment/backup.sh /usr/local/bin/attendance-backup.sh
sudo chmod 700 /usr/local/bin/attendance-backup.sh
sudo chown root:root /usr/local/bin/attendance-backup.sh

# Create backup destination directory
sudo mkdir -p /var/backups/attendance/daily
sudo chown root:root /var/backups/attendance
sudo chmod 750 /var/backups/attendance
```

### Schedule Daily Backup via Cron

```bash
# Add cron job for root — runs at 02:00 daily
sudo crontab -e
```

Add the following line:

```
0 2 * * * /usr/local/bin/attendance-backup.sh >> /var/log/attendance-backup.log 2>&1
```

### Configure Log Rotation for Backup Logs

```bash
sudo tee /etc/logrotate.d/attendance-backup << 'EOF'
/var/log/attendance-backup.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
}
EOF
```

### Verify Backup Script Runs Correctly

```bash
sudo /usr/local/bin/attendance-backup.sh
ls -lh /var/backups/attendance/daily/
```

> [!CAUTION]
> Backups stored in `/var/backups/attendance/daily/` are on the **same physical disk** as the application. This protects against accidental deletion or software errors, but **does not protect against disk failure**. Arrange off-host backup transfer (USB, NAS, or network share) with IT as a required secondary measure.

---

## Step 14 — Post-Deployment Health Verification

Run all of the following checks. All must pass before the deployment is considered complete.

```bash
# 1. Confirm both services are active
systemctl is-active attendance   # must output: active
systemctl is-active nginx        # must output: active

# 2. Test the application health endpoint directly (bypass Nginx)
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
# Expected:
# {
#     "status": "healthy",
#     "database": "connected",
#     ...
# }

# 3. Test via Nginx (port 80 or 443)
curl -s http://192.168.14.224/api/health | python3 -m json.tool
# (or https://192.168.14.224/api/health for TLS — add -k flag for self-signed certs)

# 4. Run the provided health check script
/var/www/attendance/deployment/healthcheck.sh
# Or against the Nginx endpoint:
/var/www/attendance/deployment/healthcheck.sh http://192.168.14.224

# 5. Test EMS system info endpoint
curl -s http://127.0.0.1:3000/api/ems/system/info

# 6. Confirm uploads directory is writable by www-data
sudo -u www-data touch /var/www/attendance/uploads/checkins/.write_test
sudo -u www-data rm /var/www/attendance/uploads/checkins/.write_test
echo "Uploads writable: OK"

# 7. Confirm EMS SQLite data directory is writable
sudo -u www-data touch /var/www/attendance/ems/data/.write_test
sudo -u www-data rm /var/www/attendance/ems/data/.write_test
echo "EMS data dir writable: OK"
```

---

## Step 15 — Monitor Disk, Memory, and Logs

### Ongoing Monitoring Commands

```bash
# Memory usage
free -h

# Watch memory in real time (refresh every 5 seconds)
watch -n5 free -h

# Disk usage — check application, backup, and log directories
df -h /var/www/attendance /var/backups /var/log

# Disk I/O (useful for diagnosing HDD bottlenecks — rotational disk)
iostat -x 5

# Application logs (live tail)
sudo journalctl -u attendance -f

# Application logs (last 100 lines, no pager)
sudo journalctl -u attendance -n 100 --no-pager

# Nginx access and error logs
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# Backup log
sudo tail -f /var/log/attendance-backup.log
```

> [!TIP]
> On a rotational HDD, heavy concurrent write operations (photo uploads + SQLite WAL checkpoints + PostgreSQL WAL) may cause I/O contention. Monitor `iostat -x 5` during peak usage. If `%util` regularly exceeds 80%, discuss an SSD upgrade or I/O scheduling tuning (`mq-deadline` scheduler) with IT.

---

## Stop Conditions

**Immediately stop and do not proceed if any of the following occur:**

| Condition | Action |
|-----------|--------|
| `systemctl status attendance` shows `failed` or remains `activating` for more than 30 seconds | Check `journalctl -u attendance` for the root cause before retrying |
| `journalctl -u attendance` shows `FATAL`, `NODE_MODULE_VERSION mismatch`, or `Cannot start in production without a database connection` | Resolve the specific error before retrying |
| `curl http://127.0.0.1:3000/api/health` returns HTTP status ≠ 200 or `"database": "error"` | Diagnose database connectivity; do not route traffic to Nginx |
| `nginx -t` reports a configuration error | Fix the configuration error before restarting Nginx |
| Disk free space is less than 5 GB on any partition hosting `/var/www`, `/var/backups`, or `/var/log` | Extend the volume or free space before proceeding |
| `/etc/attendance/attendance.env` is missing or not readable by `www-data` | Recheck file permissions: `chmod 640`, `chown root:www-data` |

---

## Rollback Procedure

If the deployment fails and a previous version was running, follow these steps:

### 1. Stop the Service

```bash
sudo systemctl stop attendance
```

### 2. Restore Previous Application Files

```bash
# If you kept a backup of the previous release:
sudo rm -rf /var/www/attendance
sudo mkdir -p /var/www/attendance
sudo tar -xzf /tmp/previous_release.tar.gz -C /var/www/attendance
sudo chown -R www-data:www-data /var/www/attendance
```

### 3. Restore Node Modules (if Node.js version changed)

```bash
cd /var/www/attendance
sudo -u www-data npm ci --omit=dev
sudo -u www-data npm rebuild better-sqlite3

cd /var/www/attendance/ems
sudo -u www-data npm ci --omit=dev
sudo -u www-data npm rebuild better-sqlite3
```

### 4. Restart and Verify

```bash
sudo systemctl start attendance
sudo systemctl status attendance
sudo journalctl -u attendance -n 30 --no-pager
curl -s http://127.0.0.1:3000/api/health
```

### Database Schema Rollback

> [!NOTE]
> The application uses **additive-only schema migrations** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). There is no automatic schema rollback built into the application. If a migration causes data loss or corruption, restore from the most recent backup using the procedure in [`DATABASE_DEPLOYMENT_AND_MIGRATION.md`](./DATABASE_DEPLOYMENT_AND_MIGRATION.md).

For a full PostgreSQL database restore from backup:

```bash
# Stop the application first
sudo systemctl stop attendance

# Restore database from backup (replace with actual backup file path)
sudo -u postgres psql -c "DROP DATABASE IF EXISTS attendance_prod;"
sudo -u postgres psql -c "CREATE DATABASE attendance_prod OWNER attendance_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
sudo -u postgres pg_restore -d attendance_prod /var/backups/attendance/daily/attendance_prod_YYYYMMDD.dump

# Restart
sudo systemctl start attendance
sudo journalctl -u attendance -n 30 --no-pager
```

---

## Appendix — Quick Reference

### Key Paths

| Resource | Path |
|----------|------|
| Application root | `/var/www/attendance` |
| Environment file | `/etc/attendance/attendance.env` |
| Systemd service | `/etc/systemd/system/attendance.service` |
| Nginx site config | `/etc/nginx/sites-available/attendance.conf` |
| Uploads directory | `/var/www/attendance/uploads` |
| EMS SQLite database | `/var/www/attendance/ems/data/ems.sqlite` |
| Backups | `/var/backups/attendance/daily/` |
| Backup script | `/usr/local/bin/attendance-backup.sh` |
| TLS certificate | `/etc/ssl/certs/attendance-institutional.crt` |
| TLS private key | `/etc/ssl/private/attendance-institutional.key` |

### Key Ports

| Service | Port | Access |
|---------|------|--------|
| Node.js application | 3000 | Localhost only (Nginx proxies) |
| Nginx HTTP | 80 | `192.168.14.0/24` subnet only |
| Nginx HTTPS | 443 | `192.168.14.0/24` subnet only |
| PostgreSQL | 5432 | Localhost only |
| SSH | 22 | Admin IP only |

### Service Management

```bash
# Start / stop / restart application
sudo systemctl start attendance
sudo systemctl stop attendance
sudo systemctl restart attendance

# Reload Nginx configuration without downtime
sudo systemctl reload nginx

# View live logs
sudo journalctl -u attendance -f
```

---

*Generated: 2026-10-29. Verified locally on Node.js v22.23.4, macOS (development). Target server verification required by AIIMS IT administrator before production go-live.*
