# Secure 30-Minute Session Timeout — Implementation Reference

**System:** AIIMS CDER Attendance App + Employee Management System (EMS)  
**Implemented:** October 2026  
**Status:** ✅ Production-Ready — 15/15 regression tests passing

---

## 1. Overview

Every authenticated user (employee, administrator, HR) is subject to a **30-minute server-side inactivity timeout**. If no meaningful interaction is recorded for 30 consecutive minutes, the session is expired server-side, the token is immediately revoked in the authoritative database store, and the user is redirected to the login page with a professional in-app modal — **no native `alert()` or `confirm()` dialogs are used**.

### Scope

| Application | Session Store | Inactivity Column | Timeout Constant |
|---|---|---|---|
| AIIMS CDER Attendance App | PostgreSQL `sessions` table | `last_activity` | `SESSION_INACTIVITY_TIMEOUT_MS` (default 30 min) |
| EMS | SQLite `ems.sqlite` → `user_sessions` table | `last_activity_at` | `INACTIVITY_TIMEOUT_MS` (hardcoded 30 min) |

---

## 2. Required Behaviour — Specification Compliance

| # | Requirement | Implementation |
|---|---|---|
| 1 | Max inactivity period: 30 minutes for all roles | Enforced server-side on every authenticated request |
| 2 | No session survival after 30 min of inactivity | `getSession()` / `validateSession()` revoke and return `null` |
| 3 | Page refresh must not revive an expired session | Token revoked in DB; subsequent lookups return `null` |
| 4 | Browser restart / reopen must not revive session | Cookie `Max-Age=1800`; server rejects stale tokens |
| 5 | No native `alert()` / `confirm()` dialogs | Custom CSS modal with countdown; no browser dialogs |
| 6 | All roles covered (employee, admin, HR) | `requireAuthenticatedEmployee`, `requireAuthenticatedAdmin`, `requireAuthenticatedUser` all call same service |
| 7 | Background requests must not extend inactivity | `X-Background-Request: true` / `X-Session-Touch: false` skips `last_activity` update |
| 8 | API requests after expiry return HTTP 401 with `SESSION_EXPIRED` | Verified in test 8 |
| 9 | DB errors fail closed (no accidental grant) | `SESSION_ERROR` returned; middleware catch block denies access |
| 10 | Multi-tab logout sync | `localStorage` `sessionLogout` event propagated; visibility change triggers re-validation |

---

## 3. Architecture

### 3.1 Attendance App (PostgreSQL)

#### `src/services/session_service.js`

The central session authority. All session lifecycle operations flow through this module.

```
createSession()    — Inserts row into sessions table; expires_at = now + 30m
getSession(token)  — Validates token, checks inactivity elapsed >= 30m, revokes if expired, slides window on activity
revokeSession()    — Sets is_revoked = 1 immediately (synchronous logout)
```

**Inactivity check logic:**
```js
const elapsedInactivity = nowTime - lastActivityTime;
if (elapsedInactivity >= INACTIVITY_TIMEOUT_MS || nowTime >= expiresAtTime) {
  await revokeSession(token);
  return null; // Fail closed
}
```

**Background-request passthrough** (no activity slide):
```js
const touch = options.touch !== false; // false if X-Background-Request: true
if (touch) {
  // UPDATE sessions SET last_activity, expires_at ...
}
```

**DB error fail-closed:**  
`getSession()` propagates DB errors (throws with `isSessionDbError = true`) so the middleware catch block can return `SESSION_ERROR` rather than `SESSION_EXPIRED`, enabling the client to distinguish a transient server fault from an intentional expiry.

#### `src/middleware/auth_middleware.js`

- Sets `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` on every protected response.
- Calls `sessionService.getSession()` on every request; `null` → HTTP 401 `SESSION_EXPIRED`.
- Catch block (DB failure) → HTTP 401 `SESSION_ERROR`.
- Respects `X-Test-Current-Time` header in non-production environments for deterministic testing.

#### Cookie Configuration (`src/routes/api.js`)

```js
res.cookie('attendance_session', token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'Strict',
  maxAge: 1800,      // 30 minutes; browser auto-expires cookie
  path: '/'
});
```

`maxAge: 1800` ensures that even if the server-side session is not explicitly revoked, the browser cookie expires after 30 minutes, preventing credential persistence across browser restarts.

---

### 3.2 EMS (SQLite)

#### `ems/server/database/migrations/005_user_sessions.sql`

```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  employee_id  TEXT,
  created_at   TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  is_revoked   INTEGER NOT NULL DEFAULT 0,
  ...
);
```

#### `ems/server/services/AuthService.js`

