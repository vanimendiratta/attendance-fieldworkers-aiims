/**
 * Geolocation & Geofencing Service
 * Implements Haversine distance, GPS accuracy validation, geofence compliance, and anomaly checks.
 */

// Earth radius in meters
const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate accurate distance in meters between two coordinates using the Haversine formula
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10; // Round to 1 decimal place
}

/**
 * Validate GPS accuracy against organization threshold
 */
function validateGpsAccuracy(accuracy, maxAllowedAccuracy = 350) {
  const acc = parseFloat(accuracy);
  if (isNaN(acc) || acc < 0) {
    return {
      valid: false,
      error: 'Invalid GPS accuracy reported by device.'
    };
  }

  if (acc > maxAllowedAccuracy) {
    return {
      valid: false,
      accuracy: acc,
      maxAllowed: maxAllowedAccuracy,
      error: `Your location accuracy is too low (${Math.round(acc)}m). Maximum allowed is ${maxAllowedAccuracy}m. Please move to an area with better GPS signal and try again.`
    };
  }

  return {
    valid: true,
    accuracy: acc,
    maxAllowed: maxAllowedAccuracy
  };
}

/**
 * Evaluate geofence rules based on employee coordinates, office settings, and work mode
 */
function evaluateGeofence(empLat, empLng, officeLat, officeLng, radiusMeters = 100, policy = 'ALLOW_WITH_FLAG', workMode = 'OFFICE') {
  const distance = calculateHaversineDistance(empLat, empLng, officeLat, officeLng);

  // Field Work Mode: dynamic multi-location on-site duty
  if (workMode === 'FIELD_WORK') {
    return {
      distance,
      radiusMeters,
      isInside: true,
      status: 'FIELD_WORK_VERIFIED',
      allowed: true,
      reason: `Field work attendance authenticated on-site (${Math.round(distance)}m from registered workplace).`
    };
  }

  // Official Travel / Transit Mode: transit travel duty (e.g. travel to Kashmir, flights, trains, road transit)
  if (workMode === 'TRAVEL') {
    return {
      distance,
      radiusMeters,
      isInside: true,
      status: 'TRAVEL_DUTY_VERIFIED',
      allowed: true,
      reason: `Official travel / transit duty authenticated (${Math.round(distance)}m from registered workplace).`
    };
  }

  const isInside = distance <= radiusMeters;

  let status = 'WITHIN_GEOFENCE';
  let allowed = true;
  let reason = `Within registered geofence perimeter (${distance}m <= ${radiusMeters}m).`;

  if (!isInside) {
    if (policy === 'STRICT_BLOCK') {
      status = 'BLOCKED_OUTSIDE_GEOFENCE';
      allowed = false;
      reason = `Attendance blocked: You are ${Math.round(distance)}m from the office. Maximum allowed radius is ${radiusMeters}m.`;
    } else {
      status = 'OUTSIDE_GEOFENCE_ALLOWED';
      allowed = true;
      reason = `Attendance recorded outside office perimeter (${Math.round(distance)}m away). Flagged for review.`;
    }
  }

  return {
    distance,
    radiusMeters,
    isInside,
    status,
    allowed,
    reason
  };
}

/**
 * Reverse Geocode helper (formats human-readable street/facility name)
 */
async function reverseGeocode(lat, lng) {
  const detailed = await reverseGeocodeDetailed(lat, lng);
  return detailed.address;
}

/**
 * Detailed Reverse Geocode returning structured place metadata,
 * explicitly identifying whether the location is a hotel/lodging, health facility, or field site.
 */
