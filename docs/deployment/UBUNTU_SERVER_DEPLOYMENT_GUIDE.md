# Ubuntu Server 26.04 LTS Production Deployment Guide
## AIIMS CDER Real-Time Attendance + EMS System

**Document Version:** 2.0.0 | **Target Server:** Ubuntu 26.04 LTS | **Private IP:** `192.168.14.224`

---

## 1. Actual Server Specifications & Capacity Assessment

### 1.1 Server Baseline Specifications
- **Operating System:** Ubuntu Server 26.04 LTS
- **Compute:** 4 CPU Cores
- **Memory:** 4 GB RAM
- **Storage:** 100 GB Rotational HDD (Hard Disk Drive)
- **Network Interface:** Private Intranet IP `192.168.14.224` (Subnet `192.168.14.0/24`, RFC 1918)

### 1.2 Capacity & Resource Sizing Assessment

#### Memory (4 GB RAM)
- **Resource Breakdown:**
  - Linux Kernel & Core OS Services: ~600–800 MB
  - Node.js Express Application (Attendance + EMS): ~250–400 MB RSS (peaks up to ~600 MB during bulk CSV exports / biometric descriptor hash validations)
  - PostgreSQL Database: ~350–500 MB (with `shared_buffers = 256MB`, `work_mem = 4MB`, `max_connections = 50`)
  - SQLite EMS (in-memory page cache & WAL buffer): ~32–64 MB
  - Nginx Reverse Proxy: ~30–50 MB
  - Available for Linux filesystem page cache: ~1.8–2.2 GB
- **Suitability & Verdict:** 4 GB RAM is sufficient for up to 300–500 active fieldworkers under normal operational rhythms. However, during morning check-in bursts (08:30–09:30 AM), concurrent photo decodes can trigger memory spikes.
- **Mandatory Mitigation:** A **4 GB swapfile** (`/swapfile`) with `vm.swappiness = 10` is required to prevent the Linux Out-of-Memory (OOM) killer from terminating Node.js or PostgreSQL. Additionally, `--max-old-space-size=1536` is configured in the systemd unit.

#### Storage (100 GB Rotational HDD)
- **Rotational HDD Implications:**
  - Unlike NVMe/SATA SSDs, rotational HDDs have high seek latency (10–15 ms) and limited random IOPS (75–120 IOPS).
  - High concurrency disk writes (photo uploads + PostgreSQL WAL writes + SQLite WAL writes) will compete for rotational disk heads.
- **100 GB Disk Space Budget:**
  - Base OS, Kernel & System Packages: ~10 GB
  - Swap Space: 4 GB
  - PostgreSQL Database (Attendance): ~5–10 GB
  - SQLite Database (EMS): ~1–2 GB
  - Uploaded Check-in Photos & Proofs: ~60 MB/day for 200 fieldworkers ≈ 1.8 GB/month ≈ 22 GB/year.
  - Backups (14-day rolling retention): ~10–15 GB.
  - System Logs (systemd journald + Nginx): capped at 2 GB.
  - Headroom / Free Space: ~35–45 GB (safe operational margin).
- **Mandatory HDD Optimizations:**
  - SQLite: `synchronous = NORMAL`, `journal_mode = WAL` (configured in code).
  - Backup script: Includes pre-flight free disk check (aborts if free space < 5 GB).
  - Photo retention: Archive check-in photos older than 180 days to external storage.

