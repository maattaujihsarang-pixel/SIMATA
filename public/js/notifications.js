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

  window.simataConfirm = function(message) {
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
})(window, document);