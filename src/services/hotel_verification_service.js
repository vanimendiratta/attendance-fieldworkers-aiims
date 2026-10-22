/**
 * Hotel Stay GPS Verification & Location Matching Service
 * 
 * Verifies that an employee registering a hotel stay is physically near the actual
 * hotel location, calculates distance against geocoded candidate places, evaluates
 * reported GPS accuracy and location freshness, and cryptographically signs verification
 * tokens to prevent client forgery and replay attacks.
 */

const crypto = require('crypto');
const geoService = require('./geo_service');

// ---------------------------------------------------------------------------
// Configurable Verification Thresholds
// ---------------------------------------------------------------------------
const CONFIG = {
  // Maximum acceptable GPS accuracy reported by the device (in meters)
  MAX_GPS_ACCURACY_METERS: parseInt(process.env.HOTEL_VERIFY_MAX_ACCURACY_M || '150', 10),

  // Maximum acceptable age of GPS reading before submission (in milliseconds, 10 min)
  MAX_READING_AGE_MS: parseInt(process.env.HOTEL_VERIFY_MAX_AGE_SEC || '600', 10) * 1000,

  // Maximum allowed distance from captured GPS to verified hotel place (in meters)
  MAX_DISTANCE_METERS: parseInt(process.env.HOTEL_VERIFY_MAX_DIST_M || '350', 10),

  // Minimum token overlap similarity score for name matching (0.0 to 1.0)
  MIN_NAME_SIMILARITY: parseFloat(process.env.HOTEL_VERIFY_MIN_NAME_SIMILARITY || '0.40'),

  // Verification token validity TTL (15 minutes)
  TOKEN_TTL_MS: 15 * 60 * 1000
};

// Secret for HMAC signing of verification tokens
function getVerificationSecret() {
  return process.env.HOTEL_VERIFY_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET ||
    crypto.createHash('sha256').update('hotel-verify:' + (process.env.DATABASE_URL || 'local-aiims')).digest('hex');
}

// ---------------------------------------------------------------------------
// Text Normalization & Matching Algorithms
// ---------------------------------------------------------------------------

const ABBREVIATIONS = {
  'htl': 'hotel',
  'gh': 'guest house',
  'g.h.': 'guest house',
  'guesthouse': 'guest house',
  'res': 'residency',
  'st': 'street',
  'rd': 'road',
  'blvd': 'boulevard',
  'ave': 'avenue',
  'hosp': 'hospital',
  'apt': 'apartment',
  'plz': 'plaza',
  'pal': 'palace',
  'j&k': 'jammu and kashmir',
  'jk': 'jammu and kashmir'
};

const STOP_WORDS = new Set([
  'the', 'and', 'near', 'opp', 'opposite', 'beside', 'behind', 'at', 'in', 'of', 'by',
  'road', 'street', 'lane', 'sector', 'block', 'phase', 'nagar', 'colony', 'marg'
]);

/**
 * Clean and normalize text for semantic place matching
 */
function normalizePlaceText(text) {
  if (!text || typeof text !== 'string') return '';
  let str = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand abbreviations
  const words = str.split(' ').map(w => ABBREVIATIONS[w] || w);
  return words.join(' ');
}

/**
 * Extract meaningful keyword tokens from hotel name or address
 */
