# Ubuntu Server 26.04 LTS Production Deployment Guide
## AIIMS CDER Real-Time Attendance + EMS System

**Document Version:** 3.0.0 | **Target Server:** Ubuntu 26.04 LTS | **Runtime:** Node.js 22 LTS | **Private IP:** `192.168.14.224`

---

## 1. Actual Server Specifications & Unverified Capacity Baseline

### 1.1 Server Baseline Specifications
- **Operating System:** Ubuntu Server 26.04 LTS
- **Compute:** 4 CPU Cores
- **Memory:** 4 GB Physical RAM
- **Storage:** 100 GB Rotational HDD (Hard Disk Drive)
- **Network Interface:** Private Intranet IP `192.168.14.224` (Subnet `192.168.14.0/24`, RFC 1918)

### 1.2 Capacity Qualification & Hardware Constraints

> [!WARNING]
> **Capacity is Unverified Pending Load Testing:**  
> Previous assumptions that 4 GB RAM can support hundreds of concurrent fieldworkers are unverified theoretical estimates. On a 4 GB RAM server with a mechanical 100 GB HDD, throughput and concurrency are strictly bounded by rotational disk latency and available physical memory. Operational capacity must be empirically validated using staged load testing before onboarding field teams.

#### Memory Allocation & Constraints (4 GB Physical RAM)
- **Estimated Resource Allocation:**
  - Linux Kernel & Core Operating System: ~600–800 MB
  - Node.js Express Application (Attendance + EMS): ~250–400 MB baseline RSS (spikes to ~600 MB during bulk CSV exports and photo integrity validation)
  - PostgreSQL 16/17: ~350–500 MB (tuned with `shared_buffers = 256MB`, `work_mem = 4MB`, `max_connections = 50`)
  - SQLite EMS (in-memory cache & WAL buffers): ~32–64 MB
  - Nginx Reverse Proxy: ~30–50 MB
  - Available for Linux filesystem buffer cache: ~1.8–2.2 GB
