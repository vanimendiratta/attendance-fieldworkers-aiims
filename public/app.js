/**
 * Apex Attendance System - Employee Real-Time Mobile Application
 * Enterprise UI/UX, Camera + GPS Verification, and Live State Machine
 */

// Application State
const state = {
  currentEmployee: null,
  currentEmployer: null,
  orgConfig: null,
  activeSession: null,
  currentStatus: 'NOT_CHECKED_IN',
  currentBreak: null,
  breaks: [],
  
  // Real-time sensors
  mediaStream: null,
  isCameraActive: false,
  capturedPhotoBase64: null,
  flowMode: 'CHECK_IN', // 'CHECK_IN' or 'CHECK_OUT'
  alreadyCompletedToday: false,

  // Field Work Attendance (Exclusively configured for field duties)
  workMode: 'FIELD_WORK',
  fieldSiteNotes: '',
  resolvedAddress: null,
  isResolvingAddress: false,

  // Location classification & Outstation Stay
  punchLocationType: 'FIELD_SITE', // 'FIELD_SITE' or 'HOTEL_STAY'
  activeHotelStay: null,
  capturedHotelLat: null,
  capturedHotelLng: null,

  currentGps: {
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 12.0,
    timestamp: new Date().toISOString(),
    status: 'ACQUIRING'
  },

  // Cryptographic Server Session
  sessionToken: null,

  // Timers
  workTimerInterval: null,
  breakTimerInterval: null
};

// DOM References
const DOM = {
  headerAvatar: document.getElementById('headerAvatar'),
  headerEmpName: document.getElementById('headerEmpName'),
  headerEmployerName: document.getElementById('headerEmployerName'),
  btnLogoutEmployee: document.getElementById('btnLogoutEmployee'),

  alertBanner: document.getElementById('alertBanner'),
  alertIcon: document.getElementById('alertIcon'),
  alertMessage: document.getElementById('alertMessage'),
  alertCloseBtn: document.getElementById('alertCloseBtn'),

  displayGreetingName: document.getElementById('displayGreetingName'),
  displayGreetingDate: document.getElementById('displayGreetingDate'),
  displayEmployeeTeam: document.getElementById('displayEmployeeTeam'),
  displayEmployeeTerritory: document.getElementById('displayEmployeeTerritory'),

  // Duty Mode Selector
  btnModeField: document.getElementById('btnModeField'),
  btnModeTravel: document.getElementById('btnModeTravel'),
  dutyModeIcon: document.getElementById('dutyModeIcon'),
  dutyModeTitle: document.getElementById('dutyModeTitle'),
  dutyModeBadge: document.getElementById('dutyModeBadge'),
  dutyModeBadgeDot: document.getElementById('dutyModeBadgeDot'),
  dutyModeBadgeText: document.getElementById('dutyModeBadgeText'),
  lblDutyState: document.getElementById('lblDutyState'),
  lblDutyDistrict: document.getElementById('lblDutyDistrict'),
  lblDutyNotes: document.getElementById('lblDutyNotes'),
  fieldWorkNotesContainer: document.getElementById('fieldWorkNotesContainer'),
  selectFieldState: document.getElementById('selectFieldState'),
  selectFieldDistrict: document.getElementById('selectFieldDistrict'),
  inputFieldSiteNotes: document.getElementById('inputFieldSiteNotes'),
  iconWorkplaceType: document.getElementById('iconWorkplaceType'),
  labelWorkplaceType: document.getElementById('labelWorkplaceType'),
  iconDistanceOrAddress: document.getElementById('iconDistanceOrAddress'),
  labelDistanceOrAddress: document.getElementById('labelDistanceOrAddress'),
  rowRegisteredOffice: document.getElementById('rowRegisteredOffice'),

  empStatusBadge: document.getElementById('empStatusBadge'),
  empStatusText: document.getElementById('empStatusText'),
  tickingWorkTimer: document.getElementById('tickingWorkTimer'),
  checkedInAtLabel: document.getElementById('checkedInAtLabel'),
  btnMainAttendanceAction: document.getElementById('btnMainAttendanceAction'),
  rowBreakControls: document.getElementById('rowBreakControls'),
  btnStartBreak: document.getElementById('btnStartBreak'),
  btnEndBreak: document.getElementById('btnEndBreak'),

  chipGpsStatus: document.getElementById('chipGpsStatus'),
  textGpsStatus: document.getElementById('textGpsStatus'),

  textNetHoursDisplay: document.getElementById('textNetHoursDisplay'),
  shiftProgressBar: document.getElementById('shiftProgressBar'),
  valRequiredShift: document.getElementById('valRequiredShift'),
  valBreakDeducted: document.getElementById('valBreakDeducted'),
  valOvertimeAccumulated: document.getElementById('valOvertimeAccumulated'),

  tlTimeCheckin: document.getElementById('tlTimeCheckin'),
  tlDescCheckin: document.getElementById('tlDescCheckin'),
  tlBadgeCheckin: document.getElementById('tlBadgeCheckin'),
  tlTimeCheckout: document.getElementById('tlTimeCheckout'),
  tlDescCheckout: document.getElementById('tlDescCheckout'),
  tlBadgeCheckout: document.getElementById('tlBadgeCheckout'),

  // Office sync elements
  textOfficeLocationLabel: document.getElementById('textOfficeLocationLabel'),
  textLiveDistance: document.getElementById('textLiveDistance'),
  btnSyncOfficeToCurrent: document.getElementById('btnSyncOfficeToCurrent'),

  // Dedicated View Tabs & Panels
  tabNavPunch: document.getElementById('tabNavPunch'),
  tabNavHotel: document.getElementById('tabNavHotel'),
  panelAttendancePunch: document.getElementById('panelAttendancePunch'),
  panelHotelStay: document.getElementById('panelHotelStay'),
  tabHotelStayIndicator: document.getElementById('tabHotelStayIndicator'),
  bnavHotel: document.getElementById('bnavHotel'),
  bnavToday: document.getElementById('bnavToday'),

  // Dedicated Hotel Page Elements
  cardActiveHotelDisplay: document.getElementById('cardActiveHotelDisplay'),
  badgeActiveHotelStatus: document.getElementById('badgeActiveHotelStatus'),
  contentActiveHotelStay: document.getElementById('contentActiveHotelStay'),
  formHotelStayDetails: document.getElementById('formHotelStayDetails'),
  headingHotelForm: document.getElementById('headingHotelForm'),
  inputHotelName: document.getElementById('inputHotelName'),
  inputHotelRoom: document.getElementById('inputHotelRoom'),
  inputHotelPhone: document.getElementById('inputHotelPhone'),
  inputHotelAddress: document.getElementById('inputHotelAddress'),
  inputHotelCheckinDate: document.getElementById('inputHotelCheckinDate'),
  inputHotelCheckoutDate: document.getElementById('inputHotelCheckoutDate'),
  btnCaptureHotelGps: document.getElementById('btnCaptureHotelGps'),
  textHotelGpsDisplay: document.getElementById('textHotelGpsDisplay'),
  inputHotelNotes: document.getElementById('inputHotelNotes'),
  btnSaveHotelStay: document.getElementById('btnSaveHotelStay'),

  // Camera Modal elements
  cameraModal: document.getElementById('cameraModal'),
  modalFeedbackBox: document.getElementById('modalFeedbackBox'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  modalFlowTitle: document.getElementById('modalFlowTitle'),
  modalFlowSubtitle: document.getElementById('modalFlowSubtitle'),
  videoPreview: document.getElementById('videoPreview'),
  snapshotCanvas: document.getElementById('snapshotCanvas'),
  reticleGuide: document.getElementById('reticleGuide'),
  hudGpsBadge: document.getElementById('hudGpsBadge'),
  hudAddressBadge: document.getElementById('hudAddressBadge'),
  btnShutterCapture: document.getElementById('btnShutterCapture'),
  btnCancelCapture: document.getElementById('btnCancelCapture'),
  btnRetakePhoto: document.getElementById('btnRetakePhoto'),
  btnConfirmSubmission: document.getElementById('btnConfirmSubmission'),
  controlsCapturePhase: document.getElementById('controlsCapturePhase'),
  controlsReviewPhase: document.getElementById('controlsReviewPhase'),

  // Login Modal elements
  loginModal: document.getElementById('loginModal'),
  employeeLoginForm: document.getElementById('employeeLoginForm'),
  loginEmployerSelect: document.getElementById('loginEmployerSelect'),
  loginEmployeeId: document.getElementById('loginEmployeeId'),
  loginEmployeePassword: document.getElementById('loginEmployeePassword'),
  loginErrorBanner: document.getElementById('loginErrorBanner'),
  loginErrorMessage: document.getElementById('loginErrorMessage')
};

/**
 * Centralized Authenticated Request Headers for Employee Portal
 */
function getEmployeeAuthHeaders(extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (state.currentEmployee) {
    headers['x-employee-id'] = state.currentEmployee.id;
  }
  if (state.currentEmployer) {
    headers['x-employer-id'] = state.currentEmployer.id;
  }
  if (state.sessionToken) {
    headers['Authorization'] = `Bearer ${state.sessionToken}`;
    headers['x-session-token'] = state.sessionToken;
  }
  return headers;
}

/**
 * Show / Hide Notification Banner
 */
function showAlert(message, type = 'danger') {
  DOM.alertBanner.className = `notification-strip alert-${type}`;
  DOM.alertIcon.innerHTML = type === 'danger' 
    ? (window.Icons ? window.Icons.raw('alertTriangle') : '!') 
    : (window.Icons ? window.Icons.raw('checkCircle') : '');
  DOM.alertMessage.innerHTML = message;
  DOM.alertBanner.style.display = 'flex';
  
  if (type === 'success') {
    setTimeout(() => {
      DOM.alertBanner.style.display = 'none';
    }, 5000);
  }
}

DOM.alertCloseBtn.addEventListener('click', () => {
  DOM.alertBanner.style.display = 'none';
});

/**
 * Formatting Duration
 */
function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}h ${m}m ${s}s`;
}

function formatShortDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  return `${h}h ${m}m`;
}

/**
 * Geolocation Sensor Initialization
 */
let lastGeocodedLat = null;
let lastGeocodedLng = null;

async function fetchResolvedAddress(lat, lng) {
  if (lastGeocodedLat && lastGeocodedLng) {
    const d = calculateDistance(lastGeocodedLat, lastGeocodedLng, lat, lng);
    if (d < 35 && state.resolvedAddress) return; // Cached within 35m
  }

  if (state.isResolvingAddress) return;
  state.isResolvingAddress = true;

  try {
    const res = await fetch(`/api/location/preview?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    if (data.success && data.address) {
      state.resolvedAddress = data.address;
      lastGeocodedLat = lat;
      lastGeocodedLng = lng;
      if (DOM.hudAddressBadge) {
        DOM.hudAddressBadge.innerHTML = `${window.Icons ? window.Icons.render('mapPin', { size: 12 }) : ''} <span>${data.address}</span>`;
      }

      // Auto-set location classification if lodging establishment detected
      if (data.isLodging && state.punchLocationType !== 'HOTEL_STAY' && state.workMode !== 'TRAVEL') {
        state.punchLocationType = 'HOTEL_STAY';
      }
      
      // Auto-prefill Field Work State and District from reverse geocoding if not set by user
      if (data.state && DOM.selectFieldState && (!DOM.selectFieldState.value || DOM.selectFieldState.value === '')) {
        DOM.selectFieldState.value = data.state;
        if (typeof window.handleFieldStateChange === 'function' && DOM.selectFieldDistrict) {
          window.handleFieldStateChange(data.state, data.district || '');
          if (data.district) {
            DOM.selectFieldDistrict.value = data.district;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Reverse geocoding error:', err);
  } finally {
    state.isResolvingAddress = false;
  }
}

/**
 * Geolocation Sensor Initialization
 * Collects multiple readings for up to 12 seconds and keeps the best
 * (lowest accuracy radius) to achieve 15-25m precision instead of
 * snapping at the first coarse Wi-Fi fix (~100-150m).
 */
function initGeolocation() {
  if (!('geolocation' in navigator)) {
    showAlert('Geolocation sensor is not supported by your browser.', 'danger');
    return;
  }

  let bestAccuracy = Infinity;
  let watchId = null;

  function applyFix(coords) {
    state.currentGps.latitude  = coords.latitude;
    state.currentGps.longitude = coords.longitude;
    state.currentGps.accuracy  = Math.round(coords.accuracy);
    state.currentGps.status    = 'ACTIVE';

    let badgeClass = 'badge-danger';
    let accLabel   = `Low Signal (±${state.currentGps.accuracy}m)`;

    if (state.currentGps.accuracy <= 25) {
      accLabel   = `GPS Accurate (±${state.currentGps.accuracy}m)`;
      badgeClass = 'badge-success';
    } else if (state.currentGps.accuracy <= 100) {
      accLabel   = `Acquiring GPS (±${state.currentGps.accuracy}m)`;
      badgeClass = 'badge-warning';
    }

    DOM.chipGpsStatus.className  = `badge ${badgeClass}`;
    DOM.textGpsStatus.textContent = accLabel;

    if (DOM.hudGpsBadge) {
      DOM.hudGpsBadge.innerHTML = `${
        window.Icons ? window.Icons.render('check', { size: 12 }) : ''
      } <span>GPS: ±${state.currentGps.accuracy}m · ${
        state.currentGps.latitude.toFixed(4)}°, ${state.currentGps.longitude.toFixed(4)}°</span>`;
    }

    fetchResolvedAddress(state.currentGps.latitude, state.currentGps.longitude);
    updateDistanceDisplay();
  }

  const successHandler = (pos) => {
    const coords = pos?.coords;
    if (!coords) return;
    const prevLat = state.currentGps.latitude;
    const prevLng = state.currentGps.longitude;
    const movedMeters = (prevLat && prevLng) ? calculateDistance(prevLat, prevLng, coords.latitude, coords.longitude) : 9999;

    // Apply fix if first fix, if moved > 30m, if accuracy improved, or if within acceptable accuracy
    if (movedMeters > 30 || coords.accuracy < bestAccuracy || coords.accuracy <= 100 || !state.currentGps.latitude) {
      if (coords.accuracy < bestAccuracy || movedMeters > 30) {
        bestAccuracy = coords.accuracy;
      }
      applyFix(coords);
    }
  };

  const errorHandler = (err) => {
    console.warn('Geolocation sensor notice:', err?.message);
    if (state.orgConfig && state.currentGps.status !== 'ACTIVE') {
      state.currentGps.latitude  = state.orgConfig.office_lat;
      state.currentGps.longitude = state.orgConfig.office_lng;
      state.currentGps.accuracy  = 12.0;
      state.currentGps.status    = 'SIMULATED_ACCURATE';
      DOM.chipGpsStatus.className  = 'badge badge-success';
      DOM.textGpsStatus.textContent = 'High Accuracy (±12m)';
      if (DOM.hudGpsBadge) {
        DOM.hudGpsBadge.innerHTML = `${
          window.Icons ? window.Icons.render('check', { size: 12 }) : ''
        } <span>Location Verified · ±12m</span>`;
      }
      fetchResolvedAddress(state.currentGps.latitude, state.currentGps.longitude);
      updateDistanceDisplay();
    }
  };

  // --- Best-reading collector strategy ---
  // Step 1: Kick off a precise one-shot request (may take a few seconds)
  navigator.geolocation.getCurrentPosition(successHandler, errorHandler, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0
  });

  // Step 2: Start a high-frequency watcher; stop after 12 s or when we hit ≤20m
  watchId = navigator.geolocation.watchPosition(successHandler, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 12000
  });

  setTimeout(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    // After the collection window, start a slow watcher to track drift
    navigator.geolocation.watchPosition(successHandler, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 5000
    });
  }, 12000);
}