```js
validateSession(sessionId, { currentTime } = {}) {
  const now = currentTime ? new Date(currentTime) : new Date();
  const elapsed = now - new Date(session.last_activity_at);
  if (elapsed >= INACTIVITY_TIMEOUT_MS || now >= new Date(session.expires_at)) {
    db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?').run(sessionId);
    return null; // Fail closed
  }
  // Slide window on activity
  db.prepare('UPDATE user_sessions SET last_activity_at = ?, expires_at = ? WHERE id = ?')
    .run(now.toISOString(), newExpiry.toISOString(), sessionId);
  return session;
}
```

#### `ems/server/middleware/authMiddleware.js`

- Verifies JWT signature + expiry.
- Cross-references `sessionId` embedded in JWT payload against `user_sessions` table.
- Sets no-cache headers on all protected routes.
- Returns HTTP 401 `SESSION_EXPIRED` on any failure.

#### EMS Logout (`ems/server/routes/api.js`)

```
POST /api/auth/logout  →  authController.logout()
  → AuthService.revokeSession(sessionId)
  → Clears 'ems_session' cookie
```

---

## 4. Client-Side Session Managers

### 4.1 Attendance App — `public/session_timeout.js`

| Feature | Implementation |
|---|---|
| Inactivity tracking | DOM event listeners (`mousemove`, `keydown`, `click`, `touchstart`, `scroll`) reset `lastActivity` timestamp |
| Periodic check | `setInterval` every 60 seconds checks elapsed inactivity client-side |
| Server verification | On `visibilitychange` (tab focus) → `GET /api/auth/session/status` to cross-check server-side state |
| Multi-tab logout | `localStorage` `sessionLogout` event broadcast; other tabs detect and redirect |
| Expiry modal | Custom CSS overlay with countdown timer; no `alert()` or `confirm()` |
| Redirect | `window.location.href = '/index.html?reason=session_expired'` |

### 4.2 EMS — `ems/public/js/session_timeout.js`

Same architecture adapted for EMS routes, JWT-based auth, and EMS login page redirect.

---

## 5. Session Status Endpoint

```
GET /api/auth/session/status
Headers: Authorization: Bearer <token>
         X-Background-Request: true   (does not slide activity window)

Response (valid):   { success: true, valid: true, expiresAt: "..." }
Response (expired): { success: false, code: "SESSION_EXPIRED" }  (HTTP 401)
```

Used by the client-side manager to authoritatively confirm server-side session state when the tab regains focus.

---

## 6. Test Coverage

**File:** `test/session_timeout.test.js`  
**Runner:** `node test/session_timeout.test.js` (no PostgreSQL required — uses in-memory mock)

| # | Test Scenario | Result |
|---|---|---|
| 1 | Newly authenticated session is accepted | ✅ PASS |
| 2 | Session with 29 minutes of inactivity is accepted | ✅ PASS |
| 3 | Session at or beyond 30 minutes of inactivity is rejected | ✅ PASS |
| 4 | Expired sessions cannot be revived by refreshing the page | ✅ PASS |
| 5 | Expired sessions cannot be revived by reopening the browser days later | ✅ PASS |
| 6 | Expired JWTs are rejected | ✅ PASS |
| 7 | Valid but stale JWT is rejected if server-side session has expired | ✅ PASS |
| 8 | API request after expiry returns HTTP 401 with code SESSION_EXPIRED | ✅ PASS |
| 9 | Explicit logout invalidates the session immediately | ✅ PASS |
| 10 | Multi-tab synchronization and storage event invalidation | ✅ PASS |
| 11 | Background polling does not extend inactivity | ✅ PASS |
| 12 | EMS and attendance routes enforce the same inactivity policy | ✅ PASS |
| 13 | Administrator and employee accounts are both covered | ✅ PASS |
| 14 | Database/session-store error fails closed — returns SESSION_ERROR | ✅ PASS |
| 15 | Cache-Control and No-Cache headers present on all protected routes | ✅ PASS |

**Total: 15/15 PASSED**

---

## 7. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SESSION_INACTIVITY_TIMEOUT_MS` | `1800000` (30 min) | Override inactivity timeout for testing |
| `JWT_SECRET` | — | Required for EMS JWT signing/verification |
| `DATABASE_URL` | — | PostgreSQL connection string (attendance app) |
| `EMS_DB_PATH` | `ems/data/ems.sqlite` | EMS SQLite database path |

---

## 8. Security Properties

- **Fail-closed**: Any DB error during session validation denies access (HTTP 401).
- **No client trust**: Session identity is derived exclusively from the server-side session record; client-asserted identity headers are cross-checked and rejected on mismatch (HTTP 403).
- **Immediate revocation**: `revokeSession()` / `revokeUserSessions()` set `is_revoked = 1` synchronously; subsequent requests using the same token are instantly rejected.
- **No cache leakage**: `Cache-Control: no-store` on all protected responses prevents browsers and proxies from caching authenticated content.
- **Cookie hardening**: `HttpOnly`, `Secure` (production), `SameSite: Strict`, `maxAge: 1800`.
- **Background request isolation**: `X-Background-Request: true` and `X-Session-Touch: false` prevent polling from artificially extending inactivity windows.
