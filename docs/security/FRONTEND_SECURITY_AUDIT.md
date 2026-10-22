# Phase 2: Complete Frontend Security Audit

## 1. Frontend Route & Screen Inventory

The frontend is served as static single-page web applications from the `public/` directory with client-side state machines and modal controllers:

| Screen / View ID | Path / Hash | Access Level | Description | Client Guard | Server Enforcement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Employee Sign In** | `/index.html` (modal) | Public | Employee ID/Email + Password credentials login | Modal prompt | Rate-limited POST `/api/auth/employee/login` |
| **Employee Sign Up** | `/index.html` (modal) | Public | New employee onboarding with district/state selection | Input validation | POST `/api/auth/employee/signup` with password complexity policy |
| **Employee Face Login** | `/index.html` (view) | Public (Enrolled) | Camera-based face feature vector verification | View toggle | POST `/api/auth/employee/face-login` |
| **Employee Dashboard** | `/index.html` | Authenticated Employee | Daily check-in/out, GPS HUD, hotel stay registration | Redirect to login if `!sessionToken` | All attendance operations require `requireAuthenticatedEmployee` |
| **Admin Login** | `/admin.html` (modal) | Public | Employer Administrator credentials entry | Modal prompt | Rate-limited POST `/api/auth/employer/login` |
| **Admin Dashboard** | `/admin.html#dashboard` | Admin Only | Live headcount, status feed, attendance statistics | `initAuth()` checks localStorage | GET `/api/admin/attendance` requires `requireAuthenticatedAdmin` |
| **Multi-State Matrix**| `/admin.html#matrix` | Admin Only | Territorial cross-state field distribution matrix | View switcher | GET `/api/admin/attendance/matrix` (Admin token) |
| **Team Management** | `/admin.html#teams` | Admin Only | Create teams, assign employees to state/districts | View switcher | GET/POST `/api/teams` (Admin token) |
| **Employee Directory**| `/admin.html#employees` | Admin Only | Roster management, edit profile, deactivation | View switcher | GET/PUT/DELETE `/api/employees` (Admin token) |
| **Timesheets** | `/admin.html#timesheets` | Admin Only | Monthly/weekly employee hours and comp-off days | View switcher | GET `/api/admin/employees/:id/timesheet` |
| **Leaves & Holidays** | `/admin.html#leave` | Admin Only | Absenteeism synchronization, holiday roster | View switcher | GET/POST `/api/admin/leaves`, `/api/admin/holidays` |
| **Audit Logs** | `/admin.html#audit` | Admin Only | Forensic chronological security & action log | View switcher | GET `/api/admin/audit-logs` (Admin token) |
| **Settings** | `/admin.html#settings` | Admin Only | Office coordinates, geofence radius, shift target | View switcher | GET/POST `/api/admin/settings` (Admin token) |

---

## 2. Client-Side Storage & Sensitive Data Assessment

### 2.1 LocalStorage Inspection
- **Key `apex_employee_session`:** Stores `{ token, employee: { id, name, department, designation, email, state, district }, employer: { id, name, office_name } }`.
  - **Security Check:** Verified that `password`, `pin`, `face_descriptor`, and raw face images are **never stored** in client storage.
- **Key `apex_employer_admin_session`:** Stores `{ token, employer_id, admin_username, employer: { id, name, office_name } }`.
  - **Security Check:** Verified that `admin_password` hash is **never stored** in client storage.

### 2.2 Cookie Configuration
- Session tokens are set by the server via `Set-Cookie: attendance_session=<token>`:
  - `HttpOnly`: Enforced across all login responses.
  - `SameSite=Lax`: Prevents CSRF on state-changing cross-origin requests.
  - `Secure`: Dynamically set in production environments.
  - `Path=/`: Restricts scope to application domain.

---

## 3. DOM-Based XSS & Dynamic Content Sanitization

### 3.1 Vulnerability Discovery: Missing `escapeHtml` in `public/app.js`
- **Finding ID:** `VULN-FE-01`
- **Severity:** High
- **Description:** Multiple UI rendering functions in `public/app.js` (including hotel stay rendering at lines 1741-1769 and checkout badge rendering at line 2126) invoked `escapeHtml(...)`. However, `escapeHtml` was not defined in `public/app.js` or in any script included by `index.html`.
- **Impact:**
  1. **Runtime Crash:** Completing check-out or viewing hotel stays threw `ReferenceError: escapeHtml is not defined`, preventing the user from seeing the completion badge.
  2. **Injection Exposure:** Other dynamic HTML template strings (`DOM.hudAddressBadge`, `statusText`, `displayEmployeeTerritory`) inserted dynamic server or user strings without HTML escaping.
- **Remediation Implemented:**
  - Defined centralized `escapeHtml(str)` in `public/app.js`:
    ```javascript
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    ```
  - Sanitized all dynamic properties inserted into `innerHTML`:
    - `DOM.hudAddressBadge.innerHTML` -> `escapeHtml(data.address)`
    - `statusText.innerHTML` -> `escapeHtml(data.employee.name)`
    - `DOM.displayEmployeeTeam.innerHTML` -> `escapeHtml(teamTitle)`
    - `DOM.displayEmployeeTerritory.innerHTML` -> `escapeHtml(terrParts.join(', '))`
    - `DOM.tlBadgeCheckin.innerHTML` -> `escapeHtml(checkin_address)`
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 6 passed).

---

## 4. Session Expiry & Route Guard Invalidation

### 4.1 Admin Portal Interceptor (`adminFetch`)
In `public/admin.js`, all server requests pass through `adminFetch`:
```javascript
async function adminFetch(url, options = {}) {
  const headers = Object.assign({}, getAuthHeaders(), options.headers || {});
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('apex_employer_admin_session');
    currentEmployerSession = null;
    showAdminLoginModal('Session expired. Please sign in with your administrator credentials.');
    throw new Error('401 Unauthorized');
  }
  return res;
}
```
- Expired or revoked session tokens trigger immediate cache clearance and present the credential modal.
- Closing or bypassing the modal fails to load any dashboard data because backend endpoints independently return HTTP 401.

### 4.2 Logout Invalidation
Clicking logout in both portals dispatches `POST /api/auth/logout`, revokes the token in the PostgreSQL database, wipes `localStorage`, clears the session cookie (`Max-Age=0`), and resets UI state to an unauthenticated view.