#### Network Architecture (`192.168.14.224`)
- **Intranet Environment:** `192.168.14.224` is a non-routable private IP on the AIIMS internal network.
- **Access Requirements:** Clients must connect via the AIIMS hospital LAN, internal Wi-Fi, or an authorized institutional VPN (e.g., AIIMS FortiClient / GlobalProtect).
- **HTTPS & Certificates:** Public ACME certificate providers (such as Let's Encrypt HTTP-01 challenge) cannot issue certificates for private RFC 1918 IP addresses. Options for HTTPS:
  - *Option A (Recommended for LAN):* Institutional SSL certificate issued by AIIMS IT for internal domain (e.g. `attendance.cder.aiims.internal`).
  - *Option B (Local IP HTTPS):* OpenSSL self-signed certificate with IP Subject Alternative Name (`subjectAltName = IP:192.168.14.224`).
  - *Option C (Standard Intranet HTTP):* Nginx listening on HTTP port 80 restricted to the hospital subnet behind the institutional firewall.

---

## 2. Server Preparation & OS Hardening (Ubuntu 26.04 LTS)

Execute all commands on the server using an account with `sudo` privileges.

### 2.1 System Packages Update
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw \
                    ca-certificates gnupg lsb-release sqlite3 libsqlite3-dev
```

### 2.2 Configure 4 GB Swap Space (Essential for 4 GB RAM)
```bash
# Check if swap exists
sudo swapon --show

# Create 4 GB swapfile if not present
sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Set low swappiness to favor physical RAM
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.d/99-swappiness.conf
```

### 2.3 Configure Host Firewall (UFW)
Restrict access to the hospital intranet and authorized ports:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH

# Allow HTTP from hospital subnet (192.168.0.0/16) or all internal clients
sudo ufw allow from 192.168.0.0/16 to any port 80 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 443 proto tcp

sudo ufw enable
sudo ufw status verbose
```

---

## 3. Runtime Installation

### 3.1 Install Node.js 20 LTS
On Ubuntu 26.04 LTS, Node.js 20.x LTS is installed via the official NodeSource repository:

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

NODE_MAJOR=20
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt update
sudo apt install -y nodejs

# Verify versions
node -v   # v20.x
npm -v    # 10.x+
```

### 3.2 Install and Configure PostgreSQL
Ubuntu 26.04 LTS packages PostgreSQL 16/17:

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

# Tune PostgreSQL for 4 GB RAM & Rotational HDD
sudo tee -a /etc/postgresql/*/main/conf.d/tuning.conf <<EOF
# Memory tuning for 4 GB RAM
shared_buffers = 256MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 1GB
max_connections = 50

# Rotational HDD I/O smoothing
checkpoint_completion_target = 0.9
wal_buffers = 16MB
random_page_cost = 4.0
effective_io_concurrency = 2
EOF

sudo systemctl restart postgresql
```

### 3.3 Create Production Database & User
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

## 4. Application Deployment & Setup

### 4.1 Clone Repository
```bash
sudo mkdir -p /var/www/attendance
sudo chown -R $USER:$USER /var/www/attendance

git clone https://github.com/vanimendiratta/attendance-fieldworkers-aiims.git /var/www/attendance
cd /var/www/attendance
git checkout main
```

### 4.2 Install Production Dependencies
The `better-sqlite3` native dependency will automatically compile using `build-essential`:

```bash
cd /var/www/attendance
npm ci --omit=dev
```

### 4.3 Configure Directories & Permissions
```bash
sudo mkdir -p /var/www/attendance/uploads/checkins
sudo mkdir -p /var/www/attendance/uploads/checkouts
sudo mkdir -p /var/www/attendance/uploads/leave_documents
sudo mkdir -p /var/www/attendance/ems/data

sudo chown -R www-data:www-data /var/www/attendance
sudo chmod -R 750 /var/www/attendance
sudo chmod -R 770 /var/www/attendance/uploads
sudo chmod -R 770 /var/www/attendance/ems/data
```

---

## 5. Production Environment Configuration

Create the protected environment file:
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

# PostgreSQL Connection String
DATABASE_URL=postgresql://attendance_user:STRONG_PG_PASSWORD_HERE@127.0.0.1:5432/attendance_prod
DB_POOL_MAX=8

# Cryptographic Secrets (Generate using: openssl rand -hex 32)
JWT_SECRET=GENERATED_64_HEX_CHAR_SECRET_FOR_EMS_JWT
SESSION_SECRET=GENERATED_64_HEX_CHAR_SECRET_FOR_SESSION
HOTEL_VERIFY_SECRET=GENERATED_64_HEX_CHAR_SECRET_FOR_HOTEL

# EMS SQLite Configuration
EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
EMS_REQUIRE_EXISTING_DB=false

# Upload Storage Directory
UPLOADS_PATH=/var/www/attendance/uploads

# CORS Whitelist (Private IP & Internal Hostnames)
ALLOWED_ORIGINS=http://192.168.14.224,https://192.168.14.224,http://192.168.14.224:3000,http://attendance.cder.aiims.internal

# SMTP Service (AIIMS CDER Internal Mail Relay)
SMTP_HOST=smtp.aiims.edu
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=cder-attendance@aiims.edu
SMTP_PASS=INSTITUTIONAL_SMTP_PASSWORD
BACKUP_EMAIL_RECIPIENT=attendance-reports@aiims.edu
```

---

## 6. Database Initialization

```bash
cd /var/www/attendance
npm run build

# Run EMS SQLite migrations and seed master policies
sudo -u www-data env $(sudo cat /etc/attendance/attendance.env | grep -v '^#' | xargs) node -e "
const { runMigrations } = require('./ems/server/database/migrate');
const { seedMasterPolicies } = require('./ems/server/database/seed');
runMigrations();
seedMasterPolicies();
console.log('✓ EMS SQLite migrations and policies seeded.');
"
```

---

## 7. Systemd Service Activation

```bash
sudo cp /var/www/attendance/deployment/attendance.service /etc/systemd/system/attendance.service
sudo systemctl daemon-reload
sudo systemctl enable attendance.service
sudo systemctl start attendance.service

# Verify
sudo systemctl status attendance.service --no-pager
```

---

## 8. Nginx Reverse Proxy Configuration

```bash
sudo apt install -y nginx

sudo cp /var/www/attendance/deployment/nginx-attendance.conf /etc/nginx/sites-available/attendance.conf
sudo ln -sf /etc/nginx/sites-available/attendance.conf /etc/nginx/sites-enabled/attendance.conf
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
```

### Optional: Generate Self-Signed Certificate for IP HTTPS (192.168.14.224)
If encryption is required on the internal IP before institutional CA certificates are provisioned:

```bash
sudo openssl req -x509 -nodes -days 730 -newkey rsa:2048 \
  -keyout /etc/ssl/private/attendance-selfsigned.key \
  -out /etc/ssl/certs/attendance-selfsigned.crt \
  -subj "/CN=192.168.14.224" \
  -addext "subjectAltName = IP:192.168.14.224,DNS:attendance.cder.aiims.internal"
```
Then uncomment the HTTPS block in `/etc/nginx/sites-available/attendance.conf` and reload Nginx.

---

## 9. Automated Backups & Maintenance

```bash
sudo cp /var/www/attendance/deployment/backup.sh /usr/local/bin/attendance-backup.sh
sudo chmod +x /usr/local/bin/attendance-backup.sh
sudo chown root:root /usr/local/bin/attendance-backup.sh

# Run test backup
sudo /usr/local/bin/attendance-backup.sh

# Schedule daily 02:00 AM backup cron
echo "0 2 * * * root /usr/local/bin/attendance-backup.sh >> /var/log/attendance-backup.log 2>&1" | sudo tee /etc/cron.d/attendance-backup
sudo chmod 644 /etc/cron.d/attendance-backup
```

---

## 10. Operational Verification

Run the local health check on the server:
```bash
/var/www/attendance/deployment/healthcheck.sh http://127.0.0.1:3000
```

Verify over the intranet from an authorized workstation on `192.168.14.0/24`:
```bash
curl -I http://192.168.14.224/api/health
```

Expected Output:
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
```