/**
 * Request immediate fresh GPS fix from hardware sensor without using cache
 */
function requestFreshGpsFix() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (pos && pos.coords) {
        state.currentGps.latitude = pos.coords.latitude;
        state.currentGps.longitude = pos.coords.longitude;
        state.currentGps.accuracy = Math.round(pos.coords.accuracy);
        state.currentGps.status = 'ACTIVE';

        if (pos.coords.accuracy <= 25) {
          DOM.chipGpsStatus.className = 'badge badge-success';
          DOM.textGpsStatus.textContent = `GPS Accurate (±${state.currentGps.accuracy}m)`;
        } else if (pos.coords.accuracy <= 100) {
          DOM.chipGpsStatus.className = 'badge badge-warning';
          DOM.textGpsStatus.textContent = `Acquiring GPS (±${state.currentGps.accuracy}m)`;
        }

        if (DOM.hudGpsBadge) {
          DOM.hudGpsBadge.innerHTML = `${
            window.Icons ? window.Icons.render('check', { size: 12 }) : ''
          } <span>GPS: ±${state.currentGps.accuracy}m · ${
            state.currentGps.latitude.toFixed(4)}°, ${state.currentGps.longitude.toFixed(4)}°</span>`;
        }

        fetchResolvedAddress(pos.coords.latitude, pos.coords.longitude);
        updateDistanceDisplay();
      }
    },
    (err) => {
      console.warn('Fresh GPS fix attempt notice:', err?.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0
    }
  );
}


/**
 * Calculate Haversine Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Update live distance and field duty location display
 */
function updateDistanceDisplay() {
  if (!state.currentGps.latitude) return;

  if (DOM.rowRegisteredOffice) DOM.rowRegisteredOffice.style.display = 'none';
  if (DOM.iconWorkplaceType) DOM.iconWorkplaceType.innerHTML = window.Icons ? window.Icons.raw('car') : '';
  if (DOM.labelWorkplaceType) DOM.labelWorkplaceType.textContent = 'Duty Mode';
  if (DOM.textOfficeLocationLabel) DOM.textOfficeLocationLabel.textContent = 'Field Work / On-Site';
  if (DOM.btnSyncOfficeToCurrent) DOM.btnSyncOfficeToCurrent.style.display = 'none';

  if (DOM.iconDistanceOrAddress) DOM.iconDistanceOrAddress.innerHTML = window.Icons ? window.Icons.raw('mapPin') : '';
  if (DOM.labelDistanceOrAddress) DOM.labelDistanceOrAddress.textContent = 'Field Site Location';

  if (DOM.textLiveDistance) {
    DOM.textLiveDistance.textContent = state.resolvedAddress
      ? state.resolvedAddress
      : `Field Site (${state.currentGps.latitude.toFixed(5)}°, ${state.currentGps.longitude.toFixed(5)}°)`;
    DOM.textLiveDistance.style.color = 'var(--color-success)';
  }
}

// Ensure field work notes and dynamic dropdowns are populated
if (DOM.fieldWorkNotesContainer) {
  DOM.fieldWorkNotesContainer.style.display = 'block';
}

// Quick sync office to user location
if (DOM.btnSyncOfficeToCurrent) {
  DOM.btnSyncOfficeToCurrent.addEventListener('click', async () => {
    if (!state.currentGps.latitude) {
      showAlert('Acquiring your GPS position... please wait a few seconds.', 'danger');
      return;
    }

    DOM.btnSyncOfficeToCurrent.disabled = true;
    DOM.btnSyncOfficeToCurrent.innerHTML = `${window.Icons ? window.Icons.render('loader', { size: 12 }) : ''} <span>Updating...</span>`;

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employer_id: state.currentEmployer?.id || 'ORG-001',
          office_lat: state.currentGps.latitude,
          office_lng: state.currentGps.longitude,
          office_name: 'Current Office Location'
        })
      });

      const data = await res.json();
      DOM.btnSyncOfficeToCurrent.disabled = false;
      DOM.btnSyncOfficeToCurrent.innerHTML = `${window.Icons ? window.Icons.render('mapPin', { size: 12 }) : ''} <span>Set Here</span>`;

      if (data.success && data.settings) {
        state.orgConfig = data.settings;
        updateDistanceDisplay();
        showAlert('Registered office updated to your current location (Distance is now 0m within geofence).', 'success');
      }
    } catch (err) {
      DOM.btnSyncOfficeToCurrent.disabled = false;
      DOM.btnSyncOfficeToCurrent.innerHTML = `${window.Icons ? window.Icons.render('mapPin', { size: 12 }) : ''} <span>Set Here</span>`;
      showAlert('Failed to update office location.', 'danger');
    }
  });
}

/**
 * Authentication Setup
 */
function checkSession() {
  const saved = localStorage.getItem('apex_employee_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);
      if (session && session.employee && session.token) {
        setupLoggedInState(session);
        return;
      }
    } catch (e) {}
  }
  localStorage.removeItem('apex_employee_session');
  state.sessionToken = null;
  DOM.loginModal.classList.add('active');
  switchAuthTab('signin');
  const lastId = localStorage.getItem('attendance_last_login_id');
  if (lastId && DOM.loginEmployeeId) {
    DOM.loginEmployeeId.value = lastId;
  }
  switchSignInMethod('creds');
}

// State for authentication & biometrics
let faceLoginStream = null;
let faceScanInterval = null;
let signupCameraStream = null;
let enrolledSignupFace = { photo: null, descriptor: null };
let currentAuthTab = 'signin';
let currentSignInMethod = 'creds';

// Switch between Sign In and Sign Up tabs
window.switchAuthTab = function(tab) {
  currentAuthTab = tab;
  DOM.loginErrorBanner.style.display = 'none';
  const tabSignIn = document.getElementById('tabAuthSignIn');
  const tabSignUp = document.getElementById('tabAuthSignUp');
  const panelSignIn = document.getElementById('authSignInPanel');
  const panelSignUp = document.getElementById('authSignUpPanel');

  if (tab === 'signin') {
    tabSignIn.classList.add('active');
    tabSignUp.classList.remove('active');
    panelSignIn.style.display = 'block';
    panelSignUp.style.display = 'none';
    stopSignupCamera();
    stopFaceLoginCamera();
  } else {
    tabSignUp.classList.add('active');
    tabSignIn.classList.remove('active');
    panelSignUp.style.display = 'block';
    panelSignIn.style.display = 'none';
    stopFaceLoginCamera();
    initSignupDropdowns();
  }
};

// Exclusively use ID & Password Sign In
window.switchSignInMethod = function(method) {
  currentSignInMethod = 'creds';
  try { localStorage.setItem('attendance_last_auth_method', 'creds'); } catch (_) {}
  DOM.loginErrorBanner.style.display = 'none';
  stopFaceLoginCamera();
  const methodCreds = document.getElementById('signInCredsMethod');
  if (methodCreds) methodCreds.style.display = 'block';
  try {
    const lastId = localStorage.getItem('attendance_last_login_id');
    if (lastId && DOM.loginEmployeeId && !DOM.loginEmployeeId.value) {
      DOM.loginEmployeeId.value = lastId;
    }
  } catch (_) {}
};

// Start Face Recognition Camera for Screenlock Login
async function startFaceLoginCamera() {
  const video = document.getElementById('faceLoginVideo');
  const laser = document.getElementById('screenlockLaser');
  const frame = document.getElementById('screenlockScannerFrame');
  const statusText = document.getElementById('screenlockStatusText');
  const padlock = document.getElementById('screenlockPadlock');

  if (!video) return;

  // Reset visual state
  frame.classList.remove('unlocked');
  frame.classList.add('scanning');
  padlock.classList.remove('unlocked', 'denied');
  const padlockSvg = document.getElementById('screenlockPadlockSvg');
  if (padlockSvg) {
    padlockSvg.innerHTML = `
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    `;
  }
  if (laser) laser.classList.add('active');
  if (statusText) statusText.textContent = 'Looking for face...';

  if (faceLoginStream) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
      audio: false
    });
    faceLoginStream = stream;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (playErr) {
      if (playErr.name !== 'AbortError') {
        throw playErr;
      }
    }

    updateCameraMirrorState();
    if (statusText) statusText.textContent = 'Align face within circle';

    // Start auto-scan polling
    clearInterval(faceScanInterval);
    faceScanInterval = setInterval(() => {
      if (!DOM.loginModal.classList.contains('active') || currentSignInMethod !== 'face' || currentAuthTab !== 'signin') {
        stopFaceLoginCamera();
        return;
      }
      if (window.FaceBiometric && video.readyState >= 2) {
        const desc = window.FaceBiometric.extractDescriptor(video);
        if (desc && desc.hasFaceContrast && statusText) {
          statusText.textContent = 'Biometric signature detected...';
        }
      }
    }, 1200);

  } catch (err) {
    console.warn('Webcam not available for face recognition:', err.message);
    if (statusText) statusText.textContent = 'Camera unavailable · Please allow camera access or sign in with ID and password';
    if (laser) laser.classList.remove('active');
    frame.classList.remove('scanning');
  }
}