async function reverseGeocodeDetailed(lat, lng) {
  const defaultFallback = {
    address: `Field Coordinates (${Number(lat).toFixed(5)}°, ${Number(lng).toFixed(5)}°)`,
    placeName: '',
    placeType: 'FIELD_SITE',
    isLodging: false,
    isHealthFacility: false,
    rawAddress: {},
    coordinatesUrl: `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}&t=k`
  };

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ApexAttendanceSystem/2.0 (AIIMSFieldWorkVerification)' }
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && data.address) {
        const addr = data.address;

        // Lodging & Hotel detection
        const lodgingName = addr.hotel || addr.guest_house || addr.motel || addr.hostel || addr.resort || addr.lodging || '';
        const healthName = addr.hospital || addr.clinic || addr.health_post || addr.dispensary || '';
        const generalPlaceName = data.name || addr.amenity || addr.building || addr.office || addr.commercial || addr.shop || addr.leisure || '';

        const primaryPlaceName = lodgingName || healthName || generalPlaceName || '';

        const isLodging = Boolean(
          lodgingName ||
          data.class === 'tourism' ||
          data.type === 'hotel' ||
          data.type === 'guest_house' ||
          data.type === 'motel' ||
          data.type === 'hostel' ||
          /(hotel|resort|lodge|inn|guest\s*house|circuit\s*house|homestay|rest\s*house|bhawan|dharamshala|bhavan|residency)/i.test(primaryPlaceName)
        );

        const isHealthFacility = Boolean(
          healthName ||
          data.type === 'hospital' ||
          data.type === 'clinic' ||
          data.type === 'health_post' ||
          /(hospital|clinic|health\s*centre|phc|chc|dispensary|medical|aiims)/i.test(primaryPlaceName)
        );

        let placeType = 'FIELD_SITE';
        if (isLodging) placeType = 'HOTEL';
        else if (isHealthFacility) placeType = 'HEALTH_FACILITY';

        const road = addr.road || addr.street || addr.pedestrian || addr.footway || '';
        const area = addr.suburb || addr.neighbourhood || addr.residential || addr.quarter || addr.village || '';
        const city = addr.city || addr.town || addr.county || addr.state_district || '';
        const state = addr.state || '';
        const postcode = addr.postcode || '';

        const parts = [primaryPlaceName, road, area, city, state, postcode].filter(Boolean);
        const formattedAddress = parts.length > 0 ? parts.join(', ') : (data.display_name || defaultFallback.address);

        return {
          address: formattedAddress,
          placeName: primaryPlaceName,
          placeType,
          isLodging,
          isHealthFacility,
          rawAddress: addr,
          coordinatesUrl: `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}&t=k`
        };
      }
      if (data && data.display_name) {
        return {
          ...defaultFallback,
          address: data.display_name
        };
      }
    }
  } catch (e) {
    // Network timeout or error
  }

  return defaultFallback;
}

/**
 * Check for anomalous location jumps between last known activity and current activity
 */
function checkLocationAnomalies(lastRecord, currentLat, currentLng, currentTime) {
  if (!lastRecord || !lastRecord.checkin_lat || !lastRecord.checkin_server_timestamp) {
    return { isAnomalous: false };
  }

  const prevLat = lastRecord.checkout_lat || lastRecord.checkin_lat;
  const prevLng = lastRecord.checkout_lng || lastRecord.checkin_lng;
  const prevTime = new Date(lastRecord.checkout_server_timestamp || lastRecord.checkin_server_timestamp).getTime();
  const now = new Date(currentTime).getTime();

  const elapsedHours = Math.max(0.001, (now - prevTime) / (1000 * 60 * 60));
  const distanceKm = calculateHaversineDistance(prevLat, prevLng, currentLat, currentLng) / 1000;
  const speedKmh = distanceKm / elapsedHours;

  // If travel speed exceeds 750 km/h (airline speeds) over moderate distances, flag suspicious
  if (distanceKm > 50 && speedKmh > 750) {
    return {
      isAnomalous: true,
      reason: `Impossible location displacement: ${Math.round(distanceKm)}km in ${elapsedHours.toFixed(1)}h (${Math.round(speedKmh)} km/h).`
    };
  }

  return { isAnomalous: false, distanceKm, speedKmh };
}

module.exports = {
  calculateHaversineDistance,
  validateGpsAccuracy,
  evaluateGeofence,
  reverseGeocode,
  reverseGeocodeDetailed,
  checkLocationAnomalies
};

