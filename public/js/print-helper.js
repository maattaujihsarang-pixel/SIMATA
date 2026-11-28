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
    foundation_name: 'YAYASAN MUWAJJIHUL ULUM ASY SYARIYYAH',
    school_name: 'MADRASAH ALIYAH AT-TAUJIH',
    school_accreditation: 'TERAKREDITASI \u201cA\u201d',
    school_nsm: '131233170020',
    school_npsn: '70033117',
    school_akta: 'Akta Notaris : No.AHU-00009450.AH.01.04.Tahun 2021 Tanggal 06 April 2021',
    school_address: 'Jl. Dk. Pulorejo Desa Bajingjowo Kecamatan Sarang Kabupaten Rembang 59274',
    school_contact: 'Email: maattaujihsarang@gmail.com',
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
  const assetDataCache = {}; // url -> dataUrl (trimmed for logo)
  const assetImgCache = {};  // url -> HTMLImageElement / canvas
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

  /**
   * Trims excess transparent margin around the logo crest so the emblem fills
   * the Kop and QR badge cleanly without appearing tiny.
   */
  function buildTrimmedCanvas(img, trimTransparent) {
    const w = img.naturalWidth || img.width || 256;
    const h = img.naturalHeight || img.height || 256;
    const raw = document.createElement('canvas');
    raw.width = w;
    raw.height = h;
    const rCtx = raw.getContext('2d');
    rCtx.drawImage(img, 0, 0);

    if (!trimTransparent) return raw;

    try {
      const data = rCtx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
          if (data[row + x * 4 + 3] > 12) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        const pad = Math.round(Math.max(cw, ch) * 0.02);
        const side = Math.max(cw, ch) + pad * 2;
        const out = document.createElement('canvas');
        out.width = side;
        out.height = side;
        const oCtx = out.getContext('2d');
        const dx = Math.round((side - cw) / 2);
        const dy = Math.round((side - ch) / 2);
        oCtx.drawImage(raw, minX, minY, cw, ch, dx, dy, cw, ch);
        return out;
      }
    } catch (_) {
      // Cross-origin image fallback uses raw canvas/src
    }
    return raw;
  }

  function loadImageAsset(src, trimTransparent) {
    const resolved = resolveUrl(src);
    if (!resolved) return Promise.resolve(null);
    const cacheKey = resolved + (trimTransparent ? '|TRIM' : '|RAW');
    if (assetDataCache[cacheKey] && assetImgCache[cacheKey]) {
      return Promise.resolve({ dataUrl: assetDataCache[cacheKey], img: assetImgCache[cacheKey] });
    }
    return new Promise(function (resolve) {
      if (typeof Image === 'undefined') return resolve(null);
      const img = new Image();
      if (!resolved.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          const canvas = buildTrimmedCanvas(img, trimTransparent);
          const dataUrl = canvas.toDataURL('image/png');
          assetDataCache[cacheKey] = dataUrl;
          assetDataCache[resolved] = dataUrl;
          assetImgCache[cacheKey] = canvas;
          assetImgCache[resolved] = canvas;
          resolve({ dataUrl: dataUrl, img: canvas });
        } catch (_) {
          assetImgCache[cacheKey] = img;
          assetImgCache[resolved] = img;
          assetDataCache[cacheKey] = resolved;
          assetDataCache[resolved] = resolved;
          resolve({ dataUrl: resolved, img: img });
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = resolved;
    });
  }

  function preloadAssets(cfgOverride) {
    const cfg = getMergedSettings(cfgOverride);
    const jobs = [];
    const logoUrl = cfg.logo_url || DEFAULTS.logo_url;
    if (logoUrl) jobs.push(loadImageAsset(logoUrl, true));
    if (cfg.signature_img) jobs.push(loadImageAsset(cfg.signature_img, false));
    if (cfg.stamp_img) jobs.push(loadImageAsset(cfg.stamp_img, false));
    preloadPromise = Promise.all(jobs);
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

  function getCachedAssetSrc(rawSrc, preferTrim) {
    if (!rawSrc) return '';
    const resolved = resolveUrl(rawSrc);
    if (preferTrim && assetDataCache[resolved + '|TRIM']) return assetDataCache[resolved + '|TRIM'];
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
      String(cfg.school_npsn || '70033117'),
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
    if (verifyUrl) return verifyUrl.slice(0, 260);
    const code = computeVerificationCode(docTitle, cfg);
    const parts = [
      'TTE MA At-Taujih (' + (cfg.school_npsn || '70033117') + ')',
      'Kode: ' + code,
      'Oleh: ' + String(cfg.principal_name || DEFAULTS.principal_name).slice(0, 48),
      'Dok: ' + String(docTitle || 'Dokumen Resmi SIMATA').slice(0, 48)
    ];
    if (dateLabel) parts.push('Tgl: ' + String(dateLabel).slice(0, 24));
    return parts.join('\n');
  }

  /**
   * Generates a QR matrix element reliably via QRCode.js, iterating through error
   * correction levels so longer payloads never trigger a fatal code-length overflow.
   */
  function createQrMatrixSource(payload, fallbackCode) {
    if (typeof document === 'undefined' || typeof window.QRCode !== 'function') {
      return null;
    }
    const CL = window.QRCode.CorrectLevel || { H: 2, Q: 3, M: 0, L: 1 };
    const levels = [CL.H, CL.Q, CL.M, CL.L];
    const clean = String(payload || '').trim();
    const candidates = [clean];
    if (clean.length > 130) candidates.push(clean.slice(0, 126) + '...');
    if (fallbackCode) candidates.push(fallbackCode);

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-9999px';
    host.style.top = '-9999px';
    document.body.appendChild(host);

    try {
      for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
        const textVal = candidates[cIdx];
        for (let lIdx = 0; lIdx < levels.length; lIdx++) {
          try {
            host.innerHTML = '';
            new window.QRCode(host, {
              text: textVal,
              width: 240,
              height: 240,
              colorDark: '#0f172a',
              colorLight: '#ffffff',
              correctLevel: levels[lIdx]
            });
            const qrCanvas = host.querySelector('canvas');
            const qrImg = host.querySelector('img');
            const source = qrCanvas || qrImg;
            if (source && ((source.width || source.naturalWidth) > 0)) {
              const copy = document.createElement('canvas');
              copy.width = qrCanvas ? qrCanvas.width : 240;
              copy.height = qrCanvas ? qrCanvas.height : 240;
              const cCtx = copy.getContext('2d');
              cCtx.imageSmoothingEnabled = false;
              cCtx.drawImage(source, 0, 0, copy.width, copy.height);
              return copy;
            }
          } catch (_) {
            // Retry with lower error correction level or shorter payload
          }
        }
      }
      return null;
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
    }
  }

  function buildQrSignatureDataUrl(docTitle, cfgOverride, dateLabel) {
    const cfg = getMergedSettings(cfgOverride);
    const style = cfg.qr_style || 'tte_compact';
    const payload = buildQrPayload(docTitle, cfg, dateLabel);
    const shortFallback = 'TTE-SIMATA|' + computeVerificationCode(docTitle, cfg) + '|' + String(cfg.principal_name || '').slice(0, 32);
    const logoKey = cfg.logo_url || DEFAULTS.logo_url;
    const resolvedLogo = resolveUrl(logoKey);
    const logoImg = assetImgCache[resolvedLogo + '|TRIM'] || assetImgCache[resolvedLogo] || null;
    const logoLoaded = Boolean(logoImg);
    const cacheKey = style + '|' + payload + '|' + (logoLoaded ? 'L1' : 'L0');
    if (qrRenderCache[cacheKey]) return qrRenderCache[cacheKey];

    const sourceCanvas = createQrMatrixSource(payload, shortFallback);
    if (!sourceCanvas) return '';

    try {
      const outerSize = 264;
      const capH = style === 'tte_compact' ? 38 : 0;
      const out = document.createElement('canvas');
      out.width = outerSize;
      out.height = outerSize + capH;
      const ctx = out.getContext('2d');

      ctx.fillStyle = '#ffffff';
      drawRoundedRect(ctx, 1, 1, out.width - 2, out.height - 2, 14);
      ctx.fill();
      ctx.strokeStyle = style === 'tte_compact' ? 'rgba(22, 101, 52, 0.38)' : 'rgba(15, 23, 42, 0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const qz = 12;
      const qrInner = outerSize - qz * 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sourceCanvas, qz, qz, qrInner, qrInner);
      ctx.imageSmoothingEnabled = true;

      if (logoImg && cfg.show_logo !== false) {
        try {
          const badgeS = Math.round(qrInner * 0.23);
          const bx = qz + (qrInner - badgeS) / 2;
          const by = qz + (qrInner - badgeS) / 2;
          ctx.fillStyle = '#ffffff';
          drawRoundedRect(ctx, bx, by, badgeS, badgeS, Math.round(badgeS * 0.24));
          ctx.fill();
          ctx.strokeStyle = 'rgba(22, 101, 52, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          const pad = Math.max(2, Math.round(badgeS * 0.1));
          ctx.drawImage(logoImg, bx + pad, by + pad, badgeS - pad * 2, badgeS - pad * 2);
        } catch (_) {
          // Safe fallback: QR remains intact even without crest image
        }
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

      const dataUrl = out.toDataURL('image/png');
      qrRenderCache[cacheKey] = dataUrl;
      return dataUrl;
    } catch (err) {
      console.warn('[SIMATA PRINT] QR TTE render fallback:', err);
      return '';
    }
  }

  function formatEmailContactHtml(rawContact) {
    const text = String(rawContact || '').trim();
    if (!text) return '';
    // Highlight email part in classic Word-style blue while keeping safe HTML escaping
    const match = text.match(/^(Email\s*:\s*)(.+)$/i);
    if (match) {
      return esc(match[1]) + '<span class="simata-kop-email">' + esc(match[2].trim()) + '</span>';
    }
    return esc(text);
  }

  function renderKopHtml(opts) {
    const o = opts || {};
    const cfg = getMergedSettings(o.cfg);
    const compact = Boolean(o.compact);
    const showLogo = cfg.show_logo !== false && Boolean(cfg.logo_url);
    const logoSrc = showLogo ? getCachedAssetSrc(cfg.logo_url, true) : '';

    // Balanced symmetrical grid track width keeps Kop text 100% centered on the same vertical axis as doc title
    const foundHtml = cfg.foundation_name
      ? '<div class="simata-kop-found">' + esc(cfg.foundation_name) + '</div>'
      : '';
    const akredHtml = cfg.school_accreditation
      ? '<div class="simata-kop-akred">' + esc(cfg.school_accreditation) + '</div>'
      : '';

    const nsmTxt = cfg.school_nsm ? 'NSM : ' + esc(cfg.school_nsm) : '';
    const npsnTxt = cfg.school_npsn ? 'NPSN : ' + esc(cfg.school_npsn) : '';
    const regHtml = (nsmTxt || npsnTxt)
      ? '<div class="simata-kop-reg">' +
          (nsmTxt ? '<span>' + nsmTxt + '</span>' : '') +
          (npsnTxt ? '<span>' + npsnTxt + '</span>' : '') +
        '</div>'
      : '';

    const aktaHtml = cfg.school_akta
      ? '<div class="simata-kop-akta">' + esc(cfg.school_akta) + '</div>'
      : '';

    const leftCell = showLogo
      ? '<div class="simata-kop-logo"><img src="' + esc(logoSrc) + '" alt="Logo MA At-Taujih" /></div>'
      : '';
    const rightCell = showLogo
      ? '<div class="simata-kop-spacer" aria-hidden="true"></div>'
      : '';

    const addrTxt = cfg.school_address ? esc(cfg.school_address) : '';
    const contactHtml = formatEmailContactHtml(cfg.school_contact);
    const addrBarHtml = (addrTxt || contactHtml)
      ? '<div class="simata-kop-addrbar' + (!addrTxt || !contactHtml ? ' is-single' : '') + '">' +
          (addrTxt ? '<span class="simata-kop-addr">' + addrTxt + '</span>' : '') +
          (contactHtml ? '<span class="simata-kop-contact">' + contactHtml + '</span>' : '') +
        '</div>'
      : '<div class="simata-kop-rule"></div>';

    const docHeadHtml = o.title
      ? '<div class="simata-doc-title-wrap' + (compact ? ' is-compact' : '') + '">' +
          '<div class="simata-doc-title">' + esc(o.title) + '</div>' +
          (o.subtitle ? '<div class="simata-doc-subtitle">' + esc(o.subtitle) + '</div>' : '') +
        '</div>'
      : '';

    return '<div class="simata-kop-wrap' + (compact ? ' is-compact' : '') + (showLogo ? ' has-logo' : '') + '">' +
        '<div class="simata-kop">' +
          leftCell +
          '<div class="simata-kop-center">' +
            foundHtml +
            '<div class="simata-kop-school">' + esc(cfg.school_name) + '</div>' +
            akredHtml +
            regHtml +
            aktaHtml +
          '</div>' +
          rightCell +
        '</div>' +
        addrBarHtml +
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
      const stampSrc = (mode === 'qr_stamp' && cfg.stamp_img) ? getCachedAssetSrc(cfg.stamp_img, false) : '';
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
      const sigSrc = cfg.signature_img ? getCachedAssetSrc(cfg.signature_img, false) : '';
      const stampSrc = (cfg.show_stamp && cfg.stamp_img) ? getCachedAssetSrc(cfg.stamp_img, false) : '';
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
      '.simata-kop-wrap { width: 100%; margin: 0 0 12px 0; color: #0f172a; box-sizing: border-box; }',
      '.simata-kop-wrap * { box-sizing: border-box; }',
      '.simata-kop { display: grid; grid-template-columns: 1fr; align-items: center; width: 100%; padding-bottom: 5px; font-family: "Times New Roman", Times, Georgia, serif; }',
      '.simata-kop-wrap.has-logo .simata-kop { grid-template-columns: 96px minmax(0, 1fr) 96px; gap: 10px; }',
      '.simata-kop-wrap.is-compact.has-logo .simata-kop { grid-template-columns: 78px minmax(0, 1fr) 78px; gap: 8px; }',
      '.simata-kop-logo { width: 92px; height: 92px; display: flex; align-items: center; justify-content: center; margin: 0 auto; }',
      '.simata-kop-wrap.is-compact .simata-kop-logo { width: 74px; height: 74px; }',
      '.simata-kop-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }',
      '.simata-kop-spacer { width: 100%; min-height: 1px; }',
      '.simata-kop-center { width: 100%; text-align: center; line-height: 1.24; min-width: 0; color: #0f172a; }',
      '.simata-kop-found { font-size: 11.5pt; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #0f172a; }',
      '.simata-kop-school { font-size: 14pt; font-weight: 800; letter-spacing: 0.02em; text-transform: uppercase; color: #0f172a; margin: 1px 0; }',
      '.simata-kop-akred { font-size: 10.5pt; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #0f172a; }',
      '.simata-kop-reg { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 6px 28px; font-size: 9.5pt; font-weight: 500; color: #0f172a; margin-top: 2px; }',
      '.simata-kop-akta { font-size: 9.2pt; font-weight: 500; color: #0f172a; margin-top: 1px; }',
      '.simata-kop-wrap.is-compact .simata-kop-found { font-size: 9pt; }',
      '.simata-kop-wrap.is-compact .simata-kop-school { font-size: 11pt; }',
      '.simata-kop-wrap.is-compact .simata-kop-akred { font-size: 8.4pt; }',
      '.simata-kop-wrap.is-compact .simata-kop-reg { font-size: 7.8pt; gap: 4px 18px; }',
      '.simata-kop-wrap.is-compact .simata-kop-akta { font-size: 7.2pt; }',
      '.simata-kop-addrbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px 12px; width: 100%; border: 1.6px solid #0f172a; padding: 4px 10px; margin-top: 4px; font-family: "Times New Roman", Times, Georgia, serif; font-size: 8.6pt; font-style: italic; color: #0f172a; background: #ffffff; }',
      '.simata-kop-addrbar.is-single { justify-content: center; text-align: center; }',
      '.simata-kop-wrap.is-compact .simata-kop-addrbar { font-size: 7.3pt; padding: 3px 8px; }',
      '.simata-kop-email { color: #1d4ed8; font-style: italic; }',
      '.simata-kop-rule { border-bottom: 2.5px double #0f172a; margin-top: 4px; }',
      '.simata-doc-title-wrap { width: 100%; text-align: center; margin-top: 10px; }',
      '.simata-doc-title-wrap.is-compact { margin-top: 8px; }',
      '.simata-doc-title { font-size: 11.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; color: #0f172a; }',
      '.simata-doc-title-wrap.is-compact .simata-doc-title { font-size: 10.5pt; }',
      '.simata-doc-subtitle { font-size: 9pt; font-weight: 600; color: #334155; margin-top: 2px; }',
      '.simata-sig-col { text-align: center; min-width: 195px; font-size: 9.5pt; color: #0f172a; line-height: 1.3; }',
      '.simata-sig-graphic { position: relative; height: 74px; display: flex; align-items: center; justify-content: center; margin: 4px auto; }',
      '.simata-sig-graphic.is-compact { height: 66px; margin: 4px auto; }',
      '.simata-sig-blank { height: 52px; }',
      '.simata-sig-blank.is-compact { height: 42px; }',
      '.simata-sig-qr { height: 72px; width: auto; display: block; position: relative; z-index: 1; }',
      '.simata-sig-graphic.is-compact .simata-sig-qr { height: 64px; }',
      '.simata-sig-phys { max-height: 54px; max-width: 150px; object-fit: contain; display: block; position: relative; z-index: 1; }',
      '.simata-sig-stamp-overlay { position: absolute; height: 60px; width: auto; opacity: 0.62; left: 50%; top: 50%; transform: translate(-72%, -50%); pointer-events: none; z-index: 2; }',
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
      esc(cfg.default_paper_size) + '</strong>, margin <strong>' + esc(cfg.margin_mm) + ' mm</strong>, dan mode tanda tangan <strong>' + esc(String(cfg.signature_mode || 'qr').toUpperCase()) + '</strong>.</p>' +
      '<table><thead><tr><th style="width:45px;text-align:center;">No</th><th>Uraian Pengaturan</th><th>Nilai Aktif</th></tr></thead>' +
      '<tbody>' +
        '<tr><td style="text-align:center;">1</td><td>Logo Madrasah</td><td>' + (cfg.show_logo ? 'Ditampilkan besar & proporsional di Kop Surat' : 'Disembunyikan') + '</td></tr>' +
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
    getLogoSrc: function (cfg) { return getCachedAssetSrc((cfg && cfg.logo_url) || currentSettings.logo_url || DEFAULTS.logo_url, true); },
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