function extractTokens(text) {
  const norm = normalizePlaceText(text);
  return norm.split(' ')
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Calculate Jaccard similarity between two token sets
 */
function calculateTokenSimilarity(textA, textB) {
  const tokensA = new Set(extractTokens(textA));
  const tokensB = new Set(extractTokens(textB));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersection++;
    } else {
      // Partial stem check (e.g. "palace" vs "palaces")
      for (const tb of tokensB) {
        if (t.length >= 4 && tb.length >= 4 && (t.startsWith(tb) || tb.startsWith(t))) {
          intersection += 0.8;
          break;
        }
      }
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Determine if place candidate is a lodging facility
 */
function isLodgingPlace(candidate) {
  if (!candidate) return false;
  const name = (candidate.name || '').toLowerCase();
  const type = (candidate.type || '').toLowerCase();
  const category = (candidate.category || candidate.class || '').toLowerCase();

  if (category === 'tourism' || category === 'accommodation') return true;
  if (['hotel', 'guest_house', 'motel', 'hostel', 'resort', 'bed_and_breakfast', 'chalet', 'inn', 'lodging'].includes(type)) return true;

  return /(hotel|resort|lodge|inn|guest\s*house|circuit\s*house|homestay|rest\s*house|bhawan|dharamshala|bhavan|residency|suites|stay)/i.test(name);
}

// ---------------------------------------------------------------------------
// External Place Lookup & Mock Provider Support (for testability and offline resilience)
// ---------------------------------------------------------------------------

let customPlaceLookupHandler = null;

/**
 * Override place lookup handler for unit/integration tests
 */
function setPlaceLookupProvider(handler) {
  customPlaceLookupHandler = handler;
}

function resetPlaceLookupProvider() {
  customPlaceLookupHandler = null;
}

/**
 * Query candidates using Nominatim OpenStreetMap or registered provider
 */
async function searchCandidatePlaces(hotelName, hotelAddress, lat, lng) {
  if (typeof customPlaceLookupHandler === 'function') {
    // Check if provider handler accepts (lat, lng, ...) or (hotelName, hotelAddress, ...)
    if (typeof lat === 'number' && customPlaceLookupHandler.length <= 3) {
      return await customPlaceLookupHandler(lat, lng, `${hotelName} ${hotelAddress}`);
    }
    return await customPlaceLookupHandler(hotelName, hotelAddress, lat, lng);
  }

  const candidates = [];

  // Query 1: Name + Address geocoding search
  try {
    const q = `${hotelName}, ${hotelAddress}`.trim();
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ApexAttendanceSystem/2.0 (AIIMSFieldWorkVerification)' }
    });
    clearTimeout(to);

    if (res.ok) {
      const results = await res.json();
      if (Array.isArray(results)) {
        for (const r of results) {
          candidates.push({
            place_id: String(r.place_id || r.osm_id || ''),
            name: r.name || (r.address && (r.address.hotel || r.address.guest_house || r.address.building)) || r.display_name.split(',')[0],
            address: r.display_name,
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            type: r.type,
            class: r.class,
            raw: r
          });
        }
      }
    }
  } catch (_) {}

  // Query 2: Reverse / Nearby lodging search around captured GPS coordinates
  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    try {
      const rev = await geoService.reverseGeocodeDetailed(lat, lng);
      if (rev && rev.placeName) {
        candidates.push({
          place_id: `rev-${lat.toFixed(4)}-${lng.toFixed(4)}`,
          name: rev.placeName,
          address: rev.address,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          type: rev.placeType,
          class: rev.isLodging ? 'tourism' : 'amenity'
        });
      }
    } catch (_) {}
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Cryptographic Verification Tokens (HMAC Signed)
// ---------------------------------------------------------------------------

function signVerificationToken(payload) {
  const secret = getVerificationSecret();
  const tokenData = {
    ...payload,
    exp: payload.exp || (Date.now() + CONFIG.TOKEN_TTL_MS)
  };
  const encoded = Buffer.from(JSON.stringify(tokenData)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  return `${encoded}.${mac}`;
}

function verifyVerificationToken(token, expectedEmployeeIdOrOpts, expectedData = {}) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'Missing verification token' };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, error: 'Malformed verification token' };

  let expectedEmployeeId = expectedEmployeeIdOrOpts;
  let opts = expectedData;
  if (expectedEmployeeIdOrOpts && typeof expectedEmployeeIdOrOpts === 'object') {
    expectedEmployeeId = expectedEmployeeIdOrOpts.employeeId || expectedEmployeeIdOrOpts.employee_id;
    opts = expectedEmployeeIdOrOpts;
  }

  const [encoded, mac] = parts;
  const secret = getVerificationSecret();
  const expectedMac = crypto.createHmac('sha256', secret).update(encoded).digest('hex');

  const bufA = Buffer.from(mac, 'hex');
  const bufB = Buffer.from(expectedMac, 'hex');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return { valid: false, error: 'Invalid verification token signature' };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (err) {
    return { valid: false, error: 'Corrupt token payload' };
  }

  if (!data.exp || data.exp < Date.now()) {
    return { valid: false, error: 'Verification has expired. Please re-verify hotel location.' };
  }

  const tokenEmpId = data.employee_id || data.employeeId;
  if (expectedEmployeeId && tokenEmpId !== expectedEmployeeId) {
    return { valid: false, error: 'Verification token belongs to a different employee.' };
  }

  // Cross-check that the data being saved matches the verified data
  const checkHotelName = opts.hotel_name || opts.hotelName;
  if (checkHotelName) {
    const verifiedName = data.hotel_name || data.hotelName;
    const sim = calculateTokenSimilarity(checkHotelName, verifiedName);
    if (sim < 0.6 && normalizePlaceText(checkHotelName) !== normalizePlaceText(verifiedName)) {
      return { valid: false, error: 'Hotel name does not match the verified location.' };
    }
  }

  const checkLat = opts.hotel_lat != null ? opts.hotel_lat : (opts.latitude != null ? opts.latitude : opts.hotelLatitude);
  const checkLng = opts.hotel_lng != null ? opts.hotel_lng : (opts.longitude != null ? opts.longitude : opts.hotelLongitude);
  const dataLat = data.lat != null ? data.lat : data.latitude;
  const dataLng = data.lng != null ? data.lng : data.longitude;

  if (checkLat != null && checkLng != null && dataLat != null && dataLng != null) {
    const dist = geoService.calculateHaversineDistance(
      Number(checkLat), Number(checkLng),
      Number(dataLat), Number(dataLng)
    );
    if (dist > 50) {
      return { valid: false, error: 'Coordinates do not match the verified GPS location.' };
    }
  }

  return { valid: true, data };
}

