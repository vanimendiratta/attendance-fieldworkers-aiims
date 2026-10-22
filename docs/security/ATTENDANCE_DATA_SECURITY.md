# Phase 4: Attendance Data Integrity & Biometric Security

## 1. Attendance Workflow & State Machine Enforcement

The attendance lifecycle is governed strictly on the server by an authoritative PostgreSQL-backed state machine. Client-side state is treated as purely advisory.

```
       [Start of Day: NOT_CHECKED_IN]
                     │
                     ▼ (POST /attendance/check-in with Fresh Photo + GPS)
             [CHECKED_IN]
             /          \
  (POST break/start)    (POST /attendance/check-out with Fresh Photo + GPS)
           /              \
     [ON_BREAK]            \
          │                 \
  (POST break/end)           \
          │                   \
          v                    v
     [CHECKED_IN] ──────> [COMPLETED (Single Daily Punch Limit Reached)]
                               │
                               ▼ (Subsequent check-in attempts BLOCKED with 400)
```

### 1.1 Single Punch Per Day Enforcement
- Every check-in checks whether an attendance session already exists for `(employee_id, date)`.
- If an attendance record for today has status `COMPLETED`, further check-in attempts on the same calendar day are blocked with:
  `"Daily single punch limit reached. You have already completed your attendance session for today."`
- Verified in `test/single_punch_limit.test.js` (7/7 tests passed).

### 1.2 Authoritative Timestamps
- Client-supplied timestamps (`client_timestamp`) are recorded strictly for drift analysis.
- All core business logic, shift calculations, break durations, and timestamps (`checkin_server_timestamp`, `checkout_server_timestamp`) use the authoritative PostgreSQL server clock (`NOW()` / `new Date().toISOString()`).

---

## 2. Photographic Verification & Anti-Replay Security

### 2.1 Photographic Ingestion Pipeline
In `src/services/photo_service.js`:
1. **Magic Byte Signature Inspection:** Validates actual binary headers (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`). Malicious files disguised with image extensions are rejected immediately.
2. **Size Bounds Checking:** Enforces `50 bytes <= fileSize <= 8 MB`. Truncated payloads and oversized payloads are blocked before disk or cloud storage.
3. **Cryptographic SHA-256 Hashing:** Every uploaded photo has its SHA-256 hash calculated:
   - When an employee checks in or checks out, the SHA-256 digest is compared against previous attendance photos.
   - Reusing a previously captured photo triggers an immediate anti-replay rejection.
   - Verified in `test/api.test.js` (*Anti-replay mechanism blocked reused check-in photograph*).

---

## 3. Biometric Security & Liveness (PAD) Assessment

### 3.1 Architecture Classification
The application's facial recognition subsystem (`src/services/biometric_service.js`) computes a 128-dimensional feature vector based on spatial luminance distributions and localized edge-gradient histograms. Vector comparison is evaluated using Cosine Similarity against enrolled employee descriptors in PostgreSQL.

### 3.2 Formal Security Classification & Limitations
In accordance with rigorous security evaluation (`test/biometric_security_evaluation.test.js`):

| Evaluation Category | Test Condition | Result | Score | Finding |
| :--- | :--- | :--- | :--- | :--- |
| **Genuine Acceptance** | Normal, low light, angle shifts, eyewear | 10/10 Accepted | 96.9% - 100% | FRR: 0.0% |
| **Impostor Rejection** | 5 distinct human faces | 1/5 Blocked | 62.3% - 91.5% | FAR: 80.0% |
| **Presentation Attack** | Printed paper, mobile OLED screen replay, video | 6/6 Spoofs Accepted | 100.0% | **No Liveness Protection** |

> [!WARNING]
> **CRITICAL SECURITY DISCLOSURE:**
> The 2D vision algorithm lacks 3D structured light, infrared depth sensors, and active challenge-response liveness detection (e.g. random blink or head turn). Consequently, 2D photograph replays achieve > 85% similarity.
> **Operational Control:** Facial recognition is classified strictly as a secondary convenience heuristic. All primary employee authentication is enforced via Employee ID/Email and strong salted passwords.

### 3.3 Privacy & Data Protection (DPDP Act Compliance)
1. **No Raw Frame Retention:** Raw camera video feeds are processed in-memory in the browser canvas and immediately garbage-collected. Raw video is never transmitted or persisted.
2. **Biometric Descriptors Stripped from API Responses:** `face_descriptor` is explicitly excluded from employee directory lists, login responses, and attendance detail queries.
3. **Right to Erasure (De-enrollment):** When an employee record is deleted (`DELETE /api/employees/:id`), all associated biometric descriptors and uploaded photos are permanently deleted.

---

## 4. Geolocation Verification & Velocity Anomalies

### 4.1 GPS Accuracy Enforcers
- Mobile devices must report a GPS accuracy circle within the organization's policy threshold (`max_gps_accuracy_m`, typically 350m–500m).
- Inaccurate cell-tower or coarse network coordinates (> 500m) are rejected with:
  `"Your location accuracy is too low (Xm). Maximum allowed is 350m. Please move to an area with better GPS signal and try again."`

### 4.2 Velocity Anomaly / Teleportation Detection
In `src/services/geo_service.js`, `checkLocationAnomalies`:
- Calculates the Haversine distance and elapsed time between the employee's last recorded event and current submission.
- If the calculated displacement speed exceeds 750 km/h (airline cruising speed) over distances > 50 km, an anomaly flag (`ANOMALOUS_SPEED`) is logged in the audit trail for administrative review.

---

## 5. Multi-Tenant Database Isolation

1. Every attendance query, update, and deletion is constrained by `WHERE employer_id = $1`.
2. Cross-tenant tampering via headers (`x-employer-id`) or request parameters is rejected by `requireAuthenticatedAdmin`:
   ```javascript
   if (requestedEmployerId && String(requestedEmployerId).trim() !== employer.id) {
     return res.status(403).json({
       success: false,
       error: `Tenant isolation violation: Authenticated admin belongs to '${employer.id}' and cannot access or modify '${requestedEmployerId}'.`
     });
   }
   ```
3. Verified in `test/security_remediation.test.js` (Tests 4 and 5 passed).
