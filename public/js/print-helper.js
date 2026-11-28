/**
 * SIMATA — Universal Flexible Print Engine & Official Kop / QR TTE Signature Helper
 * Used across ALL SIMATA printouts (Master Siswa/Guru, Presensi, Jurnal, Rekap,
 * Laporan Akademik, Jadwal Pelajaran, Nilai Leger & KHS, dan Kuitansi).
 */
(function initSimataPrintHelper(window) {
  'use strict';

  const DEFAULT_KOP_ELEMENTS = {
    logo: { offset_x: 0, offset_y: 0 },
    foundation: {
      font_family: 'Plus Jakarta Sans',
      font_size_pt: 8.8,
      font_weight: 700,
      italic: false,
      uppercase: true,
      letter_spacing_px: 0.6,
      color: '#334155',
      offset_x: 0,
      offset_y: 0
    },
    school: {
      font_family: 'Plus Jakarta Sans',
      font_size_pt: 13.8,
      font_weight: 800,
      italic: false,
      uppercase: true,
      letter_spacing_px: 0.4,
      color: '#0f172a',
      offset_x: 0,
      offset_y: 0
    },
    address: {
      font_family: 'Plus Jakarta Sans',
      font_size_pt: 8.2,
      font_weight: 400,
      italic: false,
      uppercase: false,
      letter_spacing_px: 0,
      color: '#334155',
      offset_x: 0,
      offset_y: 0
    },
    contact: {
      font_family: 'Plus Jakarta Sans',
      font_size_pt: 8.2,
      font_weight: 600,
      italic: false,
      uppercase: false,
      letter_spacing_px: 0,
      color: '#334155',
      offset_x: 0,
      offset_y: 0
    },
    divider: {
      color: '#0f172a',
      thickness_px: 3
    }
  };

  function cloneKopElements(src) {
    const s = src || {};
    return {
      logo: Object.assign({}, DEFAULT_KOP_ELEMENTS.logo, s.logo || {}),
      foundation: Object.assign({}, DEFAULT_KOP_ELEMENTS.foundation, s.foundation || {}),
      school: Object.assign({}, DEFAULT_KOP_ELEMENTS.school, s.school || {}),
      address: Object.assign({}, DEFAULT_KOP_ELEMENTS.address, s.address || {}),
      contact: Object.assign({}, DEFAULT_KOP_ELEMENTS.contact, s.contact || {}),
      divider: Object.assign({}, DEFAULT_KOP_ELEMENTS.divider, s.divider || {})
    };
  }

  const DEFAULTS = {
    show_logo: true,
    logo_url: '/assets/logo.png',
    foundation_name: 'YAYASAN MUWAJJIHUL ULUM ASY-SYARIYYAH',
    school_name: 'MADRASAH ALIYAH AT-TAUJIH SARANG',
    school_address: 'Dk. Pulorejo, Desa Bajingjowo, Kec. Sarang, Kab. Rembang, Jawa Tengah (59274)',
    school_contact: 'NPSN: 70033117 \u2022 Email: maattaujihsarang@gmail.com',
    kop_align: 'center_page',
    header_font_family: 'sans',
    logo_size_px: 64,
    logo_text_gap_px: 14,
    logo_offset_x_px: 0,
    logo_offset_y_px: 0,
    header_offset_x_px: 0,
    header_offset_y_px: 0,
    header_font_scale_pct: 100,
    header_line_gap_px: 2,
    header_line_style: 'double',
    header_line_top_gap_px: 8,
    header_line_bottom_gap_px: 12,
    kop_elements: cloneKopElements(DEFAULT_KOP_ELEMENTS),
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

  let currentSettings = Object.assign({}, DEFAULTS, { kop_elements: cloneKopElements(DEFAULT_KOP_ELEMENTS) });
  const assetDataCache = {}; // url -> dataUrl
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

  function clampNum(val, min, max, fallback) {
    if (val === undefined || val === null || val === '') return fallback;
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function clampFloat(val, min, max, fallback) {
    if (val === undefined || val === null || val === '') return fallback;
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function fontStackFor(name) {
    switch (String(name || 'Plus Jakarta Sans')) {
      case 'Times New Roman': return '"Times New Roman", Times, Georgia, serif';
      case 'Playfair Display': return '"Playfair Display", Georgia, serif';
      case 'Montserrat': return '"Montserrat", "Plus Jakarta Sans", Arial, sans-serif';
      case 'Poppins': return '"Poppins", "Plus Jakarta Sans", Arial, sans-serif';
      case 'Inter': return '"Inter", "Segoe UI", Arial, sans-serif';
      case 'Arial': return 'Arial, Helvetica, sans-serif';
      default: return '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    }
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
    } catch (_) {}
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
    const merged = Object.assign({}, DEFAULTS, currentSettings, override || {});
    merged.kop_elements = cloneKopElements(
      (override && override.kop_elements) || (currentSettings && currentSettings.kop_elements) || DEFAULT_KOP_ELEMENTS
    );
    return merged;
  }

  function setSettings(next) {
    const merged = Object.assign({}, DEFAULTS, currentSettings, next || {});
    merged.kop_elements = cloneKopElements(
      (next && next.kop_elements) || currentSettings.kop_elements || DEFAULT_KOP_ELEMENTS
    );
    currentSettings = merged;
    preloadAssets(currentSettings);
    ensureInlinePrintStyles();
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent('simata:print-settings-updated', { detail: getMergedSettings() }));
      }
    } catch (_) {}
    return getMergedSettings();
  }

  async function loadSettings() {
    try {
      preloadAssets();
      if (window.simataClient && typeof window.simataClient.getPrintSettings === 'function') {
        const res = await window.simataClient.getPrintSettings();
        if (res && res.success && res.data) {
          setSettings(res.data);
          return getMergedSettings();
        }
      }
    } catch (err) {
      console.warn('[SIMATA PRINT] Using default print settings:', err && err.message ? err.message : err);
    }
    ensureInlinePrintStyles();
    return getMergedSettings();
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
    if (verifyUrl) return verifyUrl.slice(0, 260);
    const code = computeVerificationCode(docTitle, cfg);
    const parts = [
      'TTE MA At-Taujih (70033117)',
      'Kode: ' + code,
      'Oleh: ' + String(cfg.principal_name || DEFAULTS.principal_name).slice(0, 48),
      'Dok: ' + String(docTitle || 'Dokumen Resmi SIMATA').slice(0, 48)
    ];
    if (dateLabel) parts.push('Tgl: ' + String(dateLabel).slice(0, 24));
    return parts.join('\n');
  }

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
          } catch (_) {}
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
        } catch (_) {}
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

  function renderKopDividerHtml(lineStyle, topGapPx, bottomGapPx, divCfg, studioAttr, isSelected) {
    const color = (divCfg && divCfg.color) || '#0f172a';
    const thick = clampNum(divCfg && divCfg.thickness_px, 1, 6, 3);
    const selCls = isSelected ? ' is-studio-selected' : '';
    const mt = topGapPx;
    const mb = bottomGapPx;

    if (lineStyle === 'none') {
      return '<div class="simata-kop-divider' + selCls + '"' + (studioAttr || '') + ' style="height:2px;border-bottom:1px dashed transparent;margin-top:' + mt + 'px;margin-bottom:' + mb + 'px;"></div>';
    }
    if (lineStyle === 'thick_thin') {
      const topW = Math.max(2, thick);
      return '<div class="simata-kop-divider' + selCls + '"' + (studioAttr || '') + ' style="border-top:' + topW + 'px solid ' + esc(color) + ';border-bottom:1px solid ' + esc(color) + ';height:3px;margin-top:' + mt + 'px;margin-bottom:' + mb + 'px;"></div>';
    }
    if (lineStyle === 'solid') {
      return '<div class="simata-kop-divider' + selCls + '"' + (studioAttr || '') + ' style="border-bottom:' + thick + 'px solid ' + esc(color) + ';height:0;margin-top:' + mt + 'px;margin-bottom:' + mb + 'px;"></div>';
    }
    const doubleW = Math.max(3, thick);
    return '<div class="simata-kop-divider' + selCls + '"' + (studioAttr || '') + ' style="border-bottom:' + doubleW + 'px double ' + esc(color) + ';height:0;margin-top:' + mt + 'px;margin-bottom:' + mb + 'px;"></div>';
  }

  function buildTextLineStyle(elCfg, k, fontScale) {
    const e = elCfg || {};
    const sizePt = (clampFloat(e.font_size_pt, 6, 26, 9) * k * fontScale).toFixed(2);
    const weight = clampNum(e.font_weight, 300, 900, 400);
    const ls = clampFloat(e.letter_spacing_px, -1, 10, 0).toFixed(1);
    const ox = clampNum(e.offset_x, -120, 120, 0);
    const oy = clampNum(e.offset_y, -30, 30, 0);
    const parts = [
      'font-family:' + fontStackFor(e.font_family),
      'font-size:' + sizePt + 'pt',
      'font-weight:' + weight,
      'font-style:' + (e.italic ? 'italic' : 'normal'),
      'text-transform:' + (e.uppercase ? 'uppercase' : 'none'),
      'letter-spacing:' + ls + 'px',
      'color:' + esc(e.color || '#0f172a')
    ];
    if (ox !== 0 || oy !== 0) {
      parts.push('transform:translate(' + ox + 'px,' + oy + 'px)');
    }
    return parts.join(';') + ';';
  }

  function renderKopHtml(opts) {
    const o = opts || {};
    const cfg = getMergedSettings(o.cfg);
    const els = cloneKopElements(cfg.kop_elements);
    const compact = Boolean(o.compact);
    const interactive = Boolean(o.interactive);
    const selectedEl = interactive ? String(o.selectedEl || '') : '';
    const k = compact ? 0.88 : 1;

    const showLogo = cfg.show_logo !== false && Boolean(cfg.logo_url);
    const logoSrc = showLogo ? getCachedAssetSrc(cfg.logo_url, true) : '';

    const logoPx = Math.round(clampNum(cfg.logo_size_px, 40, 130, 64) * k);
    const gapPx = Math.round(clampNum(cfg.logo_text_gap_px, 4, 44, 14) * k);
    const logoOffsetX = clampNum(els.logo.offset_x !== undefined ? els.logo.offset_x : cfg.logo_offset_x_px, -60, 100, 0);
    const logoOffsetY = clampNum(els.logo.offset_y !== undefined ? els.logo.offset_y : cfg.logo_offset_y_px, -35, 35, 0);
    const textOffsetX = clampNum(cfg.header_offset_x_px, -120, 120, 0);
    const textOffsetY = clampNum(cfg.header_offset_y_px, -30, 30, 0);
    const fontScale = clampNum(cfg.header_font_scale_pct, 75, 140, 100) / 100;
    const lineGap = clampNum(cfg.header_line_gap_px, 0, 16, 2);
    const lineTopGap = clampNum(cfg.header_line_top_gap_px, 2, 30, 8);
    const lineBottomGap = clampNum(cfg.header_line_bottom_gap_px, 4, 34, 12);
    const kopAlign = cfg.kop_align || 'center_page';

    const textAlignCss = kopAlign === 'left' ? 'left' : 'center';
    let gridColsCss = 'minmax(0, 1fr)';
    if (showLogo) {
      gridColsCss = (kopAlign === 'center_page')
        ? (logoPx + 'px minmax(0, 1fr) ' + logoPx + 'px')
        : (logoPx + 'px minmax(0, 1fr)');
    }

    const attrFor = function (key) {
      return interactive ? (' data-kop-el="' + key + '"') : '';
    };
    const selClass = function (key) {
      return (interactive && selectedEl === key) ? ' is-studio-selected' : '';
    };

    const logoCellHtml = showLogo
      ? '<div class="simata-kop-logo' + selClass('logo') + '"' + attrFor('logo') +
          ' style="width:' + logoPx + 'px;height:' + logoPx + 'px;transform:translate(' + logoOffsetX + 'px,' + logoOffsetY + 'px);">' +
          '<img src="' + esc(logoSrc) + '" alt="Logo Madrasah" />' +
        '</div>'
      : '';
    const spacerCellHtml = (showLogo && kopAlign === 'center_page')
      ? '<div class="simata-kop-spacer" aria-hidden="true"></div>'
      : '';

    const foundHtml = cfg.foundation_name
      ? '<div class="simata-kop-found' + selClass('foundation') + '"' + attrFor('foundation') + ' style="' + buildTextLineStyle(els.foundation, k, fontScale) + '">' + esc(cfg.foundation_name) + '</div>'
      : '';
    const schoolHtml = '<div class="simata-kop-school' + selClass('school') + '"' + attrFor('school') + ' style="' + buildTextLineStyle(els.school, k, fontScale) + '">' + esc(cfg.school_name) + '</div>';
    const addrHtml = cfg.school_address
      ? '<div class="simata-kop-addr' + selClass('address') + '"' + attrFor('address') + ' style="' + buildTextLineStyle(els.address, k, fontScale) + '">' + esc(cfg.school_address) + '</div>'
      : '';
    const contactHtml = cfg.school_contact
      ? '<div class="simata-kop-contact' + selClass('contact') + '"' + attrFor('contact') + ' style="' + buildTextLineStyle(els.contact, k, fontScale) + '">' + esc(cfg.school_contact) + '</div>'
      : '';

    const dividerHtml = renderKopDividerHtml(
      cfg.header_line_style || 'double',
      lineTopGap,
      lineBottomGap,
      els.divider,
      attrFor('divider'),
      interactive && selectedEl === 'divider'
    );

    const docHeadHtml = o.title
      ? '<div class="simata-doc-title-wrap' + (compact ? ' is-compact' : '') + '">' +
          '<div class="simata-doc-title">' + esc(o.title) + '</div>' +
          (o.subtitle ? '<div class="simata-doc-subtitle">' + esc(o.subtitle) + '</div>' : '') +
        '</div>'
      : '';

    const centerTransform = (textOffsetX !== 0 || textOffsetY !== 0)
      ? 'transform:translate(' + textOffsetX + 'px,' + textOffsetY + 'px);'
      : '';

    return '<div class="simata-kop-wrap' + (compact ? ' is-compact' : '') + (interactive ? ' is-studio-interactive' : '') + '">' +
        '<div class="simata-kop" style="display:grid;grid-template-columns:' + gridColsCss + ';align-items:center;gap:' + gapPx + 'px;">' +
          logoCellHtml +
          '<div class="simata-kop-center' + selClass('global') + '" style="text-align:' + textAlignCss + ';display:flex;flex-direction:column;gap:' + lineGap + 'px;' + centerTransform + '">' +
            foundHtml +
            schoolHtml +
            addrHtml +
            contactHtml +
          '</div>' +
          spacerCellHtml +
        '</div>' +
        dividerHtml +
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
      '.simata-kop-wrap { width: 100%; margin: 0 0 10px 0; color: #0f172a; box-sizing: border-box; }',
      '.simata-kop-wrap * { box-sizing: border-box; }',
      '.simata-kop { width: 100%; }',
      '.simata-kop-logo { flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin: 0 auto; }',
      '.simata-kop-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }',
      '.simata-kop-spacer { width: 100%; min-height: 1px; }',
      '.simata-kop-center { min-width: 0; line-height: 1.24; color: #0f172a; }',
      '.simata-kop-divider { width: 100%; }',
      '.simata-kop-wrap.is-studio-interactive [data-kop-el] { cursor: pointer; border-radius: 4px; transition: outline-color 0.12s ease, background-color 0.12s ease; }',
      '.simata-kop-wrap.is-studio-interactive [data-kop-el]:hover { outline: 1.5px dashed rgba(22, 101, 52, 0.55); outline-offset: 2px; background: rgba(240, 253, 244, 0.55); }',
      '.simata-kop-wrap.is-studio-interactive .is-studio-selected { outline: 2px solid #166534 !important; outline-offset: 3px; background: rgba(220, 252, 231, 0.45); }',
      '.simata-doc-title-wrap { width: 100%; text-align: center; }',
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
    const fontLink = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Montserrat:wght@400;600;700;800&family=Playfair+Display:ital,wght@0,400..800;1,400..700&family=Plus+Jakarta+Sans:ital,wght@0,400..800;1,400..700&family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">';
    const html = '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Uji Cetak SIMATA</title>' +
      fontLink +
      '<style>' +
      getPageCss('portrait', cfg) +
      'body{font-family:"Plus Jakarta Sans",Arial,Helvetica,sans-serif;margin:20px;color:#0f172a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
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
      esc(cfg.default_paper_size) + '</strong>, margin <strong>' + esc(cfg.margin_mm) + ' mm</strong>, logo <strong>' + esc(cfg.logo_size_px) + ' px</strong>, dan mode tanda tangan <strong>' + esc(String(cfg.signature_mode || 'qr').toUpperCase()) + '</strong>.</p>' +
      '<table><thead><tr><th style="width:45px;text-align:center;">No</th><th>Uraian Pengaturan</th><th>Nilai Aktif</th></tr></thead>' +
      '<tbody>' +
        '<tr><td style="text-align:center;">1</td><td>Logo &amp; Tata Letak Kop</td><td>' + (cfg.show_logo ? ('Logo ' + esc(cfg.logo_size_px) + 'px') : 'Logo disembunyikan') + ' &bull; ' + esc(cfg.kop_align) + ' &bull; Skala ' + esc(cfg.header_font_scale_pct) + '%</td></tr>' +
        '<tr><td style="text-align:center;">2</td><td>Pejabat Penandatangan</td><td>' + esc(cfg.principal_name) + '</td></tr>' +
        '<tr><td style="text-align:center;">3</td><td>Model Tanda Tangan</td><td>' + esc(cfg.signature_mode) + ' (' + esc(cfg.qr_style) + ')</td></tr>' +
      '</tbody></table>' +
      '<div class="sig-wrap">' +
        renderPrincipalSigHtml({ docTitle: 'Uji Cetak Dokumen Resmi SIMATA', showCityDate: true, cfg: cfg }) +
      '</div>' +
      renderPrintFooterHtml(cfg) +
      '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<' + '/script></body></html>';
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  window.SimataPrint = {
    DEFAULTS: DEFAULTS,
    DEFAULT_KOP_ELEMENTS: DEFAULT_KOP_ELEMENTS,
    cloneKopElements: cloneKopElements,
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
