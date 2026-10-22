// public/js/api.js
// Enterprise API Client with auth token handling and toast system

const API = {
  getToken() {
    return localStorage.getItem('ems_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('ems_token', token);
    } else {
      localStorage.removeItem('ems_token');
    }
  },

  getUser() {
    try {
      const u = localStorage.getItem('ems_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  },

  setUser(user) {
    if (user) {
      localStorage.setItem('ems_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('ems_user');
    }
  },

  clearAuth() {
    localStorage.removeItem('ems_token');
    localStorage.removeItem('ems_user');
  },

  async request(endpoint, options = {}) {
    const url = `/api${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          this.clearAuth();
          window.location.hash = '#/login';
          window.dispatchEvent(new Event('auth_changed'));
          throw new Error(data.error || 'Session expired. Please log in again.');
        }
        throw new Error(data.error || (data.details ? data.details.join(', ') : 'Request failed'));
      }

      return data;
    } catch (err) {
      throw err;
    }
  },

  get(endpoint, params = {}) {
    const qs = new URLSearchParams();
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        qs.append(k, params[k]);
      }
    });
    const queryString = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`${endpoint}${queryString}`, { method: 'GET' });
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

  del(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  delete(endpoint) {
    return this.del(endpoint);
  }
};

// Clean, toast alert system
const Toast = {
  show(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = Icons.info;
    if (type === 'success') iconSvg = Icons.check;
    if (type === 'error') iconSvg = Icons.alertTriangle;
    if (type === 'warning') iconSvg = Icons.clock;

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-body">${message}</div>
      <button class="toast-close" onclick="this.parentElement.remove()">${Icons.x}</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  info(msg) { this.show(msg, 'info'); },
  warning(msg) { this.show(msg, 'warning'); }
};