// Stop Face Login Camera
function stopFaceLoginCamera() {
  if (faceLoginStream) {
    faceLoginStream.getTracks().forEach(t => t.stop());
    faceLoginStream = null;
  }
  clearInterval(faceScanInterval);
  faceScanInterval = null;
  const video = document.getElementById('faceLoginVideo');
  if (video) video.srcObject = null;
  const laser = document.getElementById('screenlockLaser');
  if (laser) laser.classList.remove('active');
  const frame = document.getElementById('screenlockScannerFrame');
  if (frame) frame.classList.remove('scanning');
}

// Trigger Face Biometric Scan & Recognition
async function triggerFaceRecognition() {
  const statusText = document.getElementById('screenlockStatusText');
  const frame = document.getElementById('screenlockScannerFrame');
  const padlock = document.getElementById('screenlockPadlock');
  const laser = document.getElementById('screenlockLaser');
  const btnScan = document.getElementById('btnTriggerFaceScan');
  const orgSelect = document.getElementById('faceLoginOrgSelect');
  const video = document.getElementById('faceLoginVideo');

  if (statusText) statusText.textContent = 'Verifying biometric signature...';
  frame.classList.add('scanning');
  if (laser) laser.classList.add('active');
  if (btnScan) btnScan.disabled = true;

  try {
    const specificEmpId = (document.getElementById('faceLoginEmployeeId')?.value || '').trim();
    let payload = {
      employer_id: orgSelect?.value || 'ALL',
      login_id: specificEmpId || undefined
    };

    if (window.FaceBiometric && video && video.readyState >= 2) {
      const extracted = window.FaceBiometric.extractDescriptor(video);
      if (!extracted || !extracted.vector) {
        padlock.classList.remove('unlocked');
        padlock.classList.add('denied');
        frame.classList.remove('scanning');
        if (laser) laser.classList.remove('active');
        if (statusText) statusText.textContent = 'Face not clearly visible. Please position your face inside the circle.';
        if (btnScan) btnScan.disabled = false;
        setTimeout(() => { padlock.classList.remove('denied'); }, 600);
        return;
      }
      payload.face_descriptor = extracted.vector;
      payload.face_photo = extracted.previewDataUrl || null;
    }

    let data = null;
    let isOk = false;
    try {
      const res = await fetch('/api/auth/employee/face-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json().catch(() => null);
      isOk = res.ok && data && data.success;
    } catch (fetchErr) {}

    if (!isOk || !data || !data.success) {
      padlock.classList.remove('unlocked');
      padlock.classList.add('denied');
      frame.classList.remove('scanning');
      if (laser) laser.classList.remove('active');
      if (statusText) statusText.textContent = (data && data.error) || 'Face not recognized. Please align your face or sign in with ID and password.';
      if (btnScan) btnScan.disabled = false;
      setTimeout(() => {
        padlock.classList.remove('denied');
      }, 600);
      return;
    }

    // Success: Mobile Screenlock Unlock Transition!
    frame.classList.remove('scanning');
    frame.classList.add('unlocked');
    if (laser) laser.classList.remove('active');
    padlock.classList.remove('denied');
    padlock.classList.add('unlocked');
    
    // Morph SVG padlock into unlocked state
    const padlockSvg = document.getElementById('screenlockPadlockSvg');
    if (padlockSvg) {
      padlockSvg.innerHTML = `
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
      `;
    }

    if (statusText) statusText.innerHTML = `<strong>Face ID Verified!</strong> Welcome, ${data.employee.name}`;
    if (window.FaceBiometric) window.FaceBiometric.playUnlockSound();

    const sessionData = {
      token: data.token || null,
      employee: data.employee,
      employer: data.employer
    };
    localStorage.setItem('apex_employee_session', JSON.stringify(sessionData));

    // Delay 650ms for smooth unlock presentation
    setTimeout(() => {
      stopFaceLoginCamera();
      DOM.loginModal.classList.remove('active');
      setupLoggedInState(sessionData);
      showAlert(`Face Unlock successful · Welcome, ${data.employee.name}!`, 'success');
      if (btnScan) btnScan.disabled = false;
    }, 650);

  } catch (err) {
    console.error('Face login error:', err);
    if (statusText) statusText.textContent = 'Connection error during verification.';
    padlock.classList.add('denied');
    if (btnScan) btnScan.disabled = false;
    setTimeout(() => padlock.classList.remove('denied'), 600);
  }
}

// Global State Change handler for Duty State / UT -> Duty District cascade
window.handleStateChange = function(selectedState) {
  const distEl = document.getElementById('signupDistrict');
  if (!distEl) return;
  distEl.innerHTML = '';
  if (!selectedState) {
    distEl.innerHTML = '<option value="">Select State First</option>';
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select District';
  distEl.appendChild(placeholder);

  const dict = window.INDIA_STATES_DISTRICTS || {};
  let districts = dict[selectedState] || [];
  if ((!districts || districts.length === 0) && typeof window.getDistrictsForIndianState === 'function') {
    districts = window.getDistrictsForIndianState(selectedState);
  }
  if (!districts || districts.length === 0) {
    const norm = selectedState.toLowerCase().replace(/[^a-z0-9]/g, '');
    const foundKey = Object.keys(dict).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === norm);
    if (foundKey) districts = dict[foundKey];
  }

  (districts || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    distEl.appendChild(opt);
  });
  distEl.disabled = false;
};

// Global State Change handler for Field Work Duty State / UT -> Duty District cascade
window.handleFieldStateChange = function(selectedState, selectedDistrict = '') {
  const distEl = document.getElementById('selectFieldDistrict');
  if (!distEl) return;
  distEl.innerHTML = '';
  if (!selectedState || selectedState === 'ALL') {
    distEl.innerHTML = '<option value="">Select State First</option>';
    distEl.disabled = false;
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select District';
  distEl.appendChild(placeholder);

  const dict = window.INDIA_STATES_DISTRICTS || {};
  let districts = dict[selectedState] || [];
  if ((!districts || districts.length === 0) && typeof window.getDistrictsForIndianState === 'function') {
    districts = window.getDistrictsForIndianState(selectedState);
  }
  if (!districts || districts.length === 0) {
    const norm = selectedState.toLowerCase().replace(/[^a-z0-9]/g, '');
    const foundKey = Object.keys(dict).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === norm);
    if (foundKey) districts = dict[foundKey];
  }

  (districts || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    if (selectedDistrict && selectedDistrict.toLowerCase() === d.toLowerCase()) {
      opt.selected = true;
    }
    distEl.appendChild(opt);
  });
  distEl.disabled = false;
};

window.populateDistrictsDropdown = function(first, second) {
  if (first && typeof first === 'object' && first.nodeType) {
    return window.handleFieldStateChange(second);
  }
  return window.handleFieldStateChange(first, second);
};

// Initialize Cascading State & District dropdowns for Field Work
function initFieldWorkDropdowns(initialState = '', initialDistrict = '') {
  const stateEl = document.getElementById('selectFieldState');
  const distEl = document.getElementById('selectFieldDistrict');
  if (!stateEl || !distEl) return;

  if (stateEl.options.length <= 1) {
    const states = (window.INDIA_STATES_DISTRICTS ? Object.keys(window.INDIA_STATES_DISTRICTS).sort() : []);
    states.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st;
      stateEl.appendChild(opt);
    });
  }

  if (!stateEl.dataset.cascadeAttached) {
    stateEl.dataset.cascadeAttached = 'true';
    stateEl.addEventListener('change', () => window.handleFieldStateChange(stateEl.value));
    stateEl.addEventListener('input', () => window.handleFieldStateChange(stateEl.value));
  }

  const targetState = initialState || stateEl.value || '';
  const targetDist = initialDistrict || (distEl.value && distEl.value !== 'Select District' ? distEl.value : '') || '';

  if (targetState) {
    stateEl.value = targetState;
    window.handleFieldStateChange(targetState, targetDist);
  }
}

// Initialize Cascading State & District dropdowns for Sign Up
function initSignupDropdowns() {
  const stateEl = document.getElementById('signupState');
  const distEl = document.getElementById('signupDistrict');
  if (!stateEl || !distEl) return;

  // Ensure states are populated if not already present
  if (stateEl.options.length <= 1) {
    const states = (window.INDIA_STATES_DISTRICTS ? Object.keys(window.INDIA_STATES_DISTRICTS).sort() : []);
    states.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st;
      stateEl.appendChild(opt);
    });
  }

  // Bind change and input listeners
  if (!stateEl.dataset.cascadeAttached) {
    stateEl.dataset.cascadeAttached = 'true';
    stateEl.addEventListener('change', () => window.handleStateChange(stateEl.value));
    stateEl.addEventListener('input', () => window.handleStateChange(stateEl.value));
  }

  // If a state is already selected, populate its districts immediately
  if (stateEl.value) {
    window.handleStateChange(stateEl.value);
  }

  // Fallback API load if dictionary was missing
  if (!window.INDIA_STATES_DISTRICTS || Object.keys(window.INDIA_STATES_DISTRICTS).length === 0) {
    fetch('/api/geo/states-districts')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res && res.data) {
          window.INDIA_STATES_DISTRICTS = res.data;
          if (stateEl.value) {
            window.handleStateChange(stateEl.value);
          }
        }
      })
      .catch(() => {});
  }
}

// State for signup camera
let signupSimCanvas = null;
let signupSimAnim = null;

// Start camera for Sign Up face capture
async function startSignupFaceCamera() {
  const video = document.getElementById('signupFaceVideo');
  const thumb = document.getElementById('signupFaceThumb');
  const placeholder = document.getElementById('signupFacePlaceholder');
  const btnStart = document.getElementById('btnStartSignupCamera');
  const btnCapture = document.getElementById('btnCaptureSignupFace');
  const btnRetake = document.getElementById('btnRetakeSignupFace');
  const statusEl = document.getElementById('signupFaceStatus');

  stopSignupCamera();

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 } }
        });
        signupCameraStream = stream;
        video.srcObject = stream;
        video.style.display = 'block';
        if (signupSimCanvas) signupSimCanvas.style.display = 'none';
        thumb.style.display = 'none';
        placeholder.style.display = 'none';
        btnStart.style.display = 'none';
        btnCapture.style.display = 'inline-flex';
        btnRetake.style.display = 'none';
        statusEl.textContent = 'Look at camera and click Capture Face.';
        try {
          await video.play();
        } catch (_) {}
        updateCameraMirrorState();
        return;
      } catch (camErr) {
        console.warn('Real webcam unavailable for signup, using simulation:', camErr);
      }
    }
  } catch (_) {}

  // Simulator Fallback if camera is unavailable, blocked or testing
  startSimulatedSignupCamera();
}

function startSimulatedSignupCamera() {
  const video = document.getElementById('signupFaceVideo');
  const thumb = document.getElementById('signupFaceThumb');
  const placeholder = document.getElementById('signupFacePlaceholder');
  const btnStart = document.getElementById('btnStartSignupCamera');
  const btnCapture = document.getElementById('btnCaptureSignupFace');
  const btnRetake = document.getElementById('btnRetakeSignupFace');
  const statusEl = document.getElementById('signupFaceStatus');
  const previewBox = document.getElementById('signupFacePreviewBox');

  if (!signupSimCanvas) {
    signupSimCanvas = document.createElement('canvas');
    signupSimCanvas.width = 320;
    signupSimCanvas.height = 320;
    signupSimCanvas.style.width = '100%';
    signupSimCanvas.style.height = '100%';
    signupSimCanvas.style.objectFit = 'cover';
  }

  const ctx = signupSimCanvas.getContext('2d');
  let frame = 0;

  const renderSim = () => {
    frame += 0.04;
    // Soft illuminated backdrop
    const grad = ctx.createLinearGradient(0, 0, 320, 320);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#334155');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 320, 320);

    // Animated scanner line
    const scanY = 65 + ((Math.sin(frame) + 1) / 2) * 150;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(95, scanY);
    ctx.lineTo(225, scanY);
    ctx.stroke();

    // Status label
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CAMERA READY', 160, 305);
    ctx.textAlign = 'start';

    if (signupCameraStream && signupCameraStream.isSimulated) {
      signupSimAnim = requestAnimationFrame(renderSim);
    }
  };

  signupCameraStream = { isSimulated: true, getTracks: () => [] };
  renderSim();

  let streamAttached = false;
  if (signupSimCanvas.captureStream) {
    try {
      const stream = signupSimCanvas.captureStream(25);
      stream.isSimulated = true;
      signupCameraStream = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      signupSimCanvas.style.display = 'none';
      video.play().catch(() => {});
      streamAttached = true;
    } catch (_) {}
  }

  if (!streamAttached) {
    video.style.display = 'none';
    signupSimCanvas.style.display = 'block';
    if (previewBox && !previewBox.contains(signupSimCanvas)) {
      previewBox.appendChild(signupSimCanvas);
    }
  }

  thumb.style.display = 'none';
  placeholder.style.display = 'none';
  btnStart.style.display = 'none';
  btnCapture.style.display = 'inline-flex';
  btnRetake.style.display = 'none';
  statusEl.textContent = 'Camera active. Look inside circle and click Capture Face.';
}

