// public/ems_client.js
// AIIMS CDER Fieldworker Attendance & Employee Management System (EMS) Client
// Clean light theme, responsive, authoritative live calculation preview, zero emojis

const EmsClient = {
  apiBase: '/api/ems',

  getToken() {
    return localStorage.getItem('token') || 
           localStorage.getItem('adminToken') || 
           localStorage.getItem('ems_token') || 
           '';
  },

  async request(endpoint, options = {}) {
    const url = `${this.apiBase}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data.error || (data.details ? data.details.join(', ') : 'Request failed'));
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  },

  get(endpoint, params = {}) {
    const qs = new URLSearchParams();
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        qs.append(k, params[k]);
      }
    });
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`${endpoint}${query}`, { method: 'GET' });
  },

  post(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

/* ==========================================================================
   EMPLOYEE EMS PORTAL LOGIC
   ========================================================================== */

let currentEmpSubView = 'overview';
let cachedLeaveTypes = [];
let cachedBalances = [];

async function renderEmployeeEmsPage() {
  const container = document.getElementById('panelEmployeeManagement');
  if (!container) return;

  container.innerHTML = `
    <div style="padding: 24px; text-align: center; color: var(--color-text-secondary, #64748b);">
      <div class="spinner" style="margin: 0 auto 12px auto;"></div>
      <div>Loading your Employee Leave Management Portal...</div>
    </div>
  `;

  try {
    const [balRes, typesRes, empRes] = await Promise.all([
      EmsClient.get('/ledger/balances').catch(() => ({ balances: [] })),
      EmsClient.get('/leave-types').catch(() => ({ leaveTypes: [] })),
      EmsClient.get('/auth/me').catch(() => ({ user: null }))
    ]);

    cachedBalances = balRes.balances || [];
    cachedLeaveTypes = typesRes.leaveTypes || [];
    const user = empRes.user || {};

    const clBal = cachedBalances.find(b => (b.leave_type_code || '').toUpperCase() === 'CL') || { current_balance: 0, credited_amount: 8 };
    const elBal = cachedBalances.find(b => (b.leave_type_code || '').toUpperCase() === 'EL') || { current_balance: 0, credited_amount: 15 };
    const rhBal = cachedBalances.find(b => (b.leave_type_code || '').toUpperCase() === 'RH') || { current_balance: 0, credited_amount: 2 };
    const coBal = cachedBalances.find(b => ['CO', 'COMP_OFF'].includes((b.leave_type_code || '').toUpperCase())) || { current_balance: 0, credited_amount: 0 };

    container.innerHTML = `
      <div class="ems-container">
        <!-- Staff Profile Banner -->
        <div class="ems-profile-banner">
          <div class="ems-profile-meta">
            <div class="ems-avatar">${EmsClient.escapeHtml((user.name || 'Staff').charAt(0).toUpperCase())}</div>
            <div>
              <div class="ems-profile-name">${EmsClient.escapeHtml(user.name || 'AIIMS Field Staff')}</div>
              <div class="ems-profile-details">
                <span><strong>ID:</strong> ${EmsClient.escapeHtml(user.employee_id || 'AIIMS')}</span>
                <span><strong>Designation:</strong> ${EmsClient.escapeHtml(user.designation || 'Field Officer')}</span>
                <span><strong>Department:</strong> ${EmsClient.escapeHtml(user.department || 'CDER')}</span>
                <span class="badge ${user.is_field_worker ? 'badge-primary' : 'badge-neutral'}">
                  ${user.is_field_worker ? 'Field Worker (Comp-Off Eligible)' : 'Hospital Duty'}
                </span>
              </div>
            </div>
          </div>
          <div>
            <button type="button" class="btn btn-primary" onclick="switchEmpSubView('apply')" style="display: inline-flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              <span>Apply for Leave</span>
            </button>
          </div>
        </div>

        <!-- Real-Time Leave Balances Grid -->
        <div class="ems-balance-grid">
          <div class="ems-balance-card cl">
            <div class="ems-card-code">Casual Leave</div>
            <div class="ems-card-title">CL Balance</div>
            <div class="ems-card-val">${Number(clBal.current_balance || 0).toFixed(1)}</div>
            <div class="ems-card-sub">
              <span>Annual Entitlement: ${clBal.credited_amount || 8}d</span>
              <span>Available</span>
            </div>
          </div>

          <div class="ems-balance-card el">
            <div class="ems-card-code">Earned Leave</div>
            <div class="ems-card-title">EL Balance</div>
            <div class="ems-card-val">${Number(elBal.current_balance || 0).toFixed(1)}</div>
            <div class="ems-card-sub">
              <span>Credited to Date: ${elBal.credited_amount || 0}d</span>
              <span>Bi-annual 15d</span>
            </div>
          </div>

          <div class="ems-balance-card rh">
            <div class="ems-card-code">Restricted Holiday</div>
            <div class="ems-card-title">RH Balance</div>
            <div class="ems-card-val">${Number(rhBal.current_balance || 0).toFixed(1)}</div>
            <div class="ems-card-sub">
              <span>Entitlement: ${rhBal.credited_amount || 2}d / yr</span>
              <span>Calendar RH</span>
            </div>
          </div>

          <div class="ems-balance-card co">
            <div class="ems-card-code">Compensatory Off</div>
            <div class="ems-card-title">Comp-Off Balance</div>
            <div class="ems-card-val">${Number(coBal.current_balance || 0).toFixed(1)}</div>
            <div class="ems-card-sub">
              <span>Sunday / Holiday Duty</span>
              <span>1 Mo. Validity</span>
            </div>
          </div>
        </div>

        <!-- Sub-Navigation Bar -->
        <div class="ems-subnav">
          <button type="button" class="ems-subnav-btn ${currentEmpSubView === 'overview' ? 'active' : ''}" onclick="switchEmpSubView('overview')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
            <span>Overview &amp; Requests</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentEmpSubView === 'apply' ? 'active' : ''}" onclick="switchEmpSubView('apply')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Apply for Leave</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentEmpSubView === 'ledger' ? 'active' : ''}" onclick="switchEmpSubView('ledger')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span>Leave Ledger &amp; History</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentEmpSubView === 'holidays' ? 'active' : ''}" onclick="switchEmpSubView('holidays')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>Holidays &amp; Policies</span>
          </button>
          ${user.is_field_worker ? `
            <button type="button" class="ems-subnav-btn ${currentEmpSubView === 'compoff' ? 'active' : ''}" onclick="switchEmpSubView('compoff')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              <span>Claim Comp-Off</span>
            </button>
          ` : ''}
        </div>

        <!-- Sub-View Content Container -->
        <div id="emsEmpSubViewContainer"></div>
      </div>
    `;

    renderEmpSubViewContent();
  } catch (err) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #dc2626;">
        <p><strong>Failed to load Employee Management:</strong> ${EmsClient.escapeHtml(err.message)}</p>
        <button type="button" class="btn btn-secondary" onclick="renderEmployeeEmsPage()" style="margin-top: 10px;">Retry</button>
      </div>
    `;
  }
}

