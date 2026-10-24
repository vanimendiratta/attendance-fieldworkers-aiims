// public/js/app.js
// EMS Frontend Application Engine (Dynamic, Database-Driven, Rule-Based)

const App = {
  state: {
    user: null,
    currentRoute: 'dashboard',
    notifications: [],
    unreadNotifCount: 0,
    leaveTypes: [],
    activeModal: null
  },

  async init() {
    window.addEventListener('hashchange', () => this.handleRouting());
    window.addEventListener('auth_changed', () => this.handleRouting());

    // Check user profile
    const token = API.getToken();
    if (token) {
      try {
        const res = await API.get('/auth/me');
        this.state.user = res.user;
        API.setUser(res.user);
        if (window.SessionTimeoutManager) {
          window.SessionTimeoutManager.init({
            appType: 'ems',
            onExpired: () => {
              API.clearAuth();
              this.state.user = null;
              this.handleRouting();
            }
          });
          window.SessionTimeoutManager.resetTimer();
        }
      } catch (e) {
        API.clearAuth();
        this.state.user = null;
      }
    }

    this.handleRouting();
  },

  async fetchNotifications() {
    if (!this.state.user) return;
    try {
      const res = await API.get('/notifications');
      this.state.notifications = res.notifications || [];
      this.state.unreadNotifCount = this.state.notifications.filter(n => !n.is_read).length;
      this.renderNotificationBadge();
    } catch (e) {}
  },

  toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) {
      const isOpen = sidebar.classList.toggle('open');
      if (backdrop) backdrop.classList.toggle('open', isOpen);
      document.body.classList.toggle('sidebar-locked', isOpen);
    }
  },

  closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('sidebar-locked');
  },

  handleRouting() {
    const hash = window.location.hash || '#/dashboard';
    const route = hash.replace('#/', '').split('?')[0] || 'dashboard';

    this.closeSidebar();

    // If not authenticated, always route to login
    if (!this.state.user) {
      if (window.location.hash !== '#/login') {
        window.location.hash = '#/login';
      }
      this.state.currentRoute = 'login';
      this.renderLogin();
      return;
    }

    // If authenticated and visiting login page, redirect to dashboard
    if (route === 'login') {
      window.location.hash = '#/dashboard';
      return;
    }

    this.state.currentRoute = route;
    this.renderLayout();
  },

  /* ==========================================================================
     LAYOUT & NAVIGATION
     ========================================================================== */
  renderLayout() {
    const user = this.state.user;
    if (!user) {
      this.renderLogin();
      return;
    }
    const isAdmin = user.role === 'ADMIN';

    const appEl = document.getElementById('app');
    appEl.innerHTML = `
      <!-- Mobile Sidebar Backdrop Overlay -->
      <div id="sidebar-backdrop" class="sidebar-backdrop" onclick="App.closeSidebar()"></div>

      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="brand-icon">EMS</div>
          <div>
            <div class="brand-title">Leave Governance</div>
            <div class="brand-subtitle">${isAdmin ? 'Admin Console' : 'Employee Portal'}</div>
          </div>
          <button class="sidebar-close-btn" onclick="App.closeSidebar()" aria-label="Close navigation" title="Close Navigation">
            ${Icons.x}
          </button>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-title">Navigation</div>
          
          <a class="nav-item ${this.state.currentRoute === 'dashboard' ? 'active' : ''}" href="#/dashboard" onclick="App.closeSidebar()">
            ${Icons.dashboard} Dashboard
          </a>

          ${isAdmin ? `
            <a class="nav-item ${this.state.currentRoute === 'leave-records' ? 'active' : ''}" href="#/leave-records" onclick="App.closeSidebar()">
              ${Icons.bookOpen} Staff Leave Register
            </a>
            <a class="nav-item ${this.state.currentRoute === 'employees' ? 'active' : ''}" href="#/employees" onclick="App.closeSidebar()">
              ${Icons.users} Employee Master
            </a>
            <a class="nav-item ${this.state.currentRoute === 'requests' ? 'active' : ''}" href="#/requests" onclick="App.closeSidebar()">
              ${Icons.clipboard} Leave Requests
            </a>
            <a class="nav-item ${this.state.currentRoute === 'ledger' ? 'active' : ''}" href="#/ledger" onclick="App.closeSidebar()">
              ${Icons.bookOpen} Ledger & Balances
            </a>
            <a class="nav-item ${this.state.currentRoute === 'rules' ? 'active' : ''}" href="#/rules" onclick="App.closeSidebar()">
              ${Icons.sliders} Rules & Versions
            </a>
            <a class="nav-item ${this.state.currentRoute === 'schedules' ? 'active' : ''}" href="#/schedules" onclick="App.closeSidebar()">
              ${Icons.clock} Credit Schedules
            </a>
            <a class="nav-item ${this.state.currentRoute === 'master-data' ? 'active' : ''}" href="#/master-data" onclick="App.closeSidebar()">
              ${Icons.calendar} Holidays & Policies
            </a>
            <a class="nav-item ${this.state.currentRoute === 'comp-off' ? 'active' : ''}" href="#/comp-off" onclick="App.closeSidebar()">
              ${Icons.briefcase} Comp-Off Claims
            </a>
            <a class="nav-item ${this.state.currentRoute === 'reports' ? 'active' : ''}" href="#/reports" onclick="App.closeSidebar()">
              ${Icons.fileText} Reports & Audits
            </a>
          ` : `
            <a class="nav-item ${this.state.currentRoute === 'apply-leave' ? 'active' : ''}" href="#/apply-leave" onclick="App.closeSidebar()">
              ${Icons.plus} Apply for Leave
            </a>
            <a class="nav-item ${this.state.currentRoute === 'my-requests' ? 'active' : ''}" href="#/my-requests" onclick="App.closeSidebar()">
              ${Icons.clipboard} My Leave Requests
            </a>
            <a class="nav-item ${this.state.currentRoute === 'my-ledger' ? 'active' : ''}" href="#/my-ledger" onclick="App.closeSidebar()">
              ${Icons.bookOpen} My Leave Ledger
            </a>
            <a class="nav-item ${this.state.currentRoute === 'leave-records' ? 'active' : ''}" href="#/leave-records" onclick="App.closeSidebar()">
              ${Icons.bookOpen} Staff Leave Register
            </a>
            <a class="nav-item ${this.state.currentRoute === 'holidays' ? 'active' : ''}" href="#/holidays" onclick="App.closeSidebar()">
              ${Icons.calendar} Holidays & Policies
            </a>
            ${user && user.is_field_worker ? `
              <a class="nav-item ${this.state.currentRoute === 'comp-off-claim' ? 'active' : ''}" href="#/comp-off-claim" onclick="App.closeSidebar()">
                ${Icons.briefcase} Claim Comp-Off
              </a>
            ` : ''}
          `}
        </nav>

        <div class="sidebar-footer">
          <div class="user-snippet">
            <div class="user-avatar">${user.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
            <div class="user-meta">
              <div class="user-meta-name" title="${user.name || user.email}">${user.name || user.email}</div>
              <div class="user-meta-role">${user.designation || user.role}</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App.logout()" title="Logout">
            ${Icons.logOut}
          </button>
        </div>
      </aside>

      <!-- Main Content Area -->
      <div class="main-wrapper">
        <header class="topbar">
          <div class="topbar-left">
            <button class="mobile-menu-btn" onclick="App.toggleSidebar()" aria-label="Toggle navigation menu" title="Navigation Menu">
              ${Icons.menu}
            </button>
            <div class="page-title-box">
              <h2 id="topbar-title">${this.getPageTitle()}</h2>
              <p id="topbar-subtitle">Dynamic, rule-based leave management & audit system</p>
            </div>
          </div>
          <div class="topbar-actions">
            <!-- Notifications Bell -->
            <button class="btn btn-secondary btn-sm notif-btn" onclick="App.openNotificationsModal()" style="position: relative;" title="Notifications">
              ${Icons.bell}
              <span id="notif-badge" class="badge badge-danger" style="display: none; position: absolute; top: -6px; right: -6px; padding: 2px 6px; font-size: 10px;">0</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="App.openChangePasswordModal()" title="Change Password">
              ${Icons.shield} <span class="btn-text-responsive">Change Password</span>
            </button>
          </div>
        </header>

        <main class="content-body" id="main-content">
          <!-- Page View Content injected here -->
        </main>
      </div>
    `;

    this.fetchNotifications();
    this.renderCurrentView();
  },

  getPageTitle() {
    const titles = {
      dashboard: 'Executive Dashboard',
      'leave-records': 'Official CDER Staff Leave Register (Docx Snapshot)',
      holidays: 'Official Holidays & Calendar (Gazetted & Restricted)',
      employees: 'Employee Master Management',
      requests: 'Leave Requests Governance',
      ledger: 'Leave Transaction Ledger & Adjustments',
      rules: 'Configurable Rules & Policy Versions',
      schedules: 'Automated Scheduled Credits',
      'master-data': 'Holidays, Weekly Offs & Sandwich Rules',
      'comp-off': 'Compensatory Off Approvals',
      reports: 'Executive Reports & Audit Logs',
      'apply-leave': 'Apply for Leave',
      'my-requests': 'My Leave Applications',
      'my-ledger': 'My Leave Balances & History',
      'comp-off-claim': 'Claim Compensatory Off'
    };
    return titles[this.state.currentRoute] || 'Leave Governance';
  },

  renderNotificationBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (this.state.unreadNotifCount > 0) {
      badge.style.display = 'inline-flex';
      badge.innerText = this.state.unreadNotifCount;
    } else {
      badge.style.display = 'none';
    }
  },

  /* ==========================================================================
     VIEW ROUTING DISPATCHER
     ========================================================================== */
  renderCurrentView() {
    const container = document.getElementById('main-content');
    if (!container) return;

    if (!this.state.user) {
      this.renderLogin();
      return;
    }

    const route = this.state.currentRoute;
    const isAdmin = this.state.user.role === 'ADMIN';

    if (route === 'dashboard') {
      if (isAdmin) this.renderAdminDashboard(container);
      else this.renderEmployeeDashboard(container);
    } else if (route === 'leave-records') {
      this.renderCderLeaveRegisterView(container);
    } else if (route === 'holidays') {
      this.renderHolidaysView(container);
    } else if (route === 'employees' && isAdmin) {
      this.renderEmployeeMaster(container);
    } else if (route === 'requests' && isAdmin) {
      this.renderLeaveRequests(container);
    } else if (route === 'ledger' && isAdmin) {
      this.renderLedgerView(container);
    } else if (route === 'rules' && isAdmin) {
      this.renderRulesView(container);
    } else if (route === 'schedules' && isAdmin) {
      this.renderSchedulesView(container);
    } else if (route === 'master-data' && isAdmin) {
      this.renderMasterDataView(container);
    } else if (route === 'comp-off' && isAdmin) {
      this.renderCompOffAdminView(container);
    } else if (route === 'reports' && isAdmin) {
      this.renderReportsView(container);
    } else if (route === 'apply-leave' && !isAdmin) {
      this.renderApplyLeaveView(container);
    } else if (route === 'my-requests' && !isAdmin) {
      this.renderMyRequestsView(container);
    } else if (route === 'my-ledger' && !isAdmin) {
      this.renderMyLedgerView(container);
    } else if (route === 'comp-off-claim' && !isAdmin) {
      this.renderCompOffClaimView(container);
    } else {
      container.innerHTML = `<div class="card"><p>Page not found or access denied.</p></div>`;
    }
  },

  /* ==========================================================================
     AUTH / LOGIN VIEW
     ========================================================================== */
  async renderLogin() {
    const appEl = document.getElementById('app');

    appEl.innerHTML = `
      <div class="auth-wrapper">
        <div class="auth-card">
          <div class="auth-header">
            <span class="auth-badge">${Icons.shield} EMS Leave Governance</span>
            <h1>Sign in to EMS</h1>
            <p>Access your employee leave records and administrative console</p>
          </div>

          <form id="login-form" onsubmit="App.handleLogin(event)">
            <div class="form-group">
              <label class="form-label">Employee ID or Email</label>
              <input type="text" id="login-id" class="form-control" placeholder="Enter Employee ID or Email" required autofocus>
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="login-pwd" class="form-control" placeholder="Enter password" required>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
              Sign In ${Icons.arrowRight}
            </button>
          </form>
        </div>
      </div>
    `;
  },

  async handleLogin(e) {
    e.preventDefault();
    const identifier = document.getElementById('login-id').value.trim();
    const password = document.getElementById('login-pwd').value;

    try {
      const res = await API.post('/auth/login', { identifier, password });
      API.setToken(res.token);
      API.setUser(res.user);
      this.state.user = res.user;

      if (window.SessionTimeoutManager) {
        window.SessionTimeoutManager.init({
          appType: 'ems',
          onExpired: () => {
            API.clearAuth();
            this.state.user = null;
            this.handleRouting();
          }
        });
        window.SessionTimeoutManager.resetTimer();
      }

      Toast.success(`Welcome back, ${res.user.name}!`);

      if (res.user.must_change_password) {
        this.openChangePasswordModal(true);
      } else {
        window.location.hash = '#/dashboard';
        this.handleRouting();
      }
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async logout() {
    try {
      await API.post('/auth/logout', {});
    } catch (_) {}
    API.clearAuth();
    this.state.user = null;
    this.state.currentRoute = 'login';
    if (window.SessionTimeoutManager) {
      window.SessionTimeoutManager.expireNow('logout');
    }
    if (window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
    Toast.info('Logged out successfully.');
    this.renderLogin();
  },

  /* ==========================================================================
     ADMIN DASHBOARD
     ========================================================================== */
  async renderAdminDashboard(container) {
    container.innerHTML = `<div class="card"><p>Loading dashboard metrics...</p></div>`;

    try {
      const summary = await API.get('/reports/summary');
      const m = summary.metrics || {};
      const byType = summary.leaveByType || [];

      container.innerHTML = `
        <!-- KPI Metrics Grid -->
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-header">
              <span>Active Employees</span>
              ${Icons.users}
            </div>
            <div class="metric-value">${m.totalEmployees || 0}</div>
            <div class="metric-footer">Includes ${m.totalFieldWorkers || 0} designated field staff</div>
          </div>

          <div class="metric-card">
            <div class="metric-header">
              <span>Pending Leave Requests</span>
              ${Icons.clock}
            </div>
            <div class="metric-value" style="color: ${m.pendingRequests > 0 ? '#D97706' : '#10B981'};">${m.pendingRequests || 0}</div>
            <div class="metric-footer">
              <a href="#/requests" style="color: var(--primary-600); text-decoration: none; font-weight: 600;">Review Requests &rarr;</a>
            </div>
          </div>

          <div class="metric-card">
            <div class="metric-header">
              <span>Approved Leaves (YTD)</span>
              ${Icons.check}
            </div>
            <div class="metric-value" style="color: #059669;">${m.approvedRequests || 0}</div>
            <div class="metric-footer">${m.rejectedRequests || 0} rejected or denied</div>
          </div>

          <div class="metric-card">
            <div class="metric-header">
              <span>Pending Comp-Off Claims</span>
              ${Icons.briefcase}
            </div>
            <div class="metric-value">${m.pendingCompOffs || 0}</div>
            <div class="metric-footer">
              <a href="#/comp-off" style="color: var(--primary-600); text-decoration: none; font-weight: 600;">Review Claims &rarr;</a>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
          <!-- Leave Utilization by Type Card -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Leave Utilization by Category (YTD)</div>
              <span class="badge badge-neutral">Dynamic Ledger Aggregation</span>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Leave Code</th>
                    <th>Leave Description</th>
                    <th>Days Utilized</th>
                  </tr>
                </thead>
                <tbody>
                  ${byType.map(t => `
                    <tr>
                      <td><span class="badge badge-primary" style="font-weight: 700;">${t.code}</span></td>
                      <td>${t.name}</td>
                      <td><strong>${t.days_taken} days</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Quick Governance Actions -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Quick Actions</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <button class="btn btn-primary" onclick="App.openCreateEmployeeModal()">
                ${Icons.plus} Onboard Employee
              </button>
              <button class="btn btn-secondary" onclick="App.openManualAdjustmentModal()">
                ${Icons.sliders} Manual Balance Adjustment
              </button>
              <button class="btn btn-secondary" onclick="window.location.hash='#/schedules'">
                ${Icons.clock} Run Credit Schedule
              </button>
              <button class="btn btn-secondary" onclick="window.location.hash='#/rules'">
                ${Icons.sliders} Policy Version Manager
              </button>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error loading dashboard: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     EMPLOYEE DASHBOARD
     ========================================================================== */
  async renderEmployeeDashboard(container) {
    const user = this.state.user;
    container.innerHTML = `<div class="card"><p>Loading leave balances and entitlements...</p></div>`;

    try {
      const res = await API.get('/ledger/balances');
      const balances = res.balances || [];

      container.innerHTML = `
        <!-- Profile Banner -->
        <div class="card" style="background: linear-gradient(to right, #ffffff, var(--primary-50));">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
            <div>
              <div style="font-size: 20px; font-weight: 800; color: var(--neutral-900);">Welcome, ${user.name}</div>
              <div style="font-size: 13.5px; color: var(--neutral-600); margin-top: 4px;">
                <strong>Employee ID:</strong> ${user.employee_id} &bull; 
                <strong>Department:</strong> ${user.department || 'General'} &bull; 
                <strong>Post:</strong> ${user.designation || 'Staff'} &bull; 
                <strong>Date of Joining:</strong> ${user.date_of_joining || 'N/A'}
              </div>
            </div>
            <div>
              <span class="badge ${user.is_field_worker ? 'badge-warning' : 'badge-info'}" style="font-size: 13px; padding: 6px 12px;">
                ${user.is_field_worker ? Icons.briefcase : Icons.user}
                ${user.is_field_worker ? `Field Worker (Comp-Off Eligible)${user.field_location ? ` &bull; ${user.field_location}` : ''}` : 'General Staff'}
              </span>
            </div>
          </div>
        </div>

        <!-- Leave Balance Cards -->
        <div style="margin-bottom: 12px; font-size: 15px; font-weight: 700; color: var(--neutral-900);">Your Dynamic Leave Entitlements (${new Date().getFullYear()})</div>
        <div class="balance-grid">
          ${balances.map(b => `
            <div class="balance-card type-${b.leave_type_code}">
              <div class="balance-card-header">
                <div>
                  <span class="balance-code">${b.leave_type_code}</span>
                  <div style="font-size: 12px; color: var(--neutral-500);">${b.leave_type_name}</div>
                </div>
                <span class="badge ${b.is_paid ? 'badge-success' : 'badge-neutral'}">${b.is_paid ? 'Paid' : 'Unpaid'}</span>
              </div>

              <div class="balance-available-box">
                <div class="balance-available-num">${b.available_balance}</div>
                <div class="balance-available-lbl">Available Balance</div>
              </div>

              <div class="balance-stats-row">
                <div>
                  <div class="balance-stat-val">${b.credited_amount}</div>
                  <div class="balance-stat-lbl">Credited</div>
                </div>
                <div>
                  <div class="balance-stat-val">${b.used_amount}</div>
                  <div class="balance-stat-lbl">Used</div>
                </div>
                <div>
                  <div class="balance-stat-val">${b.pending_amount}</div>
                  <div class="balance-stat-lbl">Pending</div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; gap: 12px;">
          <a href="#/apply-leave" class="btn btn-primary">
            ${Icons.plus} Apply for Leave
          </a>
          <a href="#/my-requests" class="btn btn-secondary">
            ${Icons.clipboard} View Request History
          </a>
          <a href="#/my-ledger" class="btn btn-secondary">
            ${Icons.bookOpen} View Complete Transaction Ledger
          </a>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error loading employee balances: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     APPLY FOR LEAVE (WITH AUTHORITATIVE LIVE CALCULATION PREVIEW)
     ========================================================================== */
  async renderApplyLeaveView(container) {
    container.innerHTML = `<div class="card"><p>Loading application form...</p></div>`;

    try {
      const resTypes = await API.get('/leave-types');
      const leaveTypes = resTypes.leaveTypes || [];
      const resBal = await API.get('/ledger/balances');
      const balances = resBal.balances || [];

      container.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto;">
          <div class="card">
            <div class="card-header">
              <div class="card-title">Submit Leave Application</div>
              <span class="badge badge-info">Authoritative Backend Calculation</span>
            </div>

            <form id="apply-leave-form" onsubmit="App.handleSubmitLeave(event)">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Leave Type *</label>
                  <select id="apply-type" class="form-control" required onchange="App.triggerCalculationPreview()">
                    <option value="">-- Select Applicable Leave Type --</option>
                    ${leaveTypes.map(t => {
                      const bal = balances.find(b => b.leave_type_id === t.id);
                      const avail = bal ? bal.available_balance : 0;
                      return `<option value="${t.id}" data-code="${t.code}" data-half="${t.allow_half_day}">${t.name} (${t.code}) &mdash; Available: ${avail} days</option>`;
                    }).join('')}
                  </select>
                </div>

                <div class="form-group" id="half-day-box" style="display: none;">
                  <label class="form-label">Duration Option</label>
                  <div style="display: flex; gap: 16px; padding-top: 8px;">
                    <label style="font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
                      <input type="checkbox" id="apply-is-half" onchange="App.toggleHalfDaySession()"> Half Day
                    </label>
                    <select id="apply-half-session" class="form-control" style="display: none; width: auto;" onchange="App.triggerCalculationPreview()">
                      <option value="FIRST_HALF">First Half (Forenoon)</option>
                      <option value="SECOND_HALF">Second Half (Afternoon)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">From Date *</label>
                  <input type="date" id="apply-from" class="form-control" required onchange="App.triggerCalculationPreview()">
                </div>
                <div class="form-group">
                  <label class="form-label">To Date *</label>
                  <input type="date" id="apply-to" class="form-control" required onchange="App.triggerCalculationPreview()">
                </div>
              </div>

              <!-- Real-time Live Calculation & Policy Preview Box -->
              <div id="calc-preview-container" style="display: none;"></div>

              <div class="form-group" style="margin-top: 18px;">
                <label class="form-label">Reason for Absence *</label>
                <textarea id="apply-reason" class="form-control" rows="3" placeholder="Provide reason for leave" required></textarea>
              </div>

              <div class="form-group">
                <label class="form-label">Remarks / Contact Details during Absence</label>
                <input type="text" id="apply-remarks" class="form-control" placeholder="Optional contact phone or address while on leave">
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="window.location.hash='#/dashboard'">Cancel</button>
                <button type="submit" id="apply-submit-btn" class="btn btn-primary" disabled>
                  ${Icons.check} Submit Leave Request
                </button>
              </div>
            </form>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  toggleHalfDaySession() {
    const isHalf = document.getElementById('apply-is-half').checked;
    const sessionSelect = document.getElementById('apply-half-session');
    const toDateInput = document.getElementById('apply-to');
    const fromDateInput = document.getElementById('apply-from');

    sessionSelect.style.display = isHalf ? 'block' : 'none';
    if (isHalf && fromDateInput.value) {
      toDateInput.value = fromDateInput.value;
      toDateInput.disabled = true;
    } else {
      toDateInput.disabled = false;
    }
    this.triggerCalculationPreview();
  },

  calcTimeout: null,
  triggerCalculationPreview() {
    clearTimeout(this.calcTimeout);
    this.calcTimeout = setTimeout(() => this.executeCalculationPreview(), 250);
  },

  async executeCalculationPreview() {
    const leaveTypeId = document.getElementById('apply-type')?.value;
    const fromDate = document.getElementById('apply-from')?.value;
    const toDate = document.getElementById('apply-to')?.value;
    const isHalfDay = document.getElementById('apply-is-half')?.checked;
    const halfDaySession = document.getElementById('apply-half-session')?.value;
    const submitBtn = document.getElementById('apply-submit-btn');
    const previewContainer = document.getElementById('calc-preview-container');

    if (!leaveTypeId || !fromDate || !toDate) {
      if (previewContainer) previewContainer.style.display = 'none';
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    // Toggle half-day option visibility based on leave type config
    const selOpt = document.querySelector(`#apply-type option[value="${leaveTypeId}"]`);
    const allowHalf = selOpt?.getAttribute('data-half') === '1';
    const halfBox = document.getElementById('half-day-box');
    if (halfBox) halfBox.style.display = allowHalf ? 'block' : 'none';

    try {
      const res = await API.post('/leave/calculate', {
        leaveTypeId: parseInt(leaveTypeId, 10),
        fromDate,
        toDate,
        isHalfDay,
        halfDaySession: isHalfDay ? halfDaySession : null
      });

      const calc = res.calculation;
      const isValid = res.isValid;
      submitBtn.disabled = !isValid;

      previewContainer.style.display = 'block';
      previewContainer.innerHTML = `
        <div class="calc-preview-card">
          <div class="calc-preview-header">
            <span>Server Calculation Breakdown (Rule: ${res.rule ? res.rule.rule_name + ' v' + res.rule.version_number : 'Active Policy'})</span>
            <span class="badge ${isValid ? 'badge-success' : 'badge-danger'}">
              ${isValid ? 'Eligible for Submission' : 'Validation Restriction'}
            </span>
          </div>

          <div class="calc-breakdown-row">
            <div class="calc-chip">Total Calendar Span: <strong>${calc.calendarDays} day(s)</strong></div>
            <div class="calc-chip">Weekly Offs Excluded: <strong>${calc.weeklyOffDays} day(s)</strong></div>
            <div class="calc-chip">Holidays Excluded: <strong>${calc.holidayDays} day(s)</strong></div>
            ${calc.sandwichDays > 0 ? `
              <div class="calc-chip" style="border-color: #F59E0B; background: #FFFBEB;">
                Sandwich Charged: <strong>+${calc.sandwichDays} day(s)</strong>
              </div>
            ` : ''}
            <div class="calc-chip" style="background: #FAF5FF; border-color: #D8B4FE;">
              Net Chargeable Days: <strong style="color: #6B21A8; font-size: 14px;">${calc.chargeableDays} day(s)</strong>
            </div>
            <div class="calc-chip">Available Balance: <strong>${res.balanceInfo.available_balance} &rarr; Remaining: ${(res.balanceInfo.available_balance - calc.chargeableDays).toFixed(1)}</strong></div>
          </div>

          ${!isValid ? `
            <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; color: #991B1B; font-size: 13px;">
              <strong>Cannot submit leave:</strong>
              <ul style="margin-left: 20px; margin-top: 4px;">
                ${res.errors.map(e => `<li>${e}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div style="font-size: 11.5px; font-weight: 600; color: var(--neutral-600); margin-bottom: 6px;">Day-by-Day Rationale:</div>
          <div class="calc-day-list">
            ${calc.breakdown.map(d => `
              <div class="calc-day-item ${d.isChargeable ? 'charged' : 'non-working'}">
                <span><strong>${d.date}</strong> &mdash; ${d.reason}</span>
                <span>${d.isChargeable ? `+${d.chargeableValue} day deducted` : '0 days (Excluded)'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      submitBtn.disabled = true;
      previewContainer.style.display = 'block';
      previewContainer.innerHTML = `
        <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; padding: 12px; color: #991B1B; font-size: 13px;">
          ${err.message}
        </div>
      `;
    }
  },

  async handleSubmitLeave(e) {
    e.preventDefault();
    const leaveTypeId = document.getElementById('apply-type').value;
    const fromDate = document.getElementById('apply-from').value;
    const toDate = document.getElementById('apply-to').value;
    const isHalfDay = document.getElementById('apply-is-half')?.checked;
    const halfDaySession = document.getElementById('apply-half-session')?.value;
    const reason = document.getElementById('apply-reason').value;
    const remarks = document.getElementById('apply-remarks').value;

    try {
      const res = await API.post('/leave/requests', {
        leaveTypeId: parseInt(leaveTypeId, 10),
        fromDate,
        toDate,
        isHalfDay,
        halfDaySession: isHalfDay ? halfDaySession : null,
        reason,
        remarks
      });

      Toast.success(res.message);
      window.location.hash = '#/my-requests';
      this.handleRouting();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     EMPLOYEE LEAVE REQUESTS & STATUS TIMELINE
     ========================================================================== */
  async renderMyRequestsView(container) {
    container.innerHTML = `<div class="card"><p>Loading your leave requests...</p></div>`;

    try {
      const res = await API.get('/leave/requests');
      const requests = res.requests || [];

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">My Leave Applications</div>
            <a href="#/apply-leave" class="btn btn-primary btn-sm">${Icons.plus} New Request</a>
          </div>

          ${requests.length === 0 ? `
            <div style="text-align: center; padding: 40px 20px; color: var(--neutral-500);">
              <p>No leave requests found.</p>
              <a href="#/apply-leave" class="btn btn-primary btn-sm" style="margin-top: 12px;">Apply Now</a>
            </div>
          ` : `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Request #</th>
                    <th>Leave Type</th>
                    <th>Duration</th>
                    <th>Calendar Days</th>
                    <th>Chargeable Days</th>
                    <th>Status</th>
                    <th>Submitted On</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${requests.map(r => `
                    <tr>
                      <td><strong>${r.request_number}</strong></td>
                      <td><span class="badge badge-primary">${r.leave_code}</span> ${r.leave_name}</td>
                      <td>${r.from_date} &rarr; ${r.to_date} ${r.is_half_day ? '(Half Day)' : ''}</td>
                      <td>${r.requested_calendar_days}</td>
                      <td><strong>${r.chargeable_days}</strong></td>
                      <td>${this.getStatusBadge(r.status)}</td>
                      <td>${(r.created_at || '').split(/[ T]/)[0] || 'N/A'}</td>
                      <td>
                        <button class="btn btn-secondary btn-sm" onclick="App.viewRequestDetails(${r.id})">
                          ${Icons.eye} Details
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     ADMIN LEAVE REQUESTS MANAGEMENT & APPROVAL WORKFLOW
     ========================================================================== */
  async renderLeaveRequests(container) {
    container.innerHTML = `<div class="card"><p>Loading leave requests governance queue...</p></div>`;

    try {
      const res = await API.get('/leave/requests');
      const requests = res.requests || [];

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Leave Request Governance Queue</div>
            <span class="badge badge-neutral">${requests.length} Requests Total</span>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Employee</th>
                  <th>Department / Role</th>
                  <th>Type</th>
                  <th>Date Span</th>
                  <th>Chargeable</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${requests.map(r => `
                  <tr>
                    <td><strong>${r.request_number}</strong></td>
                    <td>
                      <div><strong>${r.employee_name}</strong></div>
                      <div style="font-size: 11px; color: var(--neutral-400);">${r.employee_id}</div>
                    </td>
                    <td>
                      <div>${r.department}</div>
                      <div style="font-size: 11px; color: var(--neutral-400);">${r.designation}</div>
                    </td>
                    <td><span class="badge badge-primary">${r.leave_code}</span></td>
                    <td>${r.from_date} &rarr; ${r.to_date}</td>
                    <td><strong>${r.chargeable_days} days</strong></td>
                    <td>${this.getStatusBadge(r.status)}</td>
                    <td>${(r.created_at || '').split(/[ T]/)[0] || 'N/A'}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="App.viewRequestDetails(${r.id})">
                        ${Icons.eye} Review
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
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     REQUEST DETAILS & AUDIT TIMELINE MODAL
     ========================================================================== */
  async viewRequestDetails(requestId) {
    try {
      const res = await API.get(`/leave/requests/${requestId}`);
      const r = res.request;
      const isAdmin = this.state.user.role === 'ADMIN';
      const snap = r.snapshot || {};
      const timeline = r.timeline || [];

      const modalHtml = `
        <div class="modal-dialog" style="max-width: 720px;">
          <div class="modal-header">
            <h3>Leave Request ${r.request_number}</h3>
            <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
          </div>

          <div class="modal-body">
            <!-- Header Summary -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 14px; background: var(--neutral-50); border: 1px solid var(--neutral-200); border-radius: var(--radius-sm);">
              <div>
                <div style="font-size: 15px; font-weight: 700; color: var(--neutral-900);">${r.employee_name} (${r.employee_id})</div>
                <div style="font-size: 12px; color: var(--neutral-500);">${r.department} &bull; ${r.designation}</div>
              </div>
              <div>${this.getStatusBadge(r.status)}</div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--neutral-400); font-weight: 600;">Leave Type</div>
                <div style="font-size: 14px; font-weight: 600; color: var(--neutral-800);">${r.leave_name} (${r.leave_code})</div>
              </div>
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--neutral-400); font-weight: 600;">Dates Requested</div>
                <div style="font-size: 14px; font-weight: 600; color: var(--neutral-800);">${r.from_date} to ${r.to_date} ${r.is_half_day ? '(Half Day)' : ''}</div>
              </div>
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--neutral-400); font-weight: 600;">Calendar Span vs Chargeable</div>
                <div style="font-size: 14px; font-weight: 600; color: var(--neutral-800);">${r.requested_calendar_days} calendar days &rarr; <strong>${r.chargeable_days} chargeable</strong></div>
              </div>
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--neutral-400); font-weight: 600;">Rule Version Applied</div>
                <div style="font-size: 14px; font-weight: 600; color: var(--neutral-800);">Version ${r.rule_version_number || 1} (Immutable)</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Employee Reason</label>
              <div style="padding: 10px 14px; background: #ffffff; border: 1px solid var(--neutral-200); border-radius: var(--radius-sm); font-size: 13.5px;">
                ${r.reason}
              </div>
            </div>

            ${r.review_remarks ? `
              <div class="form-group">
                <label class="form-label">Administrative Review Remarks</label>
                <div style="padding: 10px 14px; background: #FAF5FF; border: 1px solid #E9D5FF; border-radius: var(--radius-sm); font-size: 13.5px; color: #6B21A8;">
                  ${r.review_remarks}
                </div>
              </div>
            ` : ''}

            <!-- Immutable Calculation Snapshot Breakdown -->
            <div style="margin-top: 20px;">
              <div style="font-size: 13px; font-weight: 700; color: var(--neutral-900); margin-bottom: 8px;">Calculation Audit Snapshot</div>
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day Classification</th>
                      <th>Deduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(snap.date_breakdown || []).map(d => `
                      <tr>
                        <td><strong>${d.date}</strong></td>
                        <td>${d.reason}</td>
                        <td>${d.isChargeable ? `+${d.chargeableValue} days` : '0 days (Excluded)'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Status Transition History Timeline -->
            <div style="margin-top: 20px;">
              <div style="font-size: 13px; font-weight: 700; color: var(--neutral-900); margin-bottom: 8px;">Status Timeline</div>
              <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
                ${timeline.map(t => `
                  <div style="display: flex; justify-content: space-between; padding: 6px 12px; background: var(--neutral-50); border: 1px solid var(--neutral-200); border-radius: 4px;">
                    <span><strong>${t.from_status || 'INITIAL'}</strong> &rarr; <span class="badge badge-neutral">${t.to_status}</span> by ${t.changed_by} (${t.remarks || 'No remarks'})</span>
                    <span style="color: var(--neutral-500);">${t.created_at}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            ${isAdmin && (r.status === 'PENDING' || r.status === 'HOLD') ? `
              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--neutral-200);">
                <label class="form-label">Review Remarks / Rationale</label>
                <input type="text" id="admin-review-remarks" class="form-control" placeholder="Enter remarks for approval/rejection/hold">
              </div>
            ` : ''}
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
            
            ${isAdmin && (r.status === 'PENDING' || r.status === 'HOLD') ? `
              <button class="btn btn-warning" onclick="App.submitReview(${r.id}, 'HOLD')">${Icons.clock} Hold</button>
              <button class="btn btn-danger" onclick="App.submitReview(${r.id}, 'REJECT')">${Icons.x} Reject</button>
              <button class="btn btn-success" onclick="App.submitReview(${r.id}, 'APPROVE')">${Icons.check} Approve</button>
            ` : ''}

            ${isAdmin && r.status === 'APPROVED' ? `
              <button class="btn btn-danger" onclick="App.submitReview(${r.id}, 'CANCEL')">${Icons.refresh} Cancel & Reverse Leave</button>
            ` : ''}
          </div>
        </div>
      `;

      this.openModal(modalHtml);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async submitReview(requestId, action) {
    const remarks = document.getElementById('admin-review-remarks')?.value || '';
    try {
      const res = await API.post(`/leave/requests/${requestId}/review`, { action, remarks });
      Toast.success(res.message);
      this.closeModal();
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     EMPLOYEE MASTER MANAGEMENT (ADMIN)
     ========================================================================== */
  async renderEmployeeMaster(container) {
    container.innerHTML = `<div class="card"><p>Loading employee master...</p></div>`;

    try {
      const res = await API.get('/employees');
      const employees = res.employees || [];

      container.innerHTML = `
        <div class="tabs-nav" style="margin-bottom: 20px;">
          <button class="tab-btn active" onclick="window.location.hash='#/employees'">
            ${Icons.users} Staff Master Directory (${employees.length} Staff)
          </button>
          <button class="tab-btn" onclick="window.location.hash='#/leave-records'">
            ${Icons.bookOpen} Official Leave Register (Docx Snapshot)
          </button>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Employee Master Registry</div>
            <button class="btn btn-primary btn-sm" onclick="App.openCreateEmployeeModal()">
              ${Icons.plus} Onboard New Employee
            </button>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 50px;">S.No</th>
                  <th style="width: 110px;">Emp ID</th>
                  <th>Name</th>
                  <th style="width: 125px;">Contact No</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Field Worker</th>
                  <th>Date of Joining</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${employees.map((e, index) => `
                  <tr>
                    <td style="font-weight: 600; color: var(--neutral-600);">${index + 1}</td>
                    <td>
                      ${e.official_employee_id ? `
                        <div style="display: flex; align-items: center; gap: 4px;">
                          <strong style="color: var(--neutral-900); font-size: 13px;">${e.official_employee_id}</strong>
                          <button class="btn btn-secondary btn-xs" style="padding: 2px 4px; height: 19px; min-height: 19px; font-size: 10px; line-height: 1;" onclick="App.openQuickEditEmpIdModal('${e.employee_id}', '${e.name.replace(/'/g, "\\'")}', '${e.official_employee_id.replace(/'/g, "\\'")}')" title="Edit Emp ID">
                            ${Icons.edit}
                          </button>
                        </div>
                      ` : `
                        <button class="btn btn-secondary btn-xs" style="padding: 2px 6px; height: 21px; min-height: 21px; font-size: 10.5px; color: var(--primary-700); border-color: var(--primary-200); background: var(--primary-50); display: inline-flex; align-items: center; gap: 3px;" onclick="App.openQuickEditEmpIdModal('${e.employee_id}', '${e.name.replace(/'/g, "\\'")}', '')" title="Add Official Emp ID">
                          + Emp ID
                        </button>
                      `}
                    </td>
                    <td>
                      <div><strong>${e.name}</strong></div>
                      <div style="font-size: 11px; color: var(--neutral-400);">${e.email}</div>
                    </td>
                    <td>
                      <span style="font-size: 12.5px; font-weight: 500; color: var(--neutral-800);">${e.mobile || '—'}</span>
                    </td>
                    <td>${e.department}</td>
                    <td>${e.designation}</td>
                    <td>
                      <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div class="fw-radio-group" id="fw-group-${e.employee_id}" title="Toggle Field Worker Duty Status">
                          <label class="fw-radio-label is-yes ${e.is_field_worker ? 'checked' : ''}" title="Field Duty (Comp-Off Eligible)">
                            <input type="radio" 
                                   name="fw_${e.employee_id}" 
                                   value="1" 
                                   ${e.is_field_worker ? 'checked' : ''} 
                                   onchange="App.openToggleFieldWorkerModal('${e.employee_id}', 1, '${e.name.replace(/'/g, "\\'")}', '${e.field_worker_effective_date || e.date_of_joining}', '${(e.field_location || '').replace(/'/g, "\\'")}')">
                            <span>YES</span>
                          </label>
                          <label class="fw-radio-label is-no ${!e.is_field_worker ? 'checked' : ''}" title="Hospital / Desk Duty (Comp-Off Not Provided)">
                            <input type="radio" 
                                   name="fw_${e.employee_id}" 
                                   value="0" 
                                   ${!e.is_field_worker ? 'checked' : ''} 
                                   onchange="App.openToggleFieldWorkerModal('${e.employee_id}', 0, '${e.name.replace(/'/g, "\\'")}', '${e.field_worker_effective_date || e.date_of_joining}', '')">
                            <span>NO</span>
                          </label>
                        </div>
                        <div style="font-size: 10.5px; color: var(--neutral-400); white-space: nowrap;">
                          Since: <strong style="color: var(--neutral-600);">${e.field_worker_effective_date || e.date_of_joining || '—'}</strong>
                        </div>
                        ${e.is_field_worker ? `
                          <div style="margin-top: 3px;">
                            ${e.field_location ? `
                              <div style="display: inline-flex; align-items: center; gap: 4px; max-width: 100%;">
                                <span class="badge" style="background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; font-size: 11px; padding: 2px 6px; display: inline-flex; align-items: center; gap: 4px; max-width: 135px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Field Duty Location: ${e.field_location}">
                                  ${Icons.mapPin} ${e.field_location}
                                </span>
                                <button class="btn btn-secondary btn-xs" style="padding: 2px 4px; height: 18px; min-height: 18px; font-size: 9.5px; line-height: 1;" onclick="App.openEditFieldLocationModal('${e.employee_id}', '${e.name.replace(/'/g, "\\'")}', '${e.field_location.replace(/'/g, "\\'")}')" title="Edit Field Location">
                                  ${Icons.edit}
                                </button>
                              </div>
                            ` : `
                              <button class="btn btn-secondary btn-xs" style="padding: 2px 6px; height: 21px; min-height: 21px; font-size: 10.5px; color: var(--primary-700); border-color: var(--primary-200); background: var(--primary-50); display: inline-flex; align-items: center; gap: 4px;" onclick="App.openEditFieldLocationModal('${e.employee_id}', '${e.name.replace(/'/g, "\\'")}', '')" title="Add Field Duty Location">
                                ${Icons.mapPin} + Location
                              </button>
                            `}
                          </div>
                        ` : ''}
                      </div>
                    </td>
                    <td>${e.date_of_joining}</td>
                    <td>${this.getStatusBadge(e.status)}</td>
                    <td>
                      <div style="display: flex; gap: 6px;">
                        <button class="btn btn-secondary btn-sm" style="background: #EEF2FF; color: #4338CA; border-color: #C7D2FE;" onclick="App.openEmployeeDossierModal('${e.employee_id}')" title="View Official Leave Counts & Dossier">
                          ${Icons.bookOpen}
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="App.openEditEmployeeModal('${e.employee_id}')" title="Edit Employee Details & Duty Station">
                          ${Icons.edit}
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="App.openFieldHistoryModal('${e.employee_id}')" title="View Field Duty History & Comp-Off Timeline">
                          ${Icons.clock}
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="App.openResetPasswordModal('${e.employee_id}')" title="Reset Password">
                          ${Icons.shield}
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  openToggleFieldWorkerModal(employeeId, isFieldWorker, empName, currentEffectiveDate, currentFieldLocation) {
    const today = new Date().toISOString().split('T')[0];
    const isYes = Number(isFieldWorker) === 1;

    const modalHtml = `
      <div class="modal-dialog" style="max-width: 520px;">
        <div class="modal-header">
          <h3>${isYes ? 'Assign to Field Duty' : 'Return to Hospital Duty'}</h3>
          <button class="modal-close-btn" onclick="App.closeModal(); App.renderEmployeeMaster(document.getElementById('main-content'));">${Icons.x}</button>
        </div>
        <form onsubmit="App.submitToggleFieldWorker(event, '${employeeId}', ${isFieldWorker})">
          <div class="modal-body">
            <div style="margin-bottom: 14px; font-size: 14px;">
              Employee: <strong>${empName}</strong> (<code>${employeeId}</code>)
            </div>

            <div style="margin-bottom: 16px; padding: 12px 14px; border-radius: var(--radius-md); font-size: 13px; line-height: 1.45; ${isYes ? 'background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46;' : 'background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B;'}">
              <strong>${isYes ? 'Field Duty Assignment (YES)' : 'Hospital / Desk Duty Assignment (NO)'}:</strong>
              <div style="font-size: 12px; margin-top: 4px;">
                ${isYes 
                  ? 'Comp-Off will be managed and granted for duties performed on weekly offs and holidays starting from the chosen effective date.' 
                  : 'Field work has finished and personnel returned to the hospital. Comp-Off will NOT be provided for duties performed on or after this effective date.'}
              </div>
            </div>

            ${isYes ? `
              <div class="form-group">
                <label class="form-label">Field Duty Location / Center</label>
                <div style="position: relative;">
                  <input type="text" id="toggle-field-location" class="form-control" 
                    placeholder="e.g. Ballabgarh Rural Field Station, CRHSP, etc." 
                    value="${currentFieldLocation || ''}">
                </div>
                <div style="font-size: 11px; color: var(--neutral-400); margin-top: 4px;">
                  Primary field station, outreach outpost, or healthcare center where duty is stationed.
                </div>
              </div>
            ` : ''}

            <div class="form-group">
              <label class="form-label">Effective From Date *</label>
              <input type="date" id="toggle-field-date" class="form-control" value="${today}" required>
              <div style="font-size: 11px; color: var(--neutral-400); margin-top: 4px;">
                The exact day from which this duty assignment takes effect for Comp-Off management.
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Assignment Remarks / Reason</label>
              <input type="text" id="toggle-field-remarks" class="form-control" 
                placeholder="${isYes ? 'e.g. Dispatched to regional surveillance' : 'e.g. Field work completed, returned to hospital duty'}">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal(); App.renderEmployeeMaster(document.getElementById('main-content'));">Cancel</button>
            <button type="submit" class="btn ${isYes ? 'btn-primary' : 'btn-warning'}">
              ${Icons.check} Confirm & Apply From Date
            </button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async submitToggleFieldWorker(e, employeeId, isFieldWorker) {
    e.preventDefault();
    const effectiveDate = document.getElementById('toggle-field-date').value;
    const fieldRemarks = document.getElementById('toggle-field-remarks')?.value.trim();
    const fieldLocInput = document.getElementById('toggle-field-location');
    const fieldLocation = fieldLocInput ? fieldLocInput.value.trim() : null;

    try {
      const res = await API.put(`/employees/${employeeId}`, {
        is_field_worker: isFieldWorker,
        effective_date: effectiveDate,
        field_remarks: fieldRemarks,
        field_location: Number(isFieldWorker) === 1 ? fieldLocation : null
      });

      this.closeModal();
      Toast.success(res.message);
      const mainContent = document.getElementById('main-content');
      if (mainContent) this.renderEmployeeMaster(mainContent);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  openEditFieldLocationModal(employeeId, empName, currentLocation) {
    const modalHtml = `
      <div class="modal-dialog" style="max-width: 480px;">
        <div class="modal-header">
          <h3>Set Field Duty Location</h3>
          <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <form onsubmit="App.submitFieldLocation(event, '${employeeId}')">
          <div class="modal-body">
            <div style="margin-bottom: 14px; font-size: 14px;">
              Employee: <strong>${empName}</strong> (<code>${employeeId}</code>)
            </div>

            <div style="margin-bottom: 16px; padding: 10px 12px; border-radius: var(--radius-md); font-size: 12.5px; background: #FEF3C7; border: 1px solid #FDE68A; color: #92400E; display: flex; align-items: center; gap: 8px;">
              ${Icons.mapPin}
              <div>This location will be associated with the employee's active field duty deployment.</div>
            </div>

            <div class="form-group">
              <label class="form-label">Field Duty Location / Center *</label>
              <input type="text" id="edit-field-location-input" class="form-control" 
                     placeholder="e.g. Ballabgarh Field Practice Area, Rural Health Clinic" 
                     value="${currentLocation || ''}" required autofocus>
              <div style="font-size: 11px; color: var(--neutral-400); margin-top: 4px;">
                Enter the field station, outreach outpost, or community healthcare facility.
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">
              ${Icons.check} Save Location
            </button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async submitFieldLocation(e, employeeId) {
    e.preventDefault();
    const locInput = document.getElementById('edit-field-location-input');
    const field_location = locInput ? locInput.value.trim() : '';

    try {
      const res = await API.put(`/employees/${employeeId}`, {
        is_field_worker: 1,
        field_location
      });

      this.closeModal();
      Toast.success('Field location updated successfully.');
      const mainContent = document.getElementById('main-content');
      if (mainContent) this.renderEmployeeMaster(mainContent);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  openQuickEditEmpIdModal(employeeId, empName, currentOfficialId) {
    const modalHtml = `
      <div class="modal-dialog" style="max-width: 460px;">
        <div class="modal-header">
          <h3>Set Official Employee ID</h3>
          <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <form onsubmit="App.submitQuickEditEmpId(event, '${employeeId}')">
          <div class="modal-body">
            <div style="margin-bottom: 14px; font-size: 14px;">
              Employee: <strong>${empName}</strong>
            </div>

            <div class="form-group">
              <label class="form-label">Official Employee ID (Emp ID) *</label>
              <input type="text" id="quick-edit-empid-input" class="form-control" 
                     placeholder="e.g. 1044, CDER-01, AIIMS-042" 
                     value="${currentOfficialId || ''}" required autofocus>
              <div style="font-size: 11px; color: var(--neutral-400); margin-top: 4px;">
                Enter the official staff identification code. System Ref: <code>${employeeId}</code>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">
              ${Icons.check} Save Emp ID
            </button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async submitQuickEditEmpId(e, employeeId) {
    e.preventDefault();
    const input = document.getElementById('quick-edit-empid-input');
    const official_employee_id = input ? input.value.trim() : '';

    try {
      const res = await API.put(`/employees/${employeeId}`, {
        official_employee_id
      });

      this.closeModal();
      Toast.success('Employee ID updated successfully.');
      const mainContent = document.getElementById('main-content');
      if (mainContent) this.renderEmployeeMaster(mainContent);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async openFieldHistoryModal(employeeId) {
    try {
      const res = await API.get(`/employees/${employeeId}/field-history`);
      const { employee, history } = res;

      const modalHtml = `
        <div class="modal-dialog" style="max-width: 760px;">
          <div class="modal-header">
            <h3>Field Duty & Comp-Off Governance Timeline</h3>
            <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom: 16px; font-size: 13.5px; background: var(--neutral-50); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--neutral-200);">
              Employee: <strong>${employee.name}</strong> (<code>${employee.employee_id}</code>)<br>
              Current Status: <span class="badge ${employee.is_field_worker ? 'badge-warning' : 'badge-neutral'}">${employee.is_field_worker ? 'YES — Field Duty' : 'NO — Hospital Duty'}</span>
              ${employee.is_field_worker && employee.field_location ? `&bull; Location: <strong>${employee.field_location}</strong>` : ''}
              &nbsp;(Active since: <strong>${employee.field_worker_effective_date || employee.date_of_joining}</strong>)
            </div>

            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Duty Assignment</th>
                    <th>Location</th>
                    <th>Effective From</th>
                    <th>Effective To</th>
                    <th>Comp-Off Rule</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  ${history && history.length > 0 ? history.map(h => `
                    <tr>
                      <td>
                        <span class="badge ${h.is_field_worker ? 'badge-warning' : 'badge-neutral'}">
                          ${h.is_field_worker ? 'FIELD_WORKER' : 'HOSPITAL_DUTY'}
                        </span>
                      </td>
                      <td style="font-size: 12px; font-weight: 600; color: var(--neutral-700);">
                        ${h.field_location ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${Icons.mapPin} ${h.field_location}</span>` : '—'}
                      </td>
                      <td><strong>${h.effective_from}</strong></td>
                      <td>${h.effective_to ? h.effective_to : '<span class="badge badge-success">Present</span>'}</td>
                      <td>
                        <span style="font-size: 12px; font-weight: 600; color: ${h.is_field_worker ? '#B45309' : '#6B7280'};">
                          ${h.is_field_worker ? 'Comp-Off Provided' : 'No Comp-Off Provided'}
                        </span>
                      </td>
                      <td style="font-size: 12px; color: var(--neutral-600);">${h.remarks || '—'}</td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="6" style="text-align:center; color: var(--neutral-400); padding: 16px;">No duty change records found.</td></tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
          </div>
        </div>
      `;
      this.openModal(modalHtml);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async openEditEmployeeModal(employeeId) {
    try {
      const res = await API.get(`/employees/${employeeId}`);
      const emp = res.employee;
      if (!emp) throw new Error('Employee not found');

      const modalHtml = `
        <div class="modal-dialog" style="max-width: 680px;">
          <div class="modal-header">
            <h3>Edit Employee Details & Field Status</h3>
            <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
          </div>
          <form onsubmit="App.handleUpdateEmployee(event, '${emp.employee_id}')">
            <div class="modal-body">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Official Employee ID (Emp ID)</label>
                  <input type="text" id="edit-emp-official-id" class="form-control" value="${emp.official_employee_id || ''}" placeholder="Enter Official Emp ID (e.g. 1044, CDER-01)">
                  <div style="font-size: 11px; color: var(--neutral-400); margin-top: 3px;">System Code: <code>${emp.employee_id}</code></div>
                </div>
                <div class="form-group">
                  <label class="form-label">Full Name *</label>
                  <input type="text" id="edit-emp-name" class="form-control" value="${emp.name}" required>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Email Address *</label>
                  <input type="email" id="edit-emp-email" class="form-control" value="${emp.email}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Mobile Number</label>
                  <input type="text" id="edit-emp-mobile" class="form-control" value="${emp.mobile || ''}">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Department *</label>
                  <input type="text" id="edit-emp-dept" class="form-control" value="${emp.department}" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Designation *</label>
                  <input type="text" id="edit-emp-designation" class="form-control" value="${emp.designation}" required>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Employee Category</label>
                  <select id="edit-emp-category" class="form-control">
                    <option value="GENERAL" ${emp.employee_category === 'GENERAL' ? 'selected' : ''}>General Staff</option>
                    <option value="STAFF_WITHOUT_17_HOLIDAYS" ${emp.employee_category === 'STAFF_WITHOUT_17_HOLIDAYS' ? 'selected' : ''}>Staff Without 17 Public Holidays (10 CL)</option>
                    <option value="FIELD_WORKER" ${emp.employee_category === 'FIELD_WORKER' ? 'selected' : ''}>Field Worker Category</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Employment Status</label>
                  <select id="edit-emp-status" class="form-control">
                    <option value="ACTIVE" ${emp.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
                    <option value="ON_LEAVE" ${emp.status === 'ON_LEAVE' ? 'selected' : ''}>ON_LEAVE</option>
                    <option value="SUSPENDED" ${emp.status === 'SUSPENDED' ? 'selected' : ''}>SUSPENDED</option>
                    <option value="INACTIVE" ${emp.status === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Field Worker Status (Comp-Off Policy)</label>
                <div class="radio-card-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px;">
                  <label class="radio-card-option">
                    <input type="radio" name="edit-emp-field" value="1" ${emp.is_field_worker ? 'checked' : ''} onchange="App.toggleEditEmpLocationField(true)">
                    <div>
                      <div style="font-weight: 700; font-size: 13px; color: #B45309;">YES — Field Duty</div>
                      <div style="font-size: 11.5px; color: var(--neutral-500); line-height: 1.3; margin-top: 2px;">
                        Active field worker. Eligible for Comp-Off on weekly offs/holidays.
                      </div>
                    </div>
                  </label>
                  <label class="radio-card-option">
                    <input type="radio" name="edit-emp-field" value="0" ${!emp.is_field_worker ? 'checked' : ''} onchange="App.toggleEditEmpLocationField(false)">
                    <div>
                      <div style="font-weight: 700; font-size: 13px; color: var(--neutral-800);">NO — Hospital / Desk Duty</div>
                      <div style="font-size: 11.5px; color: var(--neutral-500); line-height: 1.3; margin-top: 2px;">
                        Returned to hospital / work completed. Comp-Off is not provided.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div id="edit-emp-location-wrapper" class="form-group" style="${emp.is_field_worker ? '' : 'display: none;'} margin-top: 10px;">
                <label class="form-label">Field Duty Location / Center</label>
                <input type="text" id="edit-emp-field-location" class="form-control" value="${emp.field_location || ''}" placeholder="e.g. Ballabgarh Rural Field Station, CRHSP, etc.">
                <div style="font-size: 11px; color: var(--neutral-400); margin-top: 3px;">
                  Designated field station or healthcare outreach outpost.
                </div>
              </div>

              <div class="form-row" style="margin-top: 10px;">
                <div class="form-group">
                  <label class="form-label">Duty Assignment Effective Date *</label>
                  <input type="date" id="edit-emp-field-date" class="form-control" value="${emp.field_worker_effective_date || new Date().toISOString().split('T')[0]}" required>
                  <div style="font-size: 11px; color: var(--neutral-400); margin-top: 3px;">
                    Date from which Comp-Off rule is applied for duty performed.
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Duty Change Remarks</label>
                  <input type="text" id="edit-emp-field-remarks" class="form-control" placeholder="e.g. Returned to hospital duty after project completion">
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">${Icons.check} Save Changes</button>
            </div>
          </form>
        </div>
      `;
      this.openModal(modalHtml);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  toggleEditEmpLocationField(show) {
    const el = document.getElementById('edit-emp-location-wrapper');
    if (el) el.style.display = show ? 'block' : 'none';
  },

  async handleUpdateEmployee(e, employeeId) {
    e.preventDefault();
    const fieldRadio = document.querySelector('input[name="edit-emp-field"]:checked');
    const is_field_worker = fieldRadio ? parseInt(fieldRadio.value, 10) : 0;
    const effective_date = document.getElementById('edit-emp-field-date')?.value;
    const field_remarks = document.getElementById('edit-emp-field-remarks')?.value.trim();
    const fieldLocationInput = document.getElementById('edit-emp-field-location');
    const field_location = is_field_worker === 1 && fieldLocationInput ? fieldLocationInput.value.trim() : null;
    const officialIdInput = document.getElementById('edit-emp-official-id');
    const official_employee_id = officialIdInput ? officialIdInput.value.trim() : null;

    const payload = {
      name: document.getElementById('edit-emp-name').value.trim(),
      email: document.getElementById('edit-emp-email').value.trim(),
      mobile: document.getElementById('edit-emp-mobile').value.trim(),
      official_employee_id,
      department: document.getElementById('edit-emp-dept').value.trim(),
      designation: document.getElementById('edit-emp-designation').value.trim(),
      employee_category: document.getElementById('edit-emp-category').value,
      status: document.getElementById('edit-emp-status').value,
      is_field_worker,
      field_location,
      effective_date,
      field_remarks
    };

    try {
      const res = await API.put(`/employees/${employeeId}`, payload);
      this.closeModal();
      Toast.success(res.message);
      const mainContent = document.getElementById('main-content');
      if (mainContent) this.renderEmployeeMaster(mainContent);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  openCreateEmployeeModal() {
    const modalHtml = `
      <div class="modal-dialog" style="max-width: 680px;">
        <div class="modal-header">
          <h3>Onboard New Employee</h3>
          <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <form onsubmit="App.handleCreateEmployee(event)">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Employee ID *</label>
                <input type="text" id="emp-id" class="form-control" placeholder="e.g. EMP003" required>
              </div>
              <div class="form-group">
                <label class="form-label">Full Name *</label>
                <input type="text" id="emp-name" class="form-control" placeholder="Full legal name" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Email ID *</label>
                <input type="email" id="emp-email" class="form-control" placeholder="employee@ems.gov.in" required>
              </div>
              <div class="form-group">
                <label class="form-label">Mobile Number *</label>
                <input type="text" id="emp-mobile" class="form-control" placeholder="+91 9999999999" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Gender *</label>
                <select id="emp-gender" class="form-control" required>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Date of Birth *</label>
                <input type="date" id="emp-dob" class="form-control" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Date of Joining (Critical for Entitlement) *</label>
                <input type="date" id="emp-doj" class="form-control" required value="${new Date().toISOString().split('T')[0]}">
              </div>
              <div class="form-group">
                <label class="form-label">Department *</label>
                <input type="text" id="emp-dept" class="form-control" placeholder="e.g. Health Administration" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Post / Role / Designation *</label>
                <input type="text" id="emp-designation" class="form-control" placeholder="e.g. Medical Officer" required>
              </div>
              <div class="form-group">
                <label class="form-label">Employee Category</label>
                <select id="emp-category" class="form-control">
                  <option value="GENERAL">General Staff</option>
                  <option value="STAFF_WITHOUT_17_HOLIDAYS">Staff Without 17 Public Holidays (10 CL)</option>
                  <option value="FIELD_WORKER">Field Worker Category</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Field Worker Status (Comp-Off Policy)</label>
              <div class="radio-card-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px;">
                <label class="radio-card-option">
                  <input type="radio" name="emp-is-field" value="1" onchange="document.getElementById('create-emp-location-wrapper').style.display='block'">
                  <div>
                    <div style="font-weight: 700; font-size: 13px; color: #B45309;">YES — Field Duty</div>
                    <div style="font-size: 11.5px; color: var(--neutral-500); line-height: 1.3; margin-top: 2px;">
                      Active on field operations. Eligible for Comp-Off for duty on weekly offs/holidays.
                    </div>
                  </div>
                </label>
                <label class="radio-card-option">
                  <input type="radio" name="emp-is-field" value="0" checked onchange="document.getElementById('create-emp-location-wrapper').style.display='none'">
                  <div>
                    <div style="font-weight: 700; font-size: 13px; color: var(--neutral-800);">NO — Hospital / Desk Duty</div>
                    <div style="font-size: 11.5px; color: var(--neutral-500); line-height: 1.3; margin-top: 2px;">
                      Hospital, clinical, or desk station. Comp-Off is not provided.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div id="create-emp-location-wrapper" class="form-group" style="display: none; margin-top: 10px;">
              <label class="form-label">Field Duty Location / Center</label>
              <input type="text" id="emp-field-location" class="form-control" placeholder="e.g. Ballabgarh Rural Field Station, CRHSP, etc.">
              <div style="font-size: 11px; color: var(--neutral-400); margin-top: 3px;">
                Primary field station, outreach outpost, or healthcare center where duty is stationed.
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">${Icons.check} Onboard & Calculate Entitlements</button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async handleCreateEmployee(e) {
    e.preventDefault();
    const fieldRadio = document.querySelector('input[name="emp-is-field"]:checked');
    const isFieldWorker = fieldRadio ? parseInt(fieldRadio.value, 10) : 0;
    const fieldLocInput = document.getElementById('emp-field-location');
    const data = {
      employee_id: document.getElementById('emp-id').value.trim().toUpperCase(),
      name: document.getElementById('emp-name').value.trim(),
      email: document.getElementById('emp-email').value.trim().toLowerCase(),
      mobile: document.getElementById('emp-mobile').value.trim(),
      gender: document.getElementById('emp-gender').value,
      date_of_birth: document.getElementById('emp-dob').value,
      date_of_joining: document.getElementById('emp-doj').value,
      department: document.getElementById('emp-dept').value.trim(),
      designation: document.getElementById('emp-designation').value.trim(),
      employee_category: document.getElementById('emp-category').value,
      is_field_worker: isFieldWorker,
      field_location: isFieldWorker === 1 && fieldLocInput ? fieldLocInput.value.trim() : null
    };

    try {
      const res = await API.post('/employees', data);
      this.closeModal();
      Toast.success(res.message);

      // Display credential generated modal
      const credHtml = `
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>Employee Created Successfully</h3>
            <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
          </div>
          <div class="modal-body">
            <div style="background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 6px; padding: 14px; margin-bottom: 16px; color: #065F46;">
              ${Icons.check} <strong>Credentials Dispatched:</strong> Secure temporary password generated and dispatched to registered email <strong>${res.userAccount.email}</strong>.
            </div>
            <div style="font-size: 13.5px; margin-bottom: 12px;">
              <strong>Temporary Password:</strong> <code style="background: var(--neutral-100); padding: 3px 8px; border-radius: 4px; font-size: 14px;">${res.userAccount.temporaryPassword}</code>
            </div>
            <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Initial Dynamic Leave Credits:</div>
            <ul style="font-size: 13px; margin-left: 20px;">
              ${res.initialCredits.map(c => `<li><strong>${c.name} (${c.leaveType}):</strong> +${c.amount} days (${c.formula})</li>`).join('')}
            </ul>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" onclick="App.closeModal(); App.renderCurrentView();">Done</button>
          </div>
        </div>
      `;
      this.openModal(credHtml);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     LEAVE LEDGER & BALANCES VIEW (DOUBLE-ENTRY LEDGER AUDIT)
     ========================================================================== */
  async renderLedgerView(container) {
    container.innerHTML = `<div class="card"><p>Loading complete double-entry leave ledger...</p></div>`;

    try {
      const res = await API.get('/ledger/transactions');
      const transactions = res.transactions || [];

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Leave Credit & Deduction Transaction Ledger</div>
            <button class="btn btn-secondary btn-sm" onclick="App.openManualAdjustmentModal()">
              ${Icons.plus} Manual Adjustment
            </button>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tx #</th>
                  <th>Employee</th>
                  <th>Leave Type</th>
                  <th>Transaction Type</th>
                  <th>Amount</th>
                  <th>Running Balance</th>
                  <th>Reference / Request</th>
                  <th>Remarks / Reason</th>
                  <th>Recorded By</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${transactions.map(t => `
                  <tr>
                    <td>#${t.id}</td>
                    <td>
                      <div><strong>${t.employee_name}</strong></div>
                      <div style="font-size: 11px; color: var(--neutral-400);">${t.employee_id}</div>
                    </td>
                    <td><span class="badge badge-primary">${t.leave_type_code}</span></td>
                    <td><span class="badge badge-neutral">${t.transaction_type}</span></td>
                    <td>
                      <strong style="color: ${t.amount > 0 ? '#059669' : '#DC2626'};">
                        ${t.amount > 0 ? '+' : ''}${t.amount}
                      </strong>
                    </td>
                    <td><strong>${t.running_balance}</strong></td>
                    <td><span style="font-size: 12px; font-family: monospace;">${t.reference_id || 'N/A'}</span></td>
                    <td><span style="font-size: 12.5px;">${t.remarks || 'None'}</span></td>
                    <td>${t.created_by}</td>
                    <td>${t.created_at}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     MANUAL LEAVE ADJUSTMENT MODAL
     ========================================================================== */
  async openManualAdjustmentModal() {
    try {
      const resEmp = await API.get('/employees');
      const employees = resEmp.employees || [];
      const resTypes = await API.get('/leave-types');
      const leaveTypes = resTypes.leaveTypes || [];

      const modalHtml = `
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>Manual Leave Adjustment</h3>
            <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
          </div>
          <form onsubmit="App.handleManualAdjustment(event)">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Employee *</label>
                <select id="adj-emp" class="form-control" required>
                  <option value="">-- Select Employee --</option>
                  ${employees.map(e => `<option value="${e.employee_id}">${e.name} (${e.employee_id}) &mdash; ${e.department}</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Leave Type *</label>
                <select id="adj-type" class="form-control" required>
                  <option value="">-- Select Leave Type --</option>
                  ${leaveTypes.map(t => `<option value="${t.id}">${t.name} (${t.code})</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Adjustment Amount (Days) *</label>
                <input type="number" id="adj-amount" class="form-control" step="0.5" placeholder="e.g. +1.5 or -2.0" required>
                <div class="form-hint">Enter positive value to credit leave, negative value to debit leave.</div>
              </div>

              <div class="form-group">
                <label class="form-label">Mandatory Audit Reason / Remarks *</label>
                <textarea id="adj-remarks" class="form-control" rows="2" placeholder="State reason for manual adjustment (audited)" required></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">${Icons.check} Apply Adjustment</button>
            </div>
          </form>
        </div>
      `;
      this.openModal(modalHtml);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async handleManualAdjustment(e) {
    e.preventDefault();
    const employeeId = document.getElementById('adj-emp').value;
    const leaveTypeId = document.getElementById('adj-type').value;
    const amount = document.getElementById('adj-amount').value;
    const remarks = document.getElementById('adj-remarks').value;

    try {
      const res = await API.post('/ledger/adjust', {
        employeeId,
        leaveTypeId: parseInt(leaveTypeId, 10),
        amount: parseFloat(amount),
        remarks
      });

      Toast.success(res.message);
      this.closeModal();
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     RULES & VERSIONING VIEW (ADMIN)
     ========================================================================== */
  /* ==========================================================================
     RULES & VERSIONING VIEW (DOCTOR HOD & EXECUTIVE FRIENDLY)
     ========================================================================== */
  generatePolicyNarrative(r, cfg) {
    const annual = cfg.annual_entitlement || 0;
    const maxCont = cfg.max_continuous_days || 0;
    const midYear = cfg.mid_year_treatment || 'PRO_RATA';
    const altEnt = cfg.alternate_entitlement;
    const altCat = cfg.alternate_category;
    const ceiling = cfg.accumulation_ceiling;
    const carry = cfg.carry_forward;
    const encash = cfg.encashment_supported;

    let narrative = `Full-time personnel are allocated <strong>${annual} days</strong> of ${r.leave_type_name} per calendar year. `;

    if (altEnt && altCat) {
      narrative += `Staff serving in <strong>${altCat.replace(/_/g, ' ')}</strong> receive an alternate allocation of <strong>${altEnt} days</strong>. `;
    }

    if (midYear === 'PRO_RATA') {
      narrative += `Personnel joining mid-year receive leave calculated on a <strong>Pro-Rata basis</strong> according to remaining calendar months. `;
    } else if (midYear === 'COMPLETED_MONTHS_RATE') {
      narrative += `Mid-year joiners accrue leave at <strong>${cfg.completed_month_rate || 2.5} days per completed calendar month</strong>. `;
    } else if (midYear === 'FULL_CREDIT') {
      narrative += `New joiners receive the <strong>full annual quota</strong> regardless of joining date. `;
    } else if (midYear === 'DEPARTMENTAL_DISCRETION') {
      narrative += `Mid-year allocation is decided at <strong>HOD / Departmental discretion</strong>. `;
    }

    if (maxCont > 0) {
      narrative += `Availment is capped at <strong>${maxCont} continuous days</strong> per leave request. `;
    }

    if (cfg.exclude_weekly_offs && cfg.exclude_public_holidays) {
      narrative += `Weekly-offs and gazetted public holidays falling within the period are <strong>excluded from leave deduction</strong> (zero balance charged). `;
    } else if (cfg.exclude_weekly_offs) {
      narrative += `Weekly-offs are excluded, while public holidays are charged. `;
    }

    if (carry) {
      narrative += `Unavailed leave carries forward up to a maximum ceiling of <strong>${ceiling || 300} days</strong>. `;
    } else {
      narrative += `Unavailed balance lapses on 31st December (<strong>no carry forward</strong>). `;
    }

    if (encash) {
      narrative += `Leave encashment is permitted up to <strong>${cfg.encashment_max_at_retirement || 300} days</strong> upon superannuation/retirement.`;
    }

    return narrative;
  },

  renderRuleCard(r) {
    const cfg = r.config || {};
    const narrative = this.generatePolicyNarrative(r, cfg);
    const midYearDisplay = {
      'PRO_RATA': 'Pro-Rata (Remaining Months)',
      'COMPLETED_MONTHS_RATE': `${cfg.completed_month_rate || 2.5} Days / Month`,
      'FULL_CREDIT': 'Full Annual Credit',
      'DEPARTMENTAL_DISCRETION': 'HOD Discretion',
      'NOT_APPLICABLE': 'Not Applicable'
    }[cfg.mid_year_treatment] || cfg.mid_year_treatment || 'Standard';

    return `
      <div class="policy-card" id="policy-card-${r.rule_id}">
        <!-- Policy Header -->
        <div class="policy-header">
          <div class="policy-title-area">
            <span class="policy-code-pill">${r.leave_type_code}</span>
            <div>
              <div class="policy-name">${r.rule_name}</div>
              <div class="policy-official-ref">Official Rule Code: ${r.rule_code}</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <div class="policy-view-switcher">
              <button class="policy-view-btn active" id="btn-vis-${r.rule_id}" onclick="App.toggleRuleView(${r.rule_id}, 'visual')">
                Executive View
              </button>
              <button class="policy-view-btn" id="btn-json-${r.rule_id}" onclick="App.toggleRuleView(${r.rule_id}, 'json')">
                Developer JSON
              </button>
            </div>

            <span class="badge badge-success">Active: v${r.active_version_number || 1}</span>

            <button class="btn btn-primary btn-sm" onclick="App.openCreateVersionModal(${r.rule_id}, '${r.rule_code}')">
              ${Icons.plus} New Policy Version
            </button>
          </div>
        </div>

        <div class="policy-body">
          <!-- VISUAL DOCTOR HOD VIEW (DEFAULT) -->
          <div id="rule-visual-${r.rule_id}">
            <!-- Plain English Clinical Narrative Summary -->
            <div class="policy-hod-summary">
              <div class="policy-hod-summary-title">
                ${Icons.shield} Administrative & Clinical Policy Overview (Plain English)
              </div>
              <div class="policy-hod-summary-text">
                ${narrative}
              </div>
            </div>

            <!-- Key Executive Policy Metrics -->
            <div class="policy-metrics-grid">
              <div class="policy-metric-card">
                <div class="policy-metric-header">${Icons.calendar} Annual Entitlement</div>
                <div class="policy-metric-value">${cfg.annual_entitlement || 0} Days</div>
                <div class="policy-metric-subtext">
                  ${cfg.alternate_entitlement ? `Alternate: <strong>${cfg.alternate_entitlement} Days</strong> (${(cfg.alternate_category || 'Special').replace(/_/g, ' ')})` : 'Standard annual quota'}
                </div>
              </div>

              <div class="policy-metric-card">
                <div class="policy-metric-header">${Icons.clock} Max Continuous Availment</div>
                <div class="policy-metric-value">${cfg.max_continuous_days || '—'} Days</div>
                <div class="policy-metric-subtext">Maximum permissible in single stretch</div>
              </div>

              <div class="policy-metric-card">
                <div class="policy-metric-header">${Icons.users} Mid-Year Joining Formula</div>
                <div class="policy-metric-value" style="font-size: 16px;">${midYearDisplay}</div>
                <div class="policy-metric-subtext">Automated rule for staff joining mid-cycle</div>
              </div>

              <div class="policy-metric-card">
                <div class="policy-metric-header">${Icons.check} Weekends & Gazetted Holidays</div>
                <div class="policy-metric-value" style="font-size: 16px; color: ${cfg.exclude_weekly_offs ? '#059669' : '#DC2626'};">
                  ${cfg.exclude_weekly_offs && cfg.exclude_public_holidays ? 'Excluded (Zero Charge)' : (cfg.exclude_weekly_offs ? 'Weekly Offs Excluded' : 'Deducted')}
                </div>
                <div class="policy-metric-subtext">
                  ${cfg.sandwich_applicable ? 'Sandwich rule: Active' : 'Sandwich rule: Inactive'}
                </div>
              </div>
            </div>

            <!-- Detailed Rule Parameters -->
            <div class="policy-rules-row">
              <div class="policy-rule-box">
                <div class="policy-rule-box-title">
                  ${Icons.clipboard} Availment & Scheduling Rules
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Credit Cycle / Schedule</span>
                  <span class="policy-rule-val">${cfg.cycle_type || (cfg.semi_annual_credit ? 'Semi-Annual (1 Jan / 1 Jul)' : 'Annual (1 Jan)')}</span>
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Weekly-Offs Chargeable</span>
                  <span class="policy-rule-val">${cfg.exclude_weekly_offs ? 'NO (Excluded from balance)' : 'YES (Charged)'}</span>
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Public Holidays Chargeable</span>
                  <span class="policy-rule-val">${cfg.exclude_public_holidays ? 'NO (Excluded from balance)' : 'YES (Charged)'}</span>
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Half-Day Leave Allowed</span>
                  <span class="policy-rule-val">${r.allow_half_day ? 'YES' : 'NO'}</span>
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Minimum Days per Request</span>
                  <span class="policy-rule-val">${r.min_days_per_request || 0.5} Day(s)</span>
                </div>
              </div>

              <div class="policy-rule-box">
                <div class="policy-rule-box-title">
                  ${Icons.bookOpen} Carry Forward, Accumulation & Combinations
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Carry Forward to Next Year</span>
                  <span class="policy-rule-val">${cfg.carry_forward ? 'YES (Accumulates)' : 'NO (Lapses Dec 31)'}</span>
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Maximum Accumulation Ceiling</span>
                  <span class="policy-rule-val">${cfg.accumulation_ceiling ? `${cfg.accumulation_ceiling} Days` : 'No Ceiling'}</span>
                </div>
                <div class="policy-rule-item">
                  <span class="policy-rule-label">Retirement Encashment</span>
                  <span class="policy-rule-val">${cfg.encashment_supported ? `Permitted (Max ${cfg.encashment_max_at_retirement || 300} Days)` : 'Not Permitted'}</span>
                </div>

                <div style="margin-top: 10px;">
                  <div style="font-size: 12px; font-weight: 700; color: var(--neutral-600); margin-bottom: 4px;">Permitted Combinations (Clubbing):</div>
                  <div class="chips-container">
                    ${cfg.can_combine_with && cfg.can_combine_with.length > 0
                      ? cfg.can_combine_with.map(c => `<span class="chip chip-allowed">${Icons.check} ${c.replace(/_/g, ' ')}</span>`).join('')
                      : '<span style="font-size: 12px; color: var(--neutral-400);">None specified</span>'}
                  </div>
                </div>

                <div style="margin-top: 10px;">
                  <div style="font-size: 12px; font-weight: 700; color: var(--neutral-600); margin-bottom: 4px;">Prohibited Combinations:</div>
                  <div class="chips-container">
                    ${cfg.cannot_combine_with && cfg.cannot_combine_with.length > 0
                      ? cfg.cannot_combine_with.map(c => `<span class="chip chip-prohibited">${Icons.x} ${c.replace(/_/g, ' ')}</span>`).join('')
                      : '<span style="font-size: 12px; color: var(--neutral-400);">None prohibited</span>'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- RAW DEVELOPER JSON VIEW (COLLAPSIBLE / SECONDARY) -->
          <div id="rule-json-${r.rule_id}" style="display: none;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 12px; color: var(--neutral-500); font-weight: 600;">Technical Database Configuration JSON</span>
              <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('raw-pre-${r.rule_id}').innerText); Toast.info('JSON copied to clipboard');">
                Copy JSON
              </button>
            </div>
            <div style="background: #0F172A; color: #E2E8F0; border-radius: var(--radius-sm); padding: 14px; font-size: 12.5px; font-family: var(--font-mono); overflow-x: auto;">
              <pre id="raw-pre-${r.rule_id}" style="margin: 0; white-space: pre-wrap;">${JSON.stringify(r.config, null, 2)}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  toggleRuleView(ruleId, mode) {
    const visEl = document.getElementById(`rule-visual-${ruleId}`);
    const jsonEl = document.getElementById(`rule-json-${ruleId}`);
    const btnVis = document.getElementById(`btn-vis-${ruleId}`);
    const btnJson = document.getElementById(`btn-json-${ruleId}`);

    if (mode === 'visual') {
      if (visEl) visEl.style.display = 'block';
      if (jsonEl) jsonEl.style.display = 'none';
      btnVis?.classList.add('active');
      btnJson?.classList.remove('active');
    } else {
      if (visEl) visEl.style.display = 'none';
      if (jsonEl) jsonEl.style.display = 'block';
      btnJson?.classList.add('active');
      btnVis?.classList.remove('active');
    }
  },

  async renderRulesView(container) {
    container.innerHTML = `<div class="card"><p>Loading configurable policies and versions...</p></div>`;

    try {
      const res = await API.get('/leave-rules');
      const rules = res.rules || [];

      // Store in App state for version builder lookup
      this.state.rulesCache = rules;

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Leave Policies & Version Governance</div>
              <div style="font-size: 13px; color: var(--neutral-500); margin-top: 2px;">
                Executive medical and administrative rules in clear plain English. Fully database-driven and configurable.
              </div>
            </div>
            <span class="badge badge-info">${Icons.shield} Central Govt & Hospital Compliant</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${rules.map(r => this.renderRuleCard(r)).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  openCreateVersionModal(ruleId, ruleCode) {
    const rule = (this.state.rulesCache || []).find(r => r.rule_id === ruleId);
    const existingCfg = rule?.config || {};
    const today = new Date().toISOString().split('T')[0];

    const modalHtml = `
      <div class="modal-dialog" style="max-width: 720px;">
        <div class="modal-header">
          <h3>Create New Policy Version (${ruleCode})</h3>
          <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <form onsubmit="App.handleCreateRuleVersion(event, ${ruleId})">
          <div class="modal-body" style="max-height: 75vh; overflow-y: auto;">
            <!-- Tabs for Form vs Raw JSON -->
            <div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--neutral-200); padding-bottom: 10px;">
              <button type="button" class="btn btn-primary btn-sm" id="btn-builder-form" onclick="App.switchVersionEditorTab('form')">
                Visual Form (Doctor / HOD Friendly)
              </button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-builder-json" onclick="App.switchVersionEditorTab('json')">
                Raw JSON (Technical)
              </button>
            </div>

            <!-- SECTION 1: VERSION & EFFECTIVE DATES -->
            <div class="form-section-header">
              ${Icons.calendar} 1. Version Effective Dates & Status
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Effective From Date *</label>
                <input type="date" id="ver-effective" class="form-control" required value="${today}">
              </div>
              <div class="form-group">
                <label class="form-label">Activation Status</label>
                <select id="ver-active" class="form-control">
                  <option value="true">Make Active Immediately (Archive prior version)</option>
                  <option value="false">Save as Draft (Do not activate yet)</option>
                </select>
              </div>
            </div>

            <!-- TAB CONTAINER: FORM VIEW -->
            <div id="version-tab-form">
              <!-- SECTION 2: ENTITLEMENTS & MID-YEAR JOINING -->
              <div class="form-section-header">
                ${Icons.users} 2. Annual Entitlement & Mid-Year Joining Formula
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Standard Annual Entitlement (Days) *</label>
                  <input type="number" step="0.5" id="vf-annual-ent" class="form-control" value="${existingCfg.annual_entitlement || 8}" required oninput="App.updatePolicyVersionPreview()">
                </div>
                <div class="form-group">
                  <label class="form-label">Alternate Entitlement (Days, Optional)</label>
                  <input type="number" step="0.5" id="vf-alt-ent" class="form-control" value="${existingCfg.alternate_entitlement || ''}" placeholder="e.g. 10" oninput="App.updatePolicyVersionPreview()">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Alternate Category (if alternate entitlement set)</label>
                  <select id="vf-alt-cat" class="form-control" onchange="App.updatePolicyVersionPreview()">
                    <option value="STAFF_WITHOUT_17_HOLIDAYS" ${existingCfg.alternate_category === 'STAFF_WITHOUT_17_HOLIDAYS' ? 'selected' : ''}>Staff Without 17 Public Holidays</option>
                    <option value="FIELD_WORKER" ${existingCfg.alternate_category === 'FIELD_WORKER' ? 'selected' : ''}>Field Worker</option>
                    <option value="SHIFT_DUTY_STAFF" ${existingCfg.alternate_category === 'SHIFT_DUTY_STAFF' ? 'selected' : ''}>Shift Duty Staff</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Mid-Year Joining Calculation Formula *</label>
                  <select id="vf-mid-year" class="form-control" required onchange="App.updatePolicyVersionPreview()">
                    <option value="PRO_RATA" ${existingCfg.mid_year_treatment === 'PRO_RATA' ? 'selected' : ''}>Pro-Rata by Remaining Months (Standard CL)</option>
                    <option value="COMPLETED_MONTHS_RATE" ${existingCfg.mid_year_treatment === 'COMPLETED_MONTHS_RATE' ? 'selected' : ''}>2.5 Days per Completed Month (Standard EL)</option>
                    <option value="FULL_CREDIT" ${existingCfg.mid_year_treatment === 'FULL_CREDIT' ? 'selected' : ''}>Full Annual Credit Regardless of Joining Date</option>
                    <option value="DEPARTMENTAL_DISCRETION" ${existingCfg.mid_year_treatment === 'DEPARTMENTAL_DISCRETION' ? 'selected' : ''}>Departmental / HOD Discretion</option>
                    <option value="NOT_APPLICABLE" ${existingCfg.mid_year_treatment === 'NOT_APPLICABLE' ? 'selected' : ''}>Not Applicable (No Credit for Mid-Year Joiners)</option>
                  </select>
                </div>
              </div>

              <!-- SECTION 3: AVAILMENT LIMITS & EXCLUSIONS -->
              <div class="form-section-header">
                ${Icons.clock} 3. Availment Limits & Weekend Exclusions
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Max Continuous Availment (Days)</label>
                  <input type="number" step="0.5" id="vf-max-cont" class="form-control" value="${existingCfg.max_continuous_days || 5}" required oninput="App.updatePolicyVersionPreview()">
                </div>
                <div class="form-group">
                  <label class="form-label">Accumulation Ceiling (Max Days Saved)</label>
                  <input type="number" step="0.5" id="vf-ceiling" class="form-control" value="${existingCfg.accumulation_ceiling || 8}" oninput="App.updatePolicyVersionPreview()">
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="vf-excl-wo" ${existingCfg.exclude_weekly_offs !== false ? 'checked' : ''} onchange="App.updatePolicyVersionPreview()">
                  Exclude Weekly Offs from Leave Deduction
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="vf-excl-hol" ${existingCfg.exclude_public_holidays !== false ? 'checked' : ''} onchange="App.updatePolicyVersionPreview()">
                  Exclude Public Holidays from Leave Deduction
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="vf-carry" ${existingCfg.carry_forward ? 'checked' : ''} onchange="App.updatePolicyVersionPreview()">
                  Allow Carry-Forward to Next Year
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="vf-encash" ${existingCfg.encashment_supported ? 'checked' : ''} onchange="App.updatePolicyVersionPreview()">
                  Support Leave Encashment on Retirement
                </label>
              </div>

              <!-- LIVE PLAIN ENGLISH SUMMARY -->
              <div class="live-preview-box">
                <strong>Plain English Rule Preview for Doctors & Staff:</strong>
                <div id="live-policy-narrative" style="margin-top: 4px; font-size: 13px;"></div>
              </div>
            </div>

            <!-- TAB CONTAINER: RAW JSON VIEW (ADVANCED) -->
            <div id="version-tab-json" style="display: none;">
              <div class="form-group">
                <label class="form-label">Raw Policy Configuration JSON *</label>
                <textarea id="ver-config" class="form-control" rows="12" style="font-family: var(--font-mono); font-size: 12.5px;">${JSON.stringify(existingCfg, null, 2)}</textarea>
                <div class="form-hint">Direct JSON payload for system engineers.</div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">${Icons.check} Publish Policy Version</button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
    setTimeout(() => this.updatePolicyVersionPreview(), 50);
  },

  switchVersionEditorTab(tab) {
    const formTab = document.getElementById('version-tab-form');
    const jsonTab = document.getElementById('version-tab-json');
    const btnForm = document.getElementById('btn-builder-form');
    const btnJson = document.getElementById('btn-builder-json');
    const jsonArea = document.getElementById('ver-config');

    if (tab === 'form') {
      if (formTab) formTab.style.display = 'block';
      if (jsonTab) jsonTab.style.display = 'none';
      btnForm?.classList.replace('btn-secondary', 'btn-primary');
      btnJson?.classList.replace('btn-primary', 'btn-secondary');
    } else {
      // Sync form into JSON before switching
      const config = this.buildConfigFromVisualForm();
      if (jsonArea) jsonArea.value = JSON.stringify(config, null, 2);
      if (formTab) formTab.style.display = 'none';
      if (jsonTab) jsonTab.style.display = 'block';
      btnJson?.classList.replace('btn-secondary', 'btn-primary');
      btnForm?.classList.replace('btn-primary', 'btn-secondary');
    }
  },

  buildConfigFromVisualForm() {
    const annual = parseFloat(document.getElementById('vf-annual-ent')?.value || '0');
    const altEnt = document.getElementById('vf-alt-ent')?.value ? parseFloat(document.getElementById('vf-alt-ent').value) : null;
    const altCat = document.getElementById('vf-alt-cat')?.value || 'STAFF_WITHOUT_17_HOLIDAYS';
    const midYear = document.getElementById('vf-mid-year')?.value || 'PRO_RATA';
    const maxCont = parseFloat(document.getElementById('vf-max-cont')?.value || '0');
    const ceiling = parseFloat(document.getElementById('vf-ceiling')?.value || '0');
    const exclWo = document.getElementById('vf-excl-wo')?.checked ?? true;
    const exclHol = document.getElementById('vf-excl-hol')?.checked ?? true;
    const carry = document.getElementById('vf-carry')?.checked ?? false;
    const encash = document.getElementById('vf-encash')?.checked ?? false;

    const config = {
      annual_entitlement: annual,
      max_continuous_days: maxCont,
      mid_year_treatment: midYear,
      exclude_weekly_offs: exclWo,
      exclude_public_holidays: exclHol,
      carry_forward: carry,
      accumulation_ceiling: ceiling,
      encashment_supported: encash
    };

    if (altEnt) {
      config.alternate_entitlement = altEnt;
      config.alternate_category = altCat;
    }
    if (midYear === 'PRO_RATA') {
      config.pro_rata_basis = 'REMAINING_MONTHS';
    } else if (midYear === 'COMPLETED_MONTHS_RATE') {
      config.completed_month_rate = 2.5;
    }
    if (encash) {
      config.encashment_max_at_retirement = ceiling || 300;
    }

    return config;
  },

  updatePolicyVersionPreview() {
    const previewEl = document.getElementById('live-policy-narrative');
    if (!previewEl) return;

    const cfg = this.buildConfigFromVisualForm();
    let text = `Staff will receive <strong>${cfg.annual_entitlement} days</strong> annually. `;
    if (cfg.alternate_entitlement) {
      text += `Alternate category <strong>${cfg.alternate_category.replace(/_/g, ' ')}</strong> receives <strong>${cfg.alternate_entitlement} days</strong>. `;
    }
    text += `Mid-year joiners will be calculated via <strong>${cfg.mid_year_treatment}</strong>. `;
    text += `Max continuous stretch permitted: <strong>${cfg.max_continuous_days} days</strong>. `;
    text += `Weekly offs: <strong>${cfg.exclude_weekly_offs ? 'Excluded' : 'Charged'}</strong>. Public holidays: <strong>${cfg.exclude_public_holidays ? 'Excluded' : 'Charged'}</strong>. `;
    text += cfg.carry_forward ? `Unavailed leave carries forward (ceiling: ${cfg.accumulation_ceiling} days).` : `Lapses at year end (no carry-forward).`;

    previewEl.innerHTML = text;
  },

  async handleCreateRuleVersion(e, ruleId) {
    e.preventDefault();
    const effective_from = document.getElementById('ver-effective').value;
    const makeActive = document.getElementById('ver-active').value === 'true';

    // Check which tab is active: visual form or raw JSON
    const isJsonTab = document.getElementById('version-tab-json')?.style.display !== 'none';
    let config;

    if (isJsonTab) {
      const configStr = document.getElementById('ver-config').value;
      try {
        config = JSON.parse(configStr);
      } catch (err) {
        Toast.error('Invalid JSON configuration syntax.');
        return;
      }
    } else {
      config = this.buildConfigFromVisualForm();
    }

    try {
      const res = await API.post(`/leave-rules/${ruleId}/versions`, {
        effective_from,
        config,
        makeActive
      });
      Toast.success(res.message);
      this.closeModal();
      const mainContent = document.getElementById('main-content');
      if (mainContent) this.renderRulesView(mainContent);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     AUTOMATED CREDIT SCHEDULES VIEW (ADMIN)
     ========================================================================== */
  async renderSchedulesView(container) {
    container.innerHTML = `<div class="card"><p>Loading credit schedules...</p></div>`;

    try {
      const res = await API.get('/ledger/schedules');
      const schedules = res.schedules || [];
      const executions = res.executions || [];

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Automated & Idempotent Leave Credit Schedules</div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 28px;">
            ${schedules.map(s => `
              <div style="border: 1px solid var(--neutral-200); border-radius: var(--radius-md); padding: 18px; background: #ffffff;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <strong style="font-size: 15px;">${s.schedule_name}</strong>
                  <span class="badge badge-primary">${s.leave_code}</span>
                </div>
                <div style="font-size: 13px; color: var(--neutral-600); margin-bottom: 12px;">
                  Type: <strong>${s.schedule_type}</strong> &bull; Credit Date: <strong>${s.credit_month_day || 'Annual'}</strong>
                </div>
                <div style="font-size: 12px; color: var(--neutral-500); margin-bottom: 16px;">
                  Last Run: ${s.last_run_at || 'Never'}
                </div>
                <button class="btn btn-secondary btn-sm" onclick="App.runCreditSchedule(${s.id})">
                  ${Icons.refresh} Execute Schedule Now
                </button>
              </div>
            `).join('')}
          </div>

          <div class="card-title" style="margin-bottom: 14px;">Recent Execution Audit Log</div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Cycle Key</th>
                  <th>Schedule</th>
                  <th>Employees Credited</th>
                  <th>Executed At</th>
                </tr>
              </thead>
              <tbody>
                ${executions.map(e => `
                  <tr>
                    <td><span style="font-family: monospace; font-size: 12px;">${e.cycle_key}</span></td>
                    <td>${e.schedule_name}</td>
                    <td><strong>${e.employees_credited_count}</strong></td>
                    <td>${e.executed_at}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  async runCreditSchedule(scheduleId) {
    const confirmed = await this.confirmModal({
      title: 'Run Credit Schedule',
      message: 'Execute automated credit schedule for this cycle? Duplicate runs will be safely detected and skipped.',
      confirmText: 'Execute Schedule',
      variant: 'primary'
    });
    if (!confirmed) return;
    try {
      const res = await API.post('/ledger/schedules/run', { scheduleId });
      if (res.alreadyExecuted) {
        Toast.warning(res.message);
      } else {
        Toast.success(`Schedule executed successfully. Credited ${res.employeesCreditedCount} employees.`);
      }
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     HOLIDAYS & MASTER POLICIES VIEW
     ========================================================================== */
  async renderMasterDataView(container) {
    await this.renderHolidaysView(container);
  },

  /* ==========================================================================
     OFFICIAL HOLIDAYS & CALENDAR VIEW (GAZETTED & RESTRICTED HOLIDAYS)
     ========================================================================== */
  async renderHolidaysView(container) {
    container.innerHTML = `<div class="card"><p>Loading official holiday calendar and policies...</p></div>`;

    try {
      const resHolidays = await API.get('/holidays');
      this.state.allHolidays = resHolidays.holidays || [];
      const resSandwich = await API.get('/sandwich-rules');
      this.state.sandwichRules = resSandwich.rules || [];

      if (!this.state.holidayActiveTab) {
        this.state.holidayActiveTab = 'gazetted';
      }

      this.renderHolidayViewContent(container);
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error loading holidays: ${err.message}</p></div>`;
    }
  },

  renderHolidayViewContent(container) {
    const holidays = this.state.allHolidays || [];
    const activeTab = this.state.holidayActiveTab || 'gazetted';
    const isAdmin = this.state.user && this.state.user.role === 'ADMIN';

    const gazetted = holidays.filter(h => h.is_gazetted);
    const restricted = holidays.filter(h => h.is_restricted);

    container.innerHTML = `
      <!-- Header Banner -->
      <div class="cder-header-card" style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 13px; font-weight: 700; color: #818CF8; letter-spacing: 0.05em; text-transform: uppercase;">
              AIIMS &bull; Centre for Dental Education and Research (CDER)
            </div>
            <div class="cder-header-title" style="margin-top: 4px;">
              ${Icons.calendar} Official Holiday Calendar & Leave Policies (2026)
            </div>
            <div class="cder-header-subtitle">
              Central Government & AIIMS Gazetted Closed Holidays, Restricted Holidays (RH), and Field Duty Comp-Off Rules.
            </div>
          </div>
          ${isAdmin ? `
            <button class="btn btn-primary btn-sm" onclick="App.openCreateHolidayModal()">
              ${Icons.plus} Add Holiday
            </button>
          ` : ''}
        </div>

        <div class="cder-badge-row">
          <span class="cder-pill highlight">
            ${Icons.check} Gazetted / Public Holidays: ${gazetted.length} Days
          </span>
          <span class="cder-pill date-badge">
            ${Icons.calendar} Restricted Holidays (RH Calendar): ${restricted.length} Days
          </span>
          <span class="cder-pill">
            ${Icons.briefcase} Field Comp-Off Eligible: Sundays & Gazetted Holidays
          </span>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="tabs-nav" style="margin-bottom: 20px;">
        <button class="tab-btn ${activeTab === 'gazetted' ? 'active' : ''}" onclick="App.switchHolidayTab('gazetted')">
          ${Icons.calendar} Gazetted & Public Holidays (${gazetted.length})
        </button>
        <button class="tab-btn ${activeTab === 'restricted' ? 'active' : ''}" onclick="App.switchHolidayTab('restricted')">
          ${Icons.clipboard} Restricted Holidays / RH Calendar (${restricted.length})
        </button>
        <button class="tab-btn ${activeTab === 'weeklyoff' ? 'active' : ''}" onclick="App.switchHolidayTab('weeklyoff')">
          ${Icons.briefcase} Weekly Offs & Comp-Off Rules
        </button>
        ${isAdmin ? `
          <button class="tab-btn ${activeTab === 'sandwich' ? 'active' : ''}" onclick="App.switchHolidayTab('sandwich')">
            ${Icons.sliders} Sandwich Rule Policy
          </button>
        ` : ''}
      </div>

      <!-- Tab Content Area -->
      <div id="holiday-tab-content"></div>
    `;

    this.renderHolidayTabContent();
  },

  switchHolidayTab(tabName) {
    this.state.holidayActiveTab = tabName;
    const container = document.getElementById('main-content');
    if (container) {
      this.renderHolidayViewContent(container);
    }
  },

  renderHolidayTabContent() {
    const tabEl = document.getElementById('holiday-tab-content');
    if (!tabEl) return;

    const holidays = this.state.allHolidays || [];
    const sandwichRules = this.state.sandwichRules || [];
    const activeTab = this.state.holidayActiveTab || 'gazetted';
    const isAdmin = this.state.user && this.state.user.role === 'ADMIN';

    if (activeTab === 'gazetted') {
      const gazetted = holidays.filter(h => h.is_gazetted);
      tabEl.innerHTML = `
        <div class="card">
          <div class="card-header" style="padding-bottom: 12px; border-bottom: 1px solid var(--neutral-200);">
            <div>
              <div class="card-title">Gazetted & Public Holidays — 2026 (${gazetted.length} Days)</div>
              <p style="font-size: 13px; color: var(--neutral-500); margin-top: 4px;">
                Mandatory closed holidays for Central Government / AIIMS CDER. Staff performing field duty on any Gazetted Holiday or Sunday earn 1 Compensatory Off day.
              </p>
            </div>
            <span class="badge badge-success" style="font-size: 12px; padding: 4px 10px;">
              ${gazetted.length} Closed Holidays
            </span>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 60px;">S.No</th>
                  <th style="width: 140px;">Date</th>
                  <th style="width: 130px;">Day of Week</th>
                  <th>Holiday / Occasion</th>
                  <th style="width: 160px;">Category</th>
                  <th style="width: 180px;">Comp-Off Duty Benefit</th>
                  ${isAdmin ? '<th style="width: 70px;">Action</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${gazetted.map((h, i) => `
                  <tr>
                    <td style="font-weight: 600; color: var(--neutral-500); text-align: center;">${i + 1}</td>
                    <td><strong style="color: var(--neutral-900); font-size: 13.5px;">${h.holiday_date}</strong></td>
                    <td>
                      <span class="badge badge-neutral" style="font-size: 12px; font-weight: 600;">
                        ${h.day_of_week || ''}
                      </span>
                    </td>
                    <td>
                      <div style="font-weight: 700; color: var(--neutral-900); font-size: 13.5px;">${h.holiday_name}</div>
                      <div style="font-size: 11px; color: var(--neutral-500);">AIIMS CDER Closed Holiday</div>
                    </td>
                    <td>
                      <span class="holiday-stat-badge ${h.holiday_type === 'NATIONAL' ? 'national' : 'gazetted'}">
                        ${h.holiday_type === 'NATIONAL' ? Icons.shield : Icons.check} ${h.holiday_type === 'NATIONAL' ? 'National Holiday' : 'Gazetted Public'}
                      </span>
                    </td>
                    <td>
                      <span class="badge badge-warning" style="font-size: 11.5px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;" title="Field workers working on this Gazetted holiday earn 1 Comp-Off to be availed within 1 month">
                        ${Icons.briefcase} Comp-Off Eligible
                      </span>
                    </td>
                    ${isAdmin ? `
                      <td>
                        <button class="btn btn-secondary btn-xs" onclick="App.deleteHoliday(${h.id})" title="Delete Holiday">
                          ${Icons.x}
                        </button>
                      </td>
                    ` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'restricted') {
      const restricted = holidays.filter(h => h.is_restricted);
      tabEl.innerHTML = `
        <div class="card">
          <!-- Official Policy Box -->
          <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-left: 4px solid #2563EB; border-radius: var(--radius-sm); padding: 14px 18px; margin-bottom: 20px;">
            <div style="font-weight: 700; color: #1E40AF; font-size: 14px; margin-bottom: 6px;">
              ${Icons.calendar} CDER Restricted Holiday (RH) Entitlement Rule:
            </div>
            <div style="font-size: 13px; color: #1E3A8A; line-line: 1.5;">
              &bull; <strong>1-Year Tenure Staff (S.No. 1 to 24):</strong> Entitled to <strong>02 Restricted Holidays</strong> during the one-year period.<br>
              &bull; <strong>6-Month Tenure Staff (S.No. 25 to 44):</strong> Entitled to <strong>01 Restricted Holiday</strong> during the six-month period.<br>
              &bull; Staff may choose their allotted quota from this authoritative list of <strong>22 Central Government Restricted Holidays</strong>.
            </div>
          </div>

          <div class="card-header" style="padding-bottom: 12px; border-bottom: 1px solid var(--neutral-200);">
            <div>
              <div class="card-title">Restricted Holidays Calendar — 2026 (${restricted.length} Days)</div>
              <p style="font-size: 13px; color: var(--neutral-500); margin-top: 4px;">
                Optional festival occasions from which staff choose their sanctioned RH quota.
              </p>
            </div>
            <span class="badge badge-info" style="font-size: 12px; padding: 4px 10px;">
              ${restricted.length} Restricted Holidays
            </span>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 60px;">S.No</th>
                  <th style="width: 140px;">Date</th>
                  <th style="width: 130px;">Day of Week</th>
                  <th>Festival / Occasion</th>
                  <th style="width: 170px;">Quota Rule</th>
                  <th style="width: 140px;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${restricted.map((h, i) => `
                  <tr>
                    <td style="font-weight: 600; color: var(--neutral-500); text-align: center;">${i + 1}</td>
                    <td><strong style="color: var(--neutral-900); font-size: 13.5px;">${h.holiday_date}</strong></td>
                    <td>
                      <span class="badge badge-neutral" style="font-size: 12px; font-weight: 600;">
                        ${h.day_of_week || ''}
                      </span>
                    </td>
                    <td>
                      <div style="font-weight: 700; color: var(--neutral-900); font-size: 13.5px;">${h.holiday_name}</div>
                      <div style="font-size: 11px; color: var(--neutral-500);">Central Govt / AIIMS Restricted Holiday</div>
                    </td>
                    <td>
                      <span class="holiday-stat-badge restricted">
                        ${Icons.check} Selectable under RH Quota
                      </span>
                    </td>
                    <td>
                      ${!isAdmin ? `
                        <a href="#/apply-leave" class="btn btn-secondary btn-xs" style="padding: 2px 8px; font-size: 11px; color: var(--primary-700); border-color: var(--primary-200); background: var(--primary-50);" title="Apply for this Restricted Holiday">
                          ${Icons.plus} Apply RH
                        </a>
                      ` : `
                        <button class="btn btn-secondary btn-xs" onclick="App.deleteHoliday(${h.id})" title="Delete Holiday">
                          ${Icons.x}
                        </button>
                      `}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === 'weeklyoff') {
      tabEl.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <!-- Weekly Off Policy -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Weekly Off Governance</div>
            </div>
            <div style="font-size: 13.5px; line-height: 1.6; color: var(--neutral-700);">
              <p><strong>Primary Weekly Off:</strong> Every Sunday throughout the calendar year is designated as a mandatory Weekly Off for all CDER employees.</p>
              <div style="background: var(--neutral-50); border: 1px solid var(--neutral-200); border-radius: var(--radius-sm); padding: 12px 14px; margin: 14px 0;">
                <div style="font-weight: 700; color: var(--neutral-900); margin-bottom: 4px;">Standard Operating Schedule</div>
                <div>Duty Hours: Monday to Saturday as per assigned clinic/field rosters.</div>
                <div>Weekly Rest: Sunday (52 Sundays per annum).</div>
              </div>
            </div>
          </div>

          <!-- Compensatory Off Policy -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Compensatory Off (CO) Rule (Doc Section 1 & 2)</div>
            </div>
            <div style="font-size: 13.5px; line-height: 1.6; color: var(--neutral-700);">
              <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-left: 4px solid #F59E0B; border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 14px;">
                <div style="font-weight: 700; color: #92400E; margin-bottom: 4px;">Official Rule Provision</div>
                <div style="color: #92400E;">
                  Eligible when staff work on Sundays or Gazetted Holidays; to be availed within one month of accumulation.
                </div>
              </div>
              <p><strong>Applicability:</strong> Applicable to Field Workers (PTS-III, DEO, MTS) deployed on community outreach, dental screening, or field surveys.</p>
              <p style="margin-top: 8px;"><strong>Accrual Ratio:</strong> 1:1 compensatory day credit for each full day of approved Sunday or Gazetted Holiday duty.</p>
              <p style="margin-top: 8px;"><strong>Current Snapshot Status:</strong> 83.0 days accumulated across 20 field workers as on 01.10.2026.</p>
            </div>
          </div>
        </div>
      `;
    } else if (activeTab === 'sandwich') {
      tabEl.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Sandwich Rule Engine & Policy Controls</div>
          </div>
          <p style="font-size: 13.5px; color: var(--neutral-600); margin-bottom: 16px;">
            The Sandwich Rule dictates whether intervening weekends (Sundays) and Gazetted/Public holidays are counted and deducted as leave days when an employee takes leave immediately preceding and following those non-working days.
          </p>

          ${sandwichRules.map(sr => `
            <div style="background: var(--neutral-50); border: 1px solid var(--neutral-200); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                  <div style="font-weight: 700; font-size: 15px; color: var(--neutral-900);">${sr.rule_name}</div>
                  <div style="font-size: 12.5px; color: var(--neutral-500); margin-top: 2px;">
                    ${sr.condition_description || 'Intervening weekly-offs and holidays handling.'}
                  </div>
                </div>
                <span class="badge ${sr.is_active ? 'badge-success' : 'badge-neutral'}">${sr.is_active ? 'Policy Active' : 'Inactive'}</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px; margin-bottom: 16px;">
                <div>Applicable Leave Types: <strong>${(sr.applicable_leave_types || []).join(', ') || 'CL, EL'}</strong></div>
                <div>Charge Intervening Days: <strong>${sr.charge_intervening_days ? 'YES (Deducted from balance)' : 'NO (Free/Excluded from charge)'}</strong></div>
                <div>Include Weekly Offs: <strong>${sr.include_weekly_offs ? 'YES' : 'NO'}</strong></div>
                <div>Include Gazetted Holidays: <strong>${sr.include_public_holidays ? 'YES' : 'NO'}</strong></div>
              </div>

              <button class="btn btn-secondary btn-sm" onclick="App.openEditSandwichModal(${sr.id}, ${sr.charge_intervening_days})">
                ${Icons.sliders} Toggle Sandwich Deduction Policy
              </button>
            </div>
          `).join('')}
        </div>
      `;
    }
  },

  openCreateHolidayModal() {
    const modalHtml = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Add Calendar Holiday</h3>
          <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <form onsubmit="App.handleCreateHoliday(event)">
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Holiday Date *</label>
              <input type="date" id="hol-date" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label">Holiday Name *</label>
              <input type="text" id="hol-name" class="form-control" placeholder="e.g. Gandhi Jayanti" required>
            </div>
            <div class="form-group">
              <label class="form-label">Holiday Type</label>
              <select id="hol-type" class="form-control">
                <option value="PUBLIC">Public Holiday</option>
                <option value="NATIONAL">National Holiday</option>
                <option value="RESTRICTED">Restricted Holiday</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">${Icons.check} Add Holiday</button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async handleCreateHoliday(e) {
    e.preventDefault();
    const holiday_date = document.getElementById('hol-date').value;
    const holiday_name = document.getElementById('hol-name').value;
    const holiday_type = document.getElementById('hol-type').value;

    try {
      await API.post('/holidays', { holiday_date, holiday_name, holiday_type });
      Toast.success('Holiday added successfully.');
      this.closeModal();
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async deleteHoliday(id) {
    const confirmed = await this.confirmModal({
      title: 'Remove Holiday',
      message: 'Are you sure you want to remove this holiday from the calendar?',
      confirmText: 'Remove Holiday',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await API.del(`/holidays/${id}`);
      Toast.success('Holiday removed.');
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async openEditSandwichModal(id, currentCharge) {
    const newCharge = currentCharge ? 0 : 1;
    const confirmed = await this.confirmModal({
      title: 'Update Sandwich Policy',
      message: `Switch sandwich policy to ${newCharge ? 'CHARGE intervening weekly offs' : 'EXCLUDE intervening weekly offs'}?`,
      confirmText: 'Update Policy',
      variant: 'warning'
    });
    if (!confirmed) return;

    try {
      await API.put(`/sandwich-rules/${id}`, { charge_intervening_days: newCharge });
      Toast.success('Sandwich rule configuration updated.');
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     COMP-OFF CLAIMS (ADMIN & EMPLOYEE)
     ========================================================================== */
  async renderCompOffAdminView(container) {
    container.innerHTML = `<div class="card"><p>Loading field-worker comp-off claims...</p></div>`;

    try {
      const res = await API.get('/comp-off');
      const records = res.records || [];

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Field Worker Compensatory Off Claims</div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Worked Date</th>
                  <th>Qualifying Duty</th>
                  <th>Days Claimed</th>
                  <th>Reason</th>
                  <th>Approval Status</th>
                  <th>Claim Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${records.map(c => `
                  <tr>
                    <td><strong>${c.employee_name}</strong> (${c.employee_id})</td>
                    <td><strong>${c.worked_date}</strong></td>
                    <td><span class="badge badge-info">${c.qualifying_day_type}</span></td>
                    <td><strong>+${c.credited_days} day</strong></td>
                    <td>${c.reason}</td>
                    <td>${this.getStatusBadge(c.approval_status)}</td>
                    <td>${(c.created_at || '').split(/[ T]/)[0] || 'N/A'}</td>
                    <td>
                      ${c.approval_status === 'PENDING' ? `
                        <div class="action-btn-group" style="display: flex; gap: 8px; align-items: center; white-space: nowrap;">
                          <button class="btn btn-success btn-sm" onclick="App.reviewCompOff(${c.id}, 'APPROVE')">${Icons.check} Approve</button>
                          <button class="btn btn-danger btn-sm" onclick="App.reviewCompOff(${c.id}, 'REJECT')">${Icons.x} Reject</button>
                        </div>
                      ` : `
                        <span style="font-size: 12px; color: var(--neutral-400);">Reviewed</span>
                      `}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  async reviewCompOff(id, action) {
    try {
      const res = await API.post(`/comp-off/${id}/review`, { action });
      Toast.success(res.message);
      this.renderCurrentView();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  renderCompOffClaimView(container) {
    container.innerHTML = `
      <div style="max-width: 600px; margin: 0 auto;">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Claim Compensatory Off (Field Duty)</div>
            <span class="badge badge-warning">Field Worker Entitlement</span>
          </div>

          <form onsubmit="App.handleClaimCompOff(event)">
            <div class="form-group">
              <label class="form-label">Duty Worked Date *</label>
              <input type="date" id="claim-date" class="form-control" required value="${new Date().toISOString().split('T')[0]}">
            </div>

            <div class="form-group">
              <label class="form-label">Qualifying Day Type *</label>
              <select id="claim-type" class="form-control" required>
                <option value="SUNDAY">Sunday Duty</option>
                <option value="HOLIDAY">Public Holiday Duty</option>
                <option value="EMERGENCY_DUTY">Emergency Outbreak / Field Duty</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Reason & Field Assignment Details *</label>
              <textarea id="claim-reason" class="form-control" rows="3" placeholder="Describe field work conducted on this day" required></textarea>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">
              ${Icons.check} Submit Comp-Off Claim
            </button>
          </form>
        </div>
      </div>
    `;
  },

  async handleClaimCompOff(e) {
    e.preventDefault();
    const worked_date = document.getElementById('claim-date').value;
    const qualifying_day_type = document.getElementById('claim-type').value;
    const reason = document.getElementById('claim-reason').value;

    try {
      const res = await API.post('/comp-off/claim', { worked_date, qualifying_day_type, reason });
      Toast.success(res.message);
      window.location.hash = '#/dashboard';
      this.handleRouting();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  /* ==========================================================================
     OFFICIAL CDER STAFF LEAVE & ENTITLEMENT REGISTER VIEW (1:1 SNAPSHOT)
     ========================================================================== */
  async renderCderLeaveRegisterView(container) {
    container.innerHTML = `<div class="card"><p>Loading authoritative CDER leave register...</p></div>`;

    try {
      const res = await API.get('/reports/cder-leave-register');
      this.state.cderRegister = res;
      if (!this.state.cderFilter) {
        this.state.cderFilter = { search: '', cohort: 'ALL' };
      }

      this.renderCderRegisterContent(container);
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error loading leave register: ${err.message}</p></div>`;
    }
  },

  renderCderRegisterContent(container) {
    const data = this.state.cderRegister;
    if (!data || !container) return;

    const filter = this.state.cderFilter || { search: '', cohort: 'ALL' };
    const query = (filter.search || '').trim().toLowerCase();
    const cohort = filter.cohort || 'ALL';

    let filteredRecords = (data.records || []).filter(r => {
      // Cohort filtering
      if (cohort === '1YEAR' && r.sno > 24) return false;
      if (cohort === '6MONTH' && r.sno <= 24) return false;
      if (cohort === 'FIELD' && !r.is_field_worker) return false;
      if (cohort === 'GENERAL' && r.is_field_worker) return false;

      // Text search
      if (query) {
        const text = `${r.sno} ${r.name} ${r.designation} ${r.official_employee_id || ''} ${r.employee_id} ${r.contact || ''} ${r.email || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });

    // Compute active sums for filtered set
    let clEnt = 0, clBal = 0, elAv = 0, elBal = 0, rhEnt = 0, rhBal = 0, coBal = 0;
    filteredRecords.forEach(r => {
      clEnt += r.cl_entitled;
      clBal += r.cl_balance;
      elAv += r.el_availed;
      elBal += r.el_balance;
      rhEnt += r.rh_entitled;
      rhBal += r.rh_balance;
      coBal += r.co_balance;
    });

    container.innerHTML = `
      <!-- Header Banner -->
      <div class="cder-header-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 13px; font-weight: 700; color: #818CF8; letter-spacing: 0.05em; text-transform: uppercase;">
              ${data.title}
            </div>
            <div class="cder-header-title" style="margin-top: 4px;">
              ${Icons.bookOpen} ${data.subtitle}
            </div>
            <div class="cder-header-subtitle">
              Authoritative leave entitlement, availed, and balance record as extracted from official CDER documentation.
            </div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" style="background: rgba(255,255,255,0.15); color: #fff; border-color: rgba(255,255,255,0.25);" onclick="App.exportCderRegisterCsv()">
              ${Icons.download} Export CSV
            </button>
            <button class="btn btn-secondary btn-sm" style="background: rgba(255,255,255,0.15); color: #fff; border-color: rgba(255,255,255,0.25);" onclick="window.print()">
              ${Icons.fileText} Print Register
            </button>
          </div>
        </div>

        <div class="cder-badge-row">
          <span class="cder-pill highlight">
            ${Icons.clock} Common tenure: ${data.common_tenure}
          </span>
          <span class="cder-pill date-badge">
            ${Icons.calendar} Note : All records as on ${data.as_on_date}
          </span>
          <span class="cder-pill">
            ${Icons.users} Total CDER Staff: ${data.totalStaff} Members
          </span>
          <span class="cder-pill" style="background: rgba(16, 185, 129, 0.2); color: #A7F3D0; border-color: rgba(16, 185, 129, 0.4);">
            ${Icons.check} 100% Balanced (176/176 Match)
          </span>
        </div>
      </div>

      <!-- Leave Rules & Calculation Method Banner (Doc Section 1 & 2) -->
      <div class="cder-rules-banner">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 14px; font-weight: 700; color: var(--neutral-900); display: flex; align-items: center; gap: 8px;">
            ${Icons.sliders} Official Leave Calculation Rules & Methodology (CDER Guidelines)
          </div>
          <span style="font-size: 11.5px; color: var(--neutral-500); font-weight: 500;">
            Joining date cut-off: 25th of month
          </span>
        </div>
        <div class="cder-rules-grid">
          <div class="cder-rule-item">
            <div class="cder-rule-title">${Icons.plus} Casual Leave (CL)</div>
            <div class="cder-rule-formula">CL = (8 ÷ 12) × eligible months</div>
            <div class="cder-rule-desc">08 days per year. Calculated proportionately according to eligible months of service (rounded to nearest 0.5 day).</div>
          </div>
          <div class="cder-rule-item">
            <div class="cder-rule-title">${Icons.clock} Earned Leave (EL)</div>
            <div class="cder-rule-formula">EL = 2.5 × completed eligible months</div>
            <div class="cder-rule-desc">Credited at 2.5 days for each completed eligible month. S.No 1–24: 15.0 days; S.No 25–44: 2.5 days as on 01.10.2026.</div>
          </div>
          <div class="cder-rule-item">
            <div class="cder-rule-title">${Icons.calendar} Restricted Holiday (RH)</div>
            <div class="cder-rule-formula">02 per year / 01 per six months</div>
            <div class="cder-rule-desc">02 RH during one year tenure (S.No 1–24) and 01 RH during six months tenure (S.No 25–44) from the official 22 RH calendar.</div>
          </div>
          <div class="cder-rule-item">
            <div class="cder-rule-title">${Icons.briefcase} Compensatory Off (CO)</div>
            <div class="cder-rule-formula">Sunday / Gazetted Holiday duty</div>
            <div class="cder-rule-desc">Eligible when field staff work on Sundays or Gazetted Holidays; to be availed within one month of accumulation.</div>
          </div>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="cder-kpi-grid">
        <div class="cder-kpi-card">
          <div class="cder-kpi-label">Total Staff Listed</div>
          <div class="cder-kpi-val">${filteredRecords.length} <span style="font-size: 14px; font-weight: 500; color: var(--neutral-400);">/ 44</span></div>
          <div class="cder-kpi-sub">All active CDER employees</div>
        </div>
        <div class="cder-kpi-card">
          <div class="cder-kpi-label">CL Pool (Entitled / Bal)</div>
          <div class="cder-kpi-val">${clEnt.toFixed(1)} <span style="font-size: 15px; color: var(--primary-600); font-weight: 700;">/ ${clBal.toFixed(1)}</span></div>
          <div class="cder-kpi-sub">Used: ${(clEnt - clBal).toFixed(1)} days</div>
        </div>
        <div class="cder-kpi-card">
          <div class="cder-kpi-label">EL Pool (Availed / Bal)</div>
          <div class="cder-kpi-val">${elAv.toFixed(1)} <span style="font-size: 15px; color: var(--primary-600); font-weight: 700;">/ ${elBal.toFixed(1)}</span></div>
          <div class="cder-kpi-sub">Used: ${(elAv - elBal).toFixed(1)} days</div>
        </div>
        <div class="cder-kpi-card">
          <div class="cder-kpi-label">RH Pool (Entitled / Bal)</div>
          <div class="cder-kpi-val">${rhEnt.toFixed(1)} <span style="font-size: 15px; color: var(--primary-600); font-weight: 700;">/ ${rhBal.toFixed(1)}</span></div>
          <div class="cder-kpi-sub">Used: ${(rhEnt - rhBal).toFixed(1)} days</div>
        </div>
        <div class="cder-kpi-card" style="border-left: 3px solid #F59E0B;">
          <div class="cder-kpi-label">CO Pool (Comp-Off Bal)</div>
          <div class="cder-kpi-val" style="color: #B45309;">${coBal.toFixed(1)}</div>
          <div class="cder-kpi-sub">Accumulated by field duty</div>
        </div>
      </div>

      <!-- Search & Cohort Filter Toolbar -->
      <div class="card" style="margin-bottom: 20px; padding: 14px 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <!-- Filter Buttons -->
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn btn-sm ${cohort === 'ALL' ? 'btn-primary' : 'btn-secondary'}" onclick="App.setCderCohortFilter('ALL')">
              All Staff (44)
            </button>
            <button class="btn btn-sm ${cohort === '1YEAR' ? 'btn-primary' : 'btn-secondary'}" onclick="App.setCderCohortFilter('1YEAR')">
              1-Year Tenure (S.No 1–24)
            </button>
            <button class="btn btn-sm ${cohort === '6MONTH' ? 'btn-primary' : 'btn-secondary'}" onclick="App.setCderCohortFilter('6MONTH')">
              6-Month Tenure (S.No 25–44)
            </button>
            <button class="btn btn-sm ${cohort === 'FIELD' ? 'btn-primary' : 'btn-secondary'}" onclick="App.setCderCohortFilter('FIELD')">
              Field Workers (20)
            </button>
            <button class="btn btn-sm ${cohort === 'GENERAL' ? 'btn-primary' : 'btn-secondary'}" onclick="App.setCderCohortFilter('GENERAL')">
              General Staff (24)
            </button>
          </div>

          <!-- Search Box -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="text" 
                   id="cder-search-input" 
                   class="form-control" 
                   placeholder="Search Name, Designation, S.No..." 
                   value="${filter.search || ''}" 
                   oninput="App.onCderSearchInput(event)" 
                   style="min-width: 250px; height: 34px; font-size: 13px;">
            ${query ? `
              <button class="btn btn-secondary btn-sm" onclick="App.clearCderSearch()" title="Clear search">
                ${Icons.x}
              </button>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- Authoritative Table -->
      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="table-container" style="overflow-x: auto;">
          <table class="table-official-cder">
            <thead>
              <tr>
                <th style="width: 48px;">S.No.</th>
                <th class="text-left" style="min-width: 190px;">Name</th>
                <th class="text-left" style="min-width: 170px;">Designation</th>
                <th class="cder-num-col" style="width: 90px;">CL entitled</th>
                <th class="cder-num-col" style="width: 90px;">CL balance</th>
                <th class="cder-num-col" style="width: 90px;">EL availed</th>
                <th class="cder-num-col" style="width: 90px;">EL balance</th>
                <th class="cder-num-col" style="width: 90px;">RH entitled</th>
                <th class="cder-num-col" style="width: 90px;">RH balance</th>
                <th class="cder-num-col" style="width: 90px;">CO balance</th>
                <th style="width: 80px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRecords.map((r, idx) => {
                // Insert section divider before S.No 25 if showing all or full list
                const isDivider = (r.sno === 25 && cohort === 'ALL' && !query);
                return `
                  ${isDivider ? `
                    <tr class="tenure-section-row">
                      <td colspan="11">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span>${Icons.users} S.No. 25 to 44: Six-Month Tenure Cohort (Joining From September 2026 | Standard Entitlement: CL: 4.5, EL: 2.5, RH: 1)</span>
                          <span style="font-weight: 500; font-size: 11px; color: var(--neutral-600);">Calculated up to 31/03/2027</span>
                        </div>
                      </td>
                    </tr>
                  ` : ''}
                  <tr>
                    <td style="text-align: center; font-weight: 700; color: var(--neutral-700);">${r.sno}</td>
                    <td>
                      <div style="font-weight: 700; color: var(--neutral-900); cursor: pointer;" onclick="App.openEmployeeDossierModal('${r.employee_id}')">
                        ${r.name}
                        ${r.official_employee_id ? `<span class="badge badge-neutral" style="font-size: 10px; margin-left: 4px; padding: 1px 5px;">${r.official_employee_id}</span>` : ''}
                      </div>
                      <div style="font-size: 11px; color: var(--neutral-400);">
                        ${r.is_field_worker ? `<span style="color: #D97706; font-weight: 600;">Field Worker${r.field_location ? ` (${r.field_location})` : ''}</span> &bull; ` : ''}
                        DOJ: ${r.date_of_joining || '01/04/2026'}
                      </div>
                    </td>
                    <td>
                      <span style="font-weight: 500; color: var(--neutral-800);">${r.designation}</span>
                    </td>
                    <td class="cder-num-col">${r.cl_entitled}</td>
                    <td class="cder-num-col" style="color: var(--primary-700); font-weight: 700;">${r.cl_balance}</td>
                    <td class="cder-num-col">${r.el_availed}</td>
                    <td class="cder-num-col" style="color: var(--primary-700); font-weight: 700;">${r.el_balance}</td>
                    <td class="cder-num-col">${r.rh_entitled}</td>
                    <td class="cder-num-col" style="color: var(--primary-700); font-weight: 700;">${r.rh_balance}</td>
                    <td class="cder-num-col" style="${r.co_balance > 0 ? 'color: #D97706; font-weight: 700;' : 'color: var(--neutral-400);'}">${r.co_balance}</td>
                    <td style="text-align: center;">
                      <button class="btn btn-secondary btn-xs" style="padding: 2px 6px; font-size: 11px;" onclick="App.openEmployeeDossierModal('${r.employee_id}')" title="View Individual Leave Dossier">
                        ${Icons.bookOpen} View
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td style="text-align: center;">Total</td>
                <td colspan="2">${filteredRecords.length} Staff Members Listed</td>
                <td class="cder-num-col">${clEnt.toFixed(1)}</td>
                <td class="cder-num-col">${clBal.toFixed(1)}</td>
                <td class="cder-num-col">${elAv.toFixed(1)}</td>
                <td class="cder-num-col">${elBal.toFixed(1)}</td>
                <td class="cder-num-col">${rhEnt.toFixed(1)}</td>
                <td class="cder-num-col">${rhBal.toFixed(1)}</td>
                <td class="cder-num-col">${coBal.toFixed(1)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Footnote Banner Matching Screenshot -->
      <div class="cder-footnote-banner">
        ${Icons.check} Note : All records as on ${data.as_on_date} &bull; Official Leave Register for Centre for Dental Education and Research (CDER).
      </div>
    `;
  },

  setCderCohortFilter(cohort) {
    if (!this.state.cderFilter) this.state.cderFilter = { search: '', cohort: 'ALL' };
    this.state.cderFilter.cohort = cohort;
    const container = document.getElementById('main-content');
    if (container) this.renderCderRegisterContent(container);
  },

  onCderSearchInput(e) {
    if (!this.state.cderFilter) this.state.cderFilter = { search: '', cohort: 'ALL' };
    this.state.cderFilter.search = e.target.value;
    const container = document.getElementById('main-content');
    if (container) this.renderCderRegisterContent(container);
  },

  clearCderSearch() {
    if (!this.state.cderFilter) this.state.cderFilter = { search: '', cohort: 'ALL' };
    this.state.cderFilter.search = '';
    const container = document.getElementById('main-content');
    if (container) this.renderCderRegisterContent(container);
  },

  async openEmployeeDossierModal(empId) {
    if (!this.state.cderRegister) {
      try {
        this.state.cderRegister = await API.get('/reports/cder-leave-register');
      } catch (e) {}
    }
    const records = (this.state.cderRegister && this.state.cderRegister.records) || [];
    const emp = records.find(r => r.employee_id === empId);
    if (!emp) {
      Toast.error('Employee record not found in CDER register.');
      return;
    }

    const modalHtml = `
      <div class="modal-dialog" style="max-width: 640px;">
        <div class="modal-header" style="background: linear-gradient(135deg, #0F172A, #1E293B); color: #fff;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; color: #818CF8; font-weight: 700; letter-spacing: 0.05em;">
              CDER Official Leave Dossier
            </div>
            <h3 style="color: #fff; margin-top: 2px;">${emp.name}</h3>
            <div style="font-size: 12.5px; color: #94A3B8;">
              ${emp.designation} &bull; S.No. ${emp.sno} ${emp.official_employee_id ? `&bull; ${emp.official_employee_id}` : ''}
            </div>
          </div>
          <button class="modal-close-btn" style="color: #fff;" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <div class="modal-body" style="padding: 20px;">
          <!-- Staff Profile Overview -->
          <div style="background: var(--neutral-50); border: 1px solid var(--neutral-200); border-radius: var(--radius-sm); padding: 12px 16px; margin-bottom: 18px; font-size: 13px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div><strong>Official Emp ID:</strong> ${emp.official_employee_id || emp.employee_id}</div>
              <div><strong>Date of Joining:</strong> ${emp.date_of_joining || '01/04/2026'}</div>
              <div><strong>Contact:</strong> ${emp.contact || 'N/A'}</div>
              <div><strong>Email:</strong> ${emp.email || 'N/A'}</div>
              <div style="grid-column: span 2;">
                <strong>Duty Category:</strong> 
                <span class="badge ${emp.is_field_worker ? 'badge-warning' : 'badge-info'}" style="font-size: 11px; padding: 2px 8px; margin-left: 4px;">
                  ${emp.is_field_worker ? `Field Worker (Comp-Off Eligible)${emp.field_location ? ` — ${emp.field_location}` : ''}` : 'General Staff (Non-Field)'}
                </span>
              </div>
            </div>
          </div>

          <!-- Leave Breakdown Cards -->
          <div style="font-size: 13.5px; font-weight: 700; color: var(--neutral-900); margin-bottom: 10px;">
            Authoritative Leave Balances (As on 01.10.2026)
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
            <!-- CL Card -->
            <div style="border: 1px solid #E2E8F0; border-radius: var(--radius-sm); padding: 12px; background: #fff;">
              <div style="font-weight: 700; color: #1E293B; font-size: 13px; display: flex; justify-content: space-between;">
                <span>Casual Leave (CL)</span>
                <span class="badge badge-success">Balance: ${emp.cl_balance}</span>
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: var(--neutral-600); line-height: 1.4;">
                <div>Entitled: <strong>${emp.cl_entitled} days</strong></div>
                <div>Availed: <strong>${(emp.cl_entitled - emp.cl_balance).toFixed(1)} days</strong></div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--primary-700); background: var(--primary-50); padding: 2px 4px; border-radius: 3px;">
                  Formula: (8 ÷ 12) × ${emp.sno <= 24 ? '12' : '7'} eligible months
                </div>
              </div>
            </div>

            <!-- EL Card -->
            <div style="border: 1px solid #E2E8F0; border-radius: var(--radius-sm); padding: 12px; background: #fff;">
              <div style="font-weight: 700; color: #1E293B; font-size: 13px; display: flex; justify-content: space-between;">
                <span>Earned Leave (EL)</span>
                <span class="badge badge-success">Balance: ${emp.el_balance}</span>
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: var(--neutral-600); line-height: 1.4;">
                <div>Availed/Accrued: <strong>${emp.el_availed} days</strong></div>
                <div>Used: <strong>${(emp.el_availed - emp.el_balance).toFixed(1)} days</strong></div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--primary-700); background: var(--primary-50); padding: 2px 4px; border-radius: 3px;">
                  Rate: 2.5 days per completed eligible month
                </div>
              </div>
            </div>

            <!-- RH Card -->
            <div style="border: 1px solid #E2E8F0; border-radius: var(--radius-sm); padding: 12px; background: #fff;">
              <div style="font-weight: 700; color: #1E293B; font-size: 13px; display: flex; justify-content: space-between;">
                <span>Restricted Holiday (RH)</span>
                <span class="badge badge-success">Balance: ${emp.rh_balance}</span>
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: var(--neutral-600); line-height: 1.4;">
                <div>Entitled: <strong>${emp.rh_entitled} days</strong></div>
                <div>Availed: <strong>${(emp.rh_entitled - emp.rh_balance).toFixed(1)} days</strong></div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--neutral-500);">
                  Quota: ${emp.sno <= 24 ? '2 RH per year' : '1 RH per 6-month tenure'}
                </div>
              </div>
            </div>

            <!-- CO Card -->
            <div style="border: 1px solid #E2E8F0; border-radius: var(--radius-sm); padding: 12px; background: #fff;">
              <div style="font-weight: 700; color: #1E293B; font-size: 13px; display: flex; justify-content: space-between;">
                <span>Compensatory Off (CO)</span>
                <span class="badge ${emp.co_balance > 0 ? 'badge-warning' : 'badge-neutral'}">Balance: ${emp.co_balance}</span>
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: var(--neutral-600); line-height: 1.4;">
                <div>Field Duty CO: <strong>${emp.co_balance} days available</strong></div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--neutral-500);">
                  ${emp.is_field_worker ? 'Earned for Sunday or Gazetted Holiday duty.' : 'Not applicable for non-field staff.'}
                </div>
              </div>
            </div>
          </div>

          <div style="font-size: 11.5px; color: var(--neutral-500); text-align: center; border-top: 1px solid var(--neutral-200); padding-top: 12px;">
            Note: All records as on 01.10.2026. Sourced from official CDER Staff Details and Leave Rules & Record.
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
        </div>
      </div>
    `;

    this.openModal(modalHtml);
  },

  exportCderRegisterCsv() {
    const data = this.state.cderRegister;
    if (!data || !data.records) {
      Toast.error('No register records available for export.');
      return;
    }

    const headers = [
      'S.No.',
      'Name',
      'Designation',
      'CL entitled',
      'CL balance',
      'EL availed',
      'EL balance',
      'RH entitled',
      'RH balance',
      'CO balance'
    ];

    const rows = data.records.map(r => [
      r.sno,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.designation.replace(/"/g, '""')}"`,
      r.cl_entitled,
      r.cl_balance,
      r.el_availed,
      r.el_balance,
      r.rh_entitled,
      r.rh_balance,
      r.co_balance
    ]);

    // Add totals row
    rows.push([
      'Total',
      '44 Staff Members',
      '',
      data.totals.cl_entitled,
      data.totals.cl_balance,
      data.totals.el_availed,
      data.totals.el_balance,
      data.totals.rh_entitled,
      data.totals.rh_balance,
      data.totals.co_balance
    ]);

    rows.push([]);
    rows.push(['Note : All records as on 01.10.2026']);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `CDER_Staff_Leave_Register_${data.as_on_date.replace(/\./g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    Toast.success('Exported CDER Leave Register to CSV successfully.');
  },

  /* ==========================================================================
     REPORTS & AUDIT LOGS VIEW (ADMIN)
     ========================================================================== */
  async renderReportsView(container) {
    container.innerHTML = `<div class="card"><p>Loading administrative reports and audit logs...</p></div>`;

    try {
      const resBal = await API.get('/reports/balance-report');
      const balanceReport = resBal.report || [];
      const resAudit = await API.get('/audit/logs');
      const auditLogs = resAudit.logs || [];

      container.innerHTML = `
        <div class="tabs-nav" style="margin-bottom: 20px;">
          <button class="tab-btn" onclick="window.location.hash='#/leave-records'">
            ${Icons.bookOpen} Official CDER Leave Register (Docx Snapshot)
          </button>
          <button class="tab-btn active">
            ${Icons.fileText} Live Balance Matrix (${resBal.year})
          </button>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Employee Leave Balance Report (${resBal.year})</div>
            <a href="#/leave-records" class="btn btn-secondary btn-sm">
              ${Icons.bookOpen} View Official Register (Screenshot Layout)
            </a>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>CL (Available / Credited)</th>
                  <th>EL (Available / Credited)</th>
                  <th>RH (Available / Credited)</th>
                  <th>Comp-Off</th>
                </tr>
              </thead>
              <tbody>
                ${balanceReport.map(r => `
                  <tr>
                    <td><strong>${r.name}</strong> (${r.employee_id})</td>
                    <td>${r.department}</td>
                    <td>${r.designation}</td>
                    <td><strong>${r.leaves.CL ? r.leaves.CL.balance : 0}</strong> / ${r.leaves.CL ? r.leaves.CL.credited : 0}</td>
                    <td><strong>${r.leaves.EL ? r.leaves.EL.balance : 0}</strong> / ${r.leaves.EL ? r.leaves.EL.credited : 0}</td>
                    <td><strong>${r.leaves.RH ? r.leaves.RH.balance : 0}</strong> / ${r.leaves.RH ? r.leaves.RH.credited : 0}</td>
                    <td><strong>${(r.leaves.CO || r.leaves.COMP_OFF) ? (r.leaves.CO || r.leaves.COMP_OFF).balance : 0}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Immutable Audit Trail (Governance Compliance)</div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Remarks</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${auditLogs.map(a => `
                  <tr>
                    <td><span class="badge badge-primary">${a.action}</span></td>
                    <td>${a.entity_type} #${a.entity_id || ''}</td>
                    <td>${a.actor_email}</td>
                    <td>${a.remarks || 'Standard Operation'}</td>
                    <td>${a.created_at}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     EMPLOYEE MY LEDGER VIEW
     ========================================================================== */
  async renderMyLedgerView(container) {
    container.innerHTML = `<div class="card"><p>Loading personal ledger transactions...</p></div>`;

    try {
      const res = await API.get('/ledger/transactions');
      const transactions = res.transactions || [];

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">My Leave Transaction Ledger</div>
            <span class="badge badge-info">Double-Entry Audit Record</span>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tx #</th>
                  <th>Leave Type</th>
                  <th>Transaction Type</th>
                  <th>Impact</th>
                  <th>Running Balance</th>
                  <th>Remarks / Reason</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${transactions.map(t => `
                  <tr>
                    <td>#${t.id}</td>
                    <td><span class="badge badge-primary">${t.leave_type_code}</span></td>
                    <td><span class="badge badge-neutral">${t.transaction_type}</span></td>
                    <td>
                      <strong style="color: ${t.amount > 0 ? '#059669' : '#DC2626'};">
                        ${t.amount > 0 ? '+' : ''}${t.amount}
                      </strong>
                    </td>
                    <td><strong>${t.running_balance}</strong></td>
                    <td>${t.remarks || 'Standard'}</td>
                    <td>${t.created_at}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card"><p style="color:red;">Error: ${err.message}</p></div>`;
    }
  },

  /* ==========================================================================
     PASSWORD MANAGEMENT & NOTIFICATIONS MODALS
     ========================================================================== */
  openChangePasswordModal(forced = false) {
    const modalHtml = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>${forced ? 'Mandatory Password Change' : 'Change Password'}</h3>
          ${!forced ? `<button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>` : ''}
        </div>
        <form onsubmit="App.handleChangePassword(event)">
          <div class="modal-body">
            ${forced ? `
              <div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 12px; border-radius: 6px; font-size: 13px; color: #92400E; margin-bottom: 16px;">
                You are logging in with a temporary password. You must set a new secure password before proceeding.
              </div>
            ` : `
              <div class="form-group">
                <label class="form-label">Current Password *</label>
                <input type="password" id="pwd-curr" class="form-control" required>
              </div>
            `}

            <div class="form-group">
              <label class="form-label">New Password (min 8 characters) *</label>
              <input type="password" id="pwd-new" class="form-control" minlength="8" required>
            </div>
            <div class="form-group">
              <label class="form-label">Confirm New Password *</label>
              <input type="password" id="pwd-conf" class="form-control" minlength="8" required>
            </div>
          </div>
          <div class="modal-footer">
            ${!forced ? `<button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>` : ''}
            <button type="submit" class="btn btn-primary">${Icons.check} Update Password</button>
          </div>
        </form>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async handleChangePassword(e) {
    e.preventDefault();
    const curr = document.getElementById('pwd-curr')?.value || '';
    const newPwd = document.getElementById('pwd-new').value;
    const conf = document.getElementById('pwd-conf').value;

    if (newPwd !== conf) {
      Toast.error('New passwords do not match.');
      return;
    }

    try {
      const res = await API.post('/auth/change-password', { currentPassword: curr, newPassword: newPwd });
      Toast.success(res.message);
      this.closeModal();
      this.state.user.must_change_password = false;
      API.setUser(this.state.user);
      window.location.hash = '#/dashboard';
      this.handleRouting();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async openResetPasswordModal(employeeId) {
    const confirmed = await this.confirmModal({
      title: 'Reset Credentials',
      message: `Reset credentials for employee ${employeeId}? A secure temporary password will be generated.`,
      itemDetails: `Target Employee: ${employeeId}`,
      confirmText: 'Reset Password',
      variant: 'danger'
    });
    if (!confirmed) return;

    API.post('/auth/admin-reset-password', { employeeId })
      .then(res => {
        Toast.success(`Temporary password: ${res.temporaryPassword}`);
        alert(`Password Reset Successful for ${employeeId}!\nTemporary Password: ${res.temporaryPassword}`);
      })
      .catch(err => Toast.error(err.message));
  },

  openNotificationsModal() {
    const list = this.state.notifications;
    const modalHtml = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Notifications</h3>
          <button class="modal-close-btn" onclick="App.closeModal()">${Icons.x}</button>
        </div>
        <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
          ${list.length === 0 ? `
            <p style="text-align: center; color: var(--neutral-500); padding: 20px;">No notifications.</p>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${list.map(n => `
                <div style="padding: 12px; background: ${n.is_read ? '#ffffff' : 'var(--primary-50)'}; border: 1px solid var(--neutral-200); border-radius: var(--radius-sm);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <strong style="font-size: 13.5px;">${n.title}</strong>
                    <span style="font-size: 11px; color: var(--neutral-400);">${n.created_at}</span>
                  </div>
                  <div style="font-size: 12.5px; color: var(--neutral-600);">${n.message}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary btn-sm" onclick="App.markAllNotificationsRead()">${Icons.check} Mark All as Read</button>
          <button class="btn btn-primary btn-sm" onclick="App.closeModal()">Close</button>
        </div>
      </div>
    `;
    this.openModal(modalHtml);
  },

  async markAllNotificationsRead() {
    try {
      await API.post('/notifications/read-all');
      this.state.unreadNotifCount = 0;
      this.renderNotificationBadge();
      this.closeModal();
      Toast.success('Notifications marked as read.');
    } catch (e) {}
  },

  /* ==========================================================================
     GLOBAL MODAL HELPERS
     ========================================================================== */
  confirmModal({ title = 'Confirm Action', message = 'Are you sure you want to proceed?', itemDetails = '', confirmText = 'Confirm', cancelText = 'Cancel', variant = 'danger' } = {}) {
    return new Promise((resolve) => {
      window.__activeConfirmModalResolve = (val) => {
        window.__activeConfirmModalResolve = null;
        resolve(val);
      };
      const btnVariant = variant === 'danger' ? 'danger' : (variant === 'warning' ? 'warning' : 'primary');
      const modalHtml = `
        <div class="modal-dialog" style="max-width: 440px;">
          <div class="modal-header">
            <h3>${title}</h3>
            <button type="button" class="modal-close-btn" onclick="App.closeModal(); if (window.__activeConfirmModalResolve) window.__activeConfirmModalResolve(false);">${Icons.x}</button>
          </div>
          <div class="modal-body" style="padding: 16px 20px;">
            <p style="font-size: 13.5px; line-height: 1.5; color: var(--neutral-600, #475569); margin: 0;">${message}</p>
            ${itemDetails ? `<div style="margin-top: 10px; padding: 8px 12px; background: var(--neutral-50, #f8fafc); border: 1px solid var(--neutral-200, #e2e8f0); border-radius: 6px; font-family: monospace; font-size: 12px; color: var(--neutral-900, #0f172a);">${itemDetails}</div>` : ''}
          </div>
          <div class="modal-footer" style="padding: 12px 20px; display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal(); if (window.__activeConfirmModalResolve) window.__activeConfirmModalResolve(false);">${cancelText}</button>
            <button type="button" class="btn btn-${btnVariant}" onclick="App.closeModal(); if (window.__activeConfirmModalResolve) window.__activeConfirmModalResolve(true);">${confirmText}</button>
          </div>
        </div>
      `;
      this.openModal(modalHtml);
    });
  },

  openModal(html) {
    const container = document.getElementById('modal-container');
    container.innerHTML = `
      <div class="modal-backdrop" id="active-modal-backdrop" onclick="App.handleBackdropClick(event)">
        ${html}
      </div>
    `;
  },

  closeModal() {
    const container = document.getElementById('modal-container');
    if (container) container.innerHTML = '';
  },

  handleBackdropClick(e) {
    if (e.target.id === 'active-modal-backdrop') {
      this.closeModal();
    }
  },

  getStatusBadge(status) {
    const s = String(status).toUpperCase();
    if (s === 'APPROVED' || s === 'ACTIVE') return `<span class="badge badge-success"><span class="badge-dot"></span>${s}</span>`;
    if (s === 'PENDING') return `<span class="badge badge-warning"><span class="badge-dot"></span>${s}</span>`;
    if (s === 'HOLD') return `<span class="badge badge-info"><span class="badge-dot"></span>${s}</span>`;
    if (s === 'REJECTED' || s === 'CANCELLED' || s === 'INACTIVE') return `<span class="badge badge-danger"><span class="badge-dot"></span>${s}</span>`;
    return `<span class="badge badge-neutral">${s}</span>`;
  }
};

// Initialize Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