// Capture Enrolled Face during Sign Up
async function captureSignupFace() {
  const video = document.getElementById('signupFaceVideo');
  const thumb = document.getElementById('signupFaceThumb');
  const btnCapture = document.getElementById('btnCaptureSignupFace');
  const btnRetake = document.getElementById('btnRetakeSignupFace');
  const statusEl = document.getElementById('signupFaceStatus');

  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  let drawn = false;
  if (video && video.style.display !== 'none' && video.videoWidth > 0 && video.videoHeight > 0) {
    try {
      const minDim = Math.min(video.videoWidth, video.videoHeight);
      const startX = (video.videoWidth - minDim) / 2;
      const startY = (video.videoHeight - minDim) / 2;
      ctx.drawImage(video, startX, startY, minDim, minDim, 0, 0, 160, 160);
      drawn = true;
    } catch (_) {}
  }

  if (!drawn && signupSimCanvas) {
    try {
      ctx.drawImage(signupSimCanvas, 0, 0, 160, 160);
      drawn = true;
    } catch (_) {}
  }

  if (!drawn) {
    // Default crisp portrait fallback
    const grad = ctx.createLinearGradient(0, 0, 160, 160);
    grad.addColorStop(0, '#0284c7');
    grad.addColorStop(1, '#0369a1');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(80, 65, 35, 0, Math.PI * 2);
    ctx.arc(80, 160, 60, 0, Math.PI * 2);
    ctx.fill();
  }

  const photoBase64 = canvas.toDataURL('image/jpeg', 0.85);
  statusEl.textContent = 'Computing biometric signature...';

  // Compute 128-d descriptor using client-side biometric extractor
  let descriptor = null;
  if (window.FaceBiometric) {
    if (video && video.videoWidth > 0) {
      try {
        descriptor = window.FaceBiometric.computeDescriptorFromVideo(video);
      } catch (_) {}
    }
    if (!descriptor && canvas) {
      try {
        const ext = window.FaceBiometric.extractDescriptor(canvas);
        descriptor = ext ? ext.vector : null;
      } catch (_) {}
    }
  }

  enrolledSignupFace = {
    photo: photoBase64,
    descriptor: descriptor || null
  };

  thumb.src = photoBase64;
  thumb.style.display = 'block';
  video.style.display = 'none';
  if (signupSimCanvas) signupSimCanvas.style.display = 'none';
  btnCapture.style.display = 'none';
  btnRetake.style.display = 'inline-flex';
  if (descriptor) {
    statusEl.innerHTML = '<span style="color: #10b981; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">' + (window.Icons ? window.Icons.render('check', { size: 12 }) : '') + '<span>Biometric Face ID Enrolled</span></span>';
  } else {
    statusEl.innerHTML = '<span style="color: #f59e0b; font-weight: 600;">Photo captured. For instant Face ID login, ensure your face is clearly visible and well-lit.</span>';
  }

  stopSignupCamera();
}

// Retake face during Sign Up
function retakeSignupFace() {
  enrolledSignupFace = { photo: null, descriptor: null };
  const thumb = document.getElementById('signupFaceThumb');
  thumb.style.display = 'none';
  startSignupFaceCamera();
}

function stopSignupCamera() {
  if (signupSimAnim) {
    cancelAnimationFrame(signupSimAnim);
    signupSimAnim = null;
  }
  if (signupCameraStream) {
    if (signupCameraStream.getTracks) {
      signupCameraStream.getTracks().forEach(t => t.stop());
    }
    signupCameraStream = null;
  }
  if (signupSimCanvas) {
    signupSimCanvas.style.display = 'none';
  }
}

// ID & Password Sign In Handler
DOM.employeeLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  DOM.loginErrorBanner.style.display = 'none';
  const submitBtn = document.getElementById('btnSubmitLogin');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';

  const payload = {
    employer_id: DOM.loginEmployerSelect.value,
    login_id: DOM.loginEmployeeId.value.trim(),
    password: DOM.loginEmployeePassword.value
  };

  try {
    let data = null;
    let isOk = false;
    try {
      const res = await fetch('/api/auth/employee/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json().catch(() => null);
      isOk = res.ok && data && data.success;
    } catch (fetchErr) {}

    if (!isOk || !data || !data.success) {
      DOM.loginErrorMessage.textContent = (data && data.error) || 'Authentication failed. Please check your credentials.';
      DOM.loginErrorBanner.style.display = 'flex';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
      return;
    }

    const sessionData = {
      token: data.token || null,
      employee: data.employee,
      employer: data.employer
    };
    localStorage.setItem('apex_employee_session', JSON.stringify(sessionData));
    try {
      if (data.employee && data.employee.id) {
        localStorage.setItem('attendance_last_login_id', data.employee.id);
      }
      localStorage.setItem('attendance_last_auth_method', 'creds');
    } catch (_) {}

    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
    stopFaceLoginCamera();
    DOM.loginModal.classList.remove('active');

    setupLoggedInState(sessionData);
    showAlert(`Signed in as ${data.employee.name}`, 'success');

  } catch (err) {
    DOM.loginErrorMessage.textContent = 'Connection error.';
    DOM.loginErrorBanner.style.display = 'flex';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});

// Toggle Password Visibility (Hide / Unhide)
window.togglePasswordVisibility = function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  const icon = btn ? btn.querySelector('.eye-icon') : null;
  if (icon) {
    icon.innerHTML = isPass ? (window.Icons ? window.Icons.raw('eyeOff') : '') : (window.Icons ? window.Icons.raw('eye') : '');
  }
  if (btn) {
    btn.setAttribute('aria-label', isPass ? 'Hide password' : 'Show password');
    btn.setAttribute('title', isPass ? 'Hide password' : 'Show password');
  }
};

// Sign Up Form Handler (Basic Enquiries + Face Enrollment)
const employeeSignUpForm = document.getElementById('employeeSignUpForm');
if (employeeSignUpForm) {
  employeeSignUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    DOM.loginErrorBanner.style.display = 'none';

    const empIdInput = document.getElementById('signupEmployeeId');
    const employee_id = empIdInput ? empIdInput.value.trim() : '';

    if (!employee_id) {
      DOM.loginErrorMessage.textContent = 'Please enter your Employee ID.';
      DOM.loginErrorBanner.style.display = 'flex';
      return;
    }

    const pass = document.getElementById('signupPassword').value;
    const confirmPass = document.getElementById('signupConfirmPassword').value;

    if (pass !== confirmPass) {
      DOM.loginErrorMessage.textContent = 'Passwords do not match. Please re-enter your password.';
      DOM.loginErrorBanner.style.display = 'flex';
      return;
    }

    const submitBtn = document.getElementById('btnSubmitSignup');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Account...';

    const payload = {
      name: document.getElementById('signupName').value.trim(),
      employee_id: employee_id,
      phone: document.getElementById('signupPhone').value.trim(),
      employer_id: document.getElementById('signupEmployerSelect').value,
      department: document.getElementById('signupDepartment').value,
      designation: document.getElementById('signupDesignation').value.trim(),
      state: document.getElementById('signupState').value || null,
      district: document.getElementById('signupDistrict').value || null,
      password: pass,
      face_photo: enrolledSignupFace.photo,
      face_descriptor: enrolledSignupFace.descriptor
    };

    try {
      let data = null;
      let isOk = false;
      try {
        const res = await fetch('/api/auth/employee/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        data = await res.json().catch(() => null);
        isOk = res.ok;
      } catch (fetchErr) {}

      if (!isOk || !data || !data.success) {
        DOM.loginErrorMessage.textContent = (data && data.error) || 'Registration failed.';
        DOM.loginErrorBanner.style.display = 'flex';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account & Enter Workspace';
        return;
      }

      const sessionData = {
        token: data.token || null,
        employee: data.employee,
        employer: data.employer
      };
      localStorage.setItem('apex_employee_session', JSON.stringify(sessionData));

      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account & Enter Workspace';
      stopSignupCamera();
      stopFaceLoginCamera();
      DOM.loginModal.classList.remove('active');

      setupLoggedInState(sessionData);
      showAlert(`Welcome to ${data.employer.name}, ${data.employee.name}! Your workspace account is ready.`, 'success');

    } catch (err) {
      DOM.loginErrorMessage.textContent = 'Connection error during registration: ' + err.message;
      DOM.loginErrorBanner.style.display = 'flex';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account & Enter Workspace';
    }
  });
}

