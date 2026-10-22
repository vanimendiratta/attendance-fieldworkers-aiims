-# Secure Signup, Login and Employee ID

## Summary of behaviour

| Area | Rule |
|------|------|
| DOB | Required, `YYYY-MM-DD`, real calendar date (leap years handled), not in the future, year >= 1900. No minimum-age rule. Stored as PostgreSQL `DATE`, returned as an exact string. |
| Email | Trimmed, format-checked, must contain `cder` (case-insensitive substring, **not** a domain rule). Stored lower-cased. Error when missing: `Please enter an email address containing 'cder'.` |
| Mobile | Required. Indian 10-digit number starting 6-9. `+91`, `91`, leading `0`, spaces, dashes, brackets are stripped. Stored as the 10 digits. |
| Employee ID | Server-generated `FW-XXXXXX` (6 chars from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, `crypto.randomBytes`). Up to 50 collision retries, then fails safely. Any client-supplied `employee_id` is ignored. Never regenerated. |
| Login | Unchanged: Employee ID, email or mobile + password. Login now normalises mobile input the same way as signup. |

## Duplicate prevention
* App-level pre-checks give friendly 409 messages (no other employee data is revealed).
* DB-level enforcement closes races: unique index on `LOWER(TRIM(email))`, partial unique index on `phone` (non-empty), primary key on `id`. A `23505` violation is mapped to a 409.

## Schema changes (additive only)
`supabase/migrations/003_secure_signup_fields.sql` (also mirrored in `ensureSchema()`):
* `employees.dob DATE` (NULL for legacy rows; nothing is fabricated)
* `employees.updated_at TEXT` (the existing profile-update route already wrote to this column, which was missing)
* `idx_employees_email_lower`, `idx_employees_phone_unique`

## Legacy data
A pre-check on the local test database found 0 duplicate emails, phones or IDs (20 rows). **Before applying 003 to production, run these read-only queries; the index creation will fail if duplicates exist, and nothing is auto-merged or deleted:**
```sql
SELECT LOWER(TRIM(email)), COUNT(*) FROM employees GROUP BY 1 HAVING COUNT(*) > 1;
SELECT phone, COUNT(*) FROM employees WHERE phone IS NOT NULL AND phone <> '' GROUP BY 1 HAVING COUNT(*) > 1;
```
Legacy phones stored with formatting (e.g. `+91 98310 99887`) are not normalised by the migration; two legacy rows that are the same number in different formats will not be caught by the index and need manual review. Legacy IDs (`EMP-1001`, etc.) keep working.

## Frontend
`public/index.html` / `public/app.js`: manual Employee ID field and live availability check removed from signup; DOB (max = today), cder-email and mobile fields added with client-side validation mirroring the backend; a success dialog shows the generated ID with a "save this ID" instruction; the ID appears in the greeting header and Profile view (profile shows DOB only to the employee themself).

## Tests
`test/secure_signup_login.test.js` (32 checks, registered in `scripts/test_all.js`) covers DOB, cder email, mobile, ID generation/stability, duplicate prevention (incl. concurrent same-phone requests), login by ID/email/phone, 401/403 enforcement and check-in. Existing suites were updated only to send the now-required fields.

## Known limitations / not done
* Email ownership is **not verified**; `cder` in an address does not prove it is official or owned by the registrant. A separate verification-mail flow is recommended (no mail verification exists today).
* Collision retry and the uniqueness check are done outside a single transaction; correctness relies on the DB constraints. A failed insert creates no partial row (single INSERT).
* Employee-ID collision after the unique check is reported as a retryable 409 rather than auto-retried.
* No concurrency test exists for ID collisions specifically (probabilistic: ~33^6 space); the bounded-retry exhaustion path is not unit-tested.
* Admin employee views still return the same fields as before; DOB is returned to the employee in login/signup responses.
* Verified only against a local PostgreSQL test DB; not run against Supabase/production.
* Passing tests do not prove the absence of vulnerabilities.
