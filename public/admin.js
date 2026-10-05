/**
 * Apex Attendance System - Admin Operations & Timeline Controller
 * Enterprise UX, Editorial Dashboard & Slide-Out Attendance Drawer
 */

let drawerMapInstance = null;
let currentEmployerSession = null;
let cachedAttendanceRecords = [];
let cachedTeams = [];

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  initAuth();
  initDrawer();
  initTerritoryAndTeamControls();

  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);
  document.getElementById('btnRefreshDashboard').addEventListener('click', () => {
    loadDashboardData();
    loadMultiStateMatrix();
  });
  const btnMatrixRefresh = document.getElementById('btnRefreshMatrix');
  if (btnMatrixRefresh) btnMatrixRefresh.addEventListener('click', loadMultiStateMatrix);

  document.getElementById('btnRefreshAudit').addEventListener('click', loadAuditLogs);
  document.getElementById('adminLoginForm').addEventListener('submit', handleAdminLogin);
  document.getElementById('btnAdminLogout').addEventListener('click', handleAdminLogout);
  document.getElementById('attendanceFilterSearch').addEventListener('input', applyAttendanceFilters);
  document.getElementById('attendanceFilterStatus').addEventListener('change', applyAttendanceFilters);
  const modeFilterElem = document.getElementById('attendanceFilterMode');
  if (modeFilterElem) modeFilterElem.addEventListener('change', applyAttendanceFilters);
  const teamFilterElem = document.getElementById('attendanceFilterTeam');
  if (teamFilterElem) teamFilterElem.addEventListener('change', applyAttendanceFilters);
  const btnExportCsv = document.getElementById('btnExportAttendanceCsv');
  if (btnExportCsv) btnExportCsv.addEventListener('click', handleExportAttendanceCsv);
  const btnEmailBackup = document.getElementById('btnEmailAttendanceBackup');
  if (btnEmailBackup) btnEmailBackup.addEventListener('click', handleEmailAttendanceBackup);
  const btnOpenHolidays = document.getElementById('btnOpenHolidaysModal');
  if (btnOpenHolidays) btnOpenHolidays.addEventListener('click', openHolidaysModal);
  const btnOpenHotelStays = document.getElementById('btnOpenHotelStaysModal');
  if (btnOpenHotelStays) btnOpenHotelStays.addEventListener('click', openHotelStaysModal);
  initLeavesControls();
});

/**
 * Sidebar View Navigation
 */
function initSidebarNav() {
  const navLinks = document.querySelectorAll('.nav-link[data-view]');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const targetView = link.getAttribute('data-view');
      switchView(targetView);
    });
  });
}

function switchView(viewId, targetParam) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-link[data-view="${viewId}"]`);
  if (activeLink) activeLink.classList.add('active');

  const panels = document.querySelectorAll('.admin-view-panel');
  panels.forEach(p => { p.style.display = 'none'; });

  const targetPanel = document.getElementById(viewId);
  if (targetPanel) targetPanel.style.display = 'block';

  // Update Header Breadcrumb
  const titleMap = {
    viewDashboard: { title: 'Dashboard', breadcrumb: 'Real-time Overview' },
    viewTeams: { title: 'Teams & Districts', breadcrumb: 'Territorial Divisions & Workforce Rosters' },
    viewEmployees: { title: 'Employees', breadcrumb: 'Directory & Management' },
    viewAttendance: { title: 'Attendance', breadcrumb: 'Verified Records & History' },
    viewTimesheets: { title: 'Cumulative Timesheets', breadcrumb: 'Individual Performance & Hours Breakdown' },
    viewLeave: { title: 'Leave', breadcrumb: 'Requests & Balance' },
    viewHotelStays: { title: 'Hotel Stays', breadcrumb: 'Field Worker Lodging & Safety Directory' },
    viewReports: { title: 'Reports', breadcrumb: 'Analytics & Payroll Export' },
    viewSettings: { title: 'Organization & Geofence', breadcrumb: 'Policy Configuration' },
    viewAudit: { title: 'Security Audit Logs', breadcrumb: 'Immutable Audit Trail' },
    viewRedcap: { title: 'REDCap Gateway', breadcrumb: 'Electronic Data Capture Sync' }
  };

  const meta = titleMap[viewId] || { title: 'Admin', breadcrumb: 'Operations' };
  document.getElementById('topPageTitle').textContent = meta.title;
  document.getElementById('topBreadcrumb').textContent = meta.breadcrumb;

  if (viewId === 'viewDashboard') {
    loadDashboardData();
    loadMultiStateMatrix();
  }
  if (viewId === 'viewTeams') loadTeamsView();
  if (viewId === 'viewEmployees') loadEmployees();
  if (viewId === 'viewAttendance') loadAttendanceRecords();
  if (viewId === 'viewTimesheets') loadTimesheetsView(targetParam);
  if (viewId === 'viewLeave') loadLeavesView();
  if (viewId === 'viewHotelStays') loadHotelStaysPageView();
  if (viewId === 'viewAudit') loadAuditLogs();
  if (viewId === 'viewRedcap') loadRedcapData();
}

window.switchView = switchView;

function handleHashRoute() {
  const rawHash = (window.location.hash || '').replace('#', '').trim();
  if (rawHash.toLowerCase().startsWith('timesheet/') || rawHash.toLowerCase().startsWith('timesheets/')) {
    const parts = rawHash.split('/');
    if (parts[1]) {
      openPersonTimesheet(parts[1]);
      return;
    }
  }

  const hash = rawHash.toLowerCase();
  const hashMap = {
    dashboard: 'viewDashboard',
    teams: 'viewTeams',
    employees: 'viewEmployees',
    attendance: 'viewAttendance',
    timesheets: 'viewTimesheets',
    timesheet: 'viewTimesheets',
    leave: 'viewLeave',
    hotels: 'viewHotelStays',
    hotel: 'viewHotelStays',
    hotelstays: 'viewHotelStays',
    reports: 'viewReports',
    settings: 'viewSettings',
    audit: 'viewAudit',
    redcap: 'viewRedcap'
  };
  if (hashMap[hash]) {
    switchView(hashMap[hash]);
  }
}

window.addEventListener('hashchange', handleHashRoute);

/**
 * Authentication Setup
 */
function initAuth() {
  const now = new Date();
  const dateEl = document.getElementById('greetingDate');
  if (dateEl) {
    dateEl.textContent = `${now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · AIIMS Operations Active`;
  }

  const saved = localStorage.getItem('apex_employer_admin_session');
  if (saved) {
    try {
      currentEmployerSession = JSON.parse(saved);
      setupLoggedInAdmin(currentEmployerSession);
      return;
    } catch (e) {}
  }
  showAdminLoginModal();
}

function showAdminLoginModal(msg) {
  const modal = document.getElementById('adminLoginModal');
  if (modal) modal.classList.add('active');
  const err = document.getElementById('adminLoginError');
  if (err) {
    if (msg) {
      err.textContent = msg;
      err.style.display = 'block';
    } else {
      err.style.display = 'none';
    }
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const errorEl = document.getElementById('adminLoginError');
  errorEl.style.display = 'none';

  const orgSelect = document.getElementById('loginAdminEmployer');
  const payload = {
    employer_id: (orgSelect ? orgSelect.value : '').trim() || 'ORG-001',
    admin_username: document.getElementById('loginAdminUsername').value.trim(),
    admin_password: document.getElementById('loginAdminPassword').value
  };

  try {
    const res = await fetch('/api/auth/employer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await res.json();
    } catch (_parseErr) {
      data = { success: false, error: `Server error (${res.status}): Please check backend service.` };
    }

    if (!data.success) {
      errorEl.textContent = data.error || 'Authentication failed.';
      errorEl.style.display = 'block';
      return;
    }

    currentEmployerSession = {
      token: data.token || (data.admin_session && data.admin_session.token),
      employer: data.employer,
      admin_username: data.admin_session.admin_username,
      employer_id: data.employer.id
    };

    localStorage.setItem('apex_employer_admin_session', JSON.stringify(currentEmployerSession));
    document.getElementById('adminLoginModal').classList.remove('active');
    setupLoggedInAdmin(currentEmployerSession);

  } catch (err) {
    errorEl.textContent = `Connection error: ${err.message || 'Unable to reach backend server.'}`;
    errorEl.style.display = 'block';
  }
}

async function handleAdminLogout() {
  if (currentEmployerSession) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ employer_id: currentEmployerSession.employer_id })
      });
    } catch (e) {}
  }

  localStorage.removeItem('apex_employer_admin_session');
  currentEmployerSession = null;
  showAdminLoginModal();
}

function setupLoggedInAdmin(session) {
  document.getElementById('sidebarOrgName').textContent = session.employer.name;
  document.getElementById('headerOrgName').textContent = `${session.employer.name} (${session.employer.id})`;
  document.getElementById('sidebarAdminUser').textContent = session.admin_username;
  document.getElementById('sidebarAdminInitial').textContent = session.admin_username.charAt(0).toUpperCase();

  const now = new Date();
  document.getElementById('greetingHeadline').textContent = `Good ${getTimeOfDay()}, ${session.admin_username}`;
  document.getElementById('greetingDate').textContent = `${now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${session.employer.office_name}`;

  loadDashboardData();
  loadSettings();
  if (window.location.hash) {
    handleHashRoute();
  } else {
    switchView('viewDashboard');
  }
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (currentEmployerSession) {
    headers['x-employer-id'] = currentEmployerSession.employer_id;
    if (currentEmployerSession.token) {
      headers['Authorization'] = `Bearer ${currentEmployerSession.token}`;
      headers['x-session-token'] = currentEmployerSession.token;
    }
  }
  return headers;
}

/**
 * Authenticated API Fetch Wrapper
 * Intercepts 401 Unauthorized responses, clears stale sessions and displays the sign-in modal
 */
async function adminFetch(url, options = {}) {
  const headers = Object.assign({}, getAuthHeaders(), options.headers || {});
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    console.warn('[AUTH] Admin session invalid or expired on backend. Requiring sign-in.');
    localStorage.removeItem('apex_employer_admin_session');
    currentEmployerSession = null;
    showAdminLoginModal('Session expired. Please sign in with your administrator credentials.');
    throw new Error('401 Unauthorized');
  }
  return res;
}
const authFetch = adminFetch;

/**
 * Load Dashboard Editorial Data
 */
async function loadDashboardData() {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/admin/attendance?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success) return;

    cachedAttendanceRecords = data.records || [];
    renderDashboardMetrics(cachedAttendanceRecords);
    renderCurrentlyWorkingTable(cachedAttendanceRecords);
    renderActivityFeed(cachedAttendanceRecords);
  } catch (err) {
    console.error('Error loading dashboard data:', err);
  }
}

function renderDashboardMetrics(records) {
  const presentCount = records.length;
  const workingCount = records.filter(r => r.attendance_status === 'CHECKED_IN').length;
  const breakCount = records.filter(r => r.attendance_status === 'ON_BREAK').length;
  const completedCount = records.filter(r => r.attendance_status === 'COMPLETED').length;

  document.getElementById('dashMetricPresent').textContent = String(presentCount).padStart(2, '0');
  document.getElementById('dashMetricWorking').textContent = String(workingCount).padStart(2, '0');
  document.getElementById('dashMetricBreak').textContent = String(breakCount).padStart(2, '0');
  document.getElementById('dashMetricCompleted').textContent = String(completedCount).padStart(2, '0');
}

function renderCurrentlyWorkingTable(records) {
  const tbody = document.getElementById('bodyCurrentlyWorking');
  const workingRecords = records.filter(r => r.attendance_status === 'CHECKED_IN' || r.attendance_status === 'ON_BREAK');

  if (workingRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 28px;">
          No employees currently active on the clock.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = workingRecords.map(r => {
    const checkinTime = new Date(r.checkin_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const elapsedSec = Math.max(0, Math.round((Date.now() - new Date(r.checkin_server_timestamp).getTime()) / 1000) - (r.break_seconds || 0));
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const durationStr = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;

    const statusBadge = r.attendance_status === 'CHECKED_IN'
      ? '<span class="badge badge-success"><span class="badge-dot"></span>Working</span>'
      : '<span class="badge badge-warning"><span class="badge-dot"></span>On Break</span>';

    return `
      <tr onclick="openAttendanceDrawer('${r.id}')">
        <td>
          <div class="table-user-cell">
            <div class="user-avatar">${r.employee_name.charAt(0)}</div>
            <div>
              <div style="font-weight: 600;">${r.employee_name}</div>
              <div style="font-size: 11px; color: var(--color-text-muted);">${r.employee_id}</div>
            </div>
          </div>
        </td>
        <td style="color: var(--color-text-secondary);">${r.department}</td>
        <td style="font-family: var(--font-mono); font-weight: 500;">${checkinTime}</td>
        <td style="font-family: var(--font-mono); font-weight: 600; color: var(--color-primary);">${durationStr}</td>
        <td>
          ${r.work_mode === 'TRAVEL' ? `
            <span class="badge" style="background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              <span>Official Travel</span>
            </span>
          ` : (r.work_mode === 'FIELD_WORK' ? `
            <span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
              ${window.Icons ? window.Icons.render('car', { size: 11 }) : ''}
              <span>Field Work</span>
            </span>
          ` : `
            <span class="badge ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'badge-neutral' : 'badge-warning'}" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
              ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' 
                ? `${window.Icons ? window.Icons.render('building', { size: 11 }) : ''} <span>In Office</span>` 
                : `${window.Icons ? window.Icons.render('alertTriangle', { size: 11 }) : ''} <span>${Math.round(r.checkin_geofence_distance || 0)}m</span>`}
            </span>
          `)}
        </td>
      </tr>
    `;
  }).join('');
}

function renderActivityFeed(records) {
  const feed = document.getElementById('feedActivityList');
  if (records.length === 0) {
    feed.innerHTML = '<li style="color: var(--color-text-muted); font-size: 13px; padding: 12px 0;">No attendance events recorded today.</li>';
    return;
  }

  feed.innerHTML = records.slice(0, 6).map(r => {
    const time = new Date(r.checkin_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isCompleted = Boolean(r.checkout_server_timestamp);
    const isTravel = r.work_mode === 'TRAVEL';
    const isField = r.work_mode === 'FIELD_WORK';

    const dutyText = isCompleted
      ? (isTravel ? 'completed transit duty' : 'completed shift')
      : (isTravel
        ? `checked in on Official Travel (${r.field_site_notes || 'Transit Duty'})`
        : (isField ? `checked in on Field Work (${r.field_site_notes || 'On-Site'})` : 'checked in at Office'));

    const dutySub = isTravel
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Travel Duty · ${r.checkin_address || 'Transit Point Verified'}`
      : (isField
        ? `${window.Icons ? window.Icons.render('car', { size: 11 }) : ''} Field Duty · ${r.checkin_address || 'Verified'}`
        : (r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'Verified In Geofence' : 'Outside Geofence Flagged'));

    return `
      <li class="activity-feed-item" onclick="openAttendanceDrawer('${r.id}')" style="cursor: pointer;">
        <span class="activity-time">${time}</span>
        <span class="activity-dot ${isCompleted ? 'dot-checkout' : 'dot-checkin'}"></span>
        <div class="activity-content">
          <strong>${r.employee_name}</strong> ${dutyText}
          <div class="activity-sub">GPS: ±${r.checkin_accuracy}m · ${dutySub}</div>
        </div>
      </li>
    `;
  }).join('');
}

/**
 * Load Full Attendance Records Table
 */
async function loadAttendanceRecords() {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/admin/attendance?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success) return;

    cachedAttendanceRecords = data.records || [];
    applyAttendanceFilters();
  } catch (err) {
    console.error('Error loading attendance records:', err);
  }
}

function applyAttendanceFilters() {
  const searchTerm = (document.getElementById('attendanceFilterSearch').value || '').toLowerCase();
  const statusFilter = document.getElementById('attendanceFilterStatus').value;
  const modeFilterElem = document.getElementById('attendanceFilterMode');
  const modeFilter = modeFilterElem ? modeFilterElem.value : 'ALL';
  const stateFilter = (document.getElementById('attendanceFilterState') || {}).value || 'ALL';
  const distFilter = (document.getElementById('attendanceFilterDistrict') || {}).value || 'ALL';
  const teamFilter = (document.getElementById('attendanceFilterTeam') || {}).value || 'ALL';

  const filtered = cachedAttendanceRecords.filter(r => {
    const matchSearch = r.employee_name.toLowerCase().includes(searchTerm) || 
                        r.department.toLowerCase().includes(searchTerm) ||
                        r.employee_id.toLowerCase().includes(searchTerm) ||
                        (r.team_name && r.team_name.toLowerCase().includes(searchTerm)) ||
                        (r.district && r.district.toLowerCase().includes(searchTerm)) ||
                        (r.state && r.state.toLowerCase().includes(searchTerm)) ||
                        (r.field_site_notes && r.field_site_notes.toLowerCase().includes(searchTerm)) ||
                        (r.checkin_address && r.checkin_address.toLowerCase().includes(searchTerm));
    const matchStatus = statusFilter === 'ALL' || r.attendance_status === statusFilter;
    const matchMode = modeFilter === 'ALL' || (r.work_mode || 'OFFICE') === modeFilter;
    const matchState = stateFilter === 'ALL' || r.state === stateFilter;
    const matchDistrict = distFilter === 'ALL' || r.district === distFilter;
    const matchTeam = teamFilter === 'ALL' || r.team_id === teamFilter || (r.team_name && r.team_name === teamFilter);

    return matchSearch && matchStatus && matchMode && matchState && matchDistrict && matchTeam;
  });

  document.getElementById('attendanceCountLabel').textContent = `Showing ${filtered.length} of ${cachedAttendanceRecords.length} records`;
  renderAttendanceMainTable(filtered);
}