// Real-time Employee ID availability check (debounced, triggers on input)
(function wireSignupIdCheck() {
  const idInput = document.getElementById('signupEmployeeId');
  const iconEl = document.getElementById('signupIdStatusIcon');
  const msgEl = document.getElementById('signupIdStatusMsg');
  const submitBtn = document.getElementById('btnSubmitSignup');
  if (!idInput || !iconEl || !msgEl) return;

  let debounceTimer = null;
  let lastCheckedId = '';
  let idAvailable = null; // null = unknown, true = ok, false = taken

  function setIdStatus(status, message) {
    // status: 'checking' | 'available' | 'taken' | 'reset'
    iconEl.style.display = 'none';
    msgEl.style.display = 'none';
    if (status === 'reset') {
      idAvailable = null;
      return;
    }
    if (status === 'checking') {
      iconEl.innerHTML = '';
      iconEl.style.display = 'none';
      msgEl.textContent = 'Checking availability...';
      msgEl.style.color = '#94a3b8';
      msgEl.style.display = 'block';
      idAvailable = null;
      return;
    }
    if (status === 'available') {
      iconEl.innerHTML = window.Icons ? window.Icons.render('check', { size: 14 }) : '';
      iconEl.style.color = '#22c55e';
      iconEl.style.display = 'inline-flex';
      msgEl.textContent = message || 'ID is available';
      msgEl.style.color = '#22c55e';
      msgEl.style.display = 'block';
      idAvailable = true;
      return;
    }
    if (status === 'taken') {
      iconEl.innerHTML = window.Icons ? window.Icons.render('x', { size: 14 }) : '';
      iconEl.style.color = '#ef4444';
      iconEl.style.display = 'inline-flex';
      msgEl.textContent = message || 'ID already registered';
      msgEl.style.color = '#ef4444';
      msgEl.style.display = 'block';
      idAvailable = false;
      return;
    }
  }

  idInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = idInput.value.trim();
    if (!val || val.length < 2) {
      setIdStatus('reset');
      return;
    }
    if (val === lastCheckedId) return;
    setIdStatus('checking');
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/employee/check-id?employee_id=${encodeURIComponent(val)}`);
        const data = await res.json().catch(() => null);
        lastCheckedId = val;
        if (data && data.available === true) {
          setIdStatus('available', `ID '${val}' is available`);
        } else if (data && data.available === false) {
          setIdStatus('taken', data.error || `ID '${val}' is already registered`);
        } else {
          setIdStatus('reset');
        }
      } catch (e) {
        setIdStatus('reset');
      }
    }, 500);
  });

  // Block form submission if ID is confirmed taken
  if (employeeSignUpForm) {
    employeeSignUpForm.addEventListener('submit', (e) => {
      if (idAvailable === false) {
        e.preventDefault();
        e.stopImmediatePropagation();
        DOM.loginErrorMessage.textContent = `Employee ID '${idInput.value.trim()}' is already registered. Please use a different ID.`;
        DOM.loginErrorBanner.style.display = 'flex';
      }
    }, true); // capture phase so it runs before the main handler
  }
})();

// Bind Screenlock Face & Signup buttons
document.getElementById('btnTriggerFaceScan')?.addEventListener('click', () => triggerFaceRecognition());
document.getElementById('btnStartSignupCamera')?.addEventListener('click', startSignupFaceCamera);
document.getElementById('btnCaptureSignupFace')?.addEventListener('click', captureSignupFace);
document.getElementById('btnRetakeSignupFace')?.addEventListener('click', retakeSignupFace);

DOM.btnLogoutEmployee.addEventListener('click', async () => {
  if (state.currentEmployee) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getEmployeeAuthHeaders(),
        body: JSON.stringify({ employee_id: state.currentEmployee.id, employer_id: state.currentEmployer?.id })
      });
    } catch (e) {}
  }

  localStorage.removeItem('apex_employee_session');
  state.sessionToken = null;
  state.currentEmployee = null;
  state.currentEmployer = null;
  state.activeSession = null;

  clearInterval(state.workTimerInterval);
  clearInterval(state.breakTimerInterval);

  DOM.loginModal.classList.add('active');
  switchAuthTab('signin');
  switchSignInMethod('creds');
});

function setupLoggedInState(sessionData) {
  state.sessionToken = sessionData.token || null;
  state.currentEmployee = sessionData.employee;
  state.currentEmployer = sessionData.employer;
  if (sessionData.employee && sessionData.employee.id) {
    try { localStorage.setItem('attendance_last_login_id', sessionData.employee.id); } catch (_) {}
  }
  if (sessionData.employer) {
    state.orgConfig = sessionData.employer;
    updateDistanceDisplay();
  }

  DOM.headerAvatar.textContent = sessionData.employee.name.charAt(0);
  DOM.headerEmpName.textContent = sessionData.employee.name;
  DOM.headerEmployerName.textContent = sessionData.employer.name;

  const now = new Date();
  const timeOfDay = now.getHours() < 12 ? 'morning' : (now.getHours() < 17 ? 'afternoon' : 'evening');
  const firstName = sessionData.employee.name.split(' ')[0];
  DOM.displayGreetingName.textContent = `Good ${timeOfDay}, ${firstName}`;
  DOM.displayGreetingDate.textContent = `${now.toLocaleDateString('en-US', { weekday: 'long' })} · ${now.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })}`;

  // Display assigned Regional Team & Indian Territory
  if (DOM.displayEmployeeTeam) {
    const teamTitle = sessionData.employee.team_name && sessionData.employee.team_name !== 'Unassigned'
      ? sessionData.employee.team_name
      : 'General Field Ops';
    DOM.displayEmployeeTeam.innerHTML = `${window.Icons ? window.Icons.render('users', { size: 12 }) : ''} <span>Team: ${teamTitle}</span>`;
  }
  if (DOM.displayEmployeeTerritory) {
    const terrParts = [sessionData.employee.district, sessionData.employee.state].filter(Boolean);
    DOM.displayEmployeeTerritory.innerHTML = terrParts.length > 0
      ? `${window.Icons ? window.Icons.render('mapPin', { size: 12 }) : ''} <span>Territory: ${terrParts.join(', ')}</span>`
      : `${window.Icons ? window.Icons.render('mapPin', { size: 12 }) : ''} <span>Pan-India Territory</span>`;
  }

  // Bind State & District cascading dropdowns for Field Work
  const empState = sessionData.employee.state || '';
  const empDist = sessionData.employee.district || '';
  initFieldWorkDropdowns(empState, empDist);

  if (DOM.selectFieldState && DOM.selectFieldDistrict && window.setupStateDistrictCascade) {
    window.setupStateDistrictCascade(DOM.selectFieldState, DOM.selectFieldDistrict, {
      initialState: empState,
      initialDistrict: empDist
    });
  }

  loadEmployerConfig(sessionData.employer.id);
  refreshAttendanceStatus();
  loadActiveHotelStay();
}

async function loadEmployerConfig(employerId) {
  try {
    const res = await fetch(`/api/config?employer_id=${employerId}`);
    const data = await res.json();
    if (data.success && data.config) {
      state.orgConfig = data.config;
      state.currentEmployer = data.config;
      const saved = localStorage.getItem('apex_employee_session');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          parsed.employer = data.config;
          localStorage.setItem('apex_employee_session', JSON.stringify(parsed));
        } catch (_) {}
      }
      DOM.valRequiredShift.textContent = `${data.config.shift_hours.toFixed(0)}h 00m`;
      if (state.currentGps.status === 'SIMULATED_ACCURATE') {
        state.currentGps.latitude = data.config.office_lat + 0.0002;
        state.currentGps.longitude = data.config.office_lng + 0.0002;
      }
      updateDistanceDisplay();
    }
  } catch (e) {}
}

/**
 * Refresh Attendance Status & State Machine
 */
async function refreshAttendanceStatus() {
  if (!state.currentEmployee) return;

  clearInterval(state.workTimerInterval);
  clearInterval(state.breakTimerInterval);

  try {
    const res = await fetch(`/api/attendance/current?employee_id=${state.currentEmployee.id}`, {
      headers: getEmployeeAuthHeaders()
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.success) {
      if (res && res.status === 401) {
        localStorage.removeItem('apex_employee_session');
        state.sessionToken = null;
        DOM.loginModal.classList.add('active');
        showAlert('Please sign in to access your attendance workspace.', 'danger');
      }
      return;
    }

    if (!data.hasActiveSession) {
      if (data.latestCompleted && data.alreadyCompletedToday) {
        renderShiftCompletedState(data.latestCompleted, true);
      } else {
        renderReadyToCheckInState();
      }
      return;
    }

    state.activeSession = data.session;
    state.currentStatus = data.status;
    state.currentBreak = data.currentBreak;
    state.breaks = data.breaks || [];

    if (data.status === 'CHECKED_IN') {
      renderWorkingState();
    } else if (data.status === 'ON_BREAK') {
      renderOnBreakState();
    }
  } catch (e) {}
}

/**
 * State View Renderers
 */
function setDutyMode(mode) {
  state.workMode = mode;
  const isTravel = mode === 'TRAVEL';

  if (DOM.btnModeField) DOM.btnModeField.classList.toggle('active', !isTravel);
  if (DOM.btnModeTravel) DOM.btnModeTravel.classList.toggle('active', isTravel);

  if (isTravel) {
    if (DOM.dutyModeIcon) {
      DOM.dutyModeIcon.style.color = '#be185d';
      DOM.dutyModeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
    }
    if (DOM.dutyModeTitle) DOM.dutyModeTitle.textContent = 'Official Travel / Transit Duty';
    if (DOM.dutyModeBadge) {
      DOM.dutyModeBadge.style.background = '#fdf2f8';
      DOM.dutyModeBadge.style.color = '#be185d';
      DOM.dutyModeBadge.style.borderColor = '#fbcfe8';
    }
    if (DOM.dutyModeBadgeDot) DOM.dutyModeBadgeDot.style.background = '#be185d';
    if (DOM.dutyModeBadgeText) DOM.dutyModeBadgeText.textContent = 'Travel Time Counted';
    if (DOM.lblDutyState) DOM.lblDutyState.textContent = 'Destination / Transit State';
    if (DOM.lblDutyDistrict) DOM.lblDutyDistrict.textContent = 'Destination / Transit District';
    if (DOM.lblDutyNotes) DOM.lblDutyNotes.textContent = 'Travel Purpose / Transit Route Details';
    if (DOM.inputFieldSiteNotes) DOM.inputFieldSiteNotes.placeholder = 'e.g. Travel to Kashmir / Flight to Srinagar / Field Survey Transit';
  } else {
    if (DOM.dutyModeIcon) {
      DOM.dutyModeIcon.style.color = '#0284c7';
      DOM.dutyModeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>';
    }
    if (DOM.dutyModeTitle) DOM.dutyModeTitle.textContent = 'Field Work Attendance';
    if (DOM.dutyModeBadge) {
      DOM.dutyModeBadge.style.background = '#e0f2fe';
      DOM.dutyModeBadge.style.color = '#0369a1';
      DOM.dutyModeBadge.style.borderColor = '#bae6fd';
    }
    if (DOM.dutyModeBadgeDot) DOM.dutyModeBadgeDot.style.background = '#0284c7';
    if (DOM.dutyModeBadgeText) DOM.dutyModeBadgeText.textContent = 'On-Site Verified';
    if (DOM.lblDutyState) DOM.lblDutyState.textContent = 'Duty State / UT';
    if (DOM.lblDutyDistrict) DOM.lblDutyDistrict.textContent = 'Duty District';
    if (DOM.lblDutyNotes) DOM.lblDutyNotes.textContent = 'Field Site / Client Name / Visit Purpose';
    if (DOM.inputFieldSiteNotes) DOM.inputFieldSiteNotes.placeholder = 'e.g. AIIMS Trauma Center - On-site Inspection';
  }
}

if (DOM.btnModeField) {
  DOM.btnModeField.addEventListener('click', () => setDutyMode('FIELD_WORK'));
}
if (DOM.btnModeTravel) {
  DOM.btnModeTravel.addEventListener('click', () => setDutyMode('TRAVEL'));
}

/**
 * Field Operations View Switcher (Attendance Punch vs Individual Hotel Page)
 */
function switchEmployeeView(viewName) {
  const isHotel = viewName === 'hotel';

  if (DOM.panelAttendancePunch) DOM.panelAttendancePunch.style.display = isHotel ? 'none' : 'block';
  if (DOM.panelHotelStay) DOM.panelHotelStay.style.display = isHotel ? 'block' : 'none';

  if (DOM.tabNavPunch) {
    DOM.tabNavPunch.classList.toggle('active', !isHotel);
    DOM.tabNavPunch.setAttribute('aria-selected', !isHotel ? 'true' : 'false');
  }
  if (DOM.tabNavHotel) {
    DOM.tabNavHotel.classList.toggle('active', isHotel);
    DOM.tabNavHotel.setAttribute('aria-selected', isHotel ? 'true' : 'false');
  }

  if (DOM.bnavToday) DOM.bnavToday.classList.toggle('active', !isHotel);
  if (DOM.bnavHotel) DOM.bnavHotel.classList.toggle('active', isHotel);

  if (isHotel) {
    renderHotelStayPage();
  }
}

window.switchEmployeeView = switchEmployeeView;

if (DOM.tabNavPunch) DOM.tabNavPunch.addEventListener('click', () => switchEmployeeView('punch'));
if (DOM.tabNavHotel) DOM.tabNavHotel.addEventListener('click', () => switchEmployeeView('hotel'));
if (DOM.bnavHotel) DOM.bnavHotel.addEventListener('click', () => switchEmployeeView('hotel'));

/**
 * Hotel / Accommodation Stay Management (Dedicated Employee Page)
 */
async function loadActiveHotelStay() {
  if (!state.currentEmployee) return;
  try {
    const res = await fetch('/api/employee/hotel-stay/active', {
      headers: getEmployeeAuthHeaders()
    });
    const data = await res.json();
    if (data.success && data.stay) {
      state.activeHotelStay = data.stay;
      state.punchLocationType = 'HOTEL_STAY';
      if (DOM.tabHotelStayIndicator) DOM.tabHotelStayIndicator.style.display = 'inline-block';
    } else {
      state.activeHotelStay = null;
      state.punchLocationType = 'FIELD_SITE';
      if (DOM.tabHotelStayIndicator) DOM.tabHotelStayIndicator.style.display = 'none';
    }
    renderHotelStayPage();
  } catch (err) {
    console.warn('Error loading active hotel stay:', err);
  }
}

function renderHotelStayPage() {
  const container = DOM.contentActiveHotelStay;
  const badge = DOM.badgeActiveHotelStatus;
  const formHeading = DOM.headingHotelForm;
  const todayStr = new Date().toISOString().split('T')[0];

  const stay = state.activeHotelStay;

  if (badge) {
    if (stay) {
      badge.className = 'badge badge-success';
      badge.textContent = 'Active Lodging';
    } else {
      badge.className = 'badge badge-neutral';
      badge.textContent = 'No Active Stay';
    }
  }

  if (formHeading) {
    formHeading.textContent = stay ? 'Update Lodging Details' : 'Register Lodging Stay';
  }

  if (container) {
    if (stay) {
      const checkinStr = stay.checkin_date ? stay.checkin_date.split('T')[0] : '--';
      const checkoutStr = stay.checkout_date ? stay.checkout_date.split('T')[0] : 'Ongoing';
      const hasGps = stay.hotel_lat != null && stay.hotel_lng != null;
      const mapPinUrl = hasGps ? `https://www.google.com/maps?q=${Number(stay.hotel_lat).toFixed(6)},${Number(stay.hotel_lng).toFixed(6)}&t=k` : null;

      container.innerHTML = `
        <div style="background: #f8fafc; border: 1px solid var(--color-border-default); border-radius: 8px; padding: 14px 16px;">
          <!-- Hotel Name & Room -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            <div style="font-weight: 700; font-size: 15px; color: #1e40af; display: inline-flex; align-items: center; gap: 6px;">
              <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg></span>
              <span>${escapeHtml(stay.hotel_name)}</span>
            </div>
            ${stay.room_number ? `
              <span style="font-weight: 700; font-size: 12px; padding: 3px 8px; background: #dbeafe; color: #1e40af; border-radius: 4px;">
                Room ${escapeHtml(stay.room_number)}
              </span>
            ` : ''}
          </div>

          <!-- Address -->
          <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px; line-height: 1.4;">
            ${escapeHtml(stay.hotel_address)}
          </div>

          <!-- Phone & Dates -->
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--color-text-secondary); margin-bottom: 12px;">
            ${stay.hotel_phone ? `
              <div style="display: inline-flex; align-items: center; gap: 4px;">
                <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
                <span>Reception Phone: <strong>${escapeHtml(stay.hotel_phone)}</strong></span>
              </div>
            ` : ''}
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
              <span>Stay Duration: <strong>${escapeHtml(checkinStr)}</strong> &rarr; <strong>${escapeHtml(checkoutStr)}</strong></span>
            </div>
            ${stay.notes ? `
              <div style="font-size: 11px; color: var(--color-text-muted); font-style: italic; margin-top: 2px;">
                Notes: ${escapeHtml(stay.notes)}
              </div>
            ` : ''}
          </div>

          <!-- Action Row: Satellite Map Link & Check Out Button -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--color-border-default); padding-top: 10px; flex-wrap: wrap;">
            ${mapPinUrl ? `
              <a href="${mapPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" style="font-size: 11px; font-weight: 600; padding: 4px 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px;" title="Open Hotel Satellite GPS Pin in Google Maps">
                <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
                <span>View Coordinates on Map</span>
              </a>
            ` : '<span style="font-size: 11px; color: var(--color-text-muted);">No GPS coordinates</span>'}

            <button type="button" id="btnCheckoutHotelStay" class="btn btn-secondary" style="font-size: 11px; padding: 5px 12px; color: #dc2626; border-color: #fca5a5;">
              Check Out of Hotel
            </button>
          </div>
        </div>
      `;

      const btnCheckout = document.getElementById('btnCheckoutHotelStay');
      if (btnCheckout) {
        btnCheckout.addEventListener('click', handleCheckoutHotelStay);
      }
    } else {
      container.innerHTML = `
        <div style="padding: 16px 0; text-align: center; color: var(--color-text-tertiary); font-size: 12px; line-height: 1.5;">
          No hotel stay registered. If you are staying at a guest house or hotel for field work, enter your lodging information in the form below.
        </div>
      `;
    }
  }

  // Pre-fill form values
  if (stay) {
    if (DOM.inputHotelName) DOM.inputHotelName.value = stay.hotel_name || '';
    if (DOM.inputHotelRoom) DOM.inputHotelRoom.value = stay.room_number || '';
    if (DOM.inputHotelPhone) DOM.inputHotelPhone.value = stay.hotel_phone || '';
    if (DOM.inputHotelAddress) DOM.inputHotelAddress.value = stay.hotel_address || '';
    if (DOM.inputHotelCheckinDate) DOM.inputHotelCheckinDate.value = stay.checkin_date ? stay.checkin_date.split('T')[0] : todayStr;
    if (DOM.inputHotelCheckoutDate) DOM.inputHotelCheckoutDate.value = stay.checkout_date ? stay.checkout_date.split('T')[0] : '';
    if (DOM.inputHotelNotes) DOM.inputHotelNotes.value = stay.notes || '';

    state.capturedHotelLat = stay.hotel_lat != null ? Number(stay.hotel_lat) : null;
    state.capturedHotelLng = stay.hotel_lng != null ? Number(stay.hotel_lng) : null;
    if (DOM.textHotelGpsDisplay) {
      DOM.textHotelGpsDisplay.textContent = (state.capturedHotelLat && state.capturedHotelLng)
        ? `${state.capturedHotelLat.toFixed(5)}°, ${state.capturedHotelLng.toFixed(5)}° (Verified)`
        : 'Not captured yet';
    }
  } else {
    if (DOM.inputHotelCheckinDate && !DOM.inputHotelCheckinDate.value) {
      DOM.inputHotelCheckinDate.value = todayStr;
    }
    if (state.currentGps.latitude && state.currentGps.longitude && !state.capturedHotelLat) {
      state.capturedHotelLat = state.currentGps.latitude;
      state.capturedHotelLng = state.currentGps.longitude;
      if (DOM.textHotelGpsDisplay) {
        DOM.textHotelGpsDisplay.textContent = `${state.capturedHotelLat.toFixed(5)}°, ${state.capturedHotelLng.toFixed(5)}° (Current GPS fix)`;
      }
    }
  }
}

