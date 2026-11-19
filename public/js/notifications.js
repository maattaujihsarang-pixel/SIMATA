(function(window, document) {
  'use strict';

  function getNotice(message) {
    const text = String(message == null ? '' : message).replace(/\s+/g, ' ').trim();
    const normalized = text.toLowerCase();

    if (/berhasil|tersimpan|diperbarui|dihapus/.test(normalized)) {
      return { type: 'success', title: 'Berhasil', message: text };
    }
    if (/gagal|kesalahan|error|tidak valid|tidak ditemukan|tidak dapat/.test(normalized)) {
      return { type: 'error', title: 'Terjadi Kesalahan', message: text };
    }
    if (/silakan pilih|pilih .* terlebih dahulu|wajib diisi|belum siap|belum diambil/.test(normalized)) {
      return { type: 'warning', title: 'Pemberitahuan', message: text };
    }
    return { type: 'info', title: 'Informasi', message: text };
  }

  function renderNotice(notice) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function() {
        renderNotice(notice);
      }, { once: true });
      return;
    }

    let toast = document.getElementById('simataNativeToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'simataNativeToast';
      toast.className = 'simata-native-toast';
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');
      toast.innerHTML = '<span class="simata-native-toast__icon" aria-hidden="true"></span><span class="simata-native-toast__content"><strong></strong><span></span></span>';
      document.body.appendChild(toast);
    }

    toast.className = 'simata-native-toast is-' + notice.type;
    toast.querySelector('.simata-native-toast__icon').textContent = notice.type === 'success' ? '✓' : notice.type === 'error' ? '!' : notice.type === 'warning' ? '!' : 'i';
    toast.querySelector('strong').textContent = notice.title;
    toast.querySelector('.simata-native-toast__content span').textContent = notice.message;
    window.clearTimeout(window._simataNativeToastTimeout);
    requestAnimationFrame(function() {
      toast.classList.add('is-visible');
    });
    window._simataNativeToastTimeout = window.setTimeout(function() {
      toast.classList.remove('is-visible');
    }, 5000);
  }

  window.alert = function(message) {
    const notice = getNotice(message);
    if (typeof window.showToast === 'function') {
      window.showToast(notice.type, notice.title, notice.message);
      return;
    }
    renderNotice(notice);
  };

  window.simataConfirm = function(message, options) {
    const opts = options && typeof options === 'object' ? options : {};
    let dialog = document.getElementById('simataConfirmDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'simataConfirmDialog';
      dialog.className = 'simata-confirm-dialog';
      dialog.setAttribute('aria-labelledby', 'simataConfirmTitle');
      dialog.innerHTML = '<div class="simata-confirm-dialog__mark" aria-hidden="true">?</div><h2 id="simataConfirmTitle">Konfirmasi Tindakan</h2><p></p><div class="simata-confirm-dialog__actions"><button type="button" data-confirm-cancel>Batal</button><button type="button" data-confirm-accept>Ya, Lanjutkan</button></div>';
      document.body.appendChild(dialog);
      dialog.querySelector('[data-confirm-cancel]').addEventListener('click', function() {
        dialog.close('cancel');
      });
      dialog.querySelector('[data-confirm-accept]').addEventListener('click', function() {
        dialog.close('confirm');
      });
    }

    if (dialog.open) {
      dialog.close('cancel');
    }

    const markEl = dialog.querySelector('.simata-confirm-dialog__mark');
    const titleEl = dialog.querySelector('#simataConfirmTitle');
    const cancelBtn = dialog.querySelector('[data-confirm-cancel]');
    const acceptBtn = dialog.querySelector('[data-confirm-accept]');
    const isDanger = Boolean(opts.danger);

    dialog.classList.toggle('is-danger', isDanger);
    if (markEl) markEl.textContent = isDanger ? '!' : '?';
    if (titleEl) titleEl.textContent = opts.title || 'Konfirmasi Tindakan';
    if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'Batal';
    if (acceptBtn) acceptBtn.textContent = opts.confirmText || 'Ya, Lanjutkan';
    dialog.querySelector('p').textContent = String(message == null ? '' : message);

    return new Promise(function(resolve) {
      dialog.addEventListener('close', function() {
        dialog.classList.remove('is-visible');
        resolve(dialog.returnValue === 'confirm');
      }, { once: true });
      dialog.showModal();
      requestAnimationFrame(function() {
        dialog.classList.add('is-visible');
      });
      dialog.querySelector('[data-confirm-cancel]').focus();
    });
  };

  window.simataPrompt = function(message, options) {
    const opts = options && typeof options === 'object' ? options : {};
    let dialog = document.getElementById('simataPromptDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'simataPromptDialog';
      dialog.className = 'simata-confirm-dialog';
      dialog.setAttribute('aria-labelledby', 'simataPromptTitle');
      dialog.innerHTML = '<form method="dialog"><div class="simata-confirm-dialog__mark" aria-hidden="true">✎</div><h2 id="simataPromptTitle">Masukkan Informasi</h2><p></p><input type="text" class="simata-prompt-input" /><div class="simata-confirm-dialog__actions"><button type="button" data-confirm-cancel>Batal</button><button type="submit" value="confirm" data-confirm-accept>Lanjutkan</button></div></form>';
      document.body.appendChild(dialog);
      dialog.querySelector('form').addEventListener('submit', function(ev) {
        ev.preventDefault();
        dialog.close('confirm');
      });
      dialog.querySelector('[data-confirm-cancel]').addEventListener('click', function() {
        dialog.close('cancel');
      });
    }

    if (dialog.open) {
      dialog.close('cancel');
    }

    const markEl = dialog.querySelector('.simata-confirm-dialog__mark');
    const titleEl = dialog.querySelector('#simataPromptTitle');
    const inputEl = dialog.querySelector('.simata-prompt-input');
    const cancelBtn = dialog.querySelector('[data-confirm-cancel]');
    const acceptBtn = dialog.querySelector('[data-confirm-accept]');
    const isDanger = Boolean(opts.danger);

    dialog.classList.toggle('is-danger', isDanger);
    if (markEl) markEl.textContent = isDanger ? '!' : '✎';
    if (titleEl) titleEl.textContent = opts.title || 'Masukkan Informasi';
    if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'Batal';
    if (acceptBtn) acceptBtn.textContent = opts.confirmText || 'Lanjutkan';
    dialog.querySelector('p').textContent = String(message == null ? '' : message);

    inputEl.placeholder = opts.placeholder || '';
    inputEl.value = opts.defaultValue != null ? String(opts.defaultValue) : '';
    dialog.returnValue = '';

    return new Promise(function(resolve) {
      dialog.addEventListener('close', function() {
        dialog.classList.remove('is-visible');
        resolve(dialog.returnValue === 'confirm' ? inputEl.value : null);
      }, { once: true });
      dialog.showModal();
      requestAnimationFrame(function() {
        dialog.classList.add('is-visible');
      });
      inputEl.focus();
      inputEl.select();
    });
  };
})(window, document);