// ---------------------------------------------------------------------------
// Core Verification Workflow
// ---------------------------------------------------------------------------

/**
 * Verify hotel stay registration against GPS and place database
 */
async function verifyHotelLocation(params = {}) {
  const employee_id   = params.employee_id || params.employeeId;
  const hotel_name    = params.hotel_name || params.hotelName;
  const hotel_address = params.hotel_address || params.hotelAddress;
  const latitude      = params.latitude !== undefined ? params.latitude : params.hotelLatitude;
  const longitude     = params.longitude !== undefined ? params.longitude : params.hotelLongitude;
  const accuracy      = params.accuracy !== undefined ? params.accuracy : params.hotelAccuracy;
  const timestamp     = params.timestamp !== undefined ? params.timestamp : params.captureTimestamp;

  const now = Date.now();

  // 1. Basic field checks
  if (!employee_id) {
    return {
      status: 'UNVERIFIABLE',
      verified: false,
      reason: 'Employee session is required for hotel location verification.'
    };
  }

  if (!hotel_name || !hotel_name.trim()) {
    return {
      status: 'NAME_MISMATCH',
      verified: false,
      reason: 'Hotel or guest house name is required.'
    };
  }

  if (!hotel_address || !hotel_address.trim()) {
    return {
      status: 'UNVERIFIABLE',
      verified: false,
      reason: 'Full hotel address and landmark are required.'
    };
  }

  // 2. Validate coordinates
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      status: 'LOCATION_MISMATCH',
      verified: false,
      reason: 'Invalid or missing GPS coordinates.'
    };
  }

  // 3. Location Freshness check
  const captureTime = timestamp ? new Date(timestamp).getTime() : now;
  if (isNaN(captureTime)) {
    return {
      status: 'UNVERIFIABLE',
      verified: false,
      reason: 'Invalid GPS capture timestamp.'
    };
  }
  const ageMs = now - captureTime;
  if (ageMs > CONFIG.MAX_READING_AGE_MS) {
    return {
      status: 'LOW_ACCURACY',
      verified: false,
      reason: `Location reading is stale (${Math.round(ageMs / 1000 / 60)} minutes old). Please capture a fresh GPS reading.`
    };
  }
  if (captureTime > now + 60000) {
    return {
      status: 'UNVERIFIABLE',
      verified: false,
      reason: 'GPS capture timestamp cannot be in the future.'
    };
  }

  // 4. GPS Accuracy Check
  const acc = parseFloat(accuracy);
  if (isNaN(acc) || acc < 0) {
    return {
      status: 'LOW_ACCURACY',
      verified: false,
      reason: 'Invalid GPS accuracy reported by device.'
    };
  }

  if (acc > CONFIG.MAX_GPS_ACCURACY_METERS) {
    return {
      status: 'LOW_ACCURACY',
      verified: false,
      accuracy: acc,
      max_allowed_accuracy: CONFIG.MAX_GPS_ACCURACY_METERS,
      reason: `GPS accuracy is too low (±${Math.round(acc)}m). Maximum allowed is ${CONFIG.MAX_GPS_ACCURACY_METERS}m. Please step near a window or outdoors and retry.`
    };
  }

  // 5. Look up candidate places in geocoding / map database
  const candidates = await searchCandidatePlaces(hotel_name, hotel_address, lat, lng);

  if (!candidates || candidates.length === 0) {
    return {
      status: 'UNVERIFIABLE',
      verified: false,
      reason: 'Hotel or lodging was not found in the geographical place database. You may request manual administrative verification.',
      allow_manual_review: true,
      canRequestManualReview: true,
      gps: { latitude: lat, longitude: lng, accuracy: acc, timestamp: captureTime }
    };
  }

  // 6. Score and rank candidates
  const scoredCandidates = [];
  for (const cand of candidates) {
    const cLat = cand.lat != null ? Number(cand.lat) : Number(cand.latitude);
    const cLng = cand.lng != null ? Number(cand.lng) : Number(cand.longitude);
    const cName = cand.name || cand.placeName || '';
    const cAddr = cand.address || cand.displayName || '';
    const cPlaceId = cand.place_id || cand.placeId || '';

    const dist = geoService.calculateHaversineDistance(lat, lng, cLat, cLng);
    const nameSim = calculateTokenSimilarity(hotel_name, cName);
    const addrSim = calculateTokenSimilarity(hotel_address, cAddr);
    const isLodging = isLodgingPlace(cand);

    // Combined confidence score
    let score = nameSim * 0.5 + addrSim * 0.3;
    if (isLodging) score += 0.2;
    if (dist <= CONFIG.MAX_DISTANCE_METERS) score += 0.2;

    scoredCandidates.push({
      ...cand,
      name: cName,
      address: cAddr,
      lat: cLat,
      lng: cLng,
      place_id: cPlaceId,
      distance_meters: Math.round(dist * 10) / 10,
      name_similarity: Math.round(nameSim * 100) / 100,
      address_similarity: Math.round(addrSim * 100) / 100,
      is_lodging: isLodging,
      match_score: Math.round(score * 100) / 100
    });
  }

  // Sort by highest match score and shortest distance
  scoredCandidates.sort((a, b) => b.match_score - a.match_score || a.distance_meters - b.distance_meters);

  const best = scoredCandidates[0];

  // 7. Evaluate Ambiguity
  const highMatches = scoredCandidates.filter(c => c.match_score >= 0.70 && Math.abs(c.match_score - best.match_score) < 0.05);
  if (highMatches.length > 1 && Math.abs(highMatches[0].distance_meters - highMatches[1].distance_meters) > 200) {
    return {
      status: 'AMBIGUOUS',
      verified: false,
      reason: 'Multiple hotels with matching names exist in the area. Please specify the landmark or branch in the hotel address.',
      candidates: scoredCandidates.slice(0, 3),
      gps: { latitude: lat, longitude: lng, accuracy: acc, timestamp: captureTime }
    };
  }

  // 8. Evaluate Name Match
  if (best.name_similarity < CONFIG.MIN_NAME_SIMILARITY) {
    // Check if the place coordinates match another business
    if (best.distance_meters <= CONFIG.MAX_DISTANCE_METERS) {
      return {
        status: 'NAME_MISMATCH',
        verified: false,
        reason: `GPS coordinates correspond to "${best.name}", which does not match entered hotel "${hotel_name}".`,
        matched_place: {
          name: best.name,
          address: best.address,
          lat: best.lat,
          lng: best.lng,
          distance_meters: best.distance_meters
        },
        gps: { latitude: lat, longitude: lng, accuracy: acc, timestamp: captureTime }
      };
    }
  }

  // 9. Evaluate Distance
  if (best.distance_meters > CONFIG.MAX_DISTANCE_METERS) {
    return {
      status: 'LOCATION_MISMATCH',
      verified: false,
      distance_meters: best.distance_meters,
      max_allowed_distance: CONFIG.MAX_DISTANCE_METERS,
      reason: `Captured GPS position is ${Math.round(best.distance_meters)}m away from "${best.name}". Maximum allowed distance is ${CONFIG.MAX_DISTANCE_METERS}m.`,
      matched_place: {
        name: best.name,
        address: best.address,
        lat: best.lat,
        lng: best.lng,
        distance_meters: best.distance_meters
      },
      gps: { latitude: lat, longitude: lng, accuracy: acc, timestamp: captureTime }
    };
  }

  // 10. Check if minimum evidence threshold was met
  if (best.name_similarity < CONFIG.MIN_NAME_SIMILARITY && best.address_similarity < 0.3) {
    return {
      status: 'UNVERIFIABLE',
      verified: false,
      reason: 'Location does not have sufficient matching confidence in the place registry. Manual review may be requested.',
      allow_manual_review: true,
      gps: { latitude: lat, longitude: lng, accuracy: acc, timestamp: captureTime }
    };
  }

  // 11. SUCCESSFUL VERIFICATION (VERIFIED)
  const tokenPayload = {
    employee_id,
    hotel_name: hotel_name.trim(),
    hotel_address: hotel_address.trim(),
    lat,
    lng,
    accuracy: acc,
    status: 'VERIFIED',
    distance_meters: best.distance_meters,
    verified_place_name: best.name,
    verified_address: best.address,
    place_id: best.place_id,
    timestamp: captureTime,
    exp: now + CONFIG.TOKEN_TTL_MS
  };

  const verificationToken = signVerificationToken(tokenPayload);

  return {
    status: 'VERIFIED',
    verified: true,
    reason: `Hotel location verified successfully (${best.distance_meters}m from "${best.name}").`,
    distance_meters: best.distance_meters,
    distanceMeters: best.distance_meters,
    max_allowed_distance: CONFIG.MAX_DISTANCE_METERS,
    matched_place: {
      name: best.name,
      address: best.address,
      lat: best.lat,
      lng: best.lng,
      distance_meters: best.distance_meters,
      place_id: best.place_id
    },
    gps: {
      latitude: lat,
      longitude: lng,
      accuracy: acc,
      timestamp: captureTime
    },
    verification_token: verificationToken,
    verificationToken: verificationToken,
    verification_timestamp: new Date(now).toISOString()
  };
}

module.exports = {
  CONFIG,
  normalizePlaceText,
  calculateTokenSimilarity,
  calculateHaversineDistance: geoService.calculateHaversineDistance,
  searchCandidatePlaces,
  setPlaceLookupProvider,
  resetPlaceLookupProvider,
  verifyHotelLocation,
  signVerificationToken,
  verifyVerificationToken
};