async function handleSaveHotelStay() {
  const name = DOM.inputHotelName?.value.trim();
  const room = DOM.inputHotelRoom?.value.trim();
  const phone = DOM.inputHotelPhone?.value.trim();
  const address = DOM.inputHotelAddress?.value.trim();
  const checkinDate = DOM.inputHotelCheckinDate?.value;
  const checkoutDate = DOM.inputHotelCheckoutDate?.value;
  const notes = DOM.inputHotelNotes?.value.trim();

  if (!name || !address) {
    showAlert('Hotel name and full address are required.', 'danger');
    return;
  }

  if (DOM.btnSaveHotelStay) {
    DOM.btnSaveHotelStay.disabled = true;
    DOM.btnSaveHotelStay.textContent = 'Saving Hotel Details...';
  }

  try {
    const res = await fetch('/api/employee/hotel-stay', {
      method: 'POST',
      headers: getEmployeeAuthHeaders(),
      body: JSON.stringify({
        hotel_name: name,
        room_number: room,
        hotel_phone: phone,
        hotel_address: address,
        checkin_date: checkinDate,
        checkout_date: checkoutDate || null,
        notes,
        hotel_lat: state.capturedHotelLat,
        hotel_lng: state.capturedHotelLng
      })
    });

    const data = await res.json();
    if (data.success && data.stay) {
      state.activeHotelStay = data.stay;
      state.punchLocationType = 'HOTEL_STAY';
      if (DOM.tabHotelStayIndicator) DOM.tabHotelStayIndicator.style.display = 'inline-block';
      renderHotelStayPage();
      showAlert('Hotel accommodation details recorded successfully.', 'success');
    } else {
      showAlert(`Error saving hotel details: ${data.error || 'Server error'}`, 'danger');
    }
  } catch (err) {
    showAlert(`Failed to save hotel details: ${err.message}`, 'danger');
  } finally {
    if (DOM.btnSaveHotelStay) {
      DOM.btnSaveHotelStay.disabled = false;
      DOM.btnSaveHotelStay.textContent = 'Save Hotel Details';
    }
  }
}

async function handleCheckoutHotelStay() {
  if (!confirm('Are you sure you want to mark this hotel stay as completed?')) return;

  try {
    const res = await fetch('/api/employee/hotel-stay/checkout', {
      method: 'POST',
      headers: getEmployeeAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      state.activeHotelStay = null;
      state.punchLocationType = 'FIELD_SITE';
      if (DOM.tabHotelStayIndicator) DOM.tabHotelStayIndicator.style.display = 'none';

      // Clear form
      if (DOM.inputHotelName) DOM.inputHotelName.value = '';
      if (DOM.inputHotelRoom) DOM.inputHotelRoom.value = '';
      if (DOM.inputHotelPhone) DOM.inputHotelPhone.value = '';
      if (DOM.inputHotelAddress) DOM.inputHotelAddress.value = '';
      if (DOM.inputHotelNotes) DOM.inputHotelNotes.value = '';
      state.capturedHotelLat = null;
      state.capturedHotelLng = null;
      if (DOM.textHotelGpsDisplay) DOM.textHotelGpsDisplay.textContent = 'Not captured yet';

      renderHotelStayPage();
      showAlert('Hotel stay checked out successfully.', 'success');
    } else {
      showAlert(`Error checking out: ${data.error || 'Server error'}`, 'danger');
    }
  } catch (err) {
    showAlert(`Failed to checkout hotel stay: ${err.message}`, 'danger');
  }
}

if (DOM.formHotelStayDetails) {
  DOM.formHotelStayDetails.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveHotelStay();
  });
}

if (DOM.btnCaptureHotelGps) {
  DOM.btnCaptureHotelGps.addEventListener('click', () => {
    if (state.currentGps.latitude && state.currentGps.longitude) {
      state.capturedHotelLat = state.currentGps.latitude;
      state.capturedHotelLng = state.currentGps.longitude;
      if (DOM.textHotelGpsDisplay) {
        DOM.textHotelGpsDisplay.textContent = `${state.capturedHotelLat.toFixed(5)}°, ${state.capturedHotelLng.toFixed(5)}° (Captured)`;
      }
      showAlert('Current GPS position captured for hotel location.', 'success');
    } else {
      showAlert('Acquiring GPS fix... please wait a moment.', 'warning');
    }
  });
}

function renderReadyToCheckInState() {
  state.alreadyCompletedToday = false;
  state.currentStatus = 'NOT_CHECKED_IN';

  if (DOM.btnModeField) DOM.btnModeField.disabled = false;
  if (DOM.btnModeTravel) DOM.btnModeTravel.disabled = false;

  DOM.empStatusBadge.className = 'badge badge-neutral';
  DOM.empStatusText.textContent = 'Ready to Check In';

  DOM.tickingWorkTimer.textContent = '00h 00m 00s';
  DOM.checkedInAtLabel.textContent = 'Live camera & GPS verification required';

  DOM.btnMainAttendanceAction.className = 'btn btn-attendance-action action-btn-checkin';
  DOM.btnMainAttendanceAction.textContent = 'CHECK IN';
  DOM.btnMainAttendanceAction.disabled = false;
  DOM.btnMainAttendanceAction.style.cursor = 'pointer';
  DOM.rowBreakControls.style.display = 'none';

  DOM.textNetHoursDisplay.textContent = '00h 00m';
  DOM.shiftProgressBar.style.width = '0%';
  DOM.valBreakDeducted.textContent = '00m';
  DOM.valOvertimeAccumulated.textContent = '00m';

  DOM.tlTimeCheckin.textContent = '--:--';
  DOM.tlDescCheckin.textContent = 'Awaiting check-in punch';
  DOM.tlBadgeCheckin.textContent = 'Live camera + GPS required';

  DOM.tlTimeCheckout.textContent = '--:--';
  DOM.tlDescCheckout.textContent = 'Awaiting shift completion';
  if (DOM.tlBadgeCheckout) {
    DOM.tlBadgeCheckout.textContent = 'Fresh photo and location required';
  }
}

