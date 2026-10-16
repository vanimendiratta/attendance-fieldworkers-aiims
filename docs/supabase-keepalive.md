# Supabase Database Automated Keep-Alive

This document outlines the architecture, setup, security design, and operational procedures for the automated keep-alive mechanism designed to prevent Supabase free-tier PostgreSQL databases from automatically pausing due to inactivity.

---

## 1. Overview & Problem Context

Supabase free-tier projects automatically pause after **7 consecutive days** of database and API inactivity. Once paused:
- Incoming HTTP requests from the web client, mobile apps, or serverless backends fail with connection refused or database offline errors.
- Unpausing requires an administrator to manually log into the Supabase Dashboard and click "Restore project", which can take several minutes and cause unplanned downtime.

To avoid this, this repository implements a secure, lightweight, and automated keep-alive mechanism that executes every **3 days** (well within the 7-day cutoff).

```mermaid
flowchart LR
    A[GitHub Actions Scheduler<br/>Every 3 Days @ 04:15 UTC] -->|Trigger| B[supabase-keepalive.js Runner]
    B -->|Option 1: Direct / Pooled SQL| C[(Supabase PostgreSQL<br/>Port 6543 / 5432)]
    B -.->|Option 2: PostgREST API| D[Supabase REST Endpoint<br/>/rest/v1/]
    C -->|SELECT NOW() UTC| B
    B -->|Safe Masked Logs| E[GitHub Actions Summary]
```

---

## 2. Architecture & Design Decisions

### Why GitHub Actions Was Selected

We evaluated three potential scheduling platforms:

| Scheduler Option | Evaluation | Decision |
| :--- | :--- | :--- |
| **GitHub Actions** (Selected) | Hosted directly in the repository; zero additional infrastructure cost; supports cron schedules and on-demand `workflow_dispatch`; securely stores credentials via GitHub Encrypted Secrets; provides full audit logs and step summaries. | **Primary Choice** |
| **Vercel Cron** | Currently used for daily backups (`/api/cron/daily-attendance-backup`). However, Vercel free-tier limits cron invocations to once per day, and serverless cold-start timeouts or deployment freezes can interrupt keep-alive reliability. | Secondary / Not Preferred |
| **Supabase `pg_cron`** | `pg_cron` runs *inside* the database engine. If the database pauses, the internal cron also pauses. Therefore, an internal cron cannot wake a paused database or act as an independent external watchdog. | Ineffective for external keep-alive |

### The Database Operation (Zero Mutation, Lightweight)

The keep-alive script avoids unnecessary writes, audit logs, or data bloating. It executes a single read-only query:

```sql
SELECT 
  NOW() AT TIME ZONE 'UTC' AS server_time_utc,
  current_database()        AS db_name,
  version()                 AS pg_version,
  1                         AS keep_alive_status;
```

**Key Properties:**
- **Zero writes:** No inserts, updates, or table modifications.
- **Ultra-low latency:** Typically completes in under 40 milliseconds.
- **Engine-level activity:** Reaches PostgreSQL engine through either the Supabase Transaction Pooler (port 6543) or direct session connection (port 5432), registering active database interaction with Supabase platform telemetry.
- **REST Fallback:** If `DATABASE_URL` is omitted but `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided, the script automatically queries the Supabase PostgREST endpoint (`/rest/v1/`), providing full operational flexibility.

---

## 3. Security Hardening

- **Zero Credential Exposure:** All connection strings and tokens are processed through `sanitizeUrl()` and `sanitizeError()`. Passwords and Bearer tokens are redacted (`:***@`) before anything is printed to stdout/stderr.
- **Minimal Permissions:** The GitHub Actions workflow requests strictly minimal read-only permissions:
  ```yaml
  permissions:
    contents: read
  ```
- **Job Timeout:** Configured with `timeout-minutes: 10` to avoid hung runners or billing exhaustion.
- **Concurrency Control:** Configured with `concurrency: group: supabase-keepalive, cancel-in-progress: false` to prevent overlapping runs.
- **No Service-Role Key Needed for SQL:** When connecting via PostgreSQL (`DATABASE_URL`), the standard PostgreSQL credentials are used. When connecting via REST, only the public `SUPABASE_ANON_KEY` is required. The privileged `SUPABASE_SERVICE_ROLE_KEY` is never required for keep-alive.

---

## 4. Required Secrets & Configuration

To enable automated runs in GitHub Actions, configure the following secrets in your repository:

### How to Add Secrets to GitHub:

1. In your GitHub repository, navigate to **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret**.
3. Add the following:

| Secret Name | Required? | Description / Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Recommended** | Supabase connection URI (Transaction Pooler):<br/>`postgresql://postgres:[PASSWORD]@[REF].pooler.supabase.com:6543/postgres` |
| `SUPABASE_URL` | Optional Fallback | Supabase project URL:<br/>`https://[REF].supabase.co` |
| `SUPABASE_ANON_KEY` | Optional Fallback | Supabase public anon key (used if `DATABASE_URL` is not provided) |

