/**
 * Enterprise Session Inactivity Timeout & Multi-Tab Synchronization Manager
 *
 * Enforces a strict 30-minute inactivity timeout across AIIMS CDER Attendance App and EMS.
 * Rules:
 *  - 30-minute inactivity tracking based on user interaction (mouse, keyboard, scroll, touch).
 *  - Cross-tab synchronization via localStorage events (active interaction in one tab resets timer in all tabs).
 *  - Logout / expiry in one tab immediately triggers logout / expiry in all other tabs.
 *  - Verifies session with server on tab focus and visibility change.
 *  - In-app non-blocking modal display on expiration (Zero native alert/confirm dialogs).
 *  - Zero emojis in public UI.
 */
(function() {
  'use strict';

  const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const THROTTLE_INTERVAL_MS  = 10 * 1000;      // 10 seconds throttle for local storage updates

  const STORAGE_KEYS = {
    LAST_ACTIVE: 'attendance_session_last_active',
    LOGOUT_EVENT: 'attendance_session_logout_event',
    EXPIRED_MSG: 'attendance_session_expired_message'
  };

  let lastReportedTime = Date.now();
  let checkIntervalId  = null;
  let isExpiredState   = false;
  let currentConfig    = {
    appType: 'employee', // 'employee' | 'admin' | 'ems'
    onExpired: null
  };

  function getStoredSession() {
    if (currentConfig.appType === 'employee') {
      return localStorage.getItem('apex_employee_session');
    } else if (currentConfig.appType === 'admin') {
      return localStorage.getItem('apex_employer_admin_session');
    } else if (currentConfig.appType === 'ems') {
      return localStorage.getItem('ems_token');
    }
    return null;
  }

  function clearAllClientAuth() {
    localStorage.removeItem('apex_employee_session');
    localStorage.removeItem('apex_employer_admin_session');
    localStorage.removeItem('ems_token');
    localStorage.removeItem('ems_user');
  }

  function recordUserActivity() {
    if (isExpiredState) return;
    const now = Date.now();
    if (now - lastReportedTime > THROTTLE_INTERVAL_MS) {
      lastReportedTime = now;
      try {
        localStorage.setItem(STORAGE_KEYS.LAST_ACTIVE, String(now));
      } catch (_) {}
    }
  }

  function showInAppSessionExpiredModal(messageText) {
    if (document.getElementById('cder-session-expired-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'cder-session-expired-modal';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.75)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';
    overlay.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    const card = document.createElement('div');
    card.style.background = '#ffffff';
    card.style.borderRadius = '12px';
    card.style.padding = '32px';
    card.style.maxWidth = '440px';
    card.style.width = '90%';
    card.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
    card.style.textAlign = 'center';
    card.style.border = '1px solid #e2e8f0';

    const iconContainer = document.createElement('div');
    iconContainer.style.width = '56px';
    iconContainer.style.height = '56px';
    iconContainer.style.margin = '0 auto 16px';
    iconContainer.style.borderRadius = '50%';
    iconContainer.style.backgroundColor = '#fef2f2';
    iconContainer.style.display = 'flex';
    iconContainer.style.alignItems = 'center';
    iconContainer.style.justifyContent = 'center';
    iconContainer.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';

    const title = document.createElement('h3');
    title.textContent = 'Session Expired';
    title.style.margin = '0 0 8px';
    title.style.fontSize = '20px';
    title.style.fontWeight = '600';
    title.style.color = '#0f172a';

    const message = document.createElement('p');
    message.textContent = messageText || 'Your session expired due to inactivity. Please log in again.';
    message.style.margin = '0 0 24px';
    message.style.fontSize = '14px';
    message.style.lineHeight = '1.5';
    message.style.color = '#64748b';

    const actionBtn = document.createElement('button');
    actionBtn.textContent = 'Sign In Again';
    actionBtn.style.backgroundColor = '#1e40af';
    actionBtn.style.color = '#ffffff';
    actionBtn.style.border = 'none';
    actionBtn.style.borderRadius = '8px';
    actionBtn.style.padding = '10px 24px';
    actionBtn.style.fontSize = '14px';
    actionBtn.style.fontWeight = '500';
    actionBtn.style.cursor = 'pointer';
    actionBtn.style.width = '100%';
    actionBtn.style.transition = 'background-color 0.2s';
    actionBtn.onmouseover = function() { actionBtn.style.backgroundColor = '#1d4ed8'; };
    actionBtn.onmouseout = function() { actionBtn.style.backgroundColor = '#1e40af'; };

    actionBtn.onclick = function() {
      overlay.remove();
      if (typeof currentConfig.onExpired === 'function') {
        currentConfig.onExpired();
      } else {
        window.location.reload();
      }
    };

    card.appendChild(iconContainer);
    card.appendChild(title);
    card.appendChild(message);
    card.appendChild(actionBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  async function triggerSessionExpiration(reason = 'inactivity') {
    if (isExpiredState) return;
    isExpiredState = true;

    clearAllClientAuth();

    try {
      localStorage.setItem(STORAGE_KEYS.LOGOUT_EVENT, String(Date.now()));
    } catch (_) {}

    // Invalidate server session safely
    try {
      const logoutUrl = currentConfig.appType === 'ems' ? '/api/auth/logout' : '/api/auth/logout';
      fetch(logoutUrl, { method: 'POST', keepalive: true }).catch(function() {});
    } catch (_) {}

    const msg = reason === 'logout'
      ? 'You have logged out in another tab.'
      : 'Your session expired due to inactivity. Please log in again.';

    showInAppSessionExpiredModal(msg);
  }

  function checkInactivity() {
    if (!getStoredSession()) return;
    const lastActiveStr = localStorage.getItem(STORAGE_KEYS.LAST_ACTIVE);
    if (!lastActiveStr) return;

    const lastActive = parseInt(lastActiveStr, 10);
    if (isNaN(lastActive)) return;

    if (Date.now() - lastActive >= INACTIVITY_TIMEOUT_MS) {
      triggerSessionExpiration('inactivity');
    }
  }

  async function validateWithServer(isInteractive = false) {
    if (!getStoredSession() || isExpiredState) return;

    // Check client elapsed time first
    const lastActiveStr = localStorage.getItem(STORAGE_KEYS.LAST_ACTIVE);
    if (lastActiveStr) {
      const lastActive = parseInt(lastActiveStr, 10);
      if (!isNaN(lastActive) && (Date.now() - lastActive >= INACTIVITY_TIMEOUT_MS)) {
        triggerSessionExpiration('inactivity');
        return;
      }
    }

    // Call server with non-touch header so validation does not silently extend idle session
    let statusUrl = '/api/auth/session/status';
    let headers = {
      'X-Background-Request': 'true',
      'X-Session-Touch': 'false'
    };

    if (currentConfig.appType === 'ems') {
      statusUrl = '/api/auth/me';
      const emsToken = localStorage.getItem('ems_token');
      if (emsToken) headers['Authorization'] = 'Bearer ' + emsToken;
    } else if (currentConfig.appType === 'admin') {
      try {
        const adminSess = JSON.parse(localStorage.getItem('apex_employer_admin_session') || '{}');
        if (adminSess.token) headers['Authorization'] = 'Bearer ' + adminSess.token;
      } catch (_) {}
    } else {
      try {
        const empSess = JSON.parse(localStorage.getItem('apex_employee_session') || '{}');
        if (empSess.token) headers['Authorization'] = 'Bearer ' + empSess.token;
      } catch (_) {}
    }

    try {
      const res = await fetch(statusUrl, { method: 'GET', headers: headers });
      if (res.status === 401) {
        triggerSessionExpiration('inactivity');
      }
    } catch (_) {
      // Network hiccup; checkInactivity handles hard client clock expiry
    }
  }

  function setupEventListeners() {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(function(evt) {
      window.addEventListener(evt, recordUserActivity, { passive: true });
    });

    // Cross-tab synchronization
    window.addEventListener('storage', function(e) {
      if (e.key === STORAGE_KEYS.LOGOUT_EVENT) {
        triggerSessionExpiration('logout');
      } else if (e.key === STORAGE_KEYS.LAST_ACTIVE) {
        const newTime = parseInt(e.newValue, 10);
        if (!isNaN(newTime)) {
          lastReportedTime = newTime;
        }
      }
    });

    // Tab visibility & focus re-validation
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        validateWithServer(false);
      }
    });

    window.addEventListener('focus', function() {
      validateWithServer(false);
    });

    // Interval check every 5 seconds
    if (checkIntervalId) clearInterval(checkIntervalId);
    checkIntervalId = setInterval(checkInactivity, 5000);
  }

  window.SessionTimeoutManager = {
    init: function(config) {
      currentConfig = Object.assign(currentConfig, config || {});
      isExpiredState = false;
      const now = Date.now();
      lastReportedTime = now;
      if (!localStorage.getItem(STORAGE_KEYS.LAST_ACTIVE)) {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_ACTIVE, String(now));
        } catch (_) {}
      }
      setupEventListeners();
    },
    resetTimer: function() {
      const now = Date.now();
      lastReportedTime = now;
      try {
        localStorage.setItem(STORAGE_KEYS.LAST_ACTIVE, String(now));
      } catch (_) {}
    },
    expireNow: function(reason) {
      triggerSessionExpiration(reason || 'inactivity');
    },
    showExpiredModal: showInAppSessionExpiredModal
  };
})();