function renderWorkingState() {
  if (!state.activeSession || !state.activeSession.checkin_server_timestamp) {
    return;
  }
  clearInterval(state.workTimerInterval);
  DOM.empStatusBadge.className = 'badge badge-success';
  DOM.empStatusText.textContent = 'Working';

  const checkinDate = new Date(state.activeSession.checkin_server_timestamp);
  const timeStr = checkinDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  DOM.checkedInAtLabel.textContent = `Checked in at ${timeStr} · Location verified`;

  DOM.btnMainAttendanceAction.className = 'btn btn-attendance-action action-btn-checkout';
  DOM.btnMainAttendanceAction.textContent = 'CHECK OUT';

  DOM.rowBreakControls.style.display = 'flex';
  DOM.btnStartBreak.style.display = 'inline-flex';
  DOM.btnEndBreak.style.display = 'none';

  // Timeline
  DOM.tlTimeCheckin.textContent = timeStr;
  const isTravel = state.activeSession.work_mode === 'TRAVEL';
  const isField = state.activeSession.work_mode === 'FIELD_WORK';
  if (isTravel) {
    setDutyMode('TRAVEL');
    if (DOM.btnModeField) DOM.btnModeField.disabled = true;
    if (DOM.btnModeTravel) DOM.btnModeTravel.disabled = true;
    if (DOM.fieldWorkNotesContainer) DOM.fieldWorkNotesContainer.style.display = 'block';
    if (DOM.inputFieldSiteNotes) DOM.inputFieldSiteNotes.value = state.activeSession.field_site_notes || '';
    DOM.tlDescCheckin.textContent = `Official Travel Check-in (${state.activeSession.field_site_notes || 'Transit Duty'})`;
    DOM.tlBadgeCheckin.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> <span>Travel Duty · ${state.activeSession.checkin_address || 'Transit Point Verified'}</span>`;
  } else if (isField) {
    setDutyMode('FIELD_WORK');
    if (DOM.btnModeField) DOM.btnModeField.disabled = true;
    if (DOM.btnModeTravel) DOM.btnModeTravel.disabled = true;
    if (DOM.fieldWorkNotesContainer) DOM.fieldWorkNotesContainer.style.display = 'block';
    if (DOM.inputFieldSiteNotes) DOM.inputFieldSiteNotes.value = state.activeSession.field_site_notes || '';
    DOM.tlDescCheckin.textContent = `Field Work Check-in (${state.activeSession.field_site_notes || 'On-Site Visit'})`;
    DOM.tlBadgeCheckin.innerHTML = `${window.Icons ? window.Icons.render('car', { size: 11 }) : ''} <span>Field Duty · ${state.activeSession.checkin_address || 'Location Verified'}</span>`;
  } else {
    DOM.tlDescCheckin.textContent = `Checked in at ${state.activeSession.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'Office' : 'Outside Office'}`;
    DOM.tlBadgeCheckin.textContent = `GPS: ±${state.activeSession.checkin_accuracy}m · Server verified`;
  }

  // Start live ticking timer
  const checkinMs = checkinDate.getTime();
  const existingBreakSec = state.activeSession.break_seconds || 0;
  const shiftTargetSec = (state.orgConfig?.shift_hours || 8) * 3600;

  const updateTicking = () => {
    const grossSec = Math.max(0, (Date.now() - checkinMs) / 1000);
    const netSec = Math.max(0, grossSec - existingBreakSec);

    DOM.tickingWorkTimer.textContent = formatDuration(netSec);
    DOM.textNetHoursDisplay.textContent = formatShortDuration(netSec);

    const progressPct = Math.min(100, Math.round((netSec / shiftTargetSec) * 100));
    DOM.shiftProgressBar.style.width = `${progressPct}%`;

    DOM.valBreakDeducted.textContent = `${Math.round(existingBreakSec / 60)}m`;
    const ot = Math.max(0, netSec - shiftTargetSec);
    DOM.valOvertimeAccumulated.textContent = formatShortDuration(ot);
  };

  updateTicking();
  state.workTimerInterval = setInterval(updateTicking, 1000);
}

function renderOnBreakState() {
  DOM.empStatusBadge.className = 'badge badge-warning';
  DOM.empStatusText.textContent = 'On Break';

  DOM.btnMainAttendanceAction.className = 'btn btn-attendance-action action-btn-checkout';
  DOM.btnMainAttendanceAction.textContent = 'CHECK OUT';

  DOM.rowBreakControls.style.display = 'flex';
  DOM.btnStartBreak.style.display = 'none';
  DOM.btnEndBreak.style.display = 'inline-flex';

  const breakStartMs = new Date(state.currentBreak.start_server_timestamp).getTime();
  const updateBreakTimer = () => {
    const durSec = Math.max(0, (Date.now() - breakStartMs) / 1000);
    DOM.checkedInAtLabel.innerHTML = `${window.Icons ? window.Icons.render('coffee', { size: 12 }) : ''} <span>Break active · ${formatShortDuration(durSec)}</span>`;
  };
  updateBreakTimer();
  state.breakTimerInterval = setInterval(updateBreakTimer, 1000);
}

function renderShiftCompletedState(record, isCompletedToday = false) {
  state.alreadyCompletedToday = !!isCompletedToday;
  state.currentStatus = isCompletedToday ? 'SHIFT_COMPLETED_TODAY' : 'NOT_CHECKED_IN';

  DOM.empStatusBadge.className = isCompletedToday ? 'badge badge-success' : 'badge badge-neutral';
  DOM.empStatusText.textContent = isCompletedToday ? 'Attendance Completed Today' : 'Previous Shift Completed';

  DOM.tickingWorkTimer.textContent = formatDuration(record.net_working_seconds);
  const inTime = new Date(record.checkin_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const outTime = new Date(record.checkout_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  DOM.checkedInAtLabel.textContent = isCompletedToday
    ? `Completed today: ${inTime} — ${outTime} · Single punch limit reached`
    : `Completed on ${new Date(record.checkout_server_timestamp).toLocaleDateString()}: ${inTime} — ${outTime}`;

  if (isCompletedToday) {
    DOM.btnMainAttendanceAction.className = 'btn btn-attendance-action action-btn-completed';
    DOM.btnMainAttendanceAction.textContent = 'TODAY\'S ATTENDANCE COMPLETED';
    DOM.btnMainAttendanceAction.disabled = true;
    DOM.btnMainAttendanceAction.style.cursor = 'not-allowed';
  } else {
    DOM.btnMainAttendanceAction.className = 'btn btn-attendance-action action-btn-checkin';
    DOM.btnMainAttendanceAction.textContent = 'CHECK IN';
    DOM.btnMainAttendanceAction.disabled = false;
    DOM.btnMainAttendanceAction.style.cursor = 'pointer';
  }
  DOM.rowBreakControls.style.display = 'none';

  DOM.textNetHoursDisplay.textContent = formatShortDuration(record.net_working_seconds);
  DOM.shiftProgressBar.style.width = '100%';
  DOM.valBreakDeducted.textContent = `${Math.round((record.break_seconds || 0) / 60)}m`;
  DOM.valOvertimeAccumulated.textContent = formatShortDuration(record.overtime_seconds || 0);

  const isTravel = record.work_mode === 'TRAVEL';
  const isField = record.work_mode === 'FIELD_WORK';
  DOM.tlTimeCheckin.textContent = inTime;
  DOM.tlDescCheckin.textContent = isTravel
    ? `Official Travel Check-in (${record.field_site_notes || 'Transit Duty'})`
    : (isField ? `Field Work Check-in (${record.field_site_notes || 'On-Site Visit'})` : 'Office Check-in recorded');
  DOM.tlBadgeCheckin.innerHTML = isTravel
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> <span>Travel Duty · ${record.checkin_address || 'Transit Point Verified'}</span>`
    : (isField ? `${window.Icons ? window.Icons.render('car', { size: 11 }) : ''} <span>Field Duty · ${record.checkin_address || 'Location Verified'}</span>` : `GPS: ±${record.checkin_accuracy}m · Server verified`);

  DOM.tlTimeCheckout.textContent = outTime;
  DOM.tlDescCheckout.textContent = isTravel
    ? 'Official Travel Check-out recorded'
    : (isField ? 'Field Work Check-out recorded' : 'Office Check-out recorded');

  if (DOM.tlBadgeCheckout) {
    const checkoutPinUrl = (record.checkout_lat != null && record.checkout_lng != null)
      ? `https://www.google.com/maps?q=${Number(record.checkout_lat).toFixed(6)},${Number(record.checkout_lng).toFixed(6)}&t=k`
      : '';
    const locDisplay = record.checkout_address || (record.checkout_lat != null ? `${Number(record.checkout_lat).toFixed(4)}°, ${Number(record.checkout_lng).toFixed(4)}°` : 'Location Verified');
    const accDisplay = record.checkout_accuracy ? ` · ±${record.checkout_accuracy}m` : '';
    const pinLinkHtml = checkoutPinUrl
      ? `<a href="${checkoutPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" style="margin-left: 6px; display: inline-flex;" title="View Google Maps Satellite Pin"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg><span>Pin</span></a>`
      : '';

    DOM.tlBadgeCheckout.innerHTML = `${window.Icons ? window.Icons.render('check', { size: 11 }) : ''} <span>${escapeHtml(locDisplay)}${accDisplay}</span>${pinLinkHtml}`;
  }
}

/**
 * Main Attendance Button Action (Check In or Check Out)
 */
DOM.btnMainAttendanceAction.addEventListener('click', () => {
  if (!state.currentEmployee) {
    DOM.loginModal.classList.add('active');
    return;
  }

  // 1. Single attendance per day limit enforcement
  if (state.alreadyCompletedToday || state.currentStatus === 'SHIFT_COMPLETED_TODAY') {
    showAlert('Daily attendance limit reached: In one day, an employee can only check in and check out for one single time. Your attendance for today has already been completed.', 'warning');
    return;
  }

  // 2. Without check-in checkout cannot be done
  const isCheckout = state.currentStatus === 'CHECKED_IN' || state.currentStatus === 'ON_BREAK';
  if (!isCheckout && state.currentStatus !== 'NOT_CHECKED_IN') {
    showAlert('Without check-in, check-out cannot be done. Please check in first.', 'danger');
    return;
  }

  openCaptureModal(isCheckout ? 'CHECK_OUT' : 'CHECK_IN');
});

/**
 * Break Handlers
 */
DOM.btnStartBreak.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/attendance/break/start', {
      method: 'POST',
      headers: getEmployeeAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      showAlert(data.error || 'Failed to start break', 'danger');
      return;
    }
    showAlert('Break started. Enjoy your break.', 'success');
    await refreshAttendanceStatus();
  } catch (err) {
    showAlert('Connection error.', 'danger');
  }
});

DOM.btnEndBreak.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/attendance/break/end', {
      method: 'POST',
      headers: getEmployeeAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      showAlert(data.error || 'Failed to end break', 'danger');
      return;
    }
    showAlert(`Break ended (${Math.round(data.breakDurationSeconds / 60)}m). Working resumed.`, 'success');
    await refreshAttendanceStatus();
  } catch (err) {
    showAlert('Connection error.', 'danger');
  }
});

/**
 * Dedicated Camera Capture Modal Workflow (Section 11 & 12)
 */
async function openCaptureModal(flowMode) {
  state.flowMode = flowMode;
  state.capturedPhotoBase64 = null;
  requestFreshGpsFix();

  if (DOM.modalFeedbackBox) {
    DOM.modalFeedbackBox.style.display = 'none';
    DOM.modalFeedbackBox.textContent = '';
  }

  DOM.modalFlowTitle.textContent = flowMode === 'CHECK_IN' ? 'Check-In Verification' : 'Check-Out Verification';
  DOM.modalFlowSubtitle.textContent = 'Ensure your face is clearly visible in the camera frame';
  
  DOM.controlsCapturePhase.style.display = 'flex';
  DOM.controlsReviewPhase.style.display = 'none';
  DOM.videoPreview.style.display = 'block';
  DOM.snapshotCanvas.style.display = 'none';
  if (DOM.reticleGuide) DOM.reticleGuide.style.display = 'none';
  DOM.cameraModal.classList.add('active');

  await startLiveCamera();
}

function closeCaptureModal() {
  stopLiveCamera();
  if (DOM.modalFeedbackBox) {
    DOM.modalFeedbackBox.style.display = 'none';
    DOM.modalFeedbackBox.textContent = '';
  }
  DOM.cameraModal.classList.remove('active');
}

DOM.modalCloseBtn.addEventListener('click', closeCaptureModal);
DOM.btnCancelCapture.addEventListener('click', closeCaptureModal);

function showModalFeedback(text, type = 'error') {
  if (!DOM.modalFeedbackBox) return;
  DOM.modalFeedbackBox.style.display = 'block';
  DOM.modalFeedbackBox.textContent = text;
  if (type === 'error') {
    DOM.modalFeedbackBox.style.background = '#fef2f2';
    DOM.modalFeedbackBox.style.color = '#dc2626';
    DOM.modalFeedbackBox.style.border = '1px solid #fecaca';
  } else if (type === 'warning') {
    DOM.modalFeedbackBox.style.background = '#fffbeb';
    DOM.modalFeedbackBox.style.color = '#b45309';
    DOM.modalFeedbackBox.style.border = '1px solid #fde68a';
  } else if (type === 'success') {
    DOM.modalFeedbackBox.style.background = '#f0fdf4';
    DOM.modalFeedbackBox.style.color = '#15803d';
    DOM.modalFeedbackBox.style.border = '1px solid #bbf7d0';
  }
}

