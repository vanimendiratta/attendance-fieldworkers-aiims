# Real-Time Photo + Live Geolocation Attendance System

A tamper-proof, enterprise-grade attendance solution driven exclusively by real-time camera capture, live device geolocation, and backend-authoritative validation with full REDCap EDC synchronization.

---

## Key Features & Guarantees

1. **No Gallery / File Uploads**: Live camera stream via WebRTC `navigator.mediaDevices.getUserMedia` rendered directly to Canvas. Gallery photos, pre-recorded videos, and file selection are strictly blocked.
2. **Real-Time GPS Acquisition**: High-accuracy coordinates queried at the moment of submission. Manual latitude/longitude entry is disabled.
3. **Server-Side Authoritative Timestamps**: Official timestamps are generated in UTC on the server (`check_in_server_timestamp`, `checkout_server_timestamp`). Client timestamps are retained solely for diagnostic telemetry.
4. **GPS Accuracy Validation**: Configurable threshold (e.g. 100 meters). Readings with low GPS accuracy (e.g. 350m) are rejected with clear user guidance.
5. **Server-Side Geofencing**: Spherical Haversine calculation calculates distance to employer's registered worksite with configurable policies (`ALLOW_WITH_FLAG` vs `STRICT_BLOCK`).
6. **Anti-Tampering & Anti-Replay**:
   - Cryptographic SHA-256 photo hashing prevents photo reuse.
   - Idempotency key tracking blocks duplicate submissions and network retries.
   - Authoritative employee ID, organization, department, and designation are resolved server-side.
7. **Working Hours & Break Calculation**:
   - `Gross Working Time = Checkout Server Timestamp - Checkin Server Timestamp`
   - `Net Working Time = Gross - Total Approved Breaks`
   - `Overtime = max(0, Net - Required Shift Hours)`
8. **REDCap 22-Field Integration**:
   - Form-level adherence to the official REDCap Attendance instrument schema.
   - Automatic record sync and photo file imports.
   - Built-in REDCap emulator & inspector for local testing.
   - API token strictly concealed on the backend.
   - Official REDCap Data Dictionary CSV export.
9. **Admin Portal with Visual Timeline**:
   - Metrics: Active Working, On Break, Completed Shifts.
   - Table: Employee, Check-in Time/Photo/Location, Check-out Time/Photo/Location, Net Hours, Status.
   - Step-by-step interactive timeline modal with Leaflet OpenStreetMap rendering check-in/out pins and office geofence circle.
   - Real-time security audit log viewer.
   - Settings management panel for instant threshold updates.

---

## Multi-Employer Credentials (Pre-Configured in Backend)

### Employer 1: Apex Innovations Ltd. (`ORG-001`)
- **Admin Login**:
  - Employer ID: `ORG-001`
  - Admin Username: `apex_admin`
  - Admin Password: `ApexSecure@123`
- **Employee Logins**:
  - `EMP-1001`: Alex Johnson · Password: `Password@1001`
  - `EMP-1002`: Priya Sharma · Password: `Password@1002`

### Employer 2: Cyberdyne Systems Corp (`ORG-002`)
- **Admin Login**:
  - Employer ID: `ORG-002`
  - Admin Username: `cyberdyne_admin`
  - Admin Password: `Cyberdyne@456`
- **Employee Logins**:
  - `EMP-2001`: Marcus Wright · Password: `Password@2001`
  - `EMP-2002`: Sarah Reese · Password: `Password@2002`

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Test Suite
```bash
npm test
```

### 3. Start Application
```bash
npm start
```

### 4. Access Portals
- **Employee Live Portal**: [http://localhost:3000](http://localhost:3000)
  - Features dedicated Login/Logout with ID & Password according to backend details.
  - Quick-fill demo chips allow instant testing.
- **Admin Operations & Visual Timeline**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
  - Features Employer Administrator sign in with strict tenant isolation.


---

## Connecting to Live REDCap (Optional)

Create or update `.env` in the project root:
```env
PORT=3000
REDCAP_API_URL=https://your-redcap-domain.org/api/
REDCAP_API_TOKEN=YOUR_REDCAP_API_TOKEN
```
When configured, the server syncs records and files to the live REDCap project. When unconfigured, it utilizes the built-in REDCap emulator store for local testing and inspection.