/**
 * Export Attendance Sheet to Excel-compatible CSV format
 */
async function handleExportAttendanceCsv() {
  const btnExport = document.getElementById('btnExportAttendanceCsv');
  if (!btnExport) return;

  const originalContent = btnExport.innerHTML;
  btnExport.disabled = true;
  btnExport.innerHTML = `${window.Icons ? window.Icons.render('loader', { size: 14 }) : ''} <span>Exporting...</span>`;

  try {
    const searchTerm = (document.getElementById('attendanceFilterSearch')?.value || '').trim();
    const status = document.getElementById('attendanceFilterStatus')?.value || 'ALL';
    const mode = document.getElementById('attendanceFilterMode')?.value || 'ALL';
    const state = (document.getElementById('attendanceFilterState')?.value || 'ALL');
    const district = (document.getElementById('attendanceFilterDistrict')?.value || 'ALL');
    const team = (document.getElementById('attendanceFilterTeam')?.value || 'ALL');

    const params = new URLSearchParams();
    if (searchTerm) params.set('search', searchTerm);
    if (status !== 'ALL') params.set('status', status);
    if (mode !== 'ALL') params.set('work_mode', mode);
    if (state !== 'ALL') params.set('state', state);
    if (district !== 'ALL') params.set('district', district);
    if (team !== 'ALL') params.set('team_id', team);

    const res = await adminFetch(`/api/admin/attendance/export.csv?${params.toString()}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Export request failed');
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;

    const contentDisposition = res.headers.get('Content-Disposition');
    let filename = 'aiims_attendance_export.csv';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);

  } catch (err) {
    console.error('Export CSV error:', err);
    alert('Failed to export CSV: ' + err.message);
  } finally {
    btnExport.disabled = false;
    btnExport.innerHTML = originalContent;
  }
}

/**
 * Email Complete Attendance Backup CSV
 */
async function handleEmailAttendanceBackup() {
  const btnEmail = document.getElementById('btnEmailAttendanceBackup');
  if (!btnEmail) return;

  const targetEmail = window.prompt(
    'Enter recipient email address for attendance backup CSV:\n(Default recipient: vanicder01@gmail.com)',
    'vanicder01@gmail.com'
  );
  if (targetEmail === null) return; // Cancelled

  const originalContent = btnEmail.innerHTML;
  btnEmail.disabled = true;
  btnEmail.innerHTML = `${window.Icons ? window.Icons.render('loader', { size: 14 }) : ''} <span>Sending Email...</span>`;

  try {
    const payload = {};
    if (targetEmail && targetEmail.trim()) {
      payload.recipient_email = targetEmail.trim();
    }

    const res = await adminFetch('/api/admin/attendance/send-backup-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to dispatch backup email');
    }

    alert(`Attendance backup CSV (${data.recordCount} records) has been emailed to ${data.recipient}.`);
  } catch (err) {
    console.error('Email backup error:', err);
    alert(`Could not send backup email: ${err.message}\n\nPlease check that SMTP_USER and SMTP_PASS (Gmail App Password) are set in your environment variables.`);
  } finally {
    btnEmail.disabled = false;
    btnEmail.innerHTML = originalContent;
  }
}

/**
 * Working Hours Color Coding & Category Calculator
 * - 8 or more hours: GREEN
 * - Between 6 and 8 hours: YELLOW
 * - Less than 6 hours: RED
 * - In Progress: BLUE
 */
function computeWorkingHoursMeta(r) {
  const isCheckedOut = Boolean(r.checkout_server_timestamp) || r.attendance_status === 'COMPLETED';
  if (!isCheckedOut) {
    return {
      hours: null,
      hoursStr: 'In Progress',
      badgeHtml: '<span class="badge-hours-progress">In Progress</span>',
      rowClass: 'att-row-progress',
      category: 'IN_PROGRESS',
      variance: null,
      variancePill: ''
    };
  }

  const sec = Number(r.net_working_seconds) || 0;
  const hrs = sec / 3600;
  const formatted = `${hrs.toFixed(2)}h`;
  const variance = Number((hrs - 8.0).toFixed(2));
  let variancePill = '';
  if (variance > 0.05) {
    variancePill = `<span class="variance-pill-pos" title="+${variance.toFixed(2)}h above standard 8.0h shift target">+${variance.toFixed(1)}h</span>`;
  } else if (variance < -0.05) {
    variancePill = `<span class="variance-pill-neg" title="${variance.toFixed(2)}h below standard 8.0h shift target">${variance.toFixed(1)}h</span>`;
  } else {
    variancePill = `<span class="variance-pill-pos" style="background: #f1f5f9; color: #475569; border-color: #cbd5e1;" title="Standard 8.0h target met">&plusmn;0.0h</span>`;
  }

  if (hrs >= 8) {
    // 8 or more hours: GREEN
    return {
      hours: hrs,
      hoursStr: formatted,
      badgeHtml: `<span class="badge-hours-green" title="Full Shift: ${formatted} (&ge; 8 hrs)">${formatted}</span>`,
      rowClass: 'att-row-green',
      category: 'GREEN',
      variance,
      variancePill
    };
  } else if (hrs >= 6) {
    // between 6 and 8 hours: YELLOW
    return {
      hours: hrs,
      hoursStr: formatted,
      badgeHtml: `<span class="badge-hours-yellow" title="Partial Shift: ${formatted} (6-8 hrs)">${formatted}</span>`,
      rowClass: 'att-row-yellow',
      category: 'YELLOW',
      variance,
      variancePill
    };
  } else {
    // less than 6 hours: RED
    return {
      hours: hrs,
      hoursStr: formatted,
      badgeHtml: `<span class="badge-hours-red" title="Short / Under Hours: ${formatted} (&lt; 6 hrs)">${formatted}</span>`,
      rowClass: 'att-row-red',
      category: 'RED',
      variance,
      variancePill
    };
  }
}

let attendanceViewMode = 'DAILY';
let viewModeToggleInitialized = false;
let currentAttendanceDateWindow = 'RECENT_WEEK'; // 'RECENT_WEEK' | 'TODAY' | 'ALL' | 'SPECIFIC_DATE'
let selectedHistoricalDate = null;

function initAttendanceViewModeToggle() {
  if (viewModeToggleInitialized) return;
  const btnDaily = document.getElementById('btnViewModeDaily');
  const btnUnified = document.getElementById('btnViewModeUnified');
  if (!btnDaily || !btnUnified) return;
  viewModeToggleInitialized = true;

  btnDaily.onclick = () => {
    attendanceViewMode = 'DAILY';
    btnDaily.style.background = '#fff';
    btnDaily.style.color = 'var(--color-text-primary)';
    btnDaily.style.fontWeight = '600';
    btnDaily.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';

    btnUnified.style.background = 'transparent';
    btnUnified.style.color = 'var(--color-text-secondary)';
    btnUnified.style.fontWeight = '500';
    btnUnified.style.boxShadow = 'none';

    const dailyWrap = document.getElementById('attendanceDailyTablesWrap');
    const unifiedWrap = document.getElementById('attendanceUnifiedTableWrap');
    if (dailyWrap) dailyWrap.style.display = 'block';
    if (unifiedWrap) unifiedWrap.style.display = 'none';
  };

  btnUnified.onclick = () => {
    attendanceViewMode = 'UNIFIED';
    btnUnified.style.background = '#fff';
    btnUnified.style.color = 'var(--color-text-primary)';
    btnUnified.style.fontWeight = '600';
    btnUnified.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';

    btnDaily.style.background = 'transparent';
    btnDaily.style.color = 'var(--color-text-secondary)';
    btnDaily.style.fontWeight = '500';
    btnDaily.style.boxShadow = 'none';

    const dailyWrap = document.getElementById('attendanceDailyTablesWrap');
    const unifiedWrap = document.getElementById('attendanceUnifiedTableWrap');
    if (dailyWrap) dailyWrap.style.display = 'none';
    if (unifiedWrap) unifiedWrap.style.display = 'block';
  };
}

function setAttendanceDateWindow(mode) {
  currentAttendanceDateWindow = mode;
  selectedHistoricalDate = null;

  document.querySelectorAll('.date-window-btn').forEach(btn => btn.classList.remove('active'));
  if (mode === 'RECENT_WEEK') document.getElementById('btnDateFilterRecentWeek')?.classList.add('active');
  else if (mode === 'TODAY') document.getElementById('btnDateFilterToday')?.classList.add('active');
  else if (mode === 'ALL') document.getElementById('btnDateFilterAll')?.classList.add('active');

  const olderSelect = document.getElementById('selectOlderDate');
  if (olderSelect) olderSelect.value = '';

  if (typeof cachedAttendanceRecords !== 'undefined' && cachedAttendanceRecords.length > 0) {
    applyAttendanceFilters();
  }
}

function handleSelectOlderDate(dateVal) {
  if (!dateVal) {
    setAttendanceDateWindow('RECENT_WEEK');
    return;
  }
  currentAttendanceDateWindow = 'SPECIFIC_DATE';
  selectedHistoricalDate = dateVal;

  document.querySelectorAll('.date-window-btn').forEach(btn => btn.classList.remove('active'));

  if (typeof cachedAttendanceRecords !== 'undefined' && cachedAttendanceRecords.length > 0) {
    applyAttendanceFilters();
  }
}

window.setAttendanceDateWindow = setAttendanceDateWindow;
window.handleSelectOlderDate = handleSelectOlderDate;

/**
 * Render Day-by-Day Attendance Tables (Table 1: 16 Sept, Table 2: 17 Sept, etc.)
 */
function renderDailyAttendanceTables(records) {
  const container = document.getElementById('attendanceDailyTablesContainer');
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--color-text-muted); padding: 48px;">No matching attendance records found.</div>';
    return;
  }

  // 1. Group records by check-in date (YYYY-MM-DD)
  const dateMap = new Map();
  for (const r of records) {
    let dateStr = 'UNKNOWN';
    if (r.checkin_server_timestamp) {
      try {
        dateStr = new Date(r.checkin_server_timestamp).toISOString().split('T')[0];
      } catch (e) {
        dateStr = 'UNKNOWN';
      }
    }
    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, []);
    }
    dateMap.get(dateStr).push(r);
  }

  // 2. Sort dates in descending order (most recent date first)
  const allDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a));

  // 3. Define Recent Week window (last 7 active dates / past 7 days)
  const todayMs = Date.now();
  const sevenDaysAgoStr = new Date(todayMs - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recentDatesList = allDates.filter((d, i) => d >= sevenDaysAgoStr || i < 7);
  const recentDatesSet = new Set(recentDatesList);
  const olderDatesList = allDates.filter(d => !recentDatesSet.has(d));

  // 4. Update the Older Dates Dropdown Selector
  const olderSelect = document.getElementById('selectOlderDate');
  if (olderSelect) {
    const currentVal = selectedHistoricalDate || '';
    let optionsHtml = '<option value="">-- Browse Older Dates --</option>';
    for (const d of olderDatesList) {
      const count = dateMap.get(d).length;
      let label = d;
      try {
        const dObj = new Date(d + 'T00:00:00Z');
        label = dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) {}
      optionsHtml += `<option value="${d}" ${d === currentVal ? 'selected' : ''}>${label} (${count} record${count === 1 ? '' : 's'})</option>`;
    }
    olderSelect.innerHTML = optionsHtml;
  }

  // 5. Determine which dates to display in this window
  let displayedDates = [];
  let filterNote = '';

  if (currentAttendanceDateWindow === 'TODAY') {
    const todayStr = new Date().toISOString().split('T')[0];
    if (dateMap.has(todayStr)) {
      displayedDates = [todayStr];
    } else {
      displayedDates = [];
      filterNote = 'No attendance records logged for today yet.';
    }
  } else if (currentAttendanceDateWindow === 'SPECIFIC_DATE' && selectedHistoricalDate) {
    if (dateMap.has(selectedHistoricalDate)) {
      displayedDates = [selectedHistoricalDate];
    } else {
      displayedDates = [];
      filterNote = `No matching attendance records found for date ${selectedHistoricalDate}.`;
    }
  } else if (currentAttendanceDateWindow === 'ALL') {
    // Newest table on top
    displayedDates = allDates.slice().sort((a, b) => b.localeCompare(a));
  } else {
    // Default: RECENT_WEEK with newest table on top (e.g. Wednesday / Today = Table 1, Tuesday = Table 2)
    displayedDates = recentDatesList.slice().sort((a, b) => b.localeCompare(a));
  }

  if (displayedDates.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--color-text-muted); padding: 48px; background: #fff; border: 1px dashed var(--color-border-default); border-radius: 8px;">
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px;">${escapeHtml(filterNote || 'No records in the selected date window.')}</div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 12px;">You can view older records or switch back to All Recorded Days.</div>
        <button type="button" class="btn btn-secondary" onclick="setAttendanceDateWindow('ALL')" style="font-size: 12px;">View All Days</button>
      </div>
    `;
    return;
  }

  // 6. Render Day-by-Day Tables (Table 1: 16 Sept, Table 2: 17 Sept, etc.)
  const tablesHtml = displayedDates.map((dateStr, index) => {
    const dayRecords = dateMap.get(dateStr) || [];
    const totalWorkers = dayRecords.length;
    const completedRecords = dayRecords.filter(r => r.checkout_server_timestamp || r.attendance_status === 'COMPLETED');
    const activeWorking = dayRecords.filter(r => r.attendance_status === 'CHECKED_IN' || r.attendance_status === 'ON_BREAK');
    const totalSec = completedRecords.reduce((acc, r) => acc + (Number(r.net_working_seconds) || 0), 0);
    const totalHrs = totalSec / 3600;
    const avgHrs = completedRecords.length > 0 ? (totalHrs / completedRecords.length) : 0;


    // Check if this date was an official holiday or Sunday
    const holidayRecord = dayRecords.find(r => r.is_holiday_work);
    const isHolidayDay = Boolean(holidayRecord);
    const holidayName = holidayRecord ? (holidayRecord.holiday_name || 'Holiday / Sunday Duty') : '';

    let formattedDate = dateStr;
    let weekdayStr = '';
    try {
      const dObj = new Date(dateStr + 'T00:00:00Z');
      formattedDate = dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      weekdayStr = dObj.toLocaleDateString('en-GB', { weekday: 'long' });
    } catch (e) {}

    const rowsHtml = dayRecords.map(r => {
      const checkinTime = new Date(r.checkin_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const checkoutTime = r.checkout_server_timestamp
        ? new Date(r.checkout_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '--:--';

      const hoursMeta = computeWorkingHoursMeta(r);

      const statusBadge = r.attendance_status === 'COMPLETED'
        ? '<span class="badge badge-neutral">Completed</span>'
        : (r.attendance_status === 'ON_BREAK'
          ? '<span class="badge badge-warning">On Break</span>'
          : '<span class="badge badge-success">Working</span>');

      const checkinPhoto = r.checkin_photo
        ? `<img src="${r.checkin_photo}" class="table-photo-thumb" alt="Checkin" onclick="event.stopPropagation(); openPhotoLightbox('${r.checkin_photo}')" title="Click to view full photo">`
        : '<span style="color: var(--color-text-muted);">None</span>';

      const checkoutPhoto = r.checkout_photo
        ? `<img src="${r.checkout_photo}" class="table-photo-thumb" alt="Checkout" onclick="event.stopPropagation(); openPhotoLightbox('${r.checkout_photo}')" title="Click to view full photo">`
        : '<span style="color: var(--color-text-muted);">--</span>';

      const isTravel = r.work_mode === 'TRAVEL';
      const isField = r.work_mode === 'FIELD_WORK';
      const isHotel = (r.punch_location_type === 'HOTEL_STAY') || Boolean(r.hotel_name);

      const mapPinUrl = r.exact_coordinates_url || (r.checkin_lat != null && r.checkin_lng != null ? `https://www.google.com/maps?q=${Number(r.checkin_lat).toFixed(6)},${Number(r.checkin_lng).toFixed(6)}&t=k` : '');
      const mapPinHtml = mapPinUrl ? `
        <div style="margin-top: 3px;">
          <a href="${mapPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" onclick="event.stopPropagation();" title="View exact GPS pin in Google Maps Satellite view">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span>${Number(r.checkin_lat).toFixed(5)}°, ${Number(r.checkin_lng).toFixed(5)}°</span>
          </a>
        </div>
      ` : '';

      let locationHtml = '';
      if (isHotel) {
        locationHtml = `
          <span class="badge-location-hotel" style="margin-bottom: 2px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>
            <span>Hotel: ${escapeHtml(r.hotel_name || 'Hotel Stay')} ${r.hotel_room ? '(Rm ' + escapeHtml(r.hotel_room) + ')' : ''}</span>
          </span>
          <div style="font-size: 11px; color: var(--color-text-primary); max-width: 220px; line-height: 1.3;">
            ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Hotel Lodging'))}
          </div>
          ${r.hotel_phone ? `<div style="font-size: 10px; color: #4338ca; margin-top: 1px;">Reception: ${escapeHtml(r.hotel_phone)}</div>` : ''}
          ${mapPinHtml}
        `;
      } else if (isTravel) {
        locationHtml = `
          <span class="badge" style="background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; font-size: 10px; margin-bottom: 2px; display: inline-flex; align-items: center; gap: 4px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span>Travel / Transit ${r.field_site_notes ? '· ' + escapeHtml(r.field_site_notes) : ''}</span>
          </span>
          <div style="font-size: 11px; color: var(--color-text-primary); max-width: 220px; line-height: 1.3;">
            ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Transit Origin'))}
          </div>
          <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">Official Transit Duty</div>
          ${mapPinHtml}
        `;
      } else if (isField) {
        locationHtml = `
          <span class="badge-location-field" style="margin-bottom: 2px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span>Field Site ${r.field_site_notes ? '· ' + escapeHtml(r.field_site_notes) : ''}</span>
          </span>
          <div style="font-size: 11px; color: var(--color-text-primary); max-width: 220px; line-height: 1.3;">
            ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Premises'))}
          </div>
          <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">±${r.checkin_accuracy}m accuracy</div>
          ${mapPinHtml}
        `;
      } else {
        locationHtml = `
          <span class="badge badge-neutral" style="font-size: 10px; margin-bottom: 2px;">Office Premises</span>
          <div style="font-size: 11px; color: var(--color-text-secondary); max-width: 200px;">${escapeHtml(r.checkin_address || 'Office Premises')}</div>
          ${mapPinHtml}
        `;
      }

      return `
        <tr id="att-row-${r.id}" class="${hoursMeta.rowClass}" onclick="openAttendanceDrawer('${r.id}')" style="cursor: pointer;">
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="table-emp-avatar">${escapeHtml((r.employee_name || 'E').charAt(0))}</div>
              <div>
                <div style="font-weight: 600; color: var(--color-text-primary);">${escapeHtml(r.employee_name || 'Staff')}</div>
                <div style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono);">${escapeHtml(r.employee_id || '')} · ${escapeHtml(r.department || 'CDER')}</div>
                ${r.is_holiday_work ? `
                  <div style="margin-top: 3px;">
                    <span class="badge-compoff" style="font-size: 10px; padding: 1px 6px;" title="Comp-Off Earned: ${escapeHtml(r.holiday_name || 'Holiday Duty')}">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      <span>Comp-Off Credit</span>
                    </span>
                  </div>
                ` : ''}
                ${r.is_regularized ? `
                  <div style="margin-top: 3px;">
                    <span class="badge badge-regularized" style="font-size: 10px; padding: 1px 6px;" title="Regularized by Admin: ${escapeHtml(r.regularization_notes || '')}">
                      <span>Regularized</span>
                    </span>
                  </div>
                ` : ''}
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight: 600; font-size: 12px; color: var(--color-text-primary);">${escapeHtml(r.team_name || 'Direct Assignment')}</div>
            <span class="team-chip-tag" style="margin-top: 3px; display: inline-flex; align-items: center; gap: 4px;">
              ${window.Icons ? window.Icons.render('mapPin', { size: 10 }) : ''}
              <span>${r.district ? `${escapeHtml(r.district)}, ${escapeHtml(r.state || '')}` : (escapeHtml(r.state) || 'Territory Unspecified')}</span>
            </span>
          </td>
          <td style="font-family: var(--font-mono); font-size: 12px; white-space: nowrap;">${checkinTime}</td>
          <td>${checkinPhoto}</td>
          <td>${locationHtml}</td>
          <td style="font-family: var(--font-mono); font-size: 12px; white-space: nowrap;">${checkoutTime}</td>
          <td>${checkoutPhoto}</td>
          <td style="white-space: nowrap;">
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              ${hoursMeta.badgeHtml}
              ${hoursMeta.variancePill || ''}
            </div>
          </td>
          <td>${statusBadge}</td>
          <td style="white-space: nowrap; text-align: right;">
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="event.stopPropagation(); openAttendanceDrawer('${r.id}')" title="Inspect full audit drawer">
                View
              </button>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="event.stopPropagation(); openAlterAttendanceModal('${escapeHtml(r.employee_id)}', '${escapeHtml(dateStr)}', '${r.id}')" title="Alter attendance details">
                Alter
              </button>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="event.stopPropagation(); openPersonTimesheet('${escapeHtml(r.employee_id)}')" title="View cumulative timesheet for this employee">
                Timesheet
              </button>
              <button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px;" onclick="event.stopPropagation(); handleDeleteAttendance('${r.id}', '${escapeHtml(r.employee_name)}')" title="Delete attendance record">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="day-attendance-card" id="day-card-${escapeHtml(dateStr)}">
        <div class="day-attendance-header">
          <!-- Left: Table Identifier & Date Title -->
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div class="day-card-badge">
              Table ${index + 1}
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--color-text-primary);">
                  ${escapeHtml(weekdayStr)}, ${escapeHtml(formattedDate)}
                </h3>
                <span class="badge badge-neutral" style="font-family: var(--font-mono); font-size: 11px;">
                  ${escapeHtml(dateStr)}
                </span>
                ${isHolidayDay ? `
                  <span class="badge-compoff" title="Official Holiday Duty: ${escapeHtml(holidayName)}">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>Comp-Off Day (${escapeHtml(holidayName)})</span>
                  </span>
                ` : ''}
              </div>
              <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">
                Daily field dispatch attendance verification log
              </div>
            </div>
          </div>

          <!-- Right: Daily KPIs Strip -->
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="day-kpi-pill" title="Total Personnel Logged Today">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              <span><strong>${totalWorkers}</strong> Staff Present</span>
            </span>

            <span class="day-kpi-pill" title="Completed Shifts">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
              <span><strong>${completedRecords.length}</strong> Completed</span>
            </span>

            ${activeWorking.length > 0 ? `
              <span class="day-kpi-pill" style="color: #2563eb; border-color: #bfdbfe; background: #eff6ff;" title="Currently working live on the clock">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3b82f6;"></span>
                <span><strong>${activeWorking.length}</strong> On Clock</span>
              </span>
            ` : ''}

            <span class="day-kpi-pill" title="Average working hours per completed worker today">
              Avg: <strong>${avgHrs.toFixed(2)}h / shift</strong>
            </span>

          </div>
        </div>

        <div class="table-responsive-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Field Worker</th>
                <th>Team &amp; Territory</th>
                <th>Check-In</th>
                <th>Check-In Photo</th>
                <th>Location / Lodging / Map</th>
                <th>Checkout</th>
                <th>Checkout Photo</th>
                <th>Working Hours</th>
                <th>Status</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  // 7. If older dates are available and user is on RECENT_WEEK, append informative archive pill
  let olderBannerHtml = '';
  if (olderDatesList.length > 0 && currentAttendanceDateWindow === 'RECENT_WEEK') {
    olderBannerHtml = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #f1f5f9; border: 1px solid var(--color-border-default); border-radius: 8px; flex-wrap: wrap; gap: 10px;">
        <div style="font-size: 12px; color: var(--color-text-secondary);">
          <strong>${olderDatesList.length} Older Day Table${olderDatesList.length === 1 ? '' : 's'}</strong> available in historical records.
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="btn btn-secondary" onclick="setAttendanceDateWindow('ALL')" style="font-size: 11px; padding: 5px 12px;">
            Show All Recorded Days
          </button>
        </div>
      </div>
    `;
  }

  container.innerHTML = tablesHtml + olderBannerHtml;
}

/**
 * Filter & Render Attendance Table
 */
function renderAttendanceTable(records) {
  initAttendanceViewModeToggle();

  const countLabel = document.getElementById('attendanceCountLabel');
  if (countLabel) {
    countLabel.textContent = `Showing ${records.length} record${records.length === 1 ? '' : 's'}`;
  }

  // Render Mode 1: Daily Attendance Tables (By Date)
  renderDailyAttendanceTables(records);

  // Render Mode 2: Unified Consolidated Table
  const tbody = document.getElementById('attendanceMainTableBody');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No matching attendance records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const checkinTime = new Date(r.checkin_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const checkoutTime = r.checkout_server_timestamp
      ? new Date(r.checkout_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '--:--';

    const hoursMeta = computeWorkingHoursMeta(r);

    const statusBadge = r.attendance_status === 'COMPLETED'
      ? '<span class="badge badge-neutral">Completed</span>'
      : (r.attendance_status === 'ON_BREAK'
        ? '<span class="badge badge-warning">On Break</span>'
        : '<span class="badge badge-success">Working</span>');

    const checkinPhoto = r.checkin_photo
      ? `<img src="${r.checkin_photo}" class="table-photo-thumb" alt="Checkin" onclick="event.stopPropagation(); openPhotoLightbox('${r.checkin_photo}')" title="Click to view full photo">`
      : '<span style="color: var(--color-text-muted);">None</span>';

    const checkoutPhoto = r.checkout_photo
      ? `<img src="${r.checkout_photo}" class="table-photo-thumb" alt="Checkout" onclick="event.stopPropagation(); openPhotoLightbox('${r.checkout_photo}')" title="Click to view full photo">`
      : '<span style="color: var(--color-text-muted);">--</span>';

    const isTravel = r.work_mode === 'TRAVEL';
    const isField = r.work_mode === 'FIELD_WORK';

    return `
      <tr id="att-row-${r.id}" class="${hoursMeta.rowClass}" onclick="openAttendanceDrawer('${r.id}')" style="cursor: pointer;">
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="table-emp-avatar">${r.employee_name.charAt(0)}</div>
            <div>
              <div style="font-weight: 600;">${r.employee_name}</div>
              <div style="font-size: 11px; color: var(--color-text-muted);">${r.employee_id}</div>
              ${r.is_holiday_work ? `
                <div style="margin-top: 3px;">
                  <span class="badge-compoff" title="Compensatory Off Day Earned: ${escapeHtml(r.holiday_name || 'Holiday Duty')}">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>Comp-Off (${escapeHtml(r.holiday_name || 'Holiday')})</span>
                  </span>
                </div>
              ` : ''}
              ${r.is_regularized ? `
                <div style="margin-top: 3px;">
                  <span class="badge badge-regularized" style="font-size: 10px; padding: 1px 6px;" title="Regularized by Admin: ${escapeHtml(r.regularization_notes || '')}">
                    <span>Regularized</span>
                  </span>
                </div>
              ` : ''}
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; font-size: 13px; color: var(--color-text-primary);">${r.team_name || 'Direct Assignment'}</div>
          <span class="team-chip-tag" style="margin-top: 3px; display: inline-flex; align-items: center; gap: 4px;">
            ${window.Icons ? window.Icons.render('mapPin', { size: 10 }) : ''}
            <span>${r.district ? `${r.district}, ${r.state}` : (r.state || 'Territory Unspecified')}</span>
          </span>
        </td>
        <td style="color: var(--color-text-secondary);">${r.department}</td>
        <td style="font-family: var(--font-mono);">${checkinTime}</td>
        <td>${checkinPhoto}</td>
        <td>
          ${(() => {
            const mapPinUrl = r.exact_coordinates_url || (r.checkin_lat != null && r.checkin_lng != null ? `https://www.google.com/maps?q=${Number(r.checkin_lat).toFixed(6)},${Number(r.checkin_lng).toFixed(6)}&t=k` : '');
            const mapPinHtml = mapPinUrl ? `
              <div style="margin-top: 3px;">
                <a href="${mapPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" onclick="event.stopPropagation();" title="View exact GPS pin in Google Maps Satellite view">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                  <span>${Number(r.checkin_lat).toFixed(5)}°, ${Number(r.checkin_lng).toFixed(5)}°</span>
                </a>
              </div>
            ` : '';

            if (r.punch_location_type === 'HOTEL_STAY' || r.hotel_name) {
              return `
                <span class="badge-location-hotel" style="margin-bottom: 3px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>
                  <span>Hotel: ${escapeHtml(r.hotel_name || 'Hotel Stay')} ${r.hotel_room ? '(Rm ' + escapeHtml(r.hotel_room) + ')' : ''}</span>
                </span>
                <div style="font-size: 11px; color: var(--color-text-primary); font-weight: 500; max-width: 210px; white-space: normal; line-height: 1.3;">
                  ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Hotel Lodging'))}
                </div>
                ${r.hotel_phone ? `<div style="font-size: 10px; color: #4338ca; margin-top: 1px;">Reception: ${escapeHtml(r.hotel_phone)}</div>` : ''}
                ${mapPinHtml}
              `;
            }

            if (isTravel) {
              return `
                <span class="badge" style="background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; font-size: 10px; margin-bottom: 3px; display: inline-flex; align-items: center; gap: 4px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                  <span>Travel / Transit ${r.field_site_notes ? '· ' + escapeHtml(r.field_site_notes) : ''}</span>
                </span>
                <div style="font-size: 11px; color: var(--color-text-primary); font-weight: 500; max-width: 210px; white-space: normal; line-height: 1.3;">
                  ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Transit Origin'))}
                </div>
                <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">Official Transit Duty</div>
                ${mapPinHtml}
              `;
            }

            if (isField) {
              return `
                <span class="badge-location-field" style="margin-bottom: 3px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                  <span>Field Work ${r.field_site_notes ? '· ' + escapeHtml(r.field_site_notes) : ''}</span>
                </span>
                <div style="font-size: 11px; color: var(--color-text-primary); font-weight: 500; max-width: 210px; white-space: normal; line-height: 1.3;">
                  ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Premises'))}
                </div>
                <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">±${r.checkin_accuracy}m accuracy</div>
                ${mapPinHtml}
              `;
            }

            return `
              <span class="badge ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'badge-neutral' : 'badge-warning'}" style="font-size: 10px; margin-bottom: 3px; display: inline-flex; align-items: center; gap: 4px;">
                ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' 
                  ? `${window.Icons ? window.Icons.render('building', { size: 11 }) : ''} <span>In Office</span>` 
                  : `${window.Icons ? window.Icons.render('alertTriangle', { size: 11 }) : ''} <span>Outside (${Math.round(r.checkin_geofence_distance || 0)}m)</span>`}
              </span>
              <div style="font-size: 11px; color: var(--color-text-secondary); max-width: 200px; white-space: normal; line-height: 1.3;">
                ${escapeHtml(r.checkin_address || 'Office Premises')}
              </div>
              <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">±${r.checkin_accuracy}m accuracy</div>
              ${mapPinHtml}
            `;
          })()}
        </td>
        <td style="font-family: var(--font-mono);">${checkoutTime}</td>
        <td>${checkoutPhoto}</td>
        <td style="white-space: nowrap;">
          <div style="display: inline-flex; align-items: center; gap: 4px;">
            ${hoursMeta.badgeHtml}
            ${hoursMeta.variancePill || ''}
          </div>
        </td>
        <td>${statusBadge}</td>
        <td style="white-space: nowrap;">
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="event.stopPropagation(); openAlterAttendanceModal('${escapeHtml(r.employee_id)}', '${r.checkin_server_timestamp ? r.checkin_server_timestamp.split('T')[0] : ''}', '${r.id}')" title="Alter attendance details">
              <span>Alter</span>
            </button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="event.stopPropagation(); openPersonTimesheet('${escapeHtml(r.employee_id)}')" title="View cumulative timesheet for this employee">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>Timesheet</span>
            </button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="event.stopPropagation(); openAttendanceDrawer('${r.id}')">
              <span>View</span>
              <span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('arrowRight') : ''}</span>
            </button>
            <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="event.stopPropagation(); handleDeleteAttendance('${r.id}', '${escapeHtml(r.employee_name)}')" title="Delete attendance record">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAttendanceMainTable(records) {
  return renderAttendanceTable(records);
}

/**
 * Slide-out Attendance Detail Drawer (Section 29)
 */
function initDrawer() {
  const backdrop = document.getElementById('attendanceDrawerBackdrop');
  const closeBtn = document.getElementById('btnCloseDrawer');

  closeBtn.addEventListener('click', closeAttendanceDrawer);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeAttendanceDrawer();
  });
}

function closeAttendanceDrawer() {
  document.getElementById('attendanceDrawerBackdrop').classList.remove('active');
  if (drawerMapInstance) {
    drawerMapInstance.remove();
    drawerMapInstance = null;
  }
}

async function openAttendanceDrawer(recordId) {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/admin/attendance/${recordId}?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success) return;

    const { record, breaks } = data;

    document.getElementById('drawerEmployeeName').textContent = `${record.employee_name} (${record.department})`;
    document.getElementById('drawerRecordMeta').textContent = `Record ID: ${record.id} · Server Timestamp: ${new Date(record.checkin_server_timestamp).toLocaleString()}`;

    // Team & Territory
    const teamEl = document.getElementById('drwTeamName');
    const territoryBadge = document.getElementById('drwTerritoryBadge');
    if (teamEl) teamEl.textContent = record.team_name || 'Direct Assignment';
    if (territoryBadge) {
      territoryBadge.innerHTML = record.district
        ? `${window.Icons ? window.Icons.render('mapPin', { size: 10 }) : ''} <span>${record.district}, ${record.state}</span>`
        : (record.state ? `${window.Icons ? window.Icons.render('mapPin', { size: 10 }) : ''} <span>${record.state}</span>` : 'Territory Unspecified');
    }

    // Hours summary
    document.getElementById('drwGrossTime').textContent = `${((record.gross_working_seconds || 0) / 3600).toFixed(2)}h`;
    document.getElementById('drwBreakTime').textContent = `${Math.round((record.break_seconds || 0) / 60)}m`;
    document.getElementById('drwNetTime').textContent = `${((record.net_working_seconds || 0) / 3600).toFixed(2)}h`;
    document.getElementById('drwOvertime').textContent = `${((record.overtime_seconds || 0) / 3600).toFixed(2)}h`;

    const statusBadge = document.getElementById('drawerStatusBadge');
    if (record.is_regularized) {
      statusBadge.textContent = 'Regularized (Admin Altered)';
      statusBadge.className = 'badge badge-regularized';
    } else {
      statusBadge.textContent = record.attendance_status === 'COMPLETED' ? 'Completed Shift' : (record.attendance_status === 'ON_BREAK' ? 'On Break' : 'Active Working');
      statusBadge.className = `badge ${record.attendance_status === 'COMPLETED' ? 'badge-neutral' : 'badge-success'}`;
    }

    // Photos
    document.getElementById('drwCheckinPhoto').src = record.checkin_photo;
    document.getElementById('drwCheckinPhotoTime').textContent = `Time: ${new Date(record.checkin_server_timestamp).toLocaleTimeString()}`;
    document.getElementById('drwCheckinPhotoAcc').textContent = `GPS: ±${record.checkin_accuracy}m accuracy`;

    const checkoutBox = document.getElementById('drwCheckoutBox');
    if (record.checkout_photo && record.checkout_server_timestamp) {
      checkoutBox.style.opacity = '1';
      document.getElementById('drwCheckoutPhoto').src = record.checkout_photo;
      document.getElementById('drwCheckoutPhotoTime').textContent = `Time: ${new Date(record.checkout_server_timestamp).toLocaleTimeString()}`;
      document.getElementById('drwCheckoutPhotoAcc').textContent = `GPS: ±${record.checkout_accuracy}m accuracy`;
    } else {
      checkoutBox.style.opacity = '0.45';
      document.getElementById('drwCheckoutPhoto').src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23e2e8f0%22/><text x=%2250%22 y=%2255%22 font-size=%2212%22 fill=%22%2394a3b8%22 text-anchor=%22middle%22>Pending</text></svg>';
      document.getElementById('drwCheckoutPhotoTime').textContent = 'Awaiting checkout photo';
      document.getElementById('drwCheckoutPhotoAcc').textContent = 'Fresh GPS required at checkout';
    }

    // Geofence & Map
    const isHotel = (record.punch_location_type === 'HOTEL_STAY') || Boolean(record.hotel_name);
    const isTravel = record.work_mode === 'TRAVEL';
    const isField = record.work_mode === 'FIELD_WORK';
    const geoBadge = document.getElementById('drwGeofenceBadge');

    if (isHotel) {
      geoBadge.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg> <span>Hotel Stay Lodging Verified</span>`;
      geoBadge.className = 'badge-location-hotel';
      geoBadge.style.background = '#eef2ff';
      geoBadge.style.color = '#4338ca';
      geoBadge.style.border = '1px solid #c7d2fe';
    } else if (isTravel) {
      geoBadge.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> <span>Official Travel / Transit (${record.field_site_notes || 'Transit Verified'})</span>`;
      geoBadge.className = 'badge';
      geoBadge.style.background = '#fdf2f8';
      geoBadge.style.color = '#be185d';
      geoBadge.style.border = '1px solid #fbcfe8';
    } else if (isField) {
      geoBadge.innerHTML = `${window.Icons ? window.Icons.render('car', { size: 11 }) : ''} <span>Field Duty (${record.field_site_notes || 'On-Site Verified'})</span>`;
      geoBadge.className = 'badge badge-success';
      geoBadge.style.background = '';
      geoBadge.style.color = '';
      geoBadge.style.border = '';
    } else {
      geoBadge.innerHTML = record.checkin_geofence_status === 'WITHIN_GEOFENCE' 
        ? `${window.Icons ? window.Icons.render('check', { size: 11 }) : ''} <span>Within Geofence</span>` 
        : `${window.Icons ? window.Icons.render('alertTriangle', { size: 11 }) : ''} <span>Outside Geofence (${Math.round(record.checkin_geofence_distance || 0)}m)</span>`;
      geoBadge.className = `badge ${record.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'badge-success' : 'badge-warning'}`;
      geoBadge.style.background = '';
      geoBadge.style.color = '';
      geoBadge.style.border = '';
    }
    document.getElementById('drwAddressText').textContent = record.checkin_address || (record.checkin_lat != null ? `Coordinates: ${Number(record.checkin_lat).toFixed(5)}° N, ${Number(record.checkin_lng).toFixed(5)}° E` : 'Coordinates unspecified');

    // Hotel Stay Details in Drawer
    const hotelBox = document.getElementById('drwHotelStayDetailsBlock');
    if (hotelBox) {
      if (isHotel) {
        hotelBox.style.display = 'block';
        const nameEl = document.getElementById('drwHotelName');
        const roomEl = document.getElementById('drwHotelRoom');
        const phoneEl = document.getElementById('drwHotelPhone');
        if (nameEl) nameEl.textContent = record.hotel_name || 'Hotel Stay';
        if (roomEl) roomEl.textContent = record.hotel_room ? `Room ${record.hotel_room}` : 'Room Unspecified';
        if (phoneEl) phoneEl.textContent = record.hotel_phone ? `Reception Contact: ${record.hotel_phone}` : 'Reception desk phone not recorded';
      } else {
        hotelBox.style.display = 'none';
      }
    }

    // Google Maps Satellite Link in Drawer
    const mapLinkEl = document.getElementById('drwGoogleMapsLink');
    const coordsTextEl = document.getElementById('drwCoordsText');
    if (mapLinkEl && record.checkin_lat != null && record.checkin_lng != null) {
      const pinUrl = record.exact_coordinates_url || `https://www.google.com/maps?q=${Number(record.checkin_lat).toFixed(6)},${Number(record.checkin_lng).toFixed(6)}&t=k`;
      mapLinkEl.href = pinUrl;
      mapLinkEl.style.display = 'inline-flex';
      if (coordsTextEl) {
        coordsTextEl.textContent = `Satellite Map Pin: ${Number(record.checkin_lat).toFixed(5)}°, ${Number(record.checkin_lng).toFixed(5)}°`;
      }
    } else if (mapLinkEl) {
      mapLinkEl.style.display = 'none';
    }

    // Breaks list
    const breaksContainer = document.getElementById('drwBreaksList');
    document.getElementById('drwBreakCountLabel').textContent = `${breaks.length} break${breaks.length === 1 ? '' : 's'}`;
    if (breaks && breaks.length > 0) {
      breaksContainer.innerHTML = breaks.map((b, i) => `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--color-border-subtle);">
          <span>Break #${i + 1}: ${new Date(b.start_server_timestamp).toLocaleTimeString()} &rarr; ${b.end_server_timestamp ? new Date(b.end_server_timestamp).toLocaleTimeString() : 'In Progress'}</span>
          <span style="font-weight: 600;">${Math.round(b.duration_seconds / 60)} min</span>
        </div>
      `).join('');
    } else {
      breaksContainer.innerHTML = 'No breaks recorded during this shift.';
    }

    // Wire up drawer action buttons
    const drawerDeleteBtn = document.getElementById('btnDrawerDeleteAttendance');
    if (drawerDeleteBtn) {
      drawerDeleteBtn.onclick = () => handleDeleteAttendance(record.id, record.employee_name);
    }
    const drawerTimesheetBtn = document.getElementById('btnDrawerOpenTimesheet');
    if (drawerTimesheetBtn) {
      drawerTimesheetBtn.onclick = () => {
        closeAttendanceDrawer();
        openPersonTimesheet(record.employee_id);
      };
    }

    // Open drawer
    document.getElementById('attendanceDrawerBackdrop').classList.add('active');

    // Render Map
    setTimeout(() => {
      renderDrawerMap(record);
    }, 180);

  } catch (err) {
    console.error('Error opening drawer:', err);
  }
}

function renderDrawerMap(record) {
  if (typeof L === 'undefined') return;

  const mapContainer = document.getElementById('drawerMap');
  if (drawerMapInstance) {
    drawerMapInstance.remove();
    drawerMapInstance = null;
  }

  drawerMapInstance = L.map(mapContainer, {
    center: [record.checkin_lat, record.checkin_lng],
    zoom: 16,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(drawerMapInstance);

  // Office geofence boundary circle (if within office range or reference)
  if (record.office_lat && record.office_lng) {
    L.circle([record.office_lat, record.office_lng], {
      color: '#0f172a',
      fillColor: '#2563eb',
      fillOpacity: 0.1,
      weight: 1.5,
      radius: record.geofence_radius_m || 100
    }).addTo(drawerMapInstance);
  }

  // Checkin Pin
  const isTravel = record.work_mode === 'TRAVEL';
  const isField = record.work_mode === 'FIELD_WORK';
  const popupHtml = isTravel
    ? `<b>${record.employee_name}</b><br><span style="color:#be185d;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> <span>Official Travel / Transit</span></span>${record.field_site_notes ? ': ' + escapeHtml(record.field_site_notes) : ''}<br><small>${record.checkin_address || ''}</small><br>Accuracy: ±${record.checkin_accuracy}m`
    : (isField
      ? `<b>${record.employee_name}</b><br><span style="color:#0284c7;font-weight:600;display:inline-flex;align-items:center;gap:4px;">${window.Icons ? window.Icons.render('car', { size: 11 }) : ''} <span>Field Work</span></span>${record.field_site_notes ? ': ' + escapeHtml(record.field_site_notes) : ''}<br><small>${record.checkin_address || ''}</small><br>Accuracy: ±${record.checkin_accuracy}m`
      : `<b>${record.employee_name}</b><br>${record.checkin_address || 'Office'}<br>Accuracy: ±${record.checkin_accuracy}m`);

  L.marker([record.checkin_lat, record.checkin_lng]).addTo(drawerMapInstance)
    .bindPopup(popupHtml).openPopup();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Load Employees Directory
 */
async function loadEmployees() {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/employees?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('employeesTableBody');
    if (!data.employees || data.employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No employees registered yet. Use "+ Add Employee" or have employees register via the portal.</td></tr>';
      return;
    }
    tbody.innerHTML = data.employees.map(e => `
      <tr id="emp-row-${escapeHtml(e.id)}">
        <td>
          <div class="table-user-cell">
            <div class="user-avatar">${escapeHtml(e.name ? e.name.charAt(0).toUpperCase() : '?')}</div>
            <div>
              <div style="font-weight: 600;">${escapeHtml(e.name)}</div>
              <div style="font-size: 11px; color: var(--color-text-muted);">${escapeHtml(e.email)}</div>
            </div>
          </div>
        </td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(e.id)}</td>
        <td>${escapeHtml(e.department || 'CDER')}</td>
        <td>${escapeHtml(e.designation || 'Staff')}</td>
        <td><span class="badge badge-neutral">Standard Shift (8h)</span></td>
        <td><span class="badge badge-success"><span class="badge-dot"></span>Active</span></td>
        <td>
          <div style="display: inline-flex; gap: 6px; align-items: center;">
            <button class="btn btn-primary" onclick="openPersonTimesheet('${escapeHtml(e.id)}')" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>Timesheet</span>
            </button>
            <button class="btn btn-secondary" onclick="handleEditEmployee('${escapeHtml(e.id)}', '${escapeHtml(e.name)}', '${escapeHtml(e.department || '')}', '${escapeHtml(e.designation || '')}')" style="padding: 4px 10px; font-size: 11px;">Edit Profile</button>
            <button class="btn btn-danger" onclick="handleDeleteEmployee('${escapeHtml(e.id)}', '${escapeHtml(e.name)}')" style="padding: 4px 10px; font-size: 11px;">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading employees:', err);
  }
}

/**
 * Delete Attendance Record Handler
 */
window.handleDeleteAttendance = async function(recordId, employeeName) {
  if (!recordId) return;

  const confirmed = window.confirm(
    `Are you sure you want to delete this attendance record for "${employeeName || 'this employee'}" (${recordId})?\n\nThis will permanently delete the check-in and checkout timestamps, geofence logs, break records, and uploaded photos.\n\nThis action cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const res = await adminFetch(`/api/admin/attendance/${encodeURIComponent(recordId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!data.success) {
      alert(`Could not delete attendance record: ${data.error || 'Server error'}`);
      return;
    }

    // Close drawer if open
    closeAttendanceDrawer();

    // Optimistically remove table row immediately
    const row = document.getElementById(`att-row-${recordId}`);
    if (row) row.remove();

    // Update in-memory cache if available
    if (typeof cachedAttendanceRecords !== 'undefined' && Array.isArray(cachedAttendanceRecords)) {
      cachedAttendanceRecords = cachedAttendanceRecords.filter(r => r.id !== recordId);
      applyAttendanceFilters();
    }

    // Reload list and refresh dashboard metrics
    await loadAttendanceRecords();
    loadDashboardData();
  } catch (err) {
    alert(`Error deleting attendance record: ${err.message}`);
  }
};

/**
 * Delete Employee Handler
 */
window.handleDeleteEmployee = async function(empId, empName) {
  if (!empId) return;

  const confirmed = window.confirm(
    `Are you sure you want to delete employee "${empName}" (${empId})?\n\nThis will permanently delete their profile, attendance logs, and active sessions.\n\nThis action cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const res = await adminFetch(`/api/employees/${encodeURIComponent(empId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!data.success) {
      alert(`Could not delete employee: ${data.error || 'Server error'}`);
      return;
    }

    // Optimistically remove table row immediately
    const row = document.getElementById(`emp-row-${empId}`);
    if (row) row.remove();

    // Reload list and refresh dashboard counts
    await loadEmployees();
    loadDashboardData();
  } catch (err) {
    alert(`Error deleting employee: ${err.message}`);
  }
};

/**
 * Edit Employee Handler
 */
window.handleEditEmployee = async function(empId, currentName, currentDept, currentDesig) {
  const newName = window.prompt(`Update employee full name for ${empId}:`, currentName || '');
  if (newName === null) return;
  const newDept = window.prompt(`Update department for ${newName || currentName} (${empId}):`, currentDept || 'CDER');
  if (newDept === null) return;
  const newDesig = window.prompt(`Update designation for ${newName || currentName} (${empId}):`, currentDesig || 'Senior Research Officer');
  if (newDesig === null) return;

  try {
    const res = await adminFetch(`/api/employees/${encodeURIComponent(empId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: newName.trim() || currentName,
        department: newDept.trim(),
        designation: newDesig.trim()
      })
    });
    const data = await res.json();
    if (data.success) {
      await loadEmployees();
    } else {
      alert(`Update failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Error updating employee: ${err.message}`);
  }
};

/**
 * Settings & Organization
 */
async function loadSettings() {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/admin/settings?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success || !data.settings) return;

    const s = data.settings;
    document.getElementById('settingOfficeName').value = s.office_name;
    document.getElementById('settingOfficeLat').value = s.office_lat;
    document.getElementById('settingOfficeLng').value = s.office_lng;
    document.getElementById('settingGeofenceRadius').value = s.geofence_radius_m;
    document.getElementById('settingMaxAccuracy').value = s.max_gps_accuracy_m;
    document.getElementById('settingGeofencePolicy').value = s.geofence_policy;
    document.getElementById('settingShiftHours').value = s.shift_hours;
    document.getElementById('settingTimezone').value = s.timezone;
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  if (!currentEmployerSession) return;

  const feedback = document.getElementById('saveSettingsFeedback');
  feedback.style.display = 'none';

  const payload = {
    office_name: document.getElementById('settingOfficeName').value,
    office_lat: parseFloat(document.getElementById('settingOfficeLat').value),
    office_lng: parseFloat(document.getElementById('settingOfficeLng').value),
    geofence_radius_m: parseFloat(document.getElementById('settingGeofenceRadius').value),
    max_gps_accuracy_m: parseFloat(document.getElementById('settingMaxAccuracy').value),
    geofence_policy: document.getElementById('settingGeofencePolicy').value,
    shift_hours: parseFloat(document.getElementById('settingShiftHours').value),
    timezone: document.getElementById('settingTimezone').value
  };

  try {
    const res = await adminFetch('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      feedback.style.display = 'inline';
      setTimeout(() => { feedback.style.display = 'none'; }, 4000);
      loadDashboardData();
    }
  } catch (err) {
    alert('Failed to save settings');
  }
}

/**
 * Security Audit Logs
 */
async function loadAuditLogs() {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/admin/audit-logs?employer_id=${currentEmployerSession.employer_id}&limit=50`);
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('auditTableBody');
    const logs = data.logs || [];

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--color-text-muted);">No audit logs found.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const getStatusBadge = (status) => {
        if (status === 'SUCCESS') return '<span class="badge badge-success"><span class="badge-dot"></span>Success</span>';
        if (status === 'BLOCKED') return '<span class="badge badge-danger"><span class="badge-dot"></span>Blocked</span>';
        return '<span class="badge badge-warning"><span class="badge-dot"></span>Warning</span>';
      };

      return `
        <tr>
          <td style="font-family: var(--font-mono); font-size: 11px;">${new Date(l.timestamp).toISOString()}</td>
          <td><strong>${l.event_type}</strong></td>
          <td>${l.employee_name || l.employee_id || 'System'}</td>
          <td>${getStatusBadge(l.status)}</td>
          <td style="font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted);">${l.client_ip}</td>
          <td style="font-family: var(--font-mono); font-size: 11px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.details_json}">
            ${l.details_json || '—'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching audit logs:', err);
  }
}

/**
 * REDCap Data Viewer
 */
async function loadRedcapData() {
  if (!currentEmployerSession) return;

  try {
    const res = await adminFetch(`/api/admin/redcap/records?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('redcapRecordsBody');
    const records = data.records || [];

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--color-text-muted); padding: 24px;">No records synced to REDCap for this employer yet.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 11px;">${r.attendance_record_id}</td>
        <td><strong>${r.employee_id}</strong></td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${r.checkin_latitude || '—'}, ${r.checkin_longitude || '—'}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${r.checkin_server_timestamp || '—'}</td>
        <td><strong>${r.net_working_seconds || '0'}s</strong></td>
        <td><span class="badge badge-success"><span class="badge-dot"></span>Synced</span></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading REDCap data:', err);
  }
}

/**
 * --- STATE & DISTRICT TEAMS & OPERATIONS MATRIX ---
 */

function initTerritoryAndTeamControls() {
  // 1. Setup cascade for team creation form
  const teamStateEl = document.getElementById('teamStateSelect');
  const teamDistEl = document.getElementById('teamDistrictSelect');
  if (teamStateEl && teamDistEl && window.setupStateDistrictCascade) {
    window.setupStateDistrictCascade(teamStateEl, teamDistEl, {
      allowAll: false,
      defaultStateText: 'Select State / UT',
      defaultDistrictText: 'Select District'
    });
  }

  // 2. Setup cascade for team list filtering
  const teamFilterStateEl = document.getElementById('teamFilterState');
  const teamFilterDistEl = document.getElementById('teamFilterDistrict');
  if (teamFilterStateEl && teamFilterDistEl && window.setupStateDistrictCascade) {
    window.setupStateDistrictCascade(teamFilterStateEl, teamFilterDistEl, {
      allowAll: true,
      defaultStateText: 'All States / UTs',
      defaultDistrictText: 'All Districts',
      onStateChange: () => filterTeamsTable(),
      onDistrictChange: () => filterTeamsTable()
    });
  }

  // 3. Setup cascade for attendance table filtering
  const attStateEl = document.getElementById('attendanceFilterState');
  const attDistEl = document.getElementById('attendanceFilterDistrict');
  if (attStateEl && attDistEl && window.setupStateDistrictCascade) {
    window.setupStateDistrictCascade(attStateEl, attDistEl, {
      allowAll: true,
      defaultStateText: 'All States / UTs',
      defaultDistrictText: 'All Districts',
      onStateChange: () => applyAttendanceFilters(),
      onDistrictChange: () => applyAttendanceFilters()
    });
  }

  // 4. Form submit listener
  const formTeam = document.getElementById('formCreateTeam');
  if (formTeam) {
    formTeam.addEventListener('submit', handleCreateTeam);
  }
}

/**
 * Simultaneous Multi-State and District Operations Matrix
 */
async function loadMultiStateMatrix() {
  if (!currentEmployerSession) return;
  const badge = document.getElementById('badgeActiveStatesCount');
  const container = document.getElementById('containerStateMatrix');
  if (!container) return;

  try {
    const res = await adminFetch(`/api/admin/attendance/matrix?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success || !data.matrix) return;

    const m = data.matrix;
    if (badge) {
      badge.textContent = `${m.total_states_active} State${m.total_states_active === 1 ? '' : 's'} Active Today`;
      badge.className = `badge ${m.total_states_active > 0 ? 'badge-success' : 'badge-neutral'}`;
    }

    if (!m.states || m.states.length === 0) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--color-text-muted); padding: 24px;">No regional territories configured yet.</div>`;
      return;
    }

    container.innerHTML = m.states.map(s => {
      const isStateActive = s.total_active > 0;
      return `
        <div class="state-matrix-card">
          <div class="state-matrix-header">
            <div class="state-matrix-title">
              <span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('landmark') : ''}</span>
              <span>${s.state}</span>
            </div>
            <span class="state-matrix-badge ${isStateActive ? 'badge-success' : 'badge-neutral'}">
              ${isStateActive ? `<span class="badge-dot" style="background: #10b981; margin-right: 4px;"></span><span>${s.total_active} Active</span>` : `<span>${s.total_records} Records</span>`}
            </span>
          </div>

          <div class="district-pill-list">
            ${s.districts.map(d => {
              const hasActive = d.active > 0 || d.on_break > 0;
              return `
                <div class="district-pill-item" onclick="filterByDistrict('${s.state}', '${d.district}')" title="Filter attendance for ${d.district}, ${s.state}">
                  <div class="district-pill-name" style="display: flex; align-items: center;">
                    <span class="badge-dot" style="background: ${hasActive ? '#10b981' : '#94a3b8'}; margin-right: 6px; display: inline-block; flex-shrink: 0;"></span>
                    <span>${d.district}</span>
                  </div>
                  <div class="district-pill-stat">
                    ${d.active} working · ${d.completed} done
                  </div>
                </div>
                ${d.teams && d.teams.length > 0 ? `
                  <div style="display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px 6px;">
                    ${d.teams.map(t => `<span class="team-chip-tag" onclick="filterByTeam('${t.id}')" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Filter by ${t.name}"><span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('users') : ''}</span><span>${t.name}</span></span>`).join('')}
                  </div>
                ` : ''}
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading state matrix:', err);
  }
}

/**
 * Filter attendance table by clicking on a District pill
 */
function filterByDistrict(state, district) {
  switchView('viewAttendance');
  const stateSelect = document.getElementById('attendanceFilterState');
  const distSelect = document.getElementById('attendanceFilterDistrict');
  if (stateSelect && distSelect) {
    stateSelect.value = state;
    distSelect.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = 'ALL';
    optAll.textContent = 'All Districts';
    distSelect.appendChild(optAll);

    const districts = window.getDistrictsForIndianState(state);
    districts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      if (d.toLowerCase() === district.toLowerCase()) opt.selected = true;
      distSelect.appendChild(opt);
    });
    distSelect.disabled = false;
    applyAttendanceFilters();
  }
}

/**
 * Filter attendance table by Team ID
 */
function filterByTeam(teamId) {
  switchView('viewAttendance');
  const teamSelect = document.getElementById('attendanceFilterTeam');
  if (teamSelect) {
    teamSelect.value = teamId;
    applyAttendanceFilters();
  }
}

window.filterByDistrict = filterByDistrict;
window.filterByTeam = filterByTeam;

/**
 * Teams Directory View
 */
async function loadTeamsView() {
  if (!currentEmployerSession) return;
  try {
    const res = await adminFetch(`/api/teams?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (!data.success) return;

    cachedTeams = data.teams || [];
    renderTeamsTable(cachedTeams);
    populateTeamFilterDropdown(cachedTeams);
  } catch (err) {
    console.error('Error loading teams:', err);
  }
}

function renderTeamsTable(teams) {
  const tbody = document.getElementById('teamsTableBody');
  const label = document.getElementById('teamCountLabel');
  if (label) label.textContent = `Showing ${teams.length} teams`;

  if (!tbody) return;

  if (teams.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No regional teams found.</td></tr>`;
    return;
  }

  tbody.innerHTML = teams.map(t => {
    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: var(--color-text-primary); font-size: 13px;">${t.name}</div>
          <div style="font-size: 11px; color: var(--color-text-muted);">${t.description || 'Regional field & operations unit'}</div>
        </td>
        <td><span class="badge badge-neutral" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;"><span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('landmark') : ''}</span><span>${t.state}</span></span></td>
        <td><span style="font-weight: 500; font-size: 12px;">${t.district}</span></td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${t.member_count} member${t.member_count === 1 ? '' : 's'}</td>
        <td>
          <span class="badge ${t.active_attendance_count > 0 ? 'badge-success' : 'badge-neutral'}">
            ${t.active_attendance_count > 0 ? `<span class="badge-dot" style="background: #10b981; margin-right: 4px;"></span><span>${t.active_attendance_count} Active</span>` : '0 Active'}
          </span>
        </td>
        <td>
          <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="filterByTeam('${t.id}')">
            <span>View Attendance</span>
            <span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('arrowRight') : ''}</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterTeamsTable() {
  const stateVal = (document.getElementById('teamFilterState') || {}).value || 'ALL';
  const distVal = (document.getElementById('teamFilterDistrict') || {}).value || 'ALL';

  const filtered = cachedTeams.filter(t => {
    const matchState = stateVal === 'ALL' || t.state === stateVal;
    const matchDist = distVal === 'ALL' || t.district === distVal;
    return matchState && matchDist;
  });

  renderTeamsTable(filtered);
}

function populateTeamFilterDropdown(teams) {
  const select = document.getElementById('attendanceFilterTeam');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="ALL">All Teams</option>';

  teams.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.district})`;
    if (currentVal === t.id) opt.selected = true;
    select.appendChild(opt);
  });
}

async function handleCreateTeam(e) {
  e.preventDefault();
  if (!currentEmployerSession) return;

  const state = document.getElementById('teamStateSelect').value;
  const district = document.getElementById('teamDistrictSelect').value;
  const name = document.getElementById('teamNameInput').value;
  const description = document.getElementById('teamDescInput').value;
  const btn = document.getElementById('btnSubmitCreateTeam');

  if (!state || !district || !name) {
    alert('Please select both State, District and provide a Team Name.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating Team...';

  try {
    const res = await adminFetch('/api/teams', {
      method: 'POST',
      body: JSON.stringify({
        employer_id: currentEmployerSession.employer_id,
        state,
        district,
        name,
        description
      })
    });

    const data = await res.json();
    if (!data.success) {
      alert(`Failed to create team: ${data.error}`);
      return;
    }

    // Reset form
    document.getElementById('formCreateTeam').reset();
    const teamDistEl = document.getElementById('teamDistrictSelect');
    if (teamDistEl) {
      teamDistEl.innerHTML = '<option value="">Select State First</option>';
      teamDistEl.disabled = true;
    }

    // Reload teams and matrix
    await loadTeamsView();
    await loadMultiStateMatrix();
    alert(`Team "${name}" created successfully in ${district}, ${state}!`);
  } catch (err) {
    alert(`Error creating team: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Add Regional Team';
  }
}

/**
 * Photo Lightbox — opens full-resolution photo in a dark overlay.
 * Called from attendance table thumbnails (checkin & checkout photos).
 * @param {string} src  - Photo URL
 * @param {string} [label] - Optional label shown at bottom
 */
function openPhotoLightbox(src, label) {
  const overlay = document.getElementById('photoLightboxOverlay');
  const img     = document.getElementById('photoLightboxImg');
  const lbl     = document.getElementById('photoLightboxLabel');
  if (!overlay || !img) return;
  img.src = src;
  if (lbl) lbl.textContent = label || '';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  overlay.onclick = (e) => { if (e.target === overlay) closePhotoLightbox(); };
}

function closePhotoLightbox() {
  const overlay = document.getElementById('photoLightboxOverlay');
  const img     = document.getElementById('photoLightboxImg');
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  if (img) img.src = '';
}

// Close lightbox on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePhotoLightbox();
});

/**
 * ==========================================================================
 * Cumulative Individual Timesheet Feature
 * ==========================================================================
 */
let currentTimesheetEmpId = null;
let cachedTimesheetData = null;
let timesheetListenersBound = false;

async function loadTimesheetsView(preselectedEmpId) {
  if (!currentEmployerSession) return;

  const empSelect = document.getElementById('timesheetEmployeeSelect');
  if (!empSelect) return;

  // Bind controls once
  if (!timesheetListenersBound) {
    timesheetListenersBound = true;

    empSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      if (selectedId) {
        loadEmployeeTimesheet(selectedId);
      } else {
        const contentArea = document.getElementById('timesheetContentArea');
        const emptyPlaceholder = document.getElementById('timesheetEmptyPlaceholder');
        const btnExport = document.getElementById('btnExportIndividualTimesheetCsv');
        const btnPrint = document.getElementById('btnPrintTimesheet');
        if (contentArea) contentArea.style.display = 'none';
        if (emptyPlaceholder) emptyPlaceholder.style.display = 'block';
        if (btnExport) btnExport.disabled = true;
        if (btnPrint) btnPrint.disabled = true;
        currentTimesheetEmpId = null;
      }
    });

    const btnFilter = document.getElementById('btnApplyTimesheetFilter');
    if (btnFilter) {
      btnFilter.addEventListener('click', () => {
        if (currentTimesheetEmpId) {
          loadEmployeeTimesheet(currentTimesheetEmpId);
        }
      });
    }

    const btnExport = document.getElementById('btnExportIndividualTimesheetCsv');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        if (currentTimesheetEmpId) {
          exportPersonTimesheetCsv(currentTimesheetEmpId);
        }
      });
    }

    const searchInput = document.getElementById('tsSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        applyTimesheetSearchFilter();
      });
    }
  }

  // Populate Employee Select Dropdown
  try {
    const res = await adminFetch(`/api/employees?employer_id=${currentEmployerSession.employer_id}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.employees)) {
      const activeId = preselectedEmpId || currentTimesheetEmpId || empSelect.value;
      empSelect.innerHTML = '<option value="">-- Choose Field Worker / Employee --</option>' +
        data.employees.map(e => `
          <option value="${escapeHtml(e.id)}" ${e.id === activeId ? 'selected' : ''}>
            ${escapeHtml(e.name)} (${escapeHtml(e.id)}) · ${escapeHtml(e.department || 'CDER')}
          </option>
        `).join('');

      if (activeId) {
        empSelect.value = activeId;
        await loadEmployeeTimesheet(activeId);
      }
    }
  } catch (err) {
    console.error('Error loading employees for timesheet:', err);
  }
}

window.loadTimesheetsView = loadTimesheetsView;

window.openPersonTimesheet = function(empId) {
  if (!empId) return;
  currentTimesheetEmpId = empId;
  switchView('viewTimesheets', empId);

  const empSelect = document.getElementById('timesheetEmployeeSelect');
  if (empSelect) {
    empSelect.value = empId;
  }

  // Load and display this employee's timesheet immediately
  loadEmployeeTimesheet(empId);

  // Scroll smoothly to top of the timesheet section
  const timesheetPanel = document.getElementById('viewTimesheets');
  if (timesheetPanel) {
    timesheetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

async function loadEmployeeTimesheet(empId) {
  if (!empId) return;
  currentTimesheetEmpId = empId;

  const contentArea = document.getElementById('timesheetContentArea');
  const emptyPlaceholder = document.getElementById('timesheetEmptyPlaceholder');
  const btnExport = document.getElementById('btnExportIndividualTimesheetCsv');
  const btnPrint = document.getElementById('btnPrintTimesheet');
  const tableBody = document.getElementById('tsTableBody');
  const empSelect = document.getElementById('timesheetEmployeeSelect');

  if (empSelect && empSelect.value !== empId) {
    empSelect.value = empId;
  }

  // Immediately reveal timesheet content area and hide empty placeholder
  if (contentArea) contentArea.style.display = 'block';
  if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';

  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--color-text-muted); padding: 32px;">Loading cumulative records for this worker...</td></tr>';
  }

  const startDate = document.getElementById('timesheetStartDate')?.value || '';
  const endDate = document.getElementById('timesheetEndDate')?.value || '';
  const status = document.getElementById('timesheetStatusFilter')?.value || 'ALL';

  let url = `/api/admin/employees/${encodeURIComponent(empId)}/timesheet?status=${encodeURIComponent(status)}`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;

  try {
    const res = await adminFetch(url);
    const data = await res.json();

    if (!data.success) {
      alert(`Could not load timesheet: ${data.error || 'Server error'}`);
      return;
    }

    cachedTimesheetData = data;
    const { employee, summary, records } = data;

    // Show content container
    if (contentArea) contentArea.style.display = 'block';
    if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';
    if (btnExport) btnExport.disabled = false;
    if (btnPrint) btnPrint.disabled = false;

    // Populate Employee Profile Header
    document.getElementById('tsEmployeeName').textContent = employee.name || 'Unnamed Employee';
    document.getElementById('tsEmployeeId').textContent = employee.id || empId;
    document.getElementById('tsDepartment').textContent = employee.department || 'CDER';
    document.getElementById('tsDesignation').textContent = employee.designation || 'Field Research Staff';
    document.getElementById('tsTeam').textContent = employee.team_name || 'Direct Assignment';
    document.getElementById('tsTerritory').textContent = (employee.district ? `${employee.district}, ` : '') + (employee.state || 'AIIMS HQ');
    document.getElementById('tsEmail').textContent = employee.email || 'N/A';
    document.getElementById('tsAvatar').textContent = employee.name ? employee.name.charAt(0).toUpperCase() : '?';

    // Populate 6 Cumulative KPI Metric Cards
    document.getElementById('tsStatTotalShifts').textContent = summary.totalRecords || 0;
    document.getElementById('tsStatCompletedShifts').textContent = `${summary.completedRecords || 0} completed · ${summary.inProgressRecords || 0} active`;

    document.getElementById('tsStatTotalHours').textContent = summary.totalNetWorkingHours != null ? summary.totalNetWorkingHours.toFixed(2) : '0.00';
    document.getElementById('tsStatNetFormatted').textContent = `Net time: ${summary.totalNetWorkingFormatted || '0h 00m'}`;

    document.getElementById('tsStatAvgHours').textContent = summary.avgWorkingHoursPerShift != null ? summary.avgWorkingHoursPerShift.toFixed(2) : '0.00';
    document.getElementById('tsStatAvgFormatted').textContent = `Avg shift length: ${summary.avgWorkingFormatted || '0h 00m'}`;

    document.getElementById('tsStatTotalBreaks').textContent = summary.totalBreakMinutes || 0;
    document.getElementById('tsStatBreakHours').textContent = `${summary.totalBreakHours || '0.00'} cumulative break hours`;

    document.getElementById('tsStatOvertimeHours').textContent = summary.totalOvertimeHours != null ? summary.totalOvertimeHours.toFixed(2) : '0.00';
    document.getElementById('tsStatOvertimeFormatted').textContent = `Total overtime: ${summary.totalOvertimeFormatted || '0h 00m'}`;

    document.getElementById('tsStatCompletionRate').textContent = `${summary.completionRate || 0}%`;
    const dateRangeStr = (summary.firstRecordDate && summary.lastRecordDate) 
      ? `${summary.firstRecordDate} to ${summary.lastRecordDate}` 
      : 'All historical sessions';
    document.getElementById('tsStatDateRange').textContent = dateRangeStr;

    // Populate Hours Balance Bank & Comp-Off KPI Cards
    const balEl = document.getElementById('tsStatHoursBalance');
    const balDescEl = document.getElementById('tsStatHoursBalanceDesc');
    if (balEl && balDescEl) {
      const bal = summary.hoursBalance != null ? summary.hoursBalance : 0;
      balEl.textContent = (bal > 0 ? '+' : '') + bal.toFixed(2);
      if (bal > 0.05) {
        balEl.style.color = '#059669';
        balDescEl.textContent = `Surplus banked vs ${summary.targetShiftHours || 8}h shift target`;
      } else if (bal < -0.05) {
        balEl.style.color = '#dc2626';
        balDescEl.textContent = `Deficit hours vs ${summary.targetShiftHours || 8}h shift target`;
      } else {
        balEl.style.color = '#2563eb';
        balDescEl.textContent = `Balanced shifts vs ${summary.targetShiftHours || 8}h target`;
      }
    }

    const compOffEl = document.getElementById('tsStatCompOffDays');
    const compOffDescEl = document.getElementById('tsStatCompOffDesc');
    if (compOffEl && compOffDescEl) {
      const cDays = summary.totalCompOffEarned != null ? summary.totalCompOffEarned : 0;
      compOffEl.textContent = cDays;
      compOffDescEl.textContent = `${cDays} day${cDays === 1 ? '' : 's'} earned for holiday duty`;
    }

    // Render Detailed Table
    renderTimesheetSessions(records);

  } catch (err) {
    console.error('Error fetching individual timesheet:', err);
    alert(`Failed to load cumulative timesheet: ${err.message}`);
  }
}

function renderTimesheetSessions(records) {
  const tableBody = document.getElementById('tsTableBody');
  if (!tableBody) return;

  if (!records || records.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No attendance sessions found for the selected period.</td></tr>';
    return;
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  tableBody.innerHTML = records.map(r => {
    const dIn = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp) : null;
    const dateStr = dIn ? dIn.toISOString().split('T')[0] : 'N/A';
    const dayStr = dIn ? days[dIn.getUTCDay()] : '';
    const checkinTime = dIn ? dIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A';

    const dOut = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp) : null;
    const checkoutTime = dOut 
      ? dOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
      : '<span class="badge badge-warning" style="font-size: 10px;">In Progress</span>';

    const netHours = r.net_working_seconds != null ? (r.net_working_seconds / 3600).toFixed(2) + 'h' : '0.00h';
    const grossHours = r.gross_working_seconds != null ? (r.gross_working_seconds / 3600).toFixed(2) + 'h' : '0.00h';
    const breakMins = r.break_seconds != null ? Math.round(r.break_seconds / 60) + 'm' : '0m';
    const overtime = (r.overtime_seconds && r.overtime_seconds > 0) ? `+${(r.overtime_seconds / 3600).toFixed(2)}h` : '0h';

    // Photos
    const checkinPhoto = r.checkin_photo 
      ? `<img src="${r.checkin_photo}" class="timesheet-photo-thumb" onclick="openPhotoLightbox('${r.checkin_photo}', 'Check-in: ${escapeHtml(r.employee_name || '')} (${dateStr})')" title="View check-in photo" alt="Checkin">`
      : '<span style="color: var(--color-text-muted); font-size: 11px;">--</span>';

    const checkoutPhoto = r.checkout_photo 
      ? `<img src="${r.checkout_photo}" class="timesheet-photo-thumb" onclick="openPhotoLightbox('${r.checkout_photo}', 'Checkout: ${escapeHtml(r.employee_name || '')} (${dateStr})')" title="View checkout photo" alt="Checkout">`
      : '<span style="color: var(--color-text-muted); font-size: 11px;">--</span>';

    // Location coordinates
    const inPinUrl = r.exact_coordinates_url || (r.checkin_lat != null && r.checkin_lng != null ? `https://www.google.com/maps?q=${Number(r.checkin_lat).toFixed(6)},${Number(r.checkin_lng).toFixed(6)}&t=k` : '');
    const inPinHtml = inPinUrl ? `
      <div style="margin-top: 3px;">
        <a href="${inPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" onclick="event.stopPropagation();" title="View exact GPS pin on Google Maps Satellite">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          <span>${Number(r.checkin_lat).toFixed(5)}°, ${Number(r.checkin_lng).toFixed(5)}°</span>
        </a>
      </div>
    ` : '';

    const isHotelPunch = (r.punch_location_type === 'HOTEL_STAY') || Boolean(r.hotel_name);

    const checkinLoc = `
      ${isHotelPunch ? `
        <span class="badge-location-hotel" style="font-size: 10px; margin-bottom: 2px;">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>
          <span>Hotel Stay</span>
        </span>
      ` : ''}
      <div style="font-size: 11px; font-weight: 500; color: var(--color-text-primary); line-height: 1.3;">
        ${escapeHtml(r.checkin_address || (r.checkin_lat != null ? `${Number(r.checkin_lat).toFixed(4)}°, ${Number(r.checkin_lng).toFixed(4)}°` : 'Premises'))}
      </div>
      <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">
        ${r.checkin_accuracy != null ? `±${Math.round(r.checkin_accuracy)}m accuracy` : ''}
      </div>
      ${inPinHtml}
    `;

    const outPinUrl = (r.checkout_lat != null && r.checkout_lng != null ? `https://www.google.com/maps?q=${Number(r.checkout_lat).toFixed(6)},${Number(r.checkout_lng).toFixed(6)}&t=k` : '');
    const outPinHtml = outPinUrl ? `
      <div style="margin-top: 3px;">
        <a href="${outPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" onclick="event.stopPropagation();" title="View exact GPS pin on Google Maps Satellite">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          <span>${Number(r.checkout_lat).toFixed(5)}°, ${Number(r.checkout_lng).toFixed(5)}°</span>
        </a>
      </div>
    ` : '';

    const checkoutLoc = r.checkout_server_timestamp ? `
      <div style="font-size: 11px; font-weight: 500; color: var(--color-text-primary); line-height: 1.3;">
        ${escapeHtml(r.checkout_address || (r.checkout_lat != null ? `${Number(r.checkout_lat).toFixed(4)}°, ${Number(r.checkout_lng).toFixed(4)}°` : 'Premises'))}
      </div>
      <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">
        ${r.checkout_accuracy != null ? `±${Math.round(r.checkout_accuracy)}m accuracy` : ''}
      </div>
      ${outPinHtml}
    ` : '<span style="color: var(--color-text-muted); font-size: 11px;">--</span>';

    // Status badge
    let statusBadge = '<span class="badge badge-neutral">UNKNOWN</span>';
    if (r.attendance_status === 'PRESENT') statusBadge = '<span class="badge badge-success"><span class="badge-dot"></span>Present</span>';
    else if (r.attendance_status === 'HALF_DAY') statusBadge = '<span class="badge badge-warning">Half Day</span>';
    else if (r.attendance_status === 'OVERTIME') statusBadge = '<span class="badge" style="background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe;">Overtime</span>';
    else if (r.attendance_status === 'CHECKED_IN') statusBadge = '<span class="badge badge-primary">Active Shift</span>';

    const hoursMeta = computeWorkingHoursMeta(r);

    return `
      <tr id="ts-row-${r.id}" class="${hoursMeta.rowClass}">
        <td>
          <div style="font-weight: 600; font-size: 12px; color: var(--color-text-primary);">${dateStr}</div>
          <div style="font-size: 11px; color: var(--color-text-tertiary);">${dayStr}</div>
          ${r.is_holiday_work ? `
            <div style="margin-top: 3px;">
              <span class="badge-compoff" title="Compensatory Off Day Earned: ${escapeHtml(r.holiday_name || 'Holiday Duty')}">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                <span>Comp-Off (${escapeHtml(r.holiday_name || 'Holiday Duty')})</span>
              </span>
            </div>
          ` : ''}
        </td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${checkinTime}</td>
        <td style="max-width: 170px;">${checkinLoc}</td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${checkoutTime}</td>
        <td style="max-width: 170px;">${checkoutLoc}</td>
        <td style="white-space: nowrap;">
          <div style="display: inline-flex; align-items: center; gap: 4px;">
            ${hoursMeta.badgeHtml}
            ${hoursMeta.variancePill || ''}
          </div>
        </td>
        <td style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary);">${grossHours}</td>
        <td style="font-size: 12px;">${breakMins}</td>
        <td style="font-size: 12px; font-weight: 600; color: #7c3aed;">${overtime}</td>
        <td style="max-width: 160px; font-size: 11px; color: var(--color-text-secondary); line-height: 1.3;">
          ${isHotelPunch ? `
            <span class="badge-location-hotel" style="font-size: 10px; margin-bottom: 2px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>
              <span>${escapeHtml(r.hotel_name || 'Hotel Stay')} ${r.hotel_room ? '(Rm ' + escapeHtml(r.hotel_room) + ')' : ''}</span>
            </span><br>
          ` : (r.work_mode === 'TRAVEL' ? `
            <span class="badge" style="background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; font-size: 10px; margin-bottom: 2px; display: inline-flex; align-items: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              <span>Transit / Travel</span>
            </span><br>` : '')}
          ${escapeHtml(r.field_site_notes || (isHotelPunch ? (r.hotel_name || 'Hotel Lodging Stay') : (r.work_mode === 'TRAVEL' ? 'Official Travel / Transit' : 'Routine Field Work')))}
        </td>
        <td>
          <div style="display: flex; gap: 4px; align-items: center;">
            ${checkinPhoto}
            ${checkoutPhoto}
          </div>
        </td>
        <td>${statusBadge}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openAttendanceDrawer('${r.id}')">
            <span>Inspect</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function applyTimesheetSearchFilter() {
  if (!cachedTimesheetData || !cachedTimesheetData.records) return;
  const q = (document.getElementById('tsSearchInput')?.value || '').toLowerCase().trim();
  if (!q) {
    renderTimesheetSessions(cachedTimesheetData.records);
    return;
  }
  const filtered = cachedTimesheetData.records.filter(r => {
    return (
      (r.id && r.id.toLowerCase().includes(q)) ||
      (r.work_mode && r.work_mode.toLowerCase().includes(q)) ||
      (r.checkin_server_timestamp && r.checkin_server_timestamp.toLowerCase().includes(q)) ||
      (r.field_site_notes && r.field_site_notes.toLowerCase().includes(q)) ||
      (r.checkin_address && r.checkin_address.toLowerCase().includes(q)) ||
      (r.checkout_address && r.checkout_address.toLowerCase().includes(q)) ||
      (r.attendance_status && r.attendance_status.toLowerCase().includes(q))
    );
  });
  renderTimesheetSessions(filtered);
}

function exportPersonTimesheetCsv(empId) {
  if (!empId) return;
  const startDate = document.getElementById('timesheetStartDate')?.value || '';
  const endDate = document.getElementById('timesheetEndDate')?.value || '';
  const status = document.getElementById('timesheetStatusFilter')?.value || 'ALL';

  let url = `/api/admin/employees/${encodeURIComponent(empId)}/timesheet/export.csv?status=${encodeURIComponent(status)}`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;

  const a = document.createElement('a');
  a.href = url;
  a.download = `timesheet_${empId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

window.exportPersonTimesheetCsv = exportPersonTimesheetCsv;

/**
 * Official Organization Holidays & Comp-Off Modal Management
 */
async function openHolidaysModal() {
  const modal = document.getElementById('modalManageHolidays');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('active');

  const dateInput = document.getElementById('inputHolidayDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  await loadHolidaysList();
}

function closeHolidaysModal() {
  const modal = document.getElementById('modalManageHolidays');
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.remove('active');
}

window.openHolidaysModal = openHolidaysModal;
window.closeHolidaysModal = closeHolidaysModal;

async function loadHolidaysList() {
  const container = document.getElementById('holidaysListContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--color-text-muted);">Loading official holidays...</div>';

  try {
    const res = await authFetch('/api/admin/holidays');
    const data = await res.json();
    if (!res.ok || !data.success) {
      container.innerHTML = `<div style="text-align: center; padding: 24px; color: #dc2626;">Failed to load holidays: ${escapeHtml(data.error || 'Unknown error')}</div>`;
      return;
    }

    const holidays = data.holidays || [];
    if (holidays.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--color-text-muted);">No official holidays registered yet. Add one above.</div>';
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column;">
        ${holidays.map(h => `
          <div class="holiday-list-item" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--color-border-subtle);">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; font-size: 13px; color: var(--color-text-primary);">${escapeHtml(h.name)}</span>
                <span class="badge badge-neutral" style="font-size: 10px; text-transform: uppercase;">${escapeHtml(h.holiday_type || 'OFFICIAL')}</span>
              </div>
              <div style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); margin-top: 2px;">
                ${h.holiday_date} &middot; Automatic Comp-Off active
              </div>
            </div>
            <button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px;" onclick="handleDeleteHoliday('${escapeHtml(h.id)}', '${escapeHtml(h.name)}')" title="Delete this holiday">
              Delete
            </button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Error fetching holidays:', err);
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: #dc2626;">Network error: ${escapeHtml(err.message)}</div>`;
  }
}

async function handleAddHoliday() {
  const dateInput = document.getElementById('inputHolidayDate');
  const nameInput = document.getElementById('inputHolidayName');
  const typeSelect = document.getElementById('selectHolidayType');

  if (!dateInput || !nameInput) return;
  const holidayDate = dateInput.value;
  const name = nameInput.value.trim();
  const holidayType = typeSelect ? typeSelect.value : 'NATIONAL';

  if (!holidayDate || !name) {
    alert('Please enter both holiday date and title.');
    return;
  }

  try {
    const res = await authFetch('/api/admin/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holiday_date: holidayDate, name, holiday_type: holidayType })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Error saving holiday: ${data.error || 'Server error'}`);
      return;
    }

    nameInput.value = '';
    await loadHolidaysList();
    if (document.getElementById('viewAttendance') && document.getElementById('viewAttendance').style.display !== 'none') {
      loadAttendanceRecords();
    }
  } catch (err) {
    console.error('Error creating holiday:', err);
    alert(`Failed to add holiday: ${err.message}`);
  }
}

async function handleDeleteHoliday(id, name) {
  if (!confirm(`Are you sure you want to remove "${name}" from the official holidays calendar?`)) return;

  try {
    const res = await authFetch(`/api/admin/holidays/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Failed to delete holiday: ${data.error || 'Server error'}`);
      return;
    }

    await loadHolidaysList();
    if (document.getElementById('viewAttendance') && document.getElementById('viewAttendance').style.display !== 'none') {
      loadAttendanceRecords();
    }
  } catch (err) {
    console.error('Error deleting holiday:', err);
    alert(`Failed to delete holiday: ${err.message}`);
  }
}

window.handleAddHoliday = handleAddHoliday;
window.handleDeleteHoliday = handleDeleteHoliday;

/**
 * Field Worker Hotel & Lodging Directory Modal Management
 */
let cachedHotelStays = [];

async function openHotelStaysModal() {
  const modal = document.getElementById('modalManageHotelStays');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('active');

  const searchInput = document.getElementById('inputSearchHotelStays');
  if (searchInput) searchInput.value = '';

  await loadHotelStaysList();
}

function closeHotelStaysModal() {
  const modal = document.getElementById('modalManageHotelStays');
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.remove('active');
}

async function loadHotelStaysList() {
  const container = document.getElementById('hotelStaysListContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--color-text-muted);">Loading hotel stays...</div>';

  try {
    const res = await authFetch('/api/admin/hotel-stays');
    const data = await res.json();
    if (!res.ok || !data.success) {
      container.innerHTML = `<div style="text-align: center; padding: 24px; color: #dc2626;">Failed to load hotel stays: ${escapeHtml(data.error || 'Unknown error')}</div>`;
      return;
    }

    cachedHotelStays = data.stays || [];
    renderHotelStaysList(cachedHotelStays);
  } catch (err) {
    console.error('Error loading hotel stays:', err);
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: #dc2626;">Failed to load hotel stays: ${escapeHtml(err.message)}</div>`;
  }
}

function filterHotelStaysList() {
  const q = (document.getElementById('inputSearchHotelStays')?.value || '').toLowerCase().trim();
  if (!q) {
    renderHotelStaysList(cachedHotelStays);
    return;
  }

  const filtered = cachedHotelStays.filter(s => {
    return (s.employee_name && s.employee_name.toLowerCase().includes(q)) ||
      (s.employee_id && s.employee_id.toLowerCase().includes(q)) ||
      (s.hotel_name && s.hotel_name.toLowerCase().includes(q)) ||
      (s.room_number && s.room_number.toLowerCase().includes(q)) ||
      (s.hotel_address && s.hotel_address.toLowerCase().includes(q)) ||
      (s.hotel_phone && s.hotel_phone.toLowerCase().includes(q));
  });

  renderHotelStaysList(filtered);
}

function renderHotelStaysList(stays) {
  const container = document.getElementById('hotelStaysListContainer');
  if (!container) return;

  if (!stays || stays.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 28px; color: var(--color-text-muted);">No hotel stays registered yet. Field personnel can register their active hotel details directly on the mobile punch portal.</div>';
    return;
  }

  container.innerHTML = stays.map(s => {
    const checkinDate = s.checkin_date || '--';
    const checkoutDate = s.checkout_date || '--';
    const hasGps = s.hotel_lat != null && s.hotel_lng != null;
    const mapPinUrl = hasGps ? `https://www.google.com/maps?q=${Number(s.hotel_lat).toFixed(6)},${Number(s.hotel_lng).toFixed(6)}&t=k` : null;

    return `
      <div class="hotel-stay-card" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding: 12px 16px; border: 1px solid var(--color-border-default); border-radius: 8px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
        <div style="flex: 1; min-width: 0;">
          <!-- Top Row: Employee & Stay Status -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 700; font-size: 13px; color: var(--color-text-primary);">${escapeHtml(s.employee_name || 'Staff Member')}</span>
              <span class="badge badge-neutral" style="font-size: 10px; font-family: var(--font-mono);">${escapeHtml(s.employee_id || '')}</span>
              <span style="font-size: 11px; color: var(--color-text-tertiary);">${escapeHtml(s.department || 'CDER')}</span>
            </div>
            <span class="${s.stay_status === 'ACTIVE' ? 'badge badge-success' : 'badge badge-neutral'}" style="font-size: 10px;">
              ${s.stay_status === 'ACTIVE' ? 'Active Lodging' : 'Past Stay'}
            </span>
          </div>

          <!-- Hotel Name & Room -->
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <div style="font-weight: 700; font-size: 14px; color: #3730a3; display: flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>
              <span>${escapeHtml(s.hotel_name)}</span>
            </div>
            ${s.room_number ? `
              <span style="font-weight: 700; font-size: 12px; padding: 2px 8px; background: #e0e7ff; color: #3730a3; border-radius: 4px;">
                Room ${escapeHtml(s.room_number)}
              </span>
            ` : ''}
          </div>

          <!-- Address -->
          ${s.hotel_address ? `
            <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px; line-height: 1.3;">
              ${escapeHtml(s.hotel_address)}
            </div>
          ` : ''}

          <!-- Phone & Stay Dates Strip -->
          <div style="display: flex; align-items: center; gap: 16px; font-size: 11px; color: var(--color-text-tertiary); margin-top: 6px; flex-wrap: wrap;">
            ${s.hotel_phone ? `
              <div style="display: inline-flex; align-items: center; gap: 4px; color: #4338ca; font-weight: 600;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>Reception: ${escapeHtml(s.hotel_phone)}</span>
              </div>
            ` : ''}
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span>Stay: ${escapeHtml(checkinDate)} &rarr; ${escapeHtml(checkoutDate)}</span>
            </div>
            ${s.booking_ref ? `
              <div>Booking Ref: <strong>${escapeHtml(s.booking_ref)}</strong></div>
            ` : ''}
          </div>

          <!-- Notes -->
          ${s.notes ? `
            <div style="font-size: 11px; color: var(--color-text-muted); font-style: italic; margin-top: 4px;">
              Notes: ${escapeHtml(s.notes)}
            </div>
          ` : ''}
        </div>

        <!-- Right Side: Satellite GPS Map Link & Action -->
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; white-space: nowrap;">
          ${mapPinUrl ? `
            <a href="${mapPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" title="Open Hotel Satellite GPS Pin in Google Maps">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>${Number(s.hotel_lat).toFixed(4)}°, ${Number(s.hotel_lng).toFixed(4)}°</span>
            </a>
          ` : `
            <span style="font-size: 11px; color: var(--color-text-muted);">No GPS coordinates</span>
          `}
          <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="closeHotelStaysModal(); openPersonTimesheet('${escapeHtml(s.employee_id)}')">
            Timesheet &rarr;
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.openHotelStaysModal = openHotelStaysModal;
window.closeHotelStaysModal = closeHotelStaysModal;
window.loadHotelStaysList = loadHotelStaysList;
window.filterHotelStaysList = filterHotelStaysList;

/**
 * Dedicated Hotel Stays Page View
 */
let cachedHotelStaysPage = [];

async function loadHotelStaysPageView() {
  const container = document.getElementById('adminHotelStaysPageList');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; padding: 32px; color: var(--color-text-muted);">Loading field worker hotel directory...</div>';

  try {
    const res = await authFetch('/api/admin/hotel-stays');
    const data = await res.json();
    if (!res.ok || !data.success) {
      container.innerHTML = `<div style="text-align: center; padding: 24px; color: #dc2626;">Failed to load hotel stays: ${escapeHtml(data.error || 'Server error')}</div>`;
      return;
    }

    cachedHotelStaysPage = data.stays || [];
    updateHotelStaysMetrics(cachedHotelStaysPage);
    renderHotelStaysPageView();
  } catch (err) {
    console.error('Error loading hotel stays page view:', err);
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: #dc2626;">Failed to load hotel stays: ${escapeHtml(err.message)}</div>`;
  }
}

function updateHotelStaysMetrics(stays) {
  const total = stays.length;
  const activeStays = stays.filter(s => s.stay_status === 'ACTIVE');
  const activeCount = activeStays.length;
  const uniqueWorkersInActive = new Set(activeStays.map(s => s.employee_id)).size;

  const elTotal = document.getElementById('metricTotalHotelStays');
  const elActive = document.getElementById('metricActiveHotelStays');
  const elWorkers = document.getElementById('metricWorkersInHotels');

  if (elTotal) elTotal.textContent = String(total);
  if (elActive) elActive.textContent = String(activeCount);
  if (elWorkers) elWorkers.textContent = String(uniqueWorkersInActive);
}

function renderHotelStaysPageView() {
  const container = document.getElementById('adminHotelStaysPageList');
  const badge = document.getElementById('hotelStaysCountBadge');
  if (!container) return;

  const searchVal = (document.getElementById('hotelStaysSearchInput')?.value || '').toLowerCase().trim();
  const statusVal = document.getElementById('hotelStaysStatusFilter')?.value || 'ACTIVE';

  let filtered = cachedHotelStaysPage;

  if (statusVal && statusVal !== 'ALL') {
    filtered = filtered.filter(s => s.stay_status === statusVal);
  }

  if (searchVal) {
    filtered = filtered.filter(s => {
      return (s.employee_name && s.employee_name.toLowerCase().includes(searchVal)) ||
        (s.employee_id && s.employee_id.toLowerCase().includes(searchVal)) ||
        (s.department && s.department.toLowerCase().includes(searchVal)) ||
        (s.hotel_name && s.hotel_name.toLowerCase().includes(searchVal)) ||
        (s.room_number && s.room_number.toLowerCase().includes(searchVal)) ||
        (s.hotel_address && s.hotel_address.toLowerCase().includes(searchVal)) ||
        (s.hotel_phone && s.hotel_phone.toLowerCase().includes(searchVal));
    });
  }

  if (badge) {
    badge.textContent = `${filtered.length} Record${filtered.length === 1 ? '' : 's'}`;
    badge.className = filtered.length > 0 ? 'badge badge-primary' : 'badge badge-neutral';
  }

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--color-text-muted);">
        <div style="font-size: 14px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 6px;">No Hotel Stays Found</div>
        <div style="font-size: 12px; max-width: 420px; margin: 0 auto;">
          No lodging records match your active search or filter criteria. Field staff can register hotel details directly from their dedicated mobile portal.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${filtered.map(s => {
        const checkinDate = s.checkin_date ? s.checkin_date.split('T')[0] : '--';
        const checkoutDate = s.checkout_date ? s.checkout_date.split('T')[0] : 'Ongoing';
        const hasGps = s.hotel_lat != null && s.hotel_lng != null;
        const mapPinUrl = hasGps ? `https://www.google.com/maps?q=${Number(s.hotel_lat).toFixed(6)},${Number(s.hotel_lng).toFixed(6)}&t=k` : null;
        const isActive = s.stay_status === 'ACTIVE';

        return `
          <div class="hotel-stay-row-card" style="border: 1px solid var(--color-border-default); border-radius: 8px; padding: 14px 18px; background: #ffffff; transition: box-shadow 0.15s ease;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
              
              <!-- Left: Worker Info & Hotel Identity -->
              <div style="flex: 1; min-width: 260px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
                  <span style="font-weight: 700; font-size: 14px; color: var(--color-text-primary);">${escapeHtml(s.employee_name || 'Staff Member')}</span>
                  <span class="badge badge-neutral" style="font-size: 10px; font-family: var(--font-mono);">${escapeHtml(s.employee_id || '')}</span>
                  <span style="font-size: 11px; color: var(--color-text-tertiary);">${escapeHtml(s.department || 'Field Ops')}</span>
                  ${s.team_name ? `<span class="badge badge-neutral" style="font-size: 10px;">${escapeHtml(s.team_name)}</span>` : ''}
                  <span class="${isActive ? 'badge badge-success' : 'badge badge-neutral'}" style="font-size: 10px; margin-left: auto;">
                    ${isActive ? 'Active Stay' : 'Completed Stay'}
                  </span>
                </div>

                <!-- Hotel Name & Room -->
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
                  <div style="font-weight: 700; font-size: 14px; color: #1e40af; display: inline-flex; align-items: center; gap: 6px;">
                    <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg></span>
                    <span>${escapeHtml(s.hotel_name)}</span>
                  </div>
                  ${s.room_number ? `
                    <span style="font-weight: 700; font-size: 11px; padding: 2px 8px; background: #dbeafe; color: #1e40af; border-radius: 4px;">
                      Room ${escapeHtml(s.room_number)}
                    </span>
                  ` : ''}
                </div>

                <!-- Address -->
                ${s.hotel_address ? `
                  <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 6px; line-height: 1.35;">
                    ${escapeHtml(s.hotel_address)}
                  </div>
                ` : ''}

                <!-- Contact & Stay Dates -->
                <div style="display: flex; align-items: center; gap: 14px; font-size: 11px; color: var(--color-text-tertiary); flex-wrap: wrap;">
                  ${s.hotel_phone ? `
                    <div style="display: inline-flex; align-items: center; gap: 4px; color: #1e3a8a; font-weight: 600;">
                      <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
                      <span>Hotel Reception: ${escapeHtml(s.hotel_phone)}</span>
                    </div>
                  ` : ''}
                  <div style="display: inline-flex; align-items: center; gap: 4px;">
                    <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
                    <span>Duration: <strong>${escapeHtml(checkinDate)}</strong> &rarr; <strong>${escapeHtml(checkoutDate)}</strong></span>
                  </div>
                  ${s.booking_ref ? `<div>Ref: <strong>${escapeHtml(s.booking_ref)}</strong></div>` : ''}
                </div>

                ${s.notes ? `
                  <div style="font-size: 11px; color: var(--color-text-muted); font-style: italic; margin-top: 5px;">
                    Note: ${escapeHtml(s.notes)}
                  </div>
                ` : ''}
              </div>

              <!-- Right: GPS Satellite Link & Worker Timesheet Action -->
              <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 10px; min-width: 140px;">
                ${mapPinUrl ? `
                  <a href="${mapPinUrl}" target="_blank" rel="noopener noreferrer" class="exact-map-pin-link" style="font-size: 12px; font-weight: 600; padding: 4px 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px;" title="Open Hotel Satellite GPS Pin in Google Maps">
                    <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
                    <span>${Number(s.hotel_lat).toFixed(4)}°, ${Number(s.hotel_lng).toFixed(4)}°</span>
                  </a>
                ` : `
                  <span style="font-size: 11px; color: var(--color-text-muted);">No GPS coordinates</span>
                `}

                <button type="button" class="btn btn-secondary" style="padding: 5px 12px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openPersonTimesheet('${escapeHtml(s.employee_id)}')">
                  <span>View Timesheet</span>
                  <span class="ui-icon ui-icon-xs"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>
                </button>
              </div>

            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Wire events for the Hotel Stays page
document.addEventListener('DOMContentLoaded', () => {
  const inputSearch = document.getElementById('hotelStaysSearchInput');
  const selectStatus = document.getElementById('hotelStaysStatusFilter');
  const btnRefresh = document.getElementById('btnRefreshHotelStays');

  if (inputSearch) inputSearch.addEventListener('input', renderHotelStaysPageView);
  if (selectStatus) selectStatus.addEventListener('change', renderHotelStaysPageView);
  if (btnRefresh) btnRefresh.addEventListener('click', loadHotelStaysPageView);
});

window.loadHotelStaysPageView = loadHotelStaysPageView;
window.renderHotelStaysPageView = renderHotelStaysPageView;

/* ==========================================================================
   Leave Management & Attendance Alteration System
   ========================================================================== */
let cachedLeavesData = null;
let currentLeaveDate = '';
let currentLeaveTab = 'UNMARKED'; // 'UNMARKED' | 'RECORDED'

function initLeavesControls() {
  const dateInput = document.getElementById('leaveDatePicker');
  if (dateInput) {
    if (!dateInput.value) {
      const todayStr = new Date().toISOString().split('T')[0];
      dateInput.value = todayStr;
      currentLeaveDate = todayStr;
    }
    dateInput.addEventListener('change', () => {
      currentLeaveDate = dateInput.value;
      loadLeavesView(currentLeaveDate);
    });
  }

  const btnToday = document.getElementById('btnLeaveDateToday');
  if (btnToday) {
    btnToday.addEventListener('click', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      if (dateInput) dateInput.value = todayStr;
      currentLeaveDate = todayStr;
      loadLeavesView(currentLeaveDate);
    });
  }

  const btnYesterday = document.getElementById('btnLeaveDateYesterday');
  if (btnYesterday) {
    btnYesterday.addEventListener('click', () => {
      const yDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      if (dateInput) dateInput.value = yDate;
      currentLeaveDate = yDate;
      loadLeavesView(currentLeaveDate);
    });
  }

  const searchInput = document.getElementById('leaveSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => filterLeavesTables());
  }

  const territoryFilter = document.getElementById('leaveTerritoryFilter');
  if (territoryFilter) {
    territoryFilter.addEventListener('change', () => filterLeavesTables());
  }

  const btnRefresh = document.getElementById('btnRefreshLeaves');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => loadLeavesView(currentLeaveDate));
  }

  const btnSync = document.getElementById('btnSyncUnmarkedLeaves');
  if (btnSync) {
    btnSync.addEventListener('click', handleSyncUnmarkedLeaves);
  }

  const btnRecord = document.getElementById('btnOpenRecordLeaveModal');
  if (btnRecord) {
    btnRecord.addEventListener('click', () => openRecordLeaveModal());
  }

  const btnTabUnmarked = document.getElementById('btnTabUnmarkedLeaves');
  const btnTabRecorded = document.getElementById('btnTabRecordedLeaves');

  if (btnTabUnmarked && btnTabRecorded) {
    btnTabUnmarked.addEventListener('click', () => switchLeaveTab('UNMARKED'));
    btnTabRecorded.addEventListener('click', () => switchLeaveTab('RECORDED'));
  }
}

function switchLeaveTab(tabName) {
  currentLeaveTab = tabName;
  const btnTabUnmarked = document.getElementById('btnTabUnmarkedLeaves');
  const btnTabRecorded = document.getElementById('btnTabRecordedLeaves');
  const panelUnmarked = document.getElementById('panelUnmarkedLeaves');
  const panelRecorded = document.getElementById('panelRecordedLeaves');

  if (tabName === 'UNMARKED') {
    if (btnTabUnmarked) btnTabUnmarked.classList.add('active');
    if (btnTabRecorded) btnTabRecorded.classList.remove('active');
    if (panelUnmarked) panelUnmarked.style.display = 'block';
    if (panelRecorded) panelRecorded.style.display = 'none';
  } else {
    if (btnTabUnmarked) btnTabUnmarked.classList.remove('active');
    if (btnTabRecorded) btnTabRecorded.classList.add('active');
    if (panelUnmarked) panelUnmarked.style.display = 'none';
    if (panelRecorded) panelRecorded.style.display = 'block';
  }
}

async function loadLeavesView(dateStr) {
  if (!currentEmployerSession) return;
  const targetDate = dateStr || currentLeaveDate || new Date().toISOString().split('T')[0];
  currentLeaveDate = targetDate;

  const dateInput = document.getElementById('leaveDatePicker');
  if (dateInput) dateInput.value = targetDate;

  try {
    const res = await adminFetch(`/api/admin/leaves?employer_id=${currentEmployerSession.employer_id}&date=${targetDate}`);
    const data = await res.json();
    if (!data.success) {
      console.warn('Leaves fetch error:', data.error);
      return;
    }

    cachedLeavesData = data;
    renderLeavesMetrics(data.metrics);
    populateLeaveTerritoriesDropdown(data.unmarkedEmployees, data.leaves);
    filterLeavesTables();
  } catch (err) {
    console.error('Error loading leaves view:', err);
  }
}

function renderLeavesMetrics(m) {
  if (!m) return;
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val != null ? String(val) : '--';
  };
  setTxt('metricLeaveTotalStaff', m.totalFieldEmployees);
  setTxt('metricLeavePresent', m.presentCount);
  setTxt('metricLeaveUnmarked', m.unmarkedCount);
  setTxt('metricLeaveOnLeave', m.onLeaveCount);
  setTxt('metricLeaveRegularized', m.regularizedCount);

  const badgeUnmarked = document.getElementById('badgeTabUnmarkedCount');
  if (badgeUnmarked) badgeUnmarked.textContent = String(m.unmarkedCount || 0);

  const badgeRecorded = document.getElementById('badgeTabLeavesCount');
  if (badgeRecorded) badgeRecorded.textContent = String(m.onLeaveCount || 0);
}

function populateLeaveTerritoriesDropdown(unmarkedList = [], leavesList = []) {
  const select = document.getElementById('leaveTerritoryFilter');
  if (!select) return;

  const currentVal = select.value || 'ALL';
  const territories = new Set();
  [...unmarkedList, ...leavesList].forEach(item => {
    if (item.district) territories.add(item.district);
    else if (item.state) territories.add(item.state);
    else if (item.team_name && item.team_name !== 'Direct Assignment') territories.add(item.team_name);
  });

  const sorted = Array.from(territories).sort();
  select.innerHTML = '<option value="ALL">All Territories</option>' +
    sorted.map(t => `<option value="${escapeHtml(t)}" ${t === currentVal ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
}

function filterLeavesTables() {
  if (!cachedLeavesData) return;

  const searchTerm = (document.getElementById('leaveSearchInput')?.value || '').toLowerCase().trim();
  const territoryFilter = document.getElementById('leaveTerritoryFilter')?.value || 'ALL';

  const matchesFilter = (item) => {
    const name = (item.name || item.employee_name || '').toLowerCase();
    const id = (item.id || item.employee_id || '').toLowerCase();
    const dept = (item.department || '').toLowerCase();
    const team = (item.team_name || '').toLowerCase();
    const state = (item.state || '').toLowerCase();
    const dist = (item.district || '').toLowerCase();

    const matchesSearch = !searchTerm || name.includes(searchTerm) || id.includes(searchTerm) ||
      dept.includes(searchTerm) || team.includes(searchTerm) || dist.includes(searchTerm) || state.includes(searchTerm);

    const matchesTerritory = territoryFilter === 'ALL' ||
      item.district === territoryFilter ||
      item.state === territoryFilter ||
      item.team_name === territoryFilter;

    return matchesSearch && matchesTerritory;
  };

  const filteredUnmarked = (cachedLeavesData.unmarkedEmployees || []).filter(matchesFilter);
  const filteredLeaves = (cachedLeavesData.leaves || []).filter(matchesFilter);

  renderUnmarkedStaffTable(filteredUnmarked);
  renderRecordedLeavesTable(filteredLeaves);
}

function renderUnmarkedStaffTable(list) {
  const tbody = document.getElementById('bodyUnmarkedStaff');
  const countBadge = document.getElementById('unmarkedTableCountBadge');
  if (countBadge) countBadge.textContent = `${list.length} field worker${list.length === 1 ? '' : 's'}`;
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No unmarked personnel found for this selection. All active field workers have completed their attendance!</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(emp => {
    const isMissingCheckout = emp.unmarked_status === 'MISSING_CHECKOUT';
    const statusPill = isMissingCheckout
      ? `<span class="badge" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-size: 11px;">Checked In (Missing Checkout)</span>`
      : `<span class="badge-leave-unmarked">No Punch (Absent)</span>`;

    const leaveStatusHtml = emp.is_recorded_on_leave
      ? `<span class="badge badge-leave-casual" title="Already added to leaves list">${escapeHtml(emp.leave_type || 'On Leave')}</span>`
      : `<span style="font-size: 11px; color: var(--color-text-muted);">Not on leave</span>`;

    const territory = emp.district
      ? `${escapeHtml(emp.district)}, ${escapeHtml(emp.state || '')}`
      : (emp.state ? escapeHtml(emp.state) : 'Unassigned');

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 9px;">
            <div class="table-emp-avatar">${escapeHtml((emp.name || 'E').charAt(0))}</div>
            <div>
              <div style="font-weight: 600; color: var(--color-text-primary);">${escapeHtml(emp.name || '')}</div>
              <div style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono);">${escapeHtml(emp.id || '')}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-size: 12px; font-weight: 500; color: var(--color-text-primary);">${escapeHtml(emp.designation || 'Field Staff')}</div>
          <div style="font-size: 11px; color: var(--color-text-muted);">${escapeHtml(emp.department || 'CDER')}</div>
        </td>
        <td>
          <div style="font-size: 12px; font-weight: 500; color: var(--color-text-primary);">${escapeHtml(emp.team_name || 'Direct Assignment')}</div>
          <div style="font-size: 11px; color: var(--color-text-muted); display: inline-flex; align-items: center; gap: 3px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>${territory}</span>
          </div>
        </td>
        <td>${statusPill}</td>
        <td>${leaveStatusHtml}</td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <button type="button" class="btn btn-primary" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openAlterAttendanceModal('${escapeHtml(emp.id)}', '${escapeHtml(currentLeaveDate)}', '${emp.attendance_id || ''}')" title="Alter and regularize verified attendance for this field worker">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>Alter Attendance</span>
            </button>
            ${!emp.is_recorded_on_leave ? `
              <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openRecordLeaveModal('${escapeHtml(emp.id)}')" title="Add this worker to leave roster">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Add to Leaves</span>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderRecordedLeavesTable(list) {
  const tbody = document.getElementById('bodyRecordedLeaves');
  const countBadge = document.getElementById('leavesTableCountBadge');
  if (countBadge) countBadge.textContent = `${list.length} record${list.length === 1 ? '' : 's'}`;
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 32px;">No recorded leaves found for this date.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(lev => {
    let typeBadge = `<span class="badge badge-neutral">${escapeHtml(lev.leave_type)}</span>`;
    if (lev.leave_type === 'UNMARKED_ABSENCE') typeBadge = `<span class="badge-leave-unmarked">Field Absence</span>`;
    else if (lev.leave_type === 'CASUAL_LEAVE') typeBadge = `<span class="badge-leave-casual">Casual Leave</span>`;
    else if (lev.leave_type === 'SICK_LEAVE') typeBadge = `<span class="badge-leave-sick">Sick Leave</span>`;
    else if (lev.leave_type === 'DUTY_TRANSIT') typeBadge = `<span class="badge-leave-duty">Duty Transit</span>`;
    else if (lev.leave_type === 'COMP_OFF') typeBadge = `<span class="badge-leave-compoff">Comp-Off</span>`;

    let statusBadge = `<span class="badge-leave-status-pending">Pending Review</span>`;
    if (lev.status === 'APPROVED') statusBadge = `<span class="badge-leave-status-approved">Approved</span>`;
    else if (lev.status === 'REGULARIZED') statusBadge = `<span class="badge badge-regularized">Regularized to Attendance</span>`;
    else if (lev.status === 'REJECTED') statusBadge = `<span class="badge badge-danger">Rejected</span>`;

    const territory = lev.district
      ? `${escapeHtml(lev.district)}, ${escapeHtml(lev.state || '')}`
      : (lev.state ? escapeHtml(lev.state) : 'Unassigned');

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 9px;">
            <div class="table-emp-avatar">${escapeHtml((lev.employee_name || 'E').charAt(0))}</div>
            <div>
              <div style="font-weight: 600; color: var(--color-text-primary);">${escapeHtml(lev.employee_name || '')}</div>
              <div style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono);">${escapeHtml(lev.employee_id || '')} · ${escapeHtml(lev.department || 'CDER')}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-size: 12px; font-weight: 500; color: var(--color-text-primary);">${escapeHtml(lev.team_name || 'Direct Assignment')}</div>
          <div style="font-size: 11px; color: var(--color-text-muted);">${territory}</div>
        </td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${lev.leave_date ? String(lev.leave_date).split('T')[0] : ''}</td>
        <td>${typeBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="font-size: 12px; color: var(--color-text-primary);">${escapeHtml(lev.reason || 'No remarks provided')}</div>
          ${lev.admin_remarks ? `<div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">Admin: ${escapeHtml(lev.admin_remarks)}</div>` : ''}
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; align-items: center; gap: 5px;">
            <button type="button" class="btn btn-primary" style="padding: 3px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openAlterAttendanceModal('${escapeHtml(lev.employee_id)}', '${lev.leave_date ? String(lev.leave_date).split('T')[0] : ''}', '${lev.regularized_attendance_id || ''}', '${lev.id}')" title="Alter and regularize verified attendance for this leave">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>Alter</span>
            </button>
            ${lev.status !== 'APPROVED' && lev.status !== 'REGULARIZED' ? `
              <button type="button" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="handleApproveLeave('${lev.id}', 'APPROVED')" title="Approve leave">Approve</button>
            ` : ''}
            <button type="button" class="btn btn-danger" style="padding: 3px 8px; font-size: 11px;" onclick="handleDeleteLeave('${lev.id}', '${escapeHtml(lev.employee_name)}')" title="Delete leave record">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleSyncUnmarkedLeaves() {
  if (!currentEmployerSession) return;
  const targetDate = currentLeaveDate || new Date().toISOString().split('T')[0];
  const btn = document.getElementById('btnSyncUnmarkedLeaves');
  const origText = btn ? btn.innerHTML : '';

  if (!confirm(`Add all field workers without marked check-in / check-out on ${targetDate} to the Leave Roster?`)) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('loader') : ''}</span> <span>Adding to Leaves...</span>`;
  }

  try {
    const res = await adminFetch('/api/admin/leaves/sync-unmarked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: targetDate,
        leave_type: 'UNMARKED_ABSENCE',
        reason: 'Unmarked Field Check-In/Check-Out (Pending Regularization)'
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to sync leaves');

    alert(data.message || `Successfully added unmarked workers to leave list.`);
    await loadLeavesView(targetDate);
    switchLeaveTab('RECORDED');
  } catch (err) {
    alert(`Could not add to leaves: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}

function openAlterAttendanceModal(employeeId, defaultDate, attendanceId, leaveId) {
  const modal = document.getElementById('modalAlterAttendance');
  if (!modal) return;

  const targetDate = defaultDate || currentLeaveDate || new Date().toISOString().split('T')[0];
  document.getElementById('alterEmpId').value = employeeId || '';
  document.getElementById('alterDate').value = targetDate;
  document.getElementById('alterAttendanceId').value = attendanceId || '';
  document.getElementById('alterLeaveId').value = leaveId || '';

  // Find employee metadata
  let emp = null;
  if (cachedLeavesData) {
    emp = (cachedLeavesData.unmarkedEmployees || []).find(e => e.id === employeeId) ||
          (cachedLeavesData.leaves || []).find(l => (l.employee_id === employeeId || l.id === leaveId));
  }
  if (!emp && cachedAttendanceRecords) {
    emp = cachedAttendanceRecords.find(r => r.employee_id === employeeId);
  }

  const nameEl = document.getElementById('alterModalEmpName');
  const metaEl = document.getElementById('alterModalEmpMeta');
  const stateInp = document.getElementById('alterState');
  const distInp = document.getElementById('alterDistrict');
  const siteInp = document.getElementById('alterSiteNotes');
  const statusEl = document.getElementById('alterModalCurrentStatus');

  if (nameEl) nameEl.textContent = emp ? (emp.name || emp.employee_name || employeeId) : employeeId;
  if (metaEl) {
    metaEl.textContent = emp
      ? `${employeeId} · ${emp.department || 'Field Department'} · ${emp.team_name || 'Field Unit'}`
      : `${employeeId} · Field Personnel`;
  }
  if (stateInp) stateInp.value = emp ? (emp.state || 'Jammu and Kashmir') : 'Jammu and Kashmir';
  if (distInp) distInp.value = emp ? (emp.district || 'Srinagar') : 'Srinagar';
  if (siteInp) siteInp.value = emp && emp.field_site_notes ? emp.field_site_notes : 'Field Duty Assignment';

  if (statusEl) {
    if (attendanceId) {
      statusEl.textContent = 'Existing Attendance Record';
      statusEl.className = 'badge badge-success';
    } else if (emp && emp.is_recorded_on_leave) {
      statusEl.textContent = 'On Leave Roster (Will Regularize)';
      statusEl.className = 'badge badge-leave-casual';
    } else {
      statusEl.textContent = 'Unmarked Field Absence';
      statusEl.className = 'badge-leave-unmarked';
    }
  }

  // Pre-fill existing attendance details if altering an existing attendance record
  if (attendanceId && cachedAttendanceRecords) {
    const existingRec = cachedAttendanceRecords.find(r => r.id === attendanceId);
    if (existingRec) {
      if (existingRec.checkin_server_timestamp) {
        const d = new Date(existingRec.checkin_server_timestamp);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        document.getElementById('alterCheckinTime').value = `${hh}:${mm}`;
      }
      if (existingRec.checkout_server_timestamp) {
        const d = new Date(existingRec.checkout_server_timestamp);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        document.getElementById('alterCheckoutTime').value = `${hh}:${mm}`;
      }
      if (existingRec.work_mode) document.getElementById('alterWorkMode').value = existingRec.work_mode;
      if (existingRec.regularization_notes) document.getElementById('alterReason').value = existingRec.regularization_notes;
    }
  }

  calculateAlterHoursPreview();
  modal.style.display = 'flex';
}

function closeAlterAttendanceModal() {
  const modal = document.getElementById('modalAlterAttendance');
  if (modal) modal.style.display = 'none';
}

function calculateAlterHoursPreview() {
  const checkinVal = document.getElementById('alterCheckinTime')?.value || '09:00';
  const checkoutVal = document.getElementById('alterCheckoutTime')?.value || '17:30';
  const label = document.getElementById('alterShiftDurationLabel');
  const pill = document.getElementById('alterShiftPill');

  const [inH, inM] = checkinVal.split(':').map(Number);
  const [outH, outM] = checkoutVal.split(':').map(Number);

  let diffMins = (outH * 60 + outM) - (inH * 60 + inM);
  if (diffMins < 0) diffMins += 24 * 60;

  const diffHours = (diffMins / 60);
  const formatted = diffHours.toFixed(2);

  if (label) label.textContent = `Calculated Shift: ${formatted} hours`;

  if (pill) {
    if (diffHours >= 8.0) {
      pill.className = 'badge-hours-green';
      pill.textContent = `Full Shift (${formatted}h >= 8.0h Target)`;
    } else if (diffHours >= 6.0) {
      pill.className = 'badge-hours-yellow';
      pill.textContent = `Partial Shift (${formatted}h)`;
    } else {
      pill.className = 'badge-hours-red';
      pill.textContent = `Short Hours (${formatted}h < 6.0h)`;
    }
  }
}

async function handleSaveAlterAttendance() {
  const empId = document.getElementById('alterEmpId').value;
  const date = document.getElementById('alterDate').value;
  const checkinTime = document.getElementById('alterCheckinTime').value;
  const checkoutTime = document.getElementById('alterCheckoutTime').value;
  const workMode = document.getElementById('alterWorkMode').value;
  const state = document.getElementById('alterState').value;
  const district = document.getElementById('alterDistrict').value;
  const siteNotes = document.getElementById('alterSiteNotes').value;
  const reason = document.getElementById('alterReason').value;
  const attendanceId = document.getElementById('alterAttendanceId').value;
  const leaveId = document.getElementById('alterLeaveId').value;

  if (!empId || !date) {
    alert('Employee ID and Date are required.');
    return;
  }
  if (!reason || !reason.trim()) {
    alert('Please enter an Alteration Reason / Audit Remark for compliance.');
    return;
  }

  const btn = document.getElementById('btnSubmitAlterAttendance');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="ui-icon ui-icon-xs">${window.Icons ? window.Icons.raw('loader') : ''}</span> <span>Saving...</span>`;
  }

  try {
    const res = await adminFetch('/api/admin/attendance/alter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: empId,
        date,
        checkin_time: checkinTime,
        checkout_time: checkoutTime,
        work_mode: workMode,
        state,
        district,
        field_site_notes: siteNotes,
        alteration_reason: reason.trim(),
        attendance_status: 'COMPLETED',
        attendance_id: attendanceId || null,
        leave_id: leaveId || null
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to alter attendance');

    closeAlterAttendanceModal();
    alert(data.message || 'Attendance altered and verified successfully.');

    // Reload leaves and attendance caches
    await loadLeavesView(date);
    if (typeof loadAttendanceRecords === 'function') {
      await loadAttendanceRecords();
    }
  } catch (err) {
    alert(`Could not alter attendance: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function openRecordLeaveModal(prefillEmpId) {
  const modal = document.getElementById('modalRecordLeave');
  if (!modal) return;

  const dateInp = document.getElementById('recordLeaveDate');
  if (dateInp) dateInp.value = currentLeaveDate || new Date().toISOString().split('T')[0];

  const select = document.getElementById('recordLeaveEmployeeSelect');
  if (select) {
    // Populate with employees
    try {
      const res = await adminFetch(`/api/employees?employer_id=${currentEmployerSession.employer_id}`);
      const data = await res.json();
      if (data.success && data.employees) {
        select.innerHTML = '<option value="">-- Select Field Worker --</option>' +
          data.employees.map(e => `
            <option value="${escapeHtml(e.id)}" ${e.id === prefillEmpId ? 'selected' : ''}>
              ${escapeHtml(e.name)} (${escapeHtml(e.id)} - ${escapeHtml(e.department || 'Field')})
            </option>
          `).join('');
      }
    } catch (e) {
      console.warn('Could not populate employee select:', e);
    }
  }

  modal.style.display = 'flex';
}

function closeRecordLeaveModal() {
  const modal = document.getElementById('modalRecordLeave');
  if (modal) modal.style.display = 'none';
}

async function handleSaveRecordLeave() {
  const empId = document.getElementById('recordLeaveEmployeeSelect').value;
  const date = document.getElementById('recordLeaveDate').value;
  const type = document.getElementById('recordLeaveType').value;
  const status = document.getElementById('recordLeaveStatus').value;
  const reason = document.getElementById('recordLeaveReason').value;

  if (!empId || !date) {
    alert('Please select an employee and leave date.');
    return;
  }

  const btn = document.getElementById('btnSubmitRecordLeave');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Saving...';
  }

  try {
    const res = await adminFetch('/api/admin/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: empId,
        leave_date: date,
        leave_type: type,
        status,
        reason: reason || 'Manual leave entry'
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to record leave');

    closeRecordLeaveModal();
    alert('Leave recorded successfully.');
    await loadLeavesView(date);
    switchLeaveTab('RECORDED');
  } catch (err) {
    alert(`Error recording leave: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function handleApproveLeave(leaveId, newStatus) {
  try {
    const res = await adminFetch(`/api/admin/leaves/${leaveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to update leave');
    await loadLeavesView(currentLeaveDate);
  } catch (err) {
    alert(`Could not update leave: ${err.message}`);
  }
}

async function handleDeleteLeave(leaveId, empName) {
  if (!confirm(`Remove leave record for ${empName}?`)) return;
  try {
    const res = await adminFetch(`/api/admin/leaves/${leaveId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to delete leave');
    await loadLeavesView(currentLeaveDate);
  } catch (err) {
    alert(`Could not delete leave: ${err.message}`);
  }
}

window.openAlterAttendanceModal = openAlterAttendanceModal;
window.closeAlterAttendanceModal = closeAlterAttendanceModal;
window.calculateAlterHoursPreview = calculateAlterHoursPreview;
window.handleSaveAlterAttendance = handleSaveAlterAttendance;
window.openRecordLeaveModal = openRecordLeaveModal;
window.closeRecordLeaveModal = closeRecordLeaveModal;
window.handleSaveRecordLeave = handleSaveRecordLeave;
window.handleDeleteLeave = handleDeleteLeave;
window.handleApproveLeave = handleApproveLeave;
window.loadLeavesView = loadLeavesView;