- **Swap Space Role:** A **4 GB swapfile** (`/swapfile`) with `vm.swappiness = 10` is mandatory. **Swap is strictly a safety net against Linux Out-of-Memory (OOM) killer process termination; it is NOT a substitute for physical RAM.** If active memory spills heavily into swap, performance will degrade severely due to rotational disk thrashing.
- **V8 Heap Constraint:** `--max-old-space-size=1536` is explicitly configured in [`deployment/attendance.service`](file:///Users/vanimendiratta/Desktop/attendance/deployment/attendance.service) to prevent the V8 engine from exhausting physical host memory.

#### Storage Performance Constraints (100 GB Rotational HDD)
- **Rotational Latency & I/O Contention:** Mechanical HDDs have high average seek latency (10–15 ms) and very low random I/O throughput (75–120 IOPS). Concurrent disk writes from PostgreSQL write-ahead logs (WAL), SQLite WAL frames, and multipart check-in photo uploads compete directly for the same physical disk heads.
- **Estimated Storage Budget (100 GB):**
  - OS, Kernel, Base Packages: ~10 GB
  - Swap Space: 4 GB
  - PostgreSQL Database: ~5–10 GB
  - SQLite EMS Database: ~1–2 GB
  - Check-in Photo Storage (~150 KB/photo, 2 punches/day for 200 workers): ~1.8 GB/month (~22 GB/year)
  - Daily Backups (14-day rolling retention): ~10–15 GB
  - System Logs (journald capped at 1 GB + Nginx logs): ~2 GB
  - Free Headroom Margin: ~35–45 GB
- **Mandatory Storage Safeguards:**
  1. Automated pre-flight check in `backup.sh` aborts if free disk space is under 5 GB.
  2. Scheduled archiving of check-in photos older than 180 days to off-host institutional storage.
  3. Strict systemd journal cap (`SystemMaxUse=1G`).

---

## 2. Institutional Network & HTTPS Model (`192.168.14.224`)

### 2.1 Private Intranet Perimeter
- **RFC 1918 IP Address:** `192.168.14.224` is a private, non-routable intranet IP address.
- **Access Policy:** The server cannot and must not be exposed to the public internet directly. All access must originate from:
  1. The AIIMS Hospital Local Area Network (LAN / Ethernet / secure hospital Wi-Fi), or
  2. The authorized AIIMS Institutional VPN (e.g., FortiClient / GlobalProtect).

### 2.2 HTTPS & Certificate Strategy
Public ACME certificate authorities (such as Let's Encrypt HTTP-01 challenges) **cannot** issue certificates for private RFC 1918 IP addresses. The supported deployment tiers are:

- **Tier 1 (Preferred Enterprise Model):**  
  AIIMS IT provisions an internal DNS record (e.g., `attendance.cder.aiims.internal` or `attendance.cder.aiims.edu`) and signs an institutional SSL/TLS certificate via the AIIMS Enterprise Root/Intermediate Certificate Authority. This enables valid HTTPS on all institutional devices with zero browser warnings.
- **Tier 2 (Staging / LAN Testing with Self-Signed IP Certificate):**  
  Generate an internal OpenSSL self-signed certificate with an IP Subject Alternative Name (`subjectAltName = IP:192.168.14.224`). Requires administrative trust installation on client devices.
- **Tier 3 (Intranet HTTP on Port 80):**  
  Nginx reverse proxy serves plain HTTP on port 80 strictly bounded within the secure hospital subnet behind the perimeter firewall, or behind an institutional reverse proxy performing SSL offloading.

---

## 3. Server Preparation & Hardening (Ubuntu 26.04 LTS)

All steps require an account with `sudo` administrative privileges.

### 3.1 System Updates & Toolchain
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw \
                    ca-certificates gnupg lsb-release sqlite3 libsqlite3-dev sysstat
```

### 3.2 Configure 4 GB Swap Safety Net
```bash
# Check existing swap
sudo swapon --show

# Create 4 GB swapfile
sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Persist in fstab
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Lower swappiness to prioritize physical RAM
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.d/99-swappiness.conf
```

### 3.3 Host Firewall Configuration (UFW)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH

# Restrict HTTP/HTTPS traffic to the hospital intranet subnet (192.168.0.0/16)
sudo ufw allow from 192.168.0.0/16 to any port 80 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 443 proto tcp

sudo ufw enable
sudo ufw status verbose
```

---

## 4. Runtime & Database Installation

### 4.1 Install Node.js 22 LTS (Active LTS)
Node.js 20 is End-of-Life (EOL April 2026). Install **Node.js 22 LTS**:

```bash
# Register NodeSource repository for Node 22 LTS
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

NODE_MAJOR=22
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt update
sudo apt install -y nodejs

# Verify versions
node -v   # Expected: v22.x
npm -v    # Expected: 10.x+
```

### 4.2 Install & Tune PostgreSQL (4 GB RAM / Rotational HDD)
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

# Create tuning profile for 4 GB RAM and mechanical HDD
sudo tee -a /etc/postgresql/*/main/conf.d/tuning.conf <<EOF
# Memory Sizing (4 GB RAM Server)
shared_buffers = 256MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 1GB
max_connections = 50

# Rotational HDD Optimizations
checkpoint_completion_target = 0.9
wal_buffers = 16MB
random_page_cost = 4.0
effective_io_concurrency = 2
EOF

sudo systemctl restart postgresql
```

### 4.3 Create PostgreSQL User & Production Database
```bash
# Generate a strong password on the server: openssl rand -base64 24
sudo -u postgres psql <<EOF
CREATE ROLE attendance_user WITH LOGIN PASSWORD 'STRONG_PG_PASSWORD_HERE';
CREATE DATABASE attendance_prod OWNER attendance_user;
GRANT ALL PRIVILEGES ON DATABASE attendance_prod TO attendance_user;
\c attendance_prod
GRANT ALL ON SCHEMA public TO attendance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO attendance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO attendance_user;
EOF
```

---

## 5. Application Deployment & Environment Setup

### 5.1 Clone Repository
```bash
sudo mkdir -p /var/www/attendance
sudo chown -R $USER:$USER /var/www/attendance

git clone https://github.com/vanimendiratta/attendance-fieldworkers-aiims.git /var/www/attendance
cd /var/www/attendance
git checkout main
```

### 5.2 Install Production Dependencies
The native C++ module `better-sqlite3` will compile against the Node.js 22 LTS ABI:

```bash
cd /var/www/attendance
npm ci --omit=dev
```

### 5.3 Configure Directories & Restricted Permissions
```bash
# Storage directories
sudo mkdir -p /var/www/attendance/uploads/checkins
sudo mkdir -p /var/www/attendance/uploads/checkouts
sudo mkdir -p /var/www/attendance/uploads/leave_documents
sudo mkdir -p /var/www/attendance/ems/data

# Strict least-privilege permissions:
# Source code is owned by root:www-data with read-only access for www-data.
# Only the two runtime directories (uploads and ems/data) are writable by www-data.
sudo chown -R root:www-data /var/www/attendance
sudo find /var/www/attendance -type d -exec chmod 750 {} \;
sudo find /var/www/attendance -type f -exec chmod 640 {} \;
sudo chmod 750 /var/www/attendance/deployment/*.sh

# Grant write access ONLY to the required runtime directories:
sudo chown -R www-data:www-data /var/www/attendance/uploads
sudo chown -R www-data:www-data /var/www/attendance/ems/data
sudo chmod -R 770 /var/www/attendance/uploads
sudo chmod -R 770 /var/www/attendance/ems/data
```

### 5.4 Production Environment File (`/etc/attendance/attendance.env`)
```bash
sudo mkdir -p /etc/attendance
sudo install -m 640 -o root -g www-data /dev/null /etc/attendance/attendance.env
```

Populate `/etc/attendance/attendance.env` using `sudo nano /etc/attendance/attendance.env`:

```ini
# Core Configuration
PORT=3000
NODE_ENV=production
APP_ENV=production

# PostgreSQL Connection (Localhost only)
DATABASE_URL=postgresql://attendance_user:STRONG_PG_PASSWORD_HERE@127.0.0.1:5432/attendance_prod
DB_POOL_MAX=8

# Cryptographic Secrets (Generate via: openssl rand -hex 32)
JWT_SECRET=GENERATED_64_HEX_CHAR_SECRET_FOR_EMS_JWT
SESSION_SECRET=GENERATED_64_HEX_CHAR_SECRET_FOR_SESSION
HOTEL_VERIFY_SECRET=GENERATED_64_HEX_CHAR_SECRET_FOR_HOTEL

# EMS SQLite Path
EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
EMS_REQUIRE_EXISTING_DB=false

# Upload Storage Directory
UPLOADS_PATH=/var/www/attendance/uploads

# CORS Whitelist (Private IP & Internal Hostnames)
ALLOWED_ORIGINS=http://192.168.14.224,https://192.168.14.224,http://192.168.14.224:3000,http://attendance.cder.aiims.internal

# Internal SMTP Mail Relay
SMTP_HOST=smtp.aiims.edu
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=cder-attendance@aiims.edu
SMTP_PASS=INSTITUTIONAL_SMTP_PASSWORD
BACKUP_EMAIL_RECIPIENT=attendance-reports@aiims.edu
```

---

## 6. Database Initialization & Service Start

```bash
cd /var/www/attendance
npm run build

# Run EMS SQLite migrations and seed master policies
sudo -u www-data env $(sudo cat /etc/attendance/attendance.env | grep -v '^#' | xargs) node -e "
const { runMigrations } = require('./ems/server/database/migrate');
const { seedMasterPolicies } = require('./ems/server/database/seed');
runMigrations();
seedMasterPolicies();
console.log('✓ EMS SQLite migrations executed and foundational policies seeded.');
"

# Install and activate systemd service
sudo cp /var/www/attendance/deployment/attendance.service /etc/systemd/system/attendance.service
sudo systemctl daemon-reload
sudo systemctl enable attendance.service
sudo systemctl start attendance.service

# Verify service is running
sudo systemctl status attendance.service --no-pager
```

---

## 7. Nginx Reverse Proxy Setup

```bash
sudo apt install -y nginx

sudo cp /var/www/attendance/deployment/nginx-attendance.conf /etc/nginx/sites-available/attendance.conf
sudo ln -sf /etc/nginx/sites-available/attendance.conf /etc/nginx/sites-enabled/attendance.conf
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
```

### Self-Signed Certificate Generation (Optional Tier 2 Staging)
```bash
sudo openssl req -x509 -nodes -days 730 -newkey rsa:2048 \
  -keyout /etc/ssl/private/attendance-selfsigned.key \
  -out /etc/ssl/certs/attendance-selfsigned.crt \
  -subj "/CN=192.168.14.224" \
  -addext "subjectAltName = IP:192.168.14.224,DNS:attendance.cder.aiims.internal"
```

---

## 8. Automated Backups & Off-Host Replication

### 8.1 Local Backup Script Setup
```bash
sudo cp /var/www/attendance/deployment/backup.sh /usr/local/bin/attendance-backup.sh
sudo chmod 700 /usr/local/bin/attendance-backup.sh
sudo chown root:root /usr/local/bin/attendance-backup.sh

# Run manual verification backup
sudo /usr/local/bin/attendance-backup.sh

# Install cron job for 02:00 AM daily
echo "0 2 * * * root /usr/local/bin/attendance-backup.sh >> /var/log/attendance-backup.log 2>&1" | sudo tee /etc/cron.d/attendance-backup
sudo chmod 644 /etc/cron.d/attendance-backup
```

### 8.2 Off-Host Backup Policy
> [!IMPORTANT]
> **On-Host Backups Are Vulnerable to Physical HDD Failure:**  
> Storing backups in `/var/backups/attendance` on the same 100 GB HDD does not protect against drive hardware failure. IT Operations must configure daily off-host replication via `rsync` over SSH to an external AIIMS NAS or secondary backup server:
> ```bash
> # Example Off-Host Sync (Executed after 02:00 AM backup):
> rsync -avz -e ssh /var/backups/attendance/daily/ backup-operator@aiims-nas.internal:/volume1/cder-backups/
> ```

---

## 9. Safe Load-Testing & Capacity Validation Procedure

Before declaring the server ready for all field teams, conduct an internal load test from a client workstation on the hospital LAN (`192.168.14.0/24`):

### 9.1 Recommended Tooling & Test Strategy
Use `autocannon` or `k6` to test real HTTP endpoints incrementally:

```bash
# Example from test workstation on LAN:
# Phase 1: Baseline health check (read throughput)
npx autocannon -c 10 -d 30s http://192.168.14.224/api/health

# Phase 2: Active authenticated simulation (50 concurrent users)
npx autocannon -c 50 -d 60s \
  -H "Authorization: Bearer <TEST_TOKEN>" \
  http://192.168.14.224/api/ems/ledger/balances
```

### 9.2 Real-Time Monitoring During Load Tests
On the server, monitor resource utilization across all dimensions:
1. **Memory & Swap:** `free -h` and `vmstat 1`. Confirm swap is not thrashing (>50 MB/s swap in/out).
2. **Disk I/O Wait:** `iostat -xz 1 10`. Ensure `%util` is below 85% and `await` is below 30 ms.
3. **CPU Usage:** `mpstat -P ALL 1`. Ensure CPU wait (`%iowait`) is not dominating.
4. **PostgreSQL Activity:** Check active connections: `SELECT count(*) FROM pg_stat_activity;`.
5. **Node.js Process RSS:** `ps aux | grep server.js`. Verify process stays under 1000 MB.