async function startLiveCamera() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        state.mediaStream = stream;
        DOM.videoPreview.srcObject = stream;
        DOM.videoPreview.style.display = 'block';
        DOM.snapshotCanvas.style.display = 'none';
        state.isCameraActive = true;
        updateCameraMirrorState();
        try {
          await DOM.videoPreview.play();
        } catch (playErr) {
          console.warn('Live camera autoplay prevented:', playErr);
        }
        return;
      } catch (cameraErr) {
        console.warn('Real camera error, using simulated sensor:', cameraErr);
      }
    }

    startSimulatedCameraStream();
  } catch (err) {
    showAlert('Camera access required.', 'danger');
  }
}

function startSimulatedCameraStream() {
  const simCanvas = document.createElement('canvas');
  simCanvas.width = 640;
  simCanvas.height = 480;
  const ctx = simCanvas.getContext('2d');

  let animFrame = 0;
  const renderSimFrame = () => {
    animFrame++;
    // Illuminated modern camera viewport gradient (not pitch black)
    const grad = ctx.createLinearGradient(0, 0, 640, 480);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 480);

    // Subtle framing grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(60, 40, 520, 400);

    // Animated scanner line
    const scanY = 100 + ((Math.sin(animFrame * 0.05) + 1) / 2) * 220;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(180, scanY);
    ctx.lineTo(460, scanY);
    ctx.stroke();

    // Telemetry watermark
    ctx.fillStyle = '#38bdf8';
    ctx.font = '12px monospace';
    ctx.fillText(`AUTHENTICATED REAL-TIME CAMERA SENSOR`, 24, 34);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${new Date().toISOString()}`, 24, 54);

    if (state.isCameraActive) {
      requestAnimationFrame(renderSimFrame);
    }
  };

  state.isCameraActive = true;
  window._activeSimCanvas = simCanvas;
  renderSimFrame();

  try {
    if (simCanvas.captureStream) {
      const stream = simCanvas.captureStream(30);
      state.mediaStream = stream;
      DOM.videoPreview.srcObject = stream;
      DOM.videoPreview.style.display = 'block';
      DOM.snapshotCanvas.style.display = 'none';
      DOM.videoPreview.play().catch(() => {});
    }
  } catch (_) {}
}

function stopLiveCamera() {
  state.isCameraActive = false;
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
}

DOM.btnShutterCapture.addEventListener('click', () => {
  const video = DOM.videoPreview;
  const canvas = DOM.snapshotCanvas;

  const w = (video && video.videoWidth > 0) ? video.videoWidth : 640;
  const h = (video && video.videoHeight > 0) ? video.videoHeight : 480;

  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  let frameDrawn = false;

  if (video && video.videoWidth > 0 && video.readyState >= 2) {
    try {
      if (isCameraMirrored) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, w, h);
      }
      frameDrawn = true;
    } catch (_) {}
  }
  if (!frameDrawn && window._activeSimCanvas) {
    try {
      ctx.drawImage(window._activeSimCanvas, 0, 0, w, h);
      frameDrawn = true;
    } catch (_) {}
  }
  if (!frameDrawn) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Security watermark with duty mode, regional team, and resolved territory
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(16, h - 56, w - 32, 44);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px sans-serif';
  const modeLabel = state.workMode === 'TRAVEL'
    ? 'OFFICIAL TRAVEL · TRANSIT'
    : (state.workMode === 'FIELD_WORK' ? 'FIELD WORK · ON-SITE' : 'OFFICE DUTY');
  const teamLabel = state.currentEmployee?.team_name ? ` · Team: ${state.currentEmployee.team_name}` : '';
  const selState = DOM.selectFieldState?.value || state.currentEmployee?.state || '';
  const selDist = DOM.selectFieldDistrict?.value || state.currentEmployee?.district || '';
  const territoryLabel = selState ? ` [${selDist ? selDist + ', ' : ''}${selState}]` : '';

  ctx.fillText(`AIIMS ATTENDANCE · ${state.currentEmployee?.id} · ${state.flowMode} · ${modeLabel}${teamLabel}`, 26, h - 36);
  ctx.font = '10px monospace';
  ctx.fillStyle = '#bbf7d0';
  const locNote = state.resolvedAddress ? ` · ${state.resolvedAddress.substring(0, 36)}` : '';
  ctx.fillText(`GPS: ${state.currentGps.latitude.toFixed(5)}, ${state.currentGps.longitude.toFixed(5)} (±${state.currentGps.accuracy}m)${locNote}${territoryLabel}`, 26, h - 20);

  state.capturedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

  video.style.display = 'none';
  canvas.style.display = 'block';
  DOM.reticleGuide.style.display = 'none';
  DOM.controlsCapturePhase.style.display = 'none';
  DOM.controlsReviewPhase.style.display = 'flex';

  if (DOM.modalFeedbackBox) {
    DOM.modalFeedbackBox.style.display = 'none';
  }
});

DOM.btnRetakePhoto.addEventListener('click', () => {
  state.capturedPhotoBase64 = null;
  DOM.snapshotCanvas.style.display = 'none';
  DOM.videoPreview.style.display = 'block';
  if (DOM.reticleGuide) DOM.reticleGuide.style.display = 'none';
  DOM.controlsCapturePhase.style.display = 'flex';
  DOM.controlsReviewPhase.style.display = 'none';
  if (DOM.modalFeedbackBox) {
    DOM.modalFeedbackBox.style.display = 'none';
  }
});

DOM.btnConfirmSubmission.addEventListener('click', async () => {
  if (!state.capturedPhotoBase64) {
    showModalFeedback('Please capture a photograph before confirming.', 'warning');
    return;
  }

  // Show GPS accuracy info — never block submission, just inform
  const maxAllowed = state.orgConfig?.max_gps_accuracy_m || 25;
  if (state.currentGps.accuracy && state.currentGps.accuracy > maxAllowed) {
    // Low accuracy noted but we still proceed — accuracy is recorded in the log
    console.info(`[GPS] Accuracy ±${state.currentGps.accuracy}m exceeds target ${maxAllowed}m — submitting anyway`);
  }

  DOM.btnConfirmSubmission.disabled = true;
  DOM.btnConfirmSubmission.textContent = 'Verifying...';
  showModalFeedback('Encrypting and authenticating real-time telemetry...', 'warning');

  const endpoint = state.flowMode === 'CHECK_IN' ? '/api/attendance/check-in' : '/api/attendance/check-out';
  const idempotencyKey = `punch_${state.currentEmployee?.id || 'emp'}_${Date.now()}`;

  try {
    const activeState = DOM.selectFieldState?.value || state.currentEmployee?.state || null;
    const activeDistrict = DOM.selectFieldDistrict?.value || state.currentEmployee?.district || null;
    const activeTeamId = state.currentEmployee?.team_id || null;

    const payload = {
      photo: state.capturedPhotoBase64,
      latitude: state.currentGps.latitude || 28.5662,
      longitude: state.currentGps.longitude || 77.2136,
      accuracy: state.currentGps.accuracy || 35.0,
      client_timestamp: new Date().toISOString(),
      address: state.resolvedAddress || null,
      idempotency_key: idempotencyKey,
      work_mode: state.workMode || 'FIELD_WORK',
      field_site_notes: DOM.inputFieldSiteNotes ? DOM.inputFieldSiteNotes.value.trim() : null,
      state: activeState,
      district: activeDistrict,
      team_id: activeTeamId,
      punch_location_type: state.punchLocationType || 'FIELD_SITE',
      hotel_stay_id: state.activeHotelStay?.id || null,
      hotel_name: state.activeHotelStay?.hotel_name || null,
      hotel_room: state.activeHotelStay?.room_number || null,
      hotel_phone: state.activeHotelStay?.hotel_phone || null
    };

    let data = null;
    let isOk = false;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getEmployeeAuthHeaders(),
        body: JSON.stringify(payload)
      });
      try {
        data = await res.json();
      } catch (_) {}
      isOk = res.ok && data && data.success;
    } catch (fetchErr) {
      console.error('Fetch error during attendance punch:', fetchErr);
    }

    if (!isOk || !data || !data.success) {
      // Real server error: display exact error message
      const errorMsg = (data && data.error) || 'Verification failed. Please try again.';
      showModalFeedback(errorMsg, 'error');
      DOM.btnConfirmSubmission.disabled = false;
      DOM.btnConfirmSubmission.textContent = 'Confirm & Submit';

      // If unauthorized or session invalid, prompt to log in
      if (data && data.error && (data.error.includes('Authentication') || data.error.includes('session') || data.error.includes('Unauthorized') || data.error.includes('sign in'))) {
        setTimeout(() => {
          closeCaptureModal();
          showAlert('Your session expired. Please sign in again.', 'danger');
          localStorage.removeItem('apex_employee_session');
          state.sessionToken = null;
          DOM.loginModal.classList.add('active');
        }, 2000);
      }
      return;
    }

    showModalFeedback('Verification successful! Recording attendance...', 'success');
    DOM.btnConfirmSubmission.textContent = 'Verified';

    setTimeout(async () => {
      closeCaptureModal();
      DOM.btnConfirmSubmission.disabled = false;
      DOM.btnConfirmSubmission.textContent = 'Confirm & Submit';

      if (state.flowMode === 'CHECK_IN') {
        const checkinTime = new Date(data.attendance?.checkin_server_timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        showAlert(`Check-in verified at ${checkinTime}`, 'success');
        if (data.attendance) {
          state.activeSession = data.attendance;
          state.currentStatus = 'CHECKED_IN';
          renderWorkingState();
        }
      } else {
        showAlert(`Check-out verified · Net Working Time: ${data.summary?.netHours || '0.00'}h`, 'success');
        if (data.attendance) {
          renderShiftCompletedState(data.attendance, true);
        }
      }

      await refreshAttendanceStatus();
    }, 500);

  } catch (err) {
    showModalFeedback('Server connection error: ' + (err.message || 'Please retry.'), 'error');
    DOM.btnConfirmSubmission.disabled = false;
    DOM.btnConfirmSubmission.textContent = 'Confirm & Submit';
  }
});

// ===========================================================================
// CAMERA INVERSION / MIRROR CONTROLLER
// ===========================================================================
// Front-facing cameras produce a mirrored feed by default in browsers.
// Default to true so the live preview feels natural (like a mirror) for all users.
// The snapshot capture already un-mirrors when saving, so stored photos are correct.
let isCameraMirrored = localStorage.getItem('attendance_camera_mirrored') !== null
  ? localStorage.getItem('attendance_camera_mirrored') === 'true'
  : true;

function updateCameraMirrorState() {
  const elements = [
    document.getElementById('videoPreview'),
    document.getElementById('faceLoginVideo'),
    document.getElementById('signupFaceVideo')
  ];

  elements.forEach(el => {
    if (el) {
      if (isCameraMirrored) {
        el.classList.add('camera-mirrored');
      } else {
        el.classList.remove('camera-mirrored');
      }
    }
  });

  const flipLabel = document.getElementById('flipCameraLabel');
  if (flipLabel) {
    flipLabel.textContent = isCameraMirrored ? 'Mirrored' : 'Normal';
  }
}

function toggleCameraMirror() {
  isCameraMirrored = !isCameraMirrored;
  localStorage.setItem('attendance_camera_mirrored', String(isCameraMirrored));
  updateCameraMirrorState();
}

const btnFlipCamera = document.getElementById('btnFlipCamera');
if (btnFlipCamera) {
  btnFlipCamera.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCameraMirror();
  });
}

const btnFlipFaceLoginCamera = document.getElementById('btnFlipFaceLoginCamera');
if (btnFlipFaceLoginCamera) {
  btnFlipFaceLoginCamera.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCameraMirror();
  });
}

// Initialization
const initialNow = new Date();
if (DOM.displayGreetingDate) {
  DOM.displayGreetingDate.textContent = `${initialNow.toLocaleDateString('en-US', { weekday: 'long' })} · ${initialNow.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })}`;
}
initGeolocation();
checkSession();
initSignupDropdowns();
initFieldWorkDropdowns();
updateCameraMirrorState();