function switchEmpSubView(subview) {
  currentEmpSubView = subview;
  document.querySelectorAll('.ems-subnav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('.ems-subnav-btn')).find(b => b.getAttribute('onclick')?.includes(`'${subview}'`));
  if (activeBtn) activeBtn.classList.add('active');
  renderEmpSubViewContent();
}

async function renderEmpSubViewContent() {
  const container = document.getElementById('emsEmpSubViewContainer');
  if (!container) return;

  if (currentEmpSubView === 'overview') {
    await renderEmpOverviewView(container);
  } else if (currentEmpSubView === 'apply') {
    renderEmpApplyView(container);
  } else if (currentEmpSubView === 'ledger') {
    await renderEmpLedgerView(container);
  } else if (currentEmpSubView === 'holidays') {
    await renderEmpHolidaysView(container);
  } else if (currentEmpSubView === 'compoff') {
    renderEmpCompOffClaimView(container);
  }
}

/* 1. Employee Overview: Recent Applications & Status */
async function renderEmpOverviewView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/leave/requests');
    const requests = res.requests || [];

    if (requests.length === 0) {
      container.innerHTML = `
        <div class="ems-card" style="text-align: center; padding: 48px 24px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #94a3b8; margin-bottom: 12px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <h3 style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 6px 0;">No Leave Applications Recorded</h3>
          <p style="font-size: 13px; color: #64748b; max-width: 400px; margin: 0 auto 16px auto;">You have not submitted any leave requests yet. Click below to apply for Casual Leave, Earned Leave, or Restricted Holidays.</p>
          <button type="button" class="btn btn-primary" onclick="switchEmpSubView('apply')">Apply for Leave Now</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Your Leave Applications (${requests.length})</h3>
          <button type="button" class="btn btn-secondary btn-sm" onclick="renderEmpOverviewView(document.getElementById('emsEmpSubViewContainer'))">
            Refresh
          </button>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Request #</th>
                <th>Leave Type</th>
                <th>Dates</th>
                <th>Chargeable</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Review Remarks</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${requests.map(r => {
                const badgeClass = {
                  PENDING: 'ems-badge-pending',
                  APPROVED: 'ems-badge-approved',
                  REJECTED: 'ems-badge-rejected',
                  HOLD: 'ems-badge-hold',
                  CANCELLED: 'ems-badge-cancelled'
                }[r.status] || 'ems-badge-pending';

                const canCancel = r.status === 'PENDING';

                return `
                  <tr>
                    <td><strong>${EmsClient.escapeHtml(r.request_number)}</strong></td>
                    <td><span class="badge badge-neutral">${EmsClient.escapeHtml(r.leave_code || r.leave_name || 'LEAVE')}</span></td>
                    <td>
                      <div>${EmsClient.escapeHtml(r.from_date)} to ${EmsClient.escapeHtml(r.to_date)}</div>
                      <div style="font-size: 11px; color: #64748b;">${r.is_half_day ? 'Half Day' : `${r.requested_calendar_days} calendar days`}</div>
                    </td>
                    <td><strong>${r.chargeable_days} day(s)</strong></td>
                    <td style="max-width: 200px; font-size: 12px; color: #334155;">${EmsClient.escapeHtml(r.reason)}</td>
                    <td><span class="ems-badge ${badgeClass}">${EmsClient.escapeHtml(r.status)}</span></td>
                    <td style="font-size: 12px; color: #475569;">${r.review_remarks ? EmsClient.escapeHtml(r.review_remarks) : '<span style="color:#94a3b8;">&mdash;</span>'}</td>
                    <td>
                      ${canCancel ? `
                        <button type="button" class="btn btn-secondary btn-sm" onclick="cancelEmpLeaveRequest(${r.id})">
                          Cancel
                        </button>
                      ` : '<span style="color:#94a3b8; font-size: 11px;">Completed</span>'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load requests: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

/* 2. Employee Apply for Leave with Live Calculation Preview */
function renderEmpApplyView(container) {
  container.innerHTML = `
    <div class="ems-card" style="max-width: 800px; margin: 0 auto;">
      <div class="ems-card-header">
        <h3 class="ems-card-heading">Submit Leave Application</h3>
        <span class="badge badge-primary">Authoritative Server Calculation</span>
      </div>

      <form id="emsApplyForm" onsubmit="handleEmpSubmitLeave(event)">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div>
            <label class="form-label" for="emsLeaveType">Leave Type *</label>
            <select id="emsLeaveType" class="form-select" required onchange="triggerLiveCalcPreview()">
              <option value="">-- Select Leave Type --</option>
              ${cachedLeaveTypes.map(t => {
                const bal = cachedBalances.find(b => b.leave_type_id === t.id);
                const avail = bal ? bal.current_balance : 0;
                return `<option value="${t.id}" data-half="${t.allow_half_day}">${EmsClient.escapeHtml(t.name)} (${t.code}) &mdash; Available: ${avail}d</option>`;
              }).join('')}
            </select>
          </div>

          <div id="emsHalfDayBox" style="display: flex; flex-direction: column; justify-content: flex-end;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; cursor: pointer; margin-bottom: 8px;">
              <input type="checkbox" id="emsIsHalfDay" onchange="toggleHalfDayOptions()">
              <span>Half Day Request</span>
            </label>
            <select id="emsHalfSession" class="form-select" style="display: none;" onchange="triggerLiveCalcPreview()">
              <option value="FIRST_HALF">First Half (Forenoon)</option>
              <option value="SECOND_HALF">Second Half (Afternoon)</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
          <div>
            <label class="form-label" for="emsFromDate">From Date *</label>
            <input type="date" id="emsFromDate" class="form-input" required onchange="triggerLiveCalcPreview()">
          </div>
          <div>
            <label class="form-label" for="emsToDate">To Date *</label>
            <input type="date" id="emsToDate" class="form-input" required onchange="triggerLiveCalcPreview()">
          </div>
        </div>

        <!-- Live Calculation Preview Container -->
        <div id="emsLiveCalcBox" style="display: none;"></div>

        <div style="margin-bottom: 16px;">
          <label class="form-label" for="emsReason">Reason for Absence *</label>
          <textarea id="emsReason" class="form-input" rows="3" placeholder="Provide detailed official reason for leave request" required></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="switchEmpSubView('overview')">Cancel</button>
          <button type="submit" id="btnSubmitEmsLeave" class="btn btn-primary" style="padding: 9px 22px;">
            Submit Leave Request
          </button>
        </div>
      </form>
    </div>
  `;
}

function toggleHalfDayOptions() {
  const isHalf = document.getElementById('emsIsHalfDay')?.checked;
  const sessionBox = document.getElementById('emsHalfSession');
  if (sessionBox) sessionBox.style.display = isHalf ? 'block' : 'none';
  triggerLiveCalcPreview();
}

async function triggerLiveCalcPreview() {
  const leaveTypeId = document.getElementById('emsLeaveType')?.value;
  const fromDate = document.getElementById('emsFromDate')?.value;
  const toDate = document.getElementById('emsToDate')?.value;
  const isHalfDay = document.getElementById('emsIsHalfDay')?.checked || false;
  const halfDaySession = document.getElementById('emsHalfSession')?.value || 'FIRST_HALF';
  const box = document.getElementById('emsLiveCalcBox');

  if (!box) return;
  if (!leaveTypeId || !fromDate || !toDate) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = `<div style="font-size: 12px; color: #64748b; padding: 10px;"><div class="spinner" style="display:inline-block; vertical-align:middle; width:14px; height:14px; margin-right:6px;"></div> Calculating chargeable days &amp; evaluating policy rules...</div>`;

  try {
    const res = await EmsClient.post('/leave/calculate', {
      leaveTypeId: Number(leaveTypeId),
      fromDate,
      toDate,
      isHalfDay,
      halfDaySession
    });

    const calc = res.calculation || {};
    const bal = res.balanceInfo || {};
    const errors = res.errors || [];
    const hasError = !res.isValid;

    box.className = `ems-calc-preview ${hasError ? 'has-error' : ''}`;
    box.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; font-weight: 700; color: ${hasError ? '#991b1b' : '#065f46'};">
          ${hasError ? 'Policy Validation Warning' : 'Calculation & Policy Preview'}
        </span>
        <span style="font-size: 11px; color: #64748b;">${EmsClient.escapeHtml(res.rule?.rule_name || 'Standard Leave Policy')}</span>
      </div>

      <div class="ems-calc-grid">
        <div class="ems-calc-cell">
          <div class="ems-calc-cell-label">Calendar</div>
          <div class="ems-calc-cell-val">${calc.calendarDays || 0}d</div>
        </div>
        <div class="ems-calc-cell">
          <div class="ems-calc-cell-label">Weekly Offs Excl.</div>
          <div class="ems-calc-cell-val">${calc.weeklyOffDays || 0}d</div>
        </div>
        <div class="ems-calc-cell">
          <div class="ems-calc-cell-label">Holidays Excl.</div>
          <div class="ems-calc-cell-val">${calc.holidayDays || 0}d</div>
        </div>
        <div class="ems-calc-cell">
          <div class="ems-calc-cell-label">Sandwich Chg.</div>
          <div class="ems-calc-cell-val">${calc.sandwichDays || 0}d</div>
        </div>
        <div class="ems-calc-cell" style="background: ${hasError ? '#fef2f2' : '#f0fdf4'}; border-color: ${hasError ? '#fca5a5' : '#86efac'};">
          <div class="ems-calc-cell-label">Net Chargeable</div>
          <div class="ems-calc-cell-val chargeable">${calc.chargeableDays || 0}d</div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 11.5px; color: #475569;">
        <span>Current Available: <strong>${bal.current_balance || 0}d</strong></span>
        <span>Balance After Deduction: <strong>${Number(bal.balance_after_request || 0).toFixed(1)}d</strong></span>
      </div>

      ${errors.length > 0 ? `
        <div style="margin-top: 10px; padding: 8px 12px; background: #fee2e2; border-radius: 6px; font-size: 12px; color: #991b1b;">
          ${errors.map(e => `<div>&bull; ${EmsClient.escapeHtml(e)}</div>`).join('')}
        </div>
      ` : ''}
    `;
  } catch (err) {
    box.className = 'ems-calc-preview has-error';
    box.innerHTML = `<div style="font-size: 12px; color: #991b1b;">Calculation failed: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

async function handleEmpSubmitLeave(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitEmsLeave');
  if (btn) btn.disabled = true;

  try {
    const leaveTypeId = Number(document.getElementById('emsLeaveType').value);
    const fromDate = document.getElementById('emsFromDate').value;
    const toDate = document.getElementById('emsToDate').value;
    const isHalfDay = document.getElementById('emsIsHalfDay')?.checked || false;
    const halfDaySession = document.getElementById('emsHalfSession')?.value || 'FIRST_HALF';
    const reason = document.getElementById('emsReason').value.trim();

    const res = await EmsClient.post('/leave/requests', {
      leaveTypeId,
      fromDate,
      toDate,
      isHalfDay,
      halfDaySession,
      reason
    });

    alert(res.message || 'Leave request submitted successfully.');
    await renderEmployeeEmsPage();
    switchEmpSubView('overview');
  } catch (err) {
    alert(`Could not submit leave: ${err.message}`);
    if (btn) btn.disabled = false;
  }
}

async function cancelEmpLeaveRequest(id) {
  if (!confirm('Are you sure you want to cancel this pending leave request?')) return;
  try {
    await EmsClient.post(`/leave/requests/${id}/review`, {
      action: 'CANCEL',
      remarks: 'Cancelled by employee'
    });
    alert('Leave request cancelled.');
    renderEmpOverviewView(document.getElementById('emsEmpSubViewContainer'));
  } catch (err) {
    alert(`Failed to cancel request: ${err.message}`);
  }
}

/* 3. Employee Leave Ledger History */
async function renderEmpLedgerView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/ledger/transactions');
    const txs = res.transactions || [];

    if (txs.length === 0) {
      container.innerHTML = `<div class="ems-card" style="text-align: center; color: #64748b;">No ledger transactions recorded yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Leave Transaction Ledger (Double-Entry Audit History)</h3>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Leave Type</th>
                <th>Transaction Type</th>
                <th>Amount</th>
                <th>Running Balance</th>
                <th>Reference</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${txs.map(t => {
                const isPositive = Number(t.amount) > 0;
                return `
                  <tr>
                    <td>${EmsClient.escapeHtml((t.created_at || '').slice(0, 16).replace('T', ' '))}</td>
                    <td><span class="badge badge-neutral">${EmsClient.escapeHtml(t.leave_type_code || 'LEAVE')}</span></td>
                    <td><code>${EmsClient.escapeHtml(t.transaction_type)}</code></td>
                    <td style="color: ${isPositive ? '#059669' : '#dc2626'}; font-weight: 700;">
                      ${isPositive ? `+${t.amount}` : t.amount}d
                    </td>
                    <td><strong>${Number(t.running_balance).toFixed(1)}d</strong></td>
                    <td style="font-size: 11.5px; color: #64748b;">${EmsClient.escapeHtml(t.reference_id || '&mdash;')}</td>
                    <td style="font-size: 12px; color: #334155;">${EmsClient.escapeHtml(t.remarks || '')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load ledger: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

/* 4. Employee Holidays Calendar */
async function renderEmpHolidaysView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/holidays');
    const holidays = res.holidays || [];

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Official Calendar &amp; Holidays (${holidays.length})</h3>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Holiday Name</th>
                <th>Type</th>
                <th>Applicable Location</th>
              </tr>
            </thead>
            <tbody>
              ${holidays.map(h => `
                <tr>
                  <td><strong>${EmsClient.escapeHtml(h.holiday_date)}</strong></td>
                  <td>${EmsClient.escapeHtml(h.holiday_name)}</td>
                  <td>
                    <span class="badge ${h.holiday_type === 'RESTRICTED' ? 'badge-warning' : 'badge-primary'}">
                      ${EmsClient.escapeHtml(h.holiday_type)}
                    </span>
                  </td>
                  <td>${EmsClient.escapeHtml(h.location || 'ALL')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load holidays: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

/* 5. Employee Claim Comp-Off */
function renderEmpCompOffClaimView(container) {
  container.innerHTML = `
    <div class="ems-card" style="max-width: 600px; margin: 0 auto;">
      <div class="ems-card-header">
        <h3 class="ems-card-heading">Claim Compensatory Off</h3>
        <span class="badge badge-primary">Field Duty Only</span>
      </div>

      <form id="emsCompOffForm" onsubmit="handleEmpSubmitCompOff(event)">
        <div style="margin-bottom: 16px;">
          <label class="form-label" for="emsWorkedDate">Worked Date (Sunday / Gazetted Holiday) *</label>
          <input type="date" id="emsWorkedDate" class="form-input" required>
        </div>

        <div style="margin-bottom: 16px;">
          <label class="form-label" for="emsDutyType">Duty Qualification *</label>
          <select id="emsDutyType" class="form-select" required>
            <option value="SUNDAY">Sunday Field Duty</option>
            <option value="HOLIDAY">Gazetted Holiday Field Duty</option>
            <option value="EMERGENCY_DUTY">Emergency Outbreak Investigation</option>
          </select>
        </div>

        <div style="margin-bottom: 16px;">
          <label class="form-label" for="emsDutyReason">Reason &amp; Location of Duty *</label>
          <textarea id="emsDutyReason" class="form-input" rows="3" placeholder="Describe the field visit, survey, or clinical duty performed" required></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="submit" class="btn btn-primary">Submit Comp-Off Claim</button>
        </div>
      </form>
    </div>
  `;
}

async function handleEmpSubmitCompOff(e) {
  e.preventDefault();
  try {
    const workedDate = document.getElementById('emsWorkedDate').value;
    const qualifyingDayType = document.getElementById('emsDutyType').value;
    const reason = document.getElementById('emsDutyReason').value.trim();

    await EmsClient.post('/comp-off/claim', { workedDate, qualifyingDayType, reason });
    alert('Compensatory off claim submitted for administrator approval.');
    switchEmpSubView('overview');
  } catch (err) {
    alert(`Could not submit claim: ${err.message}`);
  }
}

/* ==========================================================================
   ADMINISTRATOR EMS PORTAL LOGIC
   ========================================================================== */

let currentAdminSubView = 'pending';
let cachedAdminRequests = [];

async function loadEmsAdminView(initialSubView) {
  const container = document.getElementById('viewEmsAdmin');
  if (!container) return;

  if (initialSubView) currentAdminSubView = initialSubView;

  container.innerHTML = `
    <div style="padding: 24px; text-align: center; color: var(--color-text-secondary, #64748b);">
      <div class="spinner" style="margin: 0 auto 12px auto;"></div>
      <div>Loading Employee Management &amp; Leave Governance Console...</div>
    </div>
  `;

  try {
    const summary = await EmsClient.get('/reports/summary').catch(() => ({ metrics: {} }));
    const m = summary.metrics || {};

    container.innerHTML = `
      <div class="ems-container">
        <!-- Administrator KPI Summary -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 10px;">
          <div class="surface-card" style="padding: 16px 20px; border-left: 4px solid #d97706;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #b45309; margin-bottom: 4px;">Pending Leave Requests</div>
            <div style="font-size: 26px; font-weight: 800; color: #d97706;" id="emsAdminKpiPending">${m.pendingRequestsCount || 0}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Awaiting supervisory decision</div>
          </div>
          <div class="surface-card" style="padding: 16px 20px; border-left: 4px solid #059669;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #047857; margin-bottom: 4px;">Approved Leaves</div>
            <div style="font-size: 26px; font-weight: 800; color: #059669;">${m.approvedRequestsCount || 0}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Verified deductions on ledger</div>
          </div>
          <div class="surface-card" style="padding: 16px 20px; border-left: 4px solid #0284c7;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0369a1; margin-bottom: 4px;">Total Field Staff</div>
            <div style="font-size: 26px; font-weight: 800; color: #0284c7;">${m.totalEmployeesCount || 0}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Enrolled across CDER divisions</div>
          </div>
          <div class="surface-card" style="padding: 16px 20px; border-left: 4px solid #7c3aed;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6d28d9; margin-bottom: 4px;">Active Leave Policies</div>
            <div style="font-size: 26px; font-weight: 800; color: #7c3aed;">${m.activeRuleVersionsCount || 4}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Dynamic versioned rule engines</div>
          </div>
        </div>

        <!-- Admin Sub Navigation Tabs -->
        <div class="ems-subnav">
          <button type="button" class="ems-subnav-btn ${currentAdminSubView === 'pending' ? 'active' : ''}" onclick="switchAdminSubView('pending')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Pending Approvals (${m.pendingRequestsCount || 0})</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentAdminSubView === 'all_requests' ? 'active' : ''}" onclick="switchAdminSubView('all_requests')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>All Leave Requests</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentAdminSubView === 'balances' ? 'active' : ''}" onclick="switchAdminSubView('balances')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Staff Balances &amp; Adjustments</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentAdminSubView === 'policies' ? 'active' : ''}" onclick="switchAdminSubView('policies')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Rules &amp; Policies</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentAdminSubView === 'compoff' ? 'active' : ''}" onclick="switchAdminSubView('compoff')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span>Comp-Off Approvals</span>
          </button>
          <button type="button" class="ems-subnav-btn ${currentAdminSubView === 'audit' ? 'active' : ''}" onclick="switchAdminSubView('audit')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>Audit Trail</span>
          </button>
        </div>

        <!-- Admin View Container -->
        <div id="emsAdminSubViewContainer"></div>
      </div>
    `;

    renderAdminSubViewContent();
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load Admin EMS: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

function switchAdminSubView(subview) {
  currentAdminSubView = subview;
  document.querySelectorAll('.ems-subnav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('.ems-subnav-btn')).find(b => b.getAttribute('onclick')?.includes(`'${subview}'`));
  if (activeBtn) activeBtn.classList.add('active');
  renderAdminSubViewContent();
}

async function renderAdminSubViewContent() {
  const container = document.getElementById('emsAdminSubViewContainer');
  if (!container) return;

  if (currentAdminSubView === 'pending') {
    await renderAdminPendingView(container);
  } else if (currentAdminSubView === 'all_requests') {
    await renderAdminAllRequestsView(container);
  } else if (currentAdminSubView === 'balances') {
    await renderAdminBalancesView(container);
  } else if (currentAdminSubView === 'policies') {
    await renderAdminPoliciesView(container);
  } else if (currentAdminSubView === 'compoff') {
    await renderAdminCompOffView(container);
  } else if (currentAdminSubView === 'audit') {
    await renderAdminAuditView(container);
  }
}

/* 1. Admin Pending Approvals */
async function renderAdminPendingView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/leave/requests', { status: 'PENDING' });
    const requests = res.requests || [];
    cachedAdminRequests = requests;

    if (requests.length === 0) {
      container.innerHTML = `
        <div class="ems-card" style="text-align: center; padding: 48px 24px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #059669; margin-bottom: 12px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <h3 style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 6px 0;">All Clear! No Pending Requests</h3>
          <p style="font-size: 13px; color: #64748b;">There are no employee leave applications awaiting review.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Pending Leave Applications Awaiting Review (${requests.length})</h3>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Request #</th>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Dates</th>
                <th>Chargeable</th>
                <th>Available Bal.</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${requests.map(r => `
                <tr>
                  <td><strong>${EmsClient.escapeHtml(r.request_number)}</strong></td>
                  <td>
                    <div style="font-weight: 600;">${EmsClient.escapeHtml(r.employee_name || 'Staff')}</div>
                    <div style="font-size: 11px; color: #64748b;">ID: ${EmsClient.escapeHtml(r.employee_id)}</div>
                  </td>
                  <td><span class="badge badge-neutral">${EmsClient.escapeHtml(r.leave_code || r.leave_name || 'LEAVE')}</span></td>
                  <td>
                    <div>${EmsClient.escapeHtml(r.from_date)} to ${EmsClient.escapeHtml(r.to_date)}</div>
                    <div style="font-size: 11px; color: #64748b;">${r.requested_calendar_days} cal days</div>
                  </td>
                  <td><strong>${r.chargeable_days} day(s)</strong></td>
                  <td><span class="badge ${Number(r.current_balance || 0) >= Number(r.chargeable_days) ? 'badge-primary' : 'badge-danger'}">${Number(r.current_balance || 0).toFixed(1)}d</span></td>
                  <td style="max-width: 200px; font-size: 12px; color: #334155;">${EmsClient.escapeHtml(r.reason)}</td>
                  <td>
                    <button type="button" class="btn btn-primary btn-sm" onclick="openAdminReviewModal(${r.id})">
                      Review &amp; Decide
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load pending requests: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

/* 2. Admin Review & Decision Modal */
function openAdminReviewModal(requestId) {
  const req = cachedAdminRequests.find(r => r.id === requestId);
  if (!req) return;

  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'ems-modal-backdrop';
  modalBackdrop.id = 'emsReviewModal';

  modalBackdrop.innerHTML = `
    <div class="ems-modal">
      <div class="ems-modal-header">
        <h3 class="ems-modal-title">Review Leave Application</h3>
        <button type="button" class="ems-close-btn" onclick="closeAdminReviewModal()">&times;</button>
      </div>

      <div style="margin-bottom: 16px; background: #f8fafc; border-radius: 8px; padding: 14px 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="font-size: 14px; font-weight: 700; color: #0f172a;">${EmsClient.escapeHtml(req.employee_name)} (${EmsClient.escapeHtml(req.employee_id)})</span>
          <span class="badge badge-primary">${EmsClient.escapeHtml(req.leave_code || req.leave_name)}</span>
        </div>
        <div style="font-size: 12.5px; color: #475569; margin-bottom: 8px;">
          <strong>Period:</strong> ${EmsClient.escapeHtml(req.from_date)} to ${EmsClient.escapeHtml(req.to_date)} (${req.chargeable_days} chargeable days)
        </div>
        <div style="font-size: 12px; color: #334155;">
          <strong>Reason:</strong> ${EmsClient.escapeHtml(req.reason)}
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
          <span>Current Leave Balance: <strong>${Number(req.current_balance || 0).toFixed(1)} days</strong></span>
          <span>Chargeable Deduction: <strong style="color: #059669;">${req.chargeable_days} days</strong></span>
        </div>
      </div>

      <div style="margin-bottom: 16px;">
        <label class="form-label" for="adminReviewRemarks">Decision Remarks / Notes *</label>
        <textarea id="adminReviewRemarks" class="form-input" rows="3" placeholder="Enter reason or instructions for approval, rejection, or corrections"></textarea>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="btn btn-secondary" onclick="closeAdminReviewModal()">Cancel</button>
        <button type="button" class="btn btn-secondary" style="color: #b45309;" onclick="submitAdminDecision(${req.id}, 'HOLD')">
          Request Correction / Hold
        </button>
        <button type="button" class="btn btn-secondary" style="color: #dc2626;" onclick="submitAdminDecision(${req.id}, 'REJECT')">
          Reject Application
        </button>
        <button type="button" class="btn btn-primary" onclick="submitAdminDecision(${req.id}, 'APPROVE')">
          Approve Leave
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalBackdrop);
}

function closeAdminReviewModal() {
  const m = document.getElementById('emsReviewModal');
  if (m) m.remove();
}

async function submitAdminDecision(requestId, action) {
  const remarks = document.getElementById('adminReviewRemarks')?.value.trim() || '';
  if (['REJECT', 'HOLD'].includes(action) && !remarks) {
    alert('Please enter remarks explaining the rejection or correction instructions.');
    return;
  }

  try {
    await EmsClient.post(`/leave/requests/${requestId}/review`, { action, remarks });
    alert(`Leave request successfully marked as ${action}.`);
    closeAdminReviewModal();
    loadEmsAdminView('pending');
  } catch (err) {
    alert(`Could not process decision: ${err.message}`);
  }
}

/* 3. Admin All Leave Requests */
async function renderAdminAllRequestsView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/leave/requests');
    const requests = res.requests || [];

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">All Employee Leave Applications (${requests.length})</h3>
          <div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="downloadEmsRequestsCsv()">
              Download Requests CSV
            </button>
          </div>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Request #</th>
                <th>Employee</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Chargeable</th>
                <th>Status</th>
                <th>Reviewed By</th>
                <th>Review Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${requests.map(r => {
                const badgeClass = {
                  PENDING: 'ems-badge-pending',
                  APPROVED: 'ems-badge-approved',
                  REJECTED: 'ems-badge-rejected',
                  HOLD: 'ems-badge-hold',
                  CANCELLED: 'ems-badge-cancelled'
                }[r.status] || 'ems-badge-pending';

                return `
                  <tr>
                    <td><strong>${EmsClient.escapeHtml(r.request_number)}</strong></td>
                    <td>
                      <div>${EmsClient.escapeHtml(r.employee_name || 'Staff')}</div>
                      <div style="font-size: 11px; color: #64748b;">${EmsClient.escapeHtml(r.employee_id)}</div>
                    </td>
                    <td><span class="badge badge-neutral">${EmsClient.escapeHtml(r.leave_code || r.leave_name || 'LEAVE')}</span></td>
                    <td>${EmsClient.escapeHtml(r.from_date)} to ${EmsClient.escapeHtml(r.to_date)}</td>
                    <td><strong>${r.chargeable_days}d</strong></td>
                    <td><span class="ems-badge ${badgeClass}">${EmsClient.escapeHtml(r.status)}</span></td>
                    <td style="font-size: 12px; color: #475569;">${EmsClient.escapeHtml(r.reviewed_by || '&mdash;')}</td>
                    <td style="font-size: 12px; color: #475569;">${EmsClient.escapeHtml(r.review_remarks || '&mdash;')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load all requests: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

function downloadEmsRequestsCsv() {
  window.open('/api/admin/leaves/export.csv', '_blank');
}

/* 4. Admin Staff Balances & Ledger Adjustments */
async function renderAdminBalancesView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/reports/balance-report');
    const staffBalances = res.report || [];

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Staff Leave Balances &amp; Entitlements (${staffBalances.length})</h3>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Employee Name</th>
                <th>Employee ID</th>
                <th>Department</th>
                <th>CL Available</th>
                <th>EL Available</th>
                <th>RH Available</th>
                <th>Comp-Off</th>
              </tr>
            </thead>
            <tbody>
              ${staffBalances.map(s => `
                <tr>
                  <td><strong>${EmsClient.escapeHtml(s.name)}</strong></td>
                  <td><code>${EmsClient.escapeHtml(s.employee_id)}</code></td>
                  <td>${EmsClient.escapeHtml(s.department || 'CDER')}</td>
                  <td><span class="badge badge-neutral">${Number(s.cl_balance || 0).toFixed(1)}d</span></td>
                  <td><span class="badge badge-neutral">${Number(s.el_balance || 0).toFixed(1)}d</span></td>
                  <td><span class="badge badge-neutral">${Number(s.rh_balance || 0).toFixed(1)}d</span></td>
                  <td><span class="badge badge-neutral">${Number(s.co_balance || 0).toFixed(1)}d</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load staff balances: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

/* 5. Admin Policies & Rule Versions */
async function renderAdminPoliciesView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const [rulesRes, swRes] = await Promise.all([
      EmsClient.get('/leave-rules'),
      EmsClient.get('/sandwich-rules')
    ]);

    const rules = rulesRes.rules || [];
    const sandwichRules = swRes.sandwichRules || [];

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Configurable Rules &amp; Versioned Policies</h3>
        </div>

        <div class="ems-table-responsive" style="margin-bottom: 24px;">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Rule Code</th>
                <th>Rule Name</th>
                <th>Leave Type</th>
                <th>Department Scope</th>
                <th>Active Version</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rules.map(r => `
                <tr>
                  <td><code>${EmsClient.escapeHtml(r.rule_code)}</code></td>
                  <td><strong>${EmsClient.escapeHtml(r.rule_name)}</strong></td>
                  <td><span class="badge badge-neutral">${EmsClient.escapeHtml(r.leave_type_code || r.leave_type_name)}</span></td>
                  <td>${EmsClient.escapeHtml(r.applicable_department || 'ALL')}</td>
                  <td>v${r.active_version || 1}</td>
                  <td><span class="badge badge-primary">ACTIVE</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <h4 style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">Intervening Weekend &amp; Holiday Sandwich Rules</h4>
        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Includes Weekly Offs</th>
                <th>Includes Holidays</th>
                <th>Charge Intervening Days</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sandwichRules.map(sw => `
                <tr>
                  <td><strong>${EmsClient.escapeHtml(sw.rule_name)}</strong></td>
                  <td>${sw.include_weekly_offs ? 'Yes' : 'No'}</td>
                  <td>${sw.include_public_holidays ? 'Yes' : 'No'}</td>
                  <td><span class="badge ${sw.charge_intervening_days ? 'badge-danger' : 'badge-neutral'}">${sw.charge_intervening_days ? 'Charged as Leave' : 'Free Excluded'}</span></td>
                  <td><span class="badge badge-primary">ACTIVE</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load policies: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

/* 6. Admin Comp-Off Approvals */
async function renderAdminCompOffView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/comp-off');
    const compOffs = res.records || [];

    if (compOffs.length === 0) {
      container.innerHTML = `<div class="ems-card" style="text-align: center; color: #64748b;">No compensatory off duty claims submitted.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Compensatory Off Claims (${compOffs.length})</h3>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Worked Date</th>
                <th>Duty Type</th>
                <th>Credited Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${compOffs.map(c => `
                <tr>
                  <td>
                    <strong>${EmsClient.escapeHtml(c.employee_name || c.employee_id)}</strong>
                    <div style="font-size: 11px; color: #64748b;">${EmsClient.escapeHtml(c.employee_id)}</div>
                  </td>
                  <td>${EmsClient.escapeHtml(c.worked_date)}</td>
                  <td><span class="badge badge-neutral">${EmsClient.escapeHtml(c.qualifying_day_type)}</span></td>
                  <td><strong>${c.credited_days || 1.0}d</strong></td>
                  <td style="max-width: 200px; font-size: 12px; color: #334155;">${EmsClient.escapeHtml(c.reason || '')}</td>
                  <td><span class="badge ${c.status === 'APPROVED' ? 'badge-primary' : (c.status === 'REJECTED' ? 'badge-danger' : 'badge-warning')}">${EmsClient.escapeHtml(c.status)}</span></td>
                  <td>
                    ${c.status === 'PENDING' ? `
                      <button type="button" class="btn btn-primary btn-sm" onclick="reviewAdminCompOff(${c.id}, 'APPROVE')">Approve</button>
                      <button type="button" class="btn btn-secondary btn-sm" onclick="reviewAdminCompOff(${c.id}, 'REJECT')" style="color: #dc2626;">Reject</button>
                    ` : '<span style="color:#94a3b8; font-size: 11px;">Decided</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load comp-offs: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

async function reviewAdminCompOff(id, action) {
  try {
    await EmsClient.post(`/comp-off/${id}/review`, { action });
    alert(`Comp-off claim marked as ${action}.`);
    renderAdminCompOffView(document.getElementById('emsAdminSubViewContainer'));
  } catch (err) {
    alert(`Failed to review comp-off: ${err.message}`);
  }
}

/* 7. Admin Audit Trail */
async function renderAdminAuditView(container) {
  container.innerHTML = `<div style="padding: 20px; text-align: center;"><div class="spinner"></div></div>`;
  try {
    const res = await EmsClient.get('/audit/logs');
    const logs = res.logs || [];

    container.innerHTML = `
      <div class="ems-card">
        <div class="ems-card-header">
          <h3 class="ems-card-heading">Immutable Leave Governance Audit Logs (${logs.length})</h3>
        </div>

        <div class="ems-table-responsive">
          <table class="ems-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Target</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(l => `
                <tr>
                  <td>${EmsClient.escapeHtml((l.created_at || '').slice(0, 19).replace('T', ' '))}</td>
                  <td><code>${EmsClient.escapeHtml(l.action)}</code></td>
                  <td>${EmsClient.escapeHtml(l.target_type)}: ${EmsClient.escapeHtml(l.target_id || '')}</td>
                  <td><strong>${EmsClient.escapeHtml(l.actor_email || 'SYSTEM')}</strong></td>
                  <td style="font-size: 12px; color: #475569; max-width: 250px;">${EmsClient.escapeHtml(l.details || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ems-card" style="color: #dc2626;">Failed to load audit logs: ${EmsClient.escapeHtml(err.message)}</div>`;
  }
}

// Global Exports
window.EmsClient = EmsClient;
window.renderEmployeeEmsPage = renderEmployeeEmsPage;
window.switchEmpSubView = switchEmpSubView;
window.triggerLiveCalcPreview = triggerLiveCalcPreview;
window.toggleHalfDayOptions = toggleHalfDayOptions;
window.handleEmpSubmitLeave = handleEmpSubmitLeave;
window.cancelEmpLeaveRequest = cancelEmpLeaveRequest;
window.handleEmpSubmitCompOff = handleEmpSubmitCompOff;
window.loadEmsAdminView = loadEmsAdminView;
window.switchAdminSubView = switchAdminSubView;
window.openAdminReviewModal = openAdminReviewModal;
window.closeAdminReviewModal = closeAdminReviewModal;
window.submitAdminDecision = submitAdminDecision;
window.reviewAdminCompOff = reviewAdminCompOff;
window.downloadEmsRequestsCsv = downloadEmsRequestsCsv;
