/**
 * Professional Inbuilt Confirmation Modal System
 * AIIMS Fieldworker Attendance Application
 *
 * Replaces browser-native confirm() boxes across the application with
 * an accessible, brand-aligned, responsive, and robust modal dialog.
 */
(function (window) {
  'use strict';

  let activeModalPromise = null;
  let previousActiveElement = null;

  const ICONS = {
    danger: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };

  /**
   * Lazily create and inject the modal DOM into the document body
   */
  function ensureModalDOM() {
    let backdrop = document.getElementById('inbuiltConfirmModal');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'inbuiltConfirmModal';
    backdrop.className = 'confirm-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'confirmModalTitle');
    backdrop.setAttribute('aria-describedby', 'confirmModalMessage');
    backdrop.style.display = 'none';

    backdrop.innerHTML = `
      <div class="confirm-modal-dialog" id="confirmModalDialog" tabindex="-1">
        <div class="confirm-modal-header">
          <div class="confirm-icon-badge" id="confirmModalIconBadge"></div>
          <div class="confirm-header-text">
            <h3 class="confirm-modal-title" id="confirmModalTitle">Confirm Action</h3>
            <p class="confirm-modal-subtitle" id="confirmModalSubtitle" style="display: none;"></p>
          </div>
          <button type="button" class="confirm-modal-close" id="confirmModalCloseBtn" aria-label="Close confirmation dialog">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="confirm-modal-body">
          <p class="confirm-modal-message" id="confirmModalMessage"></p>
          <div class="confirm-modal-details" id="confirmModalDetails" style="display: none;"></div>
          <div class="confirm-modal-error" id="confirmModalError" style="display: none;"></div>
        </div>

        <div class="confirm-modal-footer">
          <button type="button" class="btn btn-secondary confirm-btn-cancel" id="confirmModalCancelBtn">
            Cancel
          </button>
          <button type="button" class="btn confirm-btn-action" id="confirmModalConfirmBtn">
            <span class="confirm-btn-spinner" id="confirmBtnSpinner" style="display: none;">
              <svg class="icon-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <line x1="12" y1="2" x2="12" y2="6"></line>
                <line x1="12" y1="18" x2="12" y2="22"></line>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                <line x1="2" y1="12" x2="6" y2="12"></line>
                <line x1="18" y1="12" x2="22" y2="12"></line>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
              </svg>
            </span>
            <span id="confirmBtnText">Confirm</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    return backdrop;
  }

  /**
   * Main confirmation modal function
   *
   * @param {Object} options
   * @param {string} [options.title='Confirm Deletion']
   * @param {string} [options.subtitle]
   * @param {string} [options.message='Are you sure you want to delete this record? This action cannot be undone.']
   * @param {string|HTMLElement} [options.itemDetails] - Specific details/chip/card (e.g. Employee name or ID)
   * @param {string} [options.confirmText='Delete']
   * @param {string} [options.cancelText='Cancel']
   * @param {string} [options.loadingText='Deleting...']
   * @param {'danger'|'warning'|'info'} [options.variant='danger']
   * @param {Function} [options.onConfirm] - Optional async callback to execute before closing
   * @returns {Promise<boolean>}
   */
  function showConfirmModal(options = {}) {
    if (typeof options === 'string') {
      options = { message: options };
    }

    const {
      title = 'Confirm Deletion',
      subtitle = '',
      message = 'Are you sure you want to proceed? This action cannot be undone.',
      itemDetails = '',
      confirmText = 'Delete',
      cancelText = 'Cancel',
      loadingText = 'Processing...',
      variant = 'danger',
      onConfirm = null
    } = options;

    return new Promise((resolve) => {
      // If a modal is already active, close it first
      if (activeModalPromise && typeof activeModalPromise.cancel === 'function') {
        activeModalPromise.cancel();
      }

      const backdrop = ensureModalDOM();
      const dialog = document.getElementById('confirmModalDialog');
      const titleEl = document.getElementById('confirmModalTitle');
      const subtitleEl = document.getElementById('confirmModalSubtitle');
      const messageEl = document.getElementById('confirmModalMessage');
      const detailsEl = document.getElementById('confirmModalDetails');
      const errorEl = document.getElementById('confirmModalError');
      const iconBadgeEl = document.getElementById('confirmModalIconBadge');
      const cancelBtn = document.getElementById('confirmModalCancelBtn');
      const confirmBtn = document.getElementById('confirmModalConfirmBtn');
      const confirmBtnText = document.getElementById('confirmBtnText');
      const confirmBtnSpinner = document.getElementById('confirmBtnSpinner');
      const closeBtn = document.getElementById('confirmModalCloseBtn');

      previousActiveElement = document.activeElement;

      // Populate text & content
      titleEl.textContent = title;
      if (subtitle) {
        subtitleEl.textContent = subtitle;
        subtitleEl.style.display = 'block';
      } else {
        subtitleEl.style.display = 'none';
      }

      messageEl.textContent = message;

      if (itemDetails) {
        if (typeof itemDetails === 'string') {
          detailsEl.textContent = itemDetails;
        } else if (itemDetails instanceof HTMLElement) {
          detailsEl.innerHTML = '';
          detailsEl.appendChild(itemDetails);
        }
        detailsEl.style.display = 'block';
      } else {
        detailsEl.style.display = 'none';
        detailsEl.textContent = '';
      }

      errorEl.style.display = 'none';
      errorEl.textContent = '';

      // Set icon & variant styling
      const selectedVariant = ['danger', 'warning', 'info'].includes(variant) ? variant : 'danger';
      iconBadgeEl.className = `confirm-icon-badge variant-${selectedVariant}`;
      iconBadgeEl.innerHTML = ICONS[selectedVariant] || ICONS.danger;

      confirmBtn.className = `btn confirm-btn-action variant-${selectedVariant}`;
      confirmBtnText.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      confirmBtnSpinner.style.display = 'none';

      // Open modal
      backdrop.style.display = 'flex';
      backdrop.classList.add('active');

      // Focus management: focus cancel button by default to prevent accidental confirmations on Enter key
      setTimeout(() => {
        if (cancelBtn) cancelBtn.focus();
      }, 50);

      // Clean cleanup function
      function closeModal(resolvedValue) {
        window.removeEventListener('keydown', handleKeyDown);
        backdrop.style.display = 'none';
        backdrop.classList.remove('active');
        activeModalPromise = null;

        // Restore focus to previous element if valid
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
          try { previousActiveElement.focus(); } catch (_) {}
        }
        resolve(resolvedValue);
      }

      activeModalPromise = {
        cancel: () => closeModal(false)
      };

      // Handle Cancel / Dismiss
      function onCancel() {
        closeModal(false);
      }

      // Handle Confirm
      async function onAction() {
        if (confirmBtn.disabled) return;

        if (typeof onConfirm === 'function') {
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          closeBtn.disabled = true;
          confirmBtnSpinner.style.display = 'inline-flex';
          confirmBtnText.textContent = loadingText || (variant === 'danger' ? 'Deleting...' : 'Processing...');
          errorEl.style.display = 'none';

          try {
            await onConfirm();
            closeModal(true);
          } catch (err) {
            console.error('[ConfirmModal] Action error:', err);
            errorEl.textContent = err.message || 'Operation failed. Please try again.';
            errorEl.style.display = 'block';
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            closeBtn.disabled = false;
            confirmBtnSpinner.style.display = 'none';
            confirmBtnText.textContent = confirmText;
          }
        } else {
          closeModal(true);
        }
      }

      // Event handlers
      cancelBtn.onclick = onCancel;
      closeBtn.onclick = onCancel;
      confirmBtn.onclick = onAction;

      backdrop.onclick = function (e) {
        if (e.target === backdrop && !confirmBtn.disabled) {
          onCancel();
        }
      };

      // Keyboard Trap & Escape handler
      function handleKeyDown(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
          if (!confirmBtn.disabled) {
            e.preventDefault();
            onCancel();
          }
          return;
        }

        // Focus trap inside dialog
        if (e.key === 'Tab') {
          const focusable = dialog.querySelectorAll('button:not([disabled]), [tabindex="0"]');
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }

      window.addEventListener('keydown', handleKeyDown);
    });
  }

  // Expose on global window object
  window.showConfirmModal = showConfirmModal;
  window.confirmModal = showConfirmModal;

})(window);