> [!NOTE]
> You only need to configure `DATABASE_URL` for direct database connectivity. If you prefer not to store database connection strings in GitHub, you can configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` instead.

---

## 5. Execution Schedule & Manual Triggers

### Automated Schedule

The workflow is scheduled via POSIX cron:
```yaml
schedule:
  - cron: '15 4 */3 * *'
```
- **Frequency:** Every 3 days at 04:15 UTC.
- **Why 04:15 UTC:** Off-peak window that avoids the high-traffic scheduling spikes at 00:00 UTC on GitHub Actions infrastructure.

### How to Trigger a Manual Run

You can trigger a keep-alive run at any time without waiting for the 3-day schedule:

#### Option A: Via GitHub Web Interface
1. Go to the **Actions** tab in your GitHub repository.
2. Under "Workflows" on the left, select **Supabase Database Keep-Alive**.
3. Click the **Run workflow** dropdown on the right.
4. Select the branch (e.g., `main`).
5. (Optional) Check **Dry run** to test configuration without pinging the database, or check **Enable verbose logging**.
6. Click **Run workflow**.

#### Option B: Via GitHub CLI (`gh`)
```bash
# Standard execution
gh workflow run supabase-keepalive.yml

# Dry-run execution
gh workflow run supabase-keepalive.yml -f dry_run=true -f verbose=true
```

#### Option C: Local Terminal
```bash
# Load your local .env and run
npm run keepalive

# Dry run (checks config without making network requests)
npm run keepalive -- --dry-run

# Run automated tests
npm run test:keepalive
```

---

## 6. Verifying Connectivity & Viewing Logs

1. Navigate to **Actions** > **Supabase Database Keep-Alive**.
2. Click on the latest workflow run.
3. Review the **Supabase Keep-Alive Execution Summary**:
   - Status: `success`
   - Trigger Event: `schedule` or `workflow_dispatch`
   - Latency in milliseconds.
4. In the detailed log for step **Execute Keep-Alive Script**, verify output matches:
   ```text
   ===============================================================
   SUPABASE DATABASE AUTOMATED KEEP-ALIVE
   ===============================================================
   Timestamp: 2026-10-14T08:46:50.272Z
   ---------------------------------------------------------------
   Status:       SUCCESS (Database Active)
   Mode:         POSTGRES
   Target Host:  aws-0-ap-south-1.pooler.supabase.com
   Database:     postgres
   Server Time:  2026-10-14T08:46:50.000Z
   Latency:      38 ms
   ---------------------------------------------------------------
   Supabase keep-alive operation completed successfully.
   ```

---

## 7. Troubleshooting & Common Failures

### 1. `Missing database configuration`
- **Cause:** Neither `DATABASE_URL` nor `SUPABASE_URL` + `SUPABASE_ANON_KEY` is configured in GitHub repository secrets.
- **Solution:** Follow the steps in Section 4 to add `DATABASE_URL` to GitHub Secrets.

### 2. `ETIMEDOUT` or `Connection terminated unexpectedly`
- **Cause:** Network firewall, DNS issue, or database instance is unreachable.
- **Solution:**
  - Verify if your Supabase project is already paused in the Supabase Dashboard. If paused, click **Restore project** once manually.
  - If using port 5432 (direct session), switch your `DATABASE_URL` to port 6543 (Transaction Pooler: `*.pooler.supabase.com:6543`), which is more resilient to IPv4/IPv6 and serverless network restrictions.

### 3. `password authentication failed for user "postgres"`
- **Cause:** The database password was rotated or contains special characters that were not properly URL-encoded.
- **Solution:** In `DATABASE_URL`, ensure characters like `@`, `#`, or `/` in the password are percent-encoded (e.g. `@` becomes `%40`).

---

## 8. Operational Limitations & Best-Effort Disclaimer

> [!IMPORTANT]
> Keep-alive automation is a **best-effort operational measure**. Keep in mind the following platform rules:

1. **GitHub Actions Schedule Jitter:** Scheduled workflows in GitHub Actions are queued alongside other global jobs. A scheduled job may run a few minutes or hours later than specified during periods of high GitHub load. The 3-day frequency ensures that even a 24-hour delay remains well within the 7-day limit.
2. **GitHub 60-Day Inactivity Rule:** GitHub automatically disables scheduled workflows in public repositories if no commits or code changes occur within **60 consecutive days**. If this repository remains inactive for 60 days, GitHub will send an email notification warning that the workflow was paused. Visiting the repository's Actions tab and clicking "Enable workflow" re-activates it.
3. **Supabase Inactivity Policy Updates:** Supabase reserves the right to modify free-tier pause conditions (e.g. requiring dashboard logins or project upgrades). Monitor notifications from Supabase regarding project status.
4. **Credential Rotation:** Rotating your Supabase database password invalidates the existing `DATABASE_URL` secret. Always update the secret in GitHub Actions when modifying database credentials.
