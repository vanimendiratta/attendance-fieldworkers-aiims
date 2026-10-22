# Hotel Stay GPS Verification — Architecture, Security & API Reference

## Overview

The Hotel Stay GPS Verification system allows AIIMS fieldworkers registering outstation accommodation to have their GPS location cryptographically verified against a public map database (OpenStreetMap/Nominatim). A short-lived HMAC-signed token is issued only when verification passes; this token is required to save hotel stay details. Client-side coordinate forgery and parameter substitution attacks are blocked by design.

---

## 1. Feature Components

| Component | File | Purpose |
|-----------|------|---------|
| Verification Engine | `src/services/hotel_verification_service.js` | Core matching, scoring, HMAC token lifecycle |
| API Routes | `src/routes/api.js` | verify-location, hotel-stay save, admin override |
| Frontend UI | `public/app.js` | GPS capture, map init, verification flow |
| Interactive Map | `public/index.html` | Leaflet 1.9.4 with OpenStreetMap tiles |
| Database Schema | `supabase/migrations/004_hotel_gps_verification.sql` | GPS audit columns |
| Test Suite | `test/hotel_gps_verification.test.js` | 15 unit + integration tests |

---

## 2. GPS Verification Flow

Employee fills hotel form → Capture GPS → Display on Leaflet Map →
POST /api/employee/hotel-stay/verify-location → Backend scoring →
  VERIFIED: issue HMAC token
  Other: block with reason
→ POST /api/employee/hotel-stay with verificationToken →
Validate HMAC → INSERT hotel stay with full audit metadata

---

## 3. Verification Thresholds

- MAX_GPS_ACCURACY_METERS: 150  (reject readings coarser than 150m)
- MAX_READING_AGE_MS: 600000    (reject GPS readings older than 10 minutes)
- MAX_DISTANCE_METERS: 350      (hotel must be within 350m of GPS coordinates)
- MIN_NAME_SIMILARITY: 0.40     (Jaccard token similarity threshold)
- TOKEN_TTL_MS: 15 minutes       (verification tokens expire after 15 minutes)

---

## 4. Verification Status Reference

| Status | Meaning | Has Token |
|--------|---------|-----------|
| VERIFIED | GPS within 350m of a known matching place | YES |
| LOCATION_MISMATCH | Name matches but hotel is >350m from GPS | NO |
| NAME_MISMATCH | Nearby place but name similarity too low | NO |
| LOW_ACCURACY | GPS accuracy ≥150m or reading >10 min stale | NO |
| UNVERIFIABLE | No candidates found in map database | NO (manual review allowed) |
| PENDING_REVIEW | Saved, awaiting admin approval | — |
| ADMIN_APPROVED | Manually verified by administrator | — |

---

## 5. Security Controls

- GPS accuracy enforcement: accuracy >= 150m → LOW_ACCURACY rejection
- GPS freshness enforcement: timestamp > 10min old → LOW_ACCURACY rejection
- Anti-forgery token: HMAC-SHA256 signed, 15-min TTL
- Coordinate tampering prevention: token validates lat/lng within 50m
- Employee cross-use prevention: token bound to employee_id
- Name swapping prevention: token includes hotel name with similarity check
- Admin-only override: requireAuthenticatedAdmin middleware (403 for employees)
- Rate limiting: 30 requests/60s on verification endpoint

---

## 6. Running Tests

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/attendance_test" \
  node test/hotel_gps_verification.test.js
```

All 15 tests should pass including: unit tests for normalization, haversine distance, GPS accuracy/freshness thresholds, HMAC signing/tamper detection, matching logic (VERIFIED/LOCATION_MISMATCH/NAME_MISMATCH/UNVERIFIABLE), and integration tests for auth, token validation, DB persistence, manual review, and admin override.
