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

function switchView(viewId) {
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
    viewLeave: { title: 'Leave', breadcrumb: 'Requests & Balance' },
    viewShifts: { title: 'Shifts', breadcrumb: 'Schedules & Calendars' },
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
  if (viewId === 'viewAudit') loadAuditLogs();
  if (viewId === 'viewRedcap') loadRedcapData();
}

window.switchView = switchView;

function handleHashRoute() {
  const hash = (window.location.hash || '').replace('#', '').toLowerCase();
  const hashMap = {
    dashboard: 'viewDashboard',
    teams: 'viewTeams',
    employees: 'viewEmployees',
    attendance: 'viewAttendance',
    leave: 'viewLeave',
    shifts: 'viewShifts',
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

function showAdminLoginModal() {
  document.getElementById('adminLoginModal').classList.add('active');
}

window.fillAdminCreds = function(orgId, username, password) {
  document.getElementById('loginAdminEmployer').value = orgId;
  document.getElementById('loginAdminUsername').value = username;
  document.getElementById('loginAdminPassword').value = password;
  document.getElementById('adminLoginError').style.display = 'none';
};

async function handleAdminLogin(e) {
  e.preventDefault();
  const errorEl = document.getElementById('adminLoginError');
  errorEl.style.display = 'none';

  const payload = {
    employer_id: document.getElementById('loginAdminEmployer').value,
    admin_username: document.getElementById('loginAdminUsername').value.trim(),
    admin_password: document.getElementById('loginAdminPassword').value
  };

  try {
    const res = await fetch('/api/auth/employer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.success) {
      errorEl.textContent = data.error || 'Authentication failed.';
      errorEl.style.display = 'block';
      return;
    }

    currentEmployerSession = {
      employer: data.employer,
      admin_username: data.admin_session.admin_username,
      employer_id: data.employer.id
    };

    localStorage.setItem('apex_employer_admin_session', JSON.stringify(currentEmployerSession));
    document.getElementById('adminLoginModal').classList.remove('active');
    setupLoggedInAdmin(currentEmployerSession);

  } catch (err) {
    errorEl.textContent = 'Connection error during authentication.';
    errorEl.style.display = 'block';
  }
}

async function handleAdminLogout() {
  if (currentEmployerSession) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }
  return headers;
}

/**
 * Load Dashboard Editorial Data
 */
async function loadDashboardData() {
  if (!currentEmployerSession) return;

  try {
    const res = await fetch(`/api/admin/attendance?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
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
          ${r.work_mode === 'FIELD_WORK' ? `
            <span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 10px;">
              🚗 Field Work
            </span>
          ` : `
            <span class="badge ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'badge-neutral' : 'badge-warning'}" style="font-size: 10px;">
              ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? '🏢 In Office' : `⚠️ ${Math.round(r.checkin_geofence_distance || 0)}m`}
            </span>
          `}
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
    const isField = r.work_mode === 'FIELD_WORK';

    return `
      <li class="activity-feed-item" onclick="openAttendanceDrawer('${r.id}')" style="cursor: pointer;">
        <span class="activity-time">${time}</span>
        <span class="activity-dot ${isCompleted ? 'dot-checkout' : 'dot-checkin'}"></span>
        <div class="activity-content">
          <strong>${r.employee_name}</strong> ${isCompleted ? 'completed shift' : (isField ? `checked in on Field Work (${r.field_site_notes || 'On-Site'})` : 'checked in at Office')}
          <div class="activity-sub">GPS: ±${r.checkin_accuracy}m · ${isField ? `🚗 Field Duty · ${r.checkin_address || 'Verified'}` : (r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'Verified In Geofence' : 'Outside Geofence Flagged')}</div>
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
    const res = await fetch(`/api/admin/attendance?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
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
  btnExport.innerHTML = `<span style="display: inline-block;">⏳</span> <span>Exporting...</span>`;

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

    const res = await fetch(`/api/admin/attendance/export.csv?${params.toString()}`, {
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      throw new Error(`Export request returned status ${res.status}`);
    }

    const blob = await res.blob();
    let filename = `attendance_export_${new Date().toISOString().split('T')[0]}.csv`;
    const disposition = res.headers.get('content-disposition');
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename=["']?([^"';]+)["']?/i);
      if (match && match[1]) filename = match[1].trim();
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);

    btnExport.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span style="color: #059669; font-weight: 600;">Downloaded!</span>`;
    setTimeout(() => {
      btnExport.disabled = false;
      btnExport.innerHTML = originalContent;
    }, 2200);
  } catch (err) {
    console.error('Attendance CSV export error:', err);
    alert(`Failed to export attendance CSV: ${err.message}`);
    btnExport.disabled = false;
    btnExport.innerHTML = originalContent;
  }
}

function renderAttendanceMainTable(records) {
  const tbody = document.getElementById('attendanceMainTableBody');
  if (records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; color: var(--color-text-muted); padding: 36px;">
          No matching attendance records found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const checkinTime = new Date(r.checkin_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const checkoutTime = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const netHours = r.net_working_seconds ? `${(r.net_working_seconds / 3600).toFixed(2)}h` : '—';

    let statusBadge = '<span class="badge badge-success"><span class="badge-dot"></span>Working</span>';
    if (r.attendance_status === 'ON_BREAK') statusBadge = '<span class="badge badge-warning"><span class="badge-dot"></span>On Break</span>';
    if (r.attendance_status === 'COMPLETED') statusBadge = '<span class="badge badge-neutral"><span class="badge-dot"></span>Completed</span>';

    const checkinPhoto = r.checkin_photo 
      ? `<img src="${r.checkin_photo}" class="table-thumb-photo" alt="Check-in">` 
      : '—';
    
    const checkoutPhoto = r.checkout_photo 
      ? `<img src="${r.checkout_photo}" class="table-thumb-photo" alt="Checkout">` 
      : '<span style="color: var(--color-text-muted); font-size: 11px;">Pending</span>';

    const isField = r.work_mode === 'FIELD_WORK';

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
        <td>
          <div style="font-weight: 600; font-size: 13px; color: var(--color-text-primary);">${r.team_name || 'Direct Assignment'}</div>
          <span class="team-chip-tag" style="margin-top: 3px;">
            📍 ${r.district ? `${r.district}, ${r.state}` : (r.state || 'Territory Unspecified')}
          </span>
        </td>
        <td style="color: var(--color-text-secondary);">${r.department}</td>
        <td style="font-family: var(--font-mono);">${checkinTime}</td>
        <td>${checkinPhoto}</td>
        <td>
          ${isField ? `
            <span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 10px; margin-bottom: 3px; display: inline-block;">
              🚗 Field Work ${r.field_site_notes ? '· ' + r.field_site_notes : ''}
            </span>
            <div style="font-size: 11px; color: var(--color-text-primary); font-weight: 500; max-width: 210px; white-space: normal; line-height: 1.3;">
              ${r.checkin_address || `${r.checkin_lat.toFixed(4)}°, ${r.checkin_lng.toFixed(4)}°`}
            </div>
            <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">±${r.checkin_accuracy}m accuracy</div>
          ` : `
            <span class="badge ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'badge-neutral' : 'badge-warning'}" style="font-size: 10px; margin-bottom: 3px; display: inline-block;">
              ${r.checkin_geofence_status === 'WITHIN_GEOFENCE' ? '🏢 In Office' : `⚠️ Outside (${Math.round(r.checkin_geofence_distance || 0)}m)`}
            </span>
            <div style="font-size: 11px; color: var(--color-text-secondary); max-width: 200px; white-space: normal; line-height: 1.3;">
              ${r.checkin_address || 'Office Premises'}
            </div>
            <div style="font-size: 10px; color: var(--color-text-muted); font-family: var(--font-mono);">±${r.checkin_accuracy}m accuracy</div>
          `}
        </td>
        <td style="font-family: var(--font-mono);">${checkoutTime}</td>
        <td>${checkoutPhoto}</td>
        <td style="font-family: var(--font-mono); font-weight: 600; color: var(--color-primary);">${netHours}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="event.stopPropagation(); openAttendanceDrawer('${r.id}')">
            View Drawer ➔
          </button>
        </td>
      </tr>
    `;
  }).join('');
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
    const res = await fetch(`/api/admin/attendance/${recordId}?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
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
      territoryBadge.textContent = record.district ? `📍 ${record.district}, ${record.state}` : (record.state ? `📍 ${record.state}` : 'Territory Unspecified');
    }

    // Hours summary
    document.getElementById('drwGrossTime').textContent = `${((record.gross_working_seconds || 0) / 3600).toFixed(2)}h`;
    document.getElementById('drwBreakTime').textContent = `${Math.round((record.break_seconds || 0) / 60)}m`;
    document.getElementById('drwNetTime').textContent = `${((record.net_working_seconds || 0) / 3600).toFixed(2)}h`;
    document.getElementById('drwOvertime').textContent = `${((record.overtime_seconds || 0) / 3600).toFixed(2)}h`;

    const statusBadge = document.getElementById('drawerStatusBadge');
    statusBadge.textContent = record.attendance_status === 'COMPLETED' ? 'Completed Shift' : (record.attendance_status === 'ON_BREAK' ? 'On Break' : 'Active Working');
    statusBadge.className = `badge ${record.attendance_status === 'COMPLETED' ? 'badge-neutral' : 'badge-success'}`;

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
    const isField = record.work_mode === 'FIELD_WORK';
    const geoBadge = document.getElementById('drwGeofenceBadge');
    if (isField) {
      geoBadge.textContent = `🚗 Field Duty (${record.field_site_notes || 'On-Site Verified'})`;
      geoBadge.className = 'badge badge-success';
    } else {
      geoBadge.textContent = record.checkin_geofence_status === 'WITHIN_GEOFENCE' ? '✓ Within Geofence' : `⚠️ Outside Geofence (${Math.round(record.checkin_geofence_distance || 0)}m)`;
      geoBadge.className = `badge ${record.checkin_geofence_status === 'WITHIN_GEOFENCE' ? 'badge-success' : 'badge-warning'}`;
    }
    document.getElementById('drwAddressText').textContent = record.checkin_address || `Coordinates: ${record.checkin_lat.toFixed(5)}° N, ${record.checkin_lng.toFixed(5)}° E`;

    // Breaks list
    const breaksContainer = document.getElementById('drwBreaksList');
    document.getElementById('drwBreakCountLabel').textContent = `${breaks.length} break${breaks.length === 1 ? '' : 's'}`;
    if (breaks && breaks.length > 0) {
      breaksContainer.innerHTML = breaks.map((b, i) => `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--color-border-subtle);">
          <span>Break #${i + 1}: ${new Date(b.start_server_timestamp).toLocaleTimeString()} ➔ ${b.end_server_timestamp ? new Date(b.end_server_timestamp).toLocaleTimeString() : 'In Progress'}</span>
          <span style="font-weight: 600;">${Math.round(b.duration_seconds / 60)} min</span>
        </div>
      `).join('');
    } else {
      breaksContainer.innerHTML = 'No breaks recorded during this shift.';
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
  const isField = record.work_mode === 'FIELD_WORK';
  const popupHtml = isField
    ? `<b>${record.employee_name}</b><br><span style="color:#0284c7;font-weight:600;">🚗 Field Work</span>${record.field_site_notes ? ': ' + record.field_site_notes : ''}<br><small>${record.checkin_address || ''}</small><br>Accuracy: ±${record.checkin_accuracy}m`
    : `<b>${record.employee_name}</b><br>${record.checkin_address || 'Office'}<br>Accuracy: ±${record.checkin_accuracy}m`;

  L.marker([record.checkin_lat, record.checkin_lng]).addTo(drawerMapInstance)
    .bindPopup(popupHtml).openPopup();
}

/**
 * Load Employees Directory
 */
async function loadEmployees() {
  if (!currentEmployerSession) return;

  try {
    const res = await fetch(`/api/employees?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('employeesTableBody');
    tbody.innerHTML = data.employees.map(e => `
      <tr>
        <td>
          <div class="table-user-cell">
            <div class="user-avatar">${e.name.charAt(0)}</div>
            <div>
              <div style="font-weight: 600;">${e.name}</div>
              <div style="font-size: 11px; color: var(--color-text-muted);">${e.email}</div>
            </div>
          </div>
        </td>
        <td style="font-family: var(--font-mono); font-size: 12px;">${e.id}</td>
        <td>${e.department}</td>
        <td>${e.designation}</td>
        <td><span class="badge badge-neutral">Standard Shift (8h)</span></td>
        <td><span class="badge badge-success"><span class="badge-dot"></span>Active</span></td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;">Edit Profile</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading employees:', err);
  }
}

/**
 * Settings & Organization
 */
async function loadSettings() {
  if (!currentEmployerSession) return;

  try {
    const res = await fetch(`/api/admin/settings?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
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
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
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
    const res = await fetch(`/api/admin/audit-logs?employer_id=${currentEmployerSession.employer_id}&limit=50`, {
      headers: getAuthHeaders()
    });
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
    const res = await fetch(`/api/admin/redcap/records?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('redcapRecordsBody');
    const records = data.mockData?.records || [];

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--color-text-muted);">No records synced to REDCap for this employer yet.</td></tr>';
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
    const res = await fetch(`/api/admin/attendance/matrix?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
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
              <span>🏛️</span>
              <span>${s.state}</span>
            </div>
            <span class="state-matrix-badge ${isStateActive ? 'badge-success' : 'badge-neutral'}">
              ${isStateActive ? `🟢 ${s.total_active} Active` : `${s.total_records} Records`}
            </span>
          </div>

          <div class="district-pill-list">
            ${s.districts.map(d => {
              const hasActive = d.active > 0 || d.on_break > 0;
              return `
                <div class="district-pill-item" onclick="filterByDistrict('${s.state}', '${d.district}')" title="Filter attendance for ${d.district}, ${s.state}">
                  <div class="district-pill-name">
                    ${hasActive ? '🟢 ' : '⚪ '}${d.district}
                  </div>
                  <div class="district-pill-stat">
                    ${d.active} working · ${d.completed} done
                  </div>
                </div>
                ${d.teams && d.teams.length > 0 ? `
                  <div style="display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px 6px;">
                    ${d.teams.map(t => `<span class="team-chip-tag" onclick="filterByTeam('${t.id}')" style="cursor: pointer;" title="Filter by ${t.name}">👥 ${t.name}</span>`).join('')}
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
    const res = await fetch(`/api/teams?employer_id=${currentEmployerSession.employer_id}`, {
      headers: getAuthHeaders()
    });
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
        <td><span class="badge badge-neutral" style="font-size: 11px;">🏛️ ${t.state}</span></td>
        <td><span style="font-weight: 500; font-size: 12px;">${t.district}</span></td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${t.member_count} member${t.member_count === 1 ? '' : 's'}</td>
        <td>
          <span class="badge ${t.active_attendance_count > 0 ? 'badge-success' : 'badge-neutral'}">
            ${t.active_attendance_count > 0 ? `🟢 ${t.active_attendance_count} Active` : '0 Active'}
          </span>
        </td>
        <td>
          <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="filterByTeam('${t.id}')">
            View Attendance ➔
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
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: getAuthHeaders(),
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

