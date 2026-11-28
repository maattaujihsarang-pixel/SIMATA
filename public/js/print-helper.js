/**
 * SIMATA — Universal Flexible Print Engine & Official Kop / QR TTE Signature Helper
 * Used across ALL SIMATA printouts (Master Siswa/Guru, Presensi, Jurnal, Rekap,
 * Laporan Akademik, Jadwal Pelajaran, Nilai Leger & KHS, dan Kuitansi).
 */
(function initSimataPrintHelper(window) {
  'use strict';

  const DEFAULTS = {
    show_logo: true,
    logo_url: '/assets/logo.png',
    foundation_name: 'YAYASAN MUWAJJIHUL ULUM ASY-SYARIYYAH',
    school_name: 'MADRASAH ALIYAH AT-TAUJIH SARANG',
    school_address: 'Dk. Pulorejo, Desa Bajingjowo, Kec. Sarang, Kab. Rembang, Jawa Tengah (59274)',
    school_contact: 'NPSN: 70033117 \u2022 Email: maattaujihsarang@gmail.com',
    principal_title: 'Kepala Madrasah',
    principal_name: 'Moch. Iqnaul Badril Falah, S.Ag',
    principal_nip: '',
    sign_city: 'Sarang',
    signature_mode: 'qr',
    qr_style: 'tte_compact',
    qr_verify_url: '',
    show_stamp: false,
    signature_img: '/assets/kts_signature.png',
    stamp_img: '/assets/kts_stamp.png',
    default_paper_size: 'A4',
    margin_mm: 10,
    show_print_timestamp: true,
    footer_note: 'Dokumen ini dicetak secara resmi melalui SIMATA \u2014 MA At-Taujih Sarang'
  };

  let currentSettings = Object.assign({}, DEFAULTS);
  const assetDataCache = {}; // url -> dataUrl
  const assetImgCache = {};  // url -> HTMLImageElement
  const qrRenderCache = {};  // cacheKey -> dataUrl
  let preloadPromise = null;

  function esc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveUrl(src) {
    const s = String(src || '').trim();
    if (!s) return '';
    if (s.startsWith('data:') || /^https?:\/\//i.test(s)) return s;
    try {
      return window.location.origin + (s.startsWith('/') ? s : '/' + s);
    } catch (_) {
      return s;
    }
  }

  function loadImageAsset(src) {
    const resolved = resolveUrl(src);
    if (!resolved) return Promise.resolve(null);
    if (assetDataCache[resolved] && assetImgCache[resolved]) {
      return Promise.resolve({ dataUrl: assetDataCache[resolved], img: assetImgCache[resolved] });
    }
    return new Promise(function (resolve) {
      if (typeof Image === 'undefined') return resolve(null);
      const img = new Image();
      if (!resolved.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = function () {
        assetImgCache[resolved] = img;
        if (resolved.startsWith('data:')) {
          assetDataCache[resolved] = resolved;
          return resolve({ dataUrl: resolved, img: img });
        }
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 256;
          canvas.height = img.naturalHeight || img.height || 256;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          assetDataCache[resolved] = dataUrl;
          resolve({ dataUrl: dataUrl, img: img });
        } catch (_) {
          resolve({ dataUrl: resolved, img: img });
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = resolved;
    });
  }

  function preloadAssets(cfgOverride) {
    const cfg = getMergedSettings(cfgOverride);
    const urls = [cfg.logo_url || DEFAULTS.logo_url, cfg.signature_img, cfg.stamp_img].filter(Boolean);
    preloadPromise = Promise.all(urls.map(loadImageAsset));
    return preloadPromise;
  }

  function getMergedSettings(override) {
    return Object.assign({}, DEFAULTS, currentSettings, override || {});
  }

  function setSettings(next) {
    currentSettings = Object.assign({}, DEFAULTS, currentSettings, next || {});
    preloadAssets(currentSettings);
    ensureInlinePrintStyles();
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent('simata:print-settings-updated', { detail: Object.assign({}, currentSettings) }));
      }
    } catch (_) {}
    return Object.assign({}, currentSettings);
  }

  async function loadSettings() {
    try {
      preloadAssets();
      if (window.simataClient && typeof window.simataClient.getPrintSettings === 'function') {
        const res = await window.simataClient.getPrintSettings();
        if (res && res.success && res.data) {
          setSettings(res.data);
          return Object.assign({}, currentSettings);
        }
      }
    } catch (err) {
      console.warn('[SIMATA PRINT] Using default print settings:', err && err.message ? err.message : err);
    }
    ensureInlinePrintStyles();
    return Object.assign({}, currentSettings);
  }

  function getCachedAssetSrc(rawSrc) {
    if (!rawSrc) return '';
    const resolved = resolveUrl(rawSrc);
    return assetDataCache[resolved] || resolved;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function computeVerificationCode(docTitle, cfg) {
    const seed = [
      '70033117',
      String(cfg.principal_name || ''),
      String(cfg.principal_title || ''),
      String(docTitle || 'Dokumen Resmi SIMATA'),
      String(cfg.sign_city || 'Sarang')
    ].join('|');
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < seed.length; i++) {
      const c = seed.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    return 'TTE-' + (h1 >>> 0).toString(16).toUpperCase().padStart(8, '0') +
      (h2 >>> 0).toString(16).toUpperCase().slice(0, 4);
  }

  function buildQrPayload(docTitle, cfg, dateLabel) {
    const verifyUrl = String(cfg.qr_verify_url || '').trim();
    if (verifyUrl) return verifyUrl;
    const parts = [
      'TTE-SIMATA | ' + (cfg.school_name || 'MA AT-TAUJIH SARANG'),
      'Kode: ' + computeVerificationCode(docTitle, cfg),
      'Oleh: ' + (cfg.principal_name || DEFAULTS.principal_name) +
        (cfg.principal_nip ? ' (' + cfg.principal_nip + ')' : ''),
      'Jabatan: ' + (cfg.principal_title || 'Kepala Madrasah'),
      'Dokumen: ' + (docTitle || 'Dokumen Resmi SIMATA')
    ];
    if (dateLabel) parts.push('Tanggal: ' + dateLabel);
    return parts.join('\n');
  }

  function buildQrSignatureDataUrl(docTitle, cfgOverride, dateLabel) {
    const cfg = getMergedSettings(cfgOverride);
    const style = cfg.qr_style || 'tte_compact';
    const payload = buildQrPayload(docTitle, cfg, dateLabel);
    const logoKey = cfg.logo_url || DEFAULTS.logo_url;
    const resolvedLogo = resolveUrl(logoKey);
    const logoLoaded = Boolean(assetImgCache[resolvedLogo]);
    const cacheKey = style + '|' + payload + '|' + (logoLoaded ? 'L1' : 'L0');
    if (qrRenderCache[cacheKey]) return qrRenderCache[cacheKey];

    if (typeof document === 'undefined' || typeof window.QRCode !== 'function') {
      return '';
    }

    try {
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '-9999px';
      host.style.top = '-9999px';
      document.body.appendChild(host);

      const qrPx = 240;
      new window.QRCode(host, {
        text: payload,
        width: qrPx,
        height: qrPx,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.H : 2
      });

      const qrCanvasEl = host.querySelector('canvas');
      const qrImgEl = host.querySelector('img');
      const sourceEl = qrCanvasEl || qrImgEl;
      if (!sourceEl) {
        document.body.removeChild(host);
        return '';
      }

      const outerSize = 264;
      const capH = style === 'tte_compact' ? 38 : 0;
      const out = document.createElement('canvas');
      out.width = outerSize;
      out.height = outerSize + capH;
      const ctx = out.getContext('2d');

      // White card background + crisp subtle emerald frame
      ctx.fillStyle = '#ffffff';
      drawRoundedRect(ctx, 1, 1, out.width - 2, out.height - 2, 14);
      ctx.fill();
      ctx.strokeStyle = style === 'tte_compact' ? 'rgba(22, 101, 52, 0.35)' : 'rgba(15, 23, 42, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const qz = 12;
      const qrInner = outerSize - qz * 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sourceEl, qz, qz, qrInner, qrInner);
      ctx.imageSmoothingEnabled = true;

      // Center crest emblem overlay
      const logoImg = assetImgCache[resolvedLogo];
      if (logoImg && cfg.show_logo !== false) {
        const badgeS = Math.round(qrInner * 0.25);
        const bx = qz + (qrInner - badgeS) / 2;
        const by = qz + (qrInner - badgeS) / 2;
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, bx, by, badgeS, badgeS, Math.round(badgeS * 0.24));
        ctx.fill();
        ctx.strokeStyle = 'rgba(22, 101, 52, 0.38)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        const pad = Math.max(3, Math.round(badgeS * 0.14));
        ctx.drawImage(logoImg, bx + pad, by + pad, badgeS - pad * 2, badgeS - pad * 2);
      }

      if (style === 'tte_compact') {
        const ribY = outerSize - 2;
        const ribH = capH - 4;
        ctx.fillStyle = '#ecfdf5';
        drawRoundedRect(ctx, 8, ribY, outerSize - 16, ribH, 7);
        ctx.fill();
        ctx.fillStyle = '#065f46';
        ctx.font = '700 18px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TTE \u2022 UU ITE', outerSize / 2, ribY + ribH / 2 + 1);
      }

      document.body.removeChild(host);
      const dataUrl = out.toDataURL('image/png');
      qrRenderCache[cacheKey] = dataUrl;
      return dataUrl;
    } catch (err) {
      console.warn('[SIMATA PRINT] QR TTE render fallback:', err);
      return '';
    }
  }

  function renderKopHtml(opts) {
    const o = opts || {};
    const cfg = getMergedSettings(o.cfg);
    const compact = Boolean(o.compact);
    const showLogo = cfg.show_logo !== false && Boolean(cfg.logo_url);
    const logoSrc = showLogo ? getCachedAssetSrc(cfg.logo_url) : '';
    const logoDim = compact ? 44 : 56;

    const logoLeftHtml = showLogo
      ? '<div class="simata-kop-logo" style="width:' + logoDim + 'px;height:' + logoDim + 'px;"><img src="' + esc(logoSrc) + '" alt="Logo Madrasah" /></div>'
      : '';
    const rightSpacerHtml = showLogo
      ? '<div class="simata-kop-spacer" style="width:' + logoDim + 'px;" aria-hidden="true"></div>'
      : '';

    const foundHtml = cfg.foundation_name
      ? '<div class="simata-kop-found">' + esc(cfg.foundation_name) + '</div>'
      : '';
    const addrHtml = cfg.school_address
      ? '<div class="simata-kop-addr">' + esc(cfg.school_address) + '</div>'
      : '';
    const contactHtml = cfg.school_contact
      ? '<div class="simata-kop-contact">' + esc(cfg.school_contact) + '</div>'
      : '';

    const docHeadHtml = o.title
      ? '<div class="simata-doc-title-wrap' + (compact ? ' is-compact' : '') + '">' +
          '<div class="simata-doc-title">' + esc(o.title) + '</div>' +
          (o.subtitle ? '<div class="simata-doc-subtitle">' + esc(o.subtitle) + '</div>' : '') +
        '</div>'
      : '';

    return '<div class="simata-kop-wrap' + (compact ? ' is-compact' : '') + '">' +
        '<div class="simata-kop">' +
          logoLeftHtml +
          '<div class="simata-kop-center">' +
            foundHtml +
            '<div class="simata-kop-school">' + esc(cfg.school_name) + '</div>' +
            addrHtml +
            contactHtml +
          '</div>' +
          rightSpacerHtml +
        '</div>' +
        docHeadHtml +
      '</div>';
  }

  function formatIndoDateNow() {
    try {
      return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) {
      return '';
    }
  }

  function renderPrincipalSigHtml(opts) {
    const o = opts || {};
    const cfg = getMergedSettings(o.cfg);
    const compact = Boolean(o.compact);
    const mode = cfg.signature_mode || 'qr';
    const roleLabel = o.roleLabel || cfg.principal_title || 'Kepala Madrasah';
    const dateStr = o.dateText || formatIndoDateNow();
    const docTitle = o.docTitle || 'Dokumen Resmi SIMATA';

    let topHtml = '';
    if (o.showCityDate) {
      topHtml += '<div>' + esc((cfg.sign_city || 'Sarang') + (dateStr ? ', ' + dateStr : '')) + '</div>';
    } else if (o.showMengetahui !== false) {
      topHtml += '<div>Mengetahui,</div>';
    }
    topHtml += '<div>' + esc(roleLabel) + '</div>';

    let graphicHtml = '';
    if (mode === 'qr' || mode === 'qr_stamp') {
      const qrSrc = buildQrSignatureDataUrl(docTitle, cfg, dateStr);
      const stampSrc = (mode === 'qr_stamp' && cfg.stamp_img) ? getCachedAssetSrc(cfg.stamp_img) : '';
      if (qrSrc) {
        graphicHtml =
          '<div class="simata-sig-graphic' + (compact ? ' is-compact' : '') + '">' +
            (stampSrc ? '<img class="simata-sig-stamp-overlay" src="' + esc(stampSrc) + '" alt="Stempel" />' : '') +
            '<img class="simata-sig-qr" src="' + esc(qrSrc) + '" alt="TTD QR Kepala Madrasah" />' +
          '</div>';
      } else {
        graphicHtml = '<div class="simata-sig-blank' + (compact ? ' is-compact' : '') + '"></div>';
      }
    } else if (mode === 'physical') {
      const sigSrc = cfg.signature_img ? getCachedAssetSrc(cfg.signature_img) : '';
      const stampSrc = (cfg.show_stamp && cfg.stamp_img) ? getCachedAssetSrc(cfg.stamp_img) : '';
      graphicHtml =
        '<div class="simata-sig-graphic' + (compact ? ' is-compact' : '') + '">' +
          (stampSrc ? '<img class="simata-sig-stamp-overlay" src="' + esc(stampSrc) + '" alt="Stempel" />' : '') +
          (sigSrc ? '<img class="simata-sig-phys" src="' + esc(sigSrc) + '" alt="Tanda Tangan" />' : '') +
        '</div>';
    } else {
      graphicHtml = '<div class="simata-sig-blank' + (compact ? ' is-compact' : '') + '"></div>';
    }

    const nameHtml = '<div class="simata-sig-name">' + esc(cfg.principal_name || '( ............................ )') + '</div>';
    const nipHtml = cfg.principal_nip
      ? '<div class="simata-sig-nip">' + esc(cfg.principal_nip) + '</div>'
      : '';

    return '<div class="simata-sig-col">' + topHtml + graphicHtml + nameHtml + nipHtml + '</div>';
  }

  function renderPrintFooterHtml(cfgOverride) {
    const cfg = getMergedSettings(cfgOverride);
    if (!cfg.footer_note && !cfg.show_print_timestamp) return '';
    let stamp = '';
    if (cfg.show_print_timestamp) {
      try { stamp = 'Dicetak: ' + new Date().toLocaleString('id-ID'); } catch (_) {}
    }
    return '<div class="simata-print-foot">' +
      '<span>' + esc(cfg.footer_note || '') + '</span>' +
      '<span>' + esc(stamp) + '</span>' +
    '</div>';
  }

  function getPageCss(orientation, cfgOverride) {
    const cfg = getMergedSettings(cfgOverride);
    const ori = orientation === 'landscape' ? 'landscape' : 'portrait';
    const margin = Number.isFinite(Number(cfg.margin_mm)) ? Number(cfg.margin_mm) : 10;
    const sizeExpr = cfg.default_paper_size === 'F4'
      ? (ori === 'landscape' ? '330mm 215mm' : '215mm 330mm')
      : ('A4 ' + ori);
    return '@page { size: ' + sizeExpr + '; margin: ' + margin + 'mm; }';
  }

  function getSharedPrintCss() {
    return [
      '.simata-kop-wrap { width: 100%; margin-bottom: 10px; color: #0f172a; }',
      '.simata-kop { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 7px; border-bottom: 2.5px double #0f172a; }',
      '.simata-kop-wrap.is-compact .simata-kop { padding-bottom: 5px; }',
      '.simata-kop-logo { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }',
      '.simata-kop-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }',
      '.simata-kop-spacer { flex-shrink: 0; }',
      '.simata-kop-center { flex: 1; text-align: center; line-height: 1.28; min-width: 0; }',
      '.simata-kop-found { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #334155; }',
      '.simata-kop-school { font-size: 13.5pt; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; color: #0f172a; margin: 1px 0; }',
      '.simata-kop-wrap.is-compact .simata-kop-school { font-size: 12pt; }',
      '.simata-kop-addr { font-size: 8pt; color: #334155; }',
      '.simata-kop-contact { font-size: 8pt; font-weight: 600; color: #334155; margin-top: 1px; }',
      '.simata-doc-title-wrap { text-align: center; margin-top: 8px; }',
      '.simata-doc-title-wrap.is-compact { margin-top: 6px; }',
      '.simata-doc-title { font-size: 11.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; color: #0f172a; }',
      '.simata-doc-title-wrap.is-compact .simata-doc-title { font-size: 10.5pt; }',
      '.simata-doc-subtitle { font-size: 9pt; font-weight: 600; color: #334155; margin-top: 2px; }',
      '.simata-sig-col { text-align: center; min-width: 195px; font-size: 9.5pt; color: #0f172a; line-height: 1.3; }',
      '.simata-sig-graphic { position: relative; height: 68px; display: flex; align-items: center; justify-content: center; margin: 4px auto; }',
      '.simata-sig-graphic.is-compact { height: 56px; margin: 3px auto; }',
      '.simata-sig-blank { height: 52px; }',
      '.simata-sig-blank.is-compact { height: 42px; }',
      '.simata-sig-qr { height: 64px; width: auto; display: block; position: relative; z-index: 1; }',
      '.simata-sig-graphic.is-compact .simata-sig-qr { height: 54px; }',
      '.simata-sig-phys { max-height: 54px; max-width: 150px; object-fit: contain; display: block; position: relative; z-index: 1; }',
      '.simata-sig-stamp-overlay { position: absolute; height: 58px; width: auto; opacity: 0.62; left: 50%; top: 50%; transform: translate(-72%, -50%); pointer-events: none; z-index: 2; }',
      '.simata-sig-name { font-weight: 700; text-decoration: underline; }',
      '.simata-sig-nip { font-size: 8.5pt; color: #334155; margin-top: 1px; }',
      '.simata-print-foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #cbd5e1; font-size: 8pt; color: #475569; display: flex; justify-content: space-between; gap: 10px; }'
    ].join('\n');
  }

  function ensureInlinePrintStyles() {
    if (typeof document === 'undefined' || !document.head) return;
    let st = document.getElementById('simataSharedInlinePrintCss');
    if (!st) {
      st = document.createElement('style');
      st.id = 'simataSharedInlinePrintCss';
      document.head.appendChild(st);
    }
    st.textContent = getSharedPrintCss();
  }

  function openTestPrintPreview(cfgOverride) {
    const cfg = getMergedSettings(cfgOverride);
    const win = window.open('', '_blank', 'width=900,height=720');
    if (!win) {
      alert('Izinkan pop-up browser untuk membuka Pratinjau Cetak.');
      return;
    }
    const html = '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Uji Cetak SIMATA</title>' +
      '<style>' +
      getPageCss('portrait', cfg) +
      'body{font-family:Arial,Helvetica,sans-serif;margin:20px;color:#0f172a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      getSharedPrintCss() +
      'table{width:100%;border-collapse:collapse;margin:14px 0;font-size:10pt;}' +
      'th,td{border:1px solid #334155;padding:7px 9px;text-align:left;}th{background:#f1f5f9;font-weight:700;}' +
      '.sig-wrap{display:flex;justify-content:flex-end;margin-top:24px;}' +
      '</style></head><body>' +
      renderKopHtml({
        title: 'CONTOH DOKUMEN CETAK RESMI SIMATA',
        subtitle: 'Uji Tata Letak Kop, Logo Madrasah, & Tanda Tangan Kepala Madrasah',
        cfg: cfg
      }) +
      '<p style="font-size:10pt;color:#334155;">Berikut adalah contoh hasil cetak otomatis dengan ukuran kertas <strong>' +
      esc(cfg.default_paper_size) + '</strong>, margin <strong>' + esc(cfg.margin_mm) + ' mm</strong>, dan mode tanda tangan <strong>' + esc(cfg.signature_mode.toUpperCase()) + '</strong>.</p>' +
      '<table><thead><tr><th style="width:45px;text-align:center;">No</th><th>Uraian Pengaturan</th><th>Nilai Aktif</th></tr></thead>' +
      '<tbody>' +
        '<tr><td style="text-align:center;">1</td><td>Logo Madrasah</td><td>' + (cfg.show_logo ? 'Ditampilkan di header cetak' : 'Disembunyikan') + '</td></tr>' +
        '<tr><td style="text-align:center;">2</td><td>Pejabat Penandatangan</td><td>' + esc(cfg.principal_name) + '</td></tr>' +
        '<tr><td style="text-align:center;">3</td><td>Model Tanda Tangan</td><td>' + esc(cfg.signature_mode) + ' (' + esc(cfg.qr_style) + ')</td></tr>' +
      '</tbody></table>' +
      '<div class="sig-wrap">' +
        renderPrincipalSigHtml({ docTitle: 'Uji Cetak Dokumen Resmi SIMATA', showCityDate: true, cfg: cfg }) +
      '</div>' +
      renderPrintFooterHtml(cfg) +
      '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<' + '/script></body></html>';
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  window.SimataPrint = {
    DEFAULTS: DEFAULTS,
    getSettings: function () { return getMergedSettings(); },
    setSettings: setSettings,
    loadSettings: loadSettings,
    preloadAssets: preloadAssets,
    getLogoSrc: function (cfg) { return getCachedAssetSrc((cfg && cfg.logo_url) || currentSettings.logo_url || DEFAULTS.logo_url); },
    buildQrSignatureDataUrl: buildQrSignatureDataUrl,
    renderKopHtml: renderKopHtml,
    renderPrincipalSigHtml: renderPrincipalSigHtml,
    renderPrintFooterHtml: renderPrintFooterHtml,
    getPageCss: getPageCss,
    getSharedPrintCss: getSharedPrintCss,
    ensureInlinePrintStyles: ensureInlinePrintStyles,
    openTestPrintPreview: openTestPrintPreview
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { preloadAssets(); ensureInlinePrintStyles(); });
    } else {
      preloadAssets();
      ensureInlinePrintStyles();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
