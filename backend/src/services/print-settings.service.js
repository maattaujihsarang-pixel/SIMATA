const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const { BadRequestError } = require('../errors');

const KEY_PRINT_SETTINGS = 'simata_print_settings';
const KEY_PORTAL_SETTINGS = 'grades_portal_settings';

const VALID_SIGNATURE_MODES = new Set(['qr', 'qr_stamp', 'physical', 'blank']);
const VALID_QR_STYLES = new Set(['tte_compact', 'qr_only_crest']);
const VALID_PAPER_SIZES = new Set(['A4', 'F4']);
const VALID_KOP_ALIGNS = new Set(['center_page', 'center_remain', 'left']);
const VALID_HEADER_FONTS = new Set(['sans', 'serif']);
const VALID_LINE_STYLES = new Set(['double', 'solid', 'thick_thin', 'none']);
const VALID_FONT_FAMILIES = new Set([
  'Plus Jakarta Sans',
  'Times New Roman',
  'Inter',
  'Poppins',
  'Montserrat',
  'Playfair Display',
  'Arial'
]);
const VALID_FONT_WEIGHTS = new Set([300, 400, 500, 600, 700, 800, 900]);

const DEFAULT_KOP_ELEMENTS = {
  logo: {
    offset_x: 0,
    offset_y: 0
  },
  foundation: {
    font_family: 'Plus Jakarta Sans',
    font_size_pt: 8.8,
    font_size_pt: 8.5,
    font_weight: 700,
    italic: false,
    uppercase: true,
    letter_spacing_px: 0.6,
    letter_spacing_px: 0.4,
    color: '#334155',
    offset_x: 0,
    offset_y: 0
  },
  school: {
    font_family: 'Plus Jakarta Sans',
    font_size_pt: 13.8,
    font_size_pt: 13.5,
    font_weight: 800,
    italic: false,
    uppercase: true,
    letter_spacing_px: 0.4,
    letter_spacing_px: 0.3,
    color: '#0f172a',
    offset_x: 0,
    offset_y: 0
  },
  address: {
    font_family: 'Plus Jakarta Sans',
    font_size_pt: 8.2,
    font_size_pt: 8,
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
    font_size_pt: 8,
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

const DEFAULT_PRINT_SETTINGS = {
  show_logo: true,
  logo_url: '/assets/logo.png',
  foundation_name: 'YAYASAN MUWAJJIHUL ULUM ASY-SYARIYYAH',
  school_name: 'MADRASAH ALIYAH AT-TAUJIH SARANG',
  school_address: 'Dk. Pulorejo, Desa Bajingjowo, Kec. Sarang, Kab. Rembang, Jawa Tengah (59274)',
  school_contact: 'NSM: 131233170020 \u2022 NPSN: 70033117 \u2022 Email: maattaujihsarang@gmail.com',
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
  header_line_gap_px: 1,
  header_line_style: 'double',
  header_line_top_gap_px: 8,
  header_line_bottom_gap_px: 12,
  header_line_top_gap_px: 7,
  header_line_bottom_gap_px: 10,
  kop_elements: DEFAULT_KOP_ELEMENTS,
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

function safeParseJson(str, fallback = {}) {
  if (!str) return fallback;
  try {
    const parsed = typeof str === 'string' ? JSON.parse(str) : str;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function cleanStr(val, maxLen, fallback = '') {
  if (val === undefined || val === null) return fallback;
  return String(val).trim().slice(0, maxLen);
}

function clampInt(val, min, max, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(val, min, max, decimals, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  const factor = Math.pow(10, decimals);
  return Math.round(clamped * factor) / factor;
}

function sanitizeHexColor(val, fallback) {
  const s = String(val || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return fallback;
}

function sanitizeTextElement(rawEl, baseEl) {
  const src = (rawEl && typeof rawEl === 'object') ? rawEl : {};
  const fam = VALID_FONT_FAMILIES.has(src.font_family) ? src.font_family : baseEl.font_family;
  const wNum = Number(src.font_weight);
  const weight = VALID_FONT_WEIGHTS.has(wNum) ? wNum : baseEl.font_weight;
  return {
    font_family: fam,
    font_size_pt: clampFloat(src.font_size_pt, 6, 26, 1, baseEl.font_size_pt),
    font_weight: weight,
    italic: src.italic === undefined ? baseEl.italic : Boolean(src.italic),
    uppercase: src.uppercase === undefined ? baseEl.uppercase : Boolean(src.uppercase),
    letter_spacing_px: clampFloat(src.letter_spacing_px, -1, 10, 1, baseEl.letter_spacing_px),
    color: sanitizeHexColor(src.color, baseEl.color),
    offset_x: clampInt(src.offset_x, -120, 120, baseEl.offset_x),
    offset_y: clampInt(src.offset_y, -30, 30, baseEl.offset_y)
  };
}

function sanitizeKopElements(rawEls, fallbackEls = DEFAULT_KOP_ELEMENTS) {
  const src = (rawEls && typeof rawEls === 'object') ? rawEls : {};
  const fb = fallbackEls || DEFAULT_KOP_ELEMENTS;
  const rawLogo = (src.logo && typeof src.logo === 'object') ? src.logo : {};
  const rawDiv = (src.divider && typeof src.divider === 'object') ? src.divider : {};
  return {
    logo: {
      offset_x: clampInt(rawLogo.offset_x, -60, 100, fb.logo.offset_x),
      offset_y: clampInt(rawLogo.offset_y, -35, 35, fb.logo.offset_y)
    },
    foundation: sanitizeTextElement(src.foundation, fb.foundation),
    school: sanitizeTextElement(src.school, fb.school),
    address: sanitizeTextElement(src.address, fb.address),
    contact: sanitizeTextElement(src.contact, fb.contact),
    divider: {
      color: sanitizeHexColor(rawDiv.color, fb.divider.color),
      thickness_px: clampInt(rawDiv.thickness_px, 1, 6, fb.divider.thickness_px)
    }
  };
}

function sanitizeImageRef(val, fallback) {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim();
  if (!s) return '';
  if (s.startsWith('/assets/')) return s.slice(0, 200);
  if (/^https?:\/\//i.test(s)) return s.slice(0, 500);
  if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i.test(s) && s.length <= 450000) {
    return s;
  }
  throw new BadRequestError('Format gambar cetak tidak valid (gunakan PNG/JPG/WebP maksimal ~300KB atau aset bawaan).');
}

class PrintSettingsService {
  async getPrintSettings() {
    let map = {};
    try {
      map = await attendanceEvidenceRepository.getSystemSettings([KEY_PRINT_SETTINGS, KEY_PORTAL_SETTINGS]);
    } catch (_) {
      map = {};
    }

    const raw = safeParseJson(map[KEY_PRINT_SETTINGS]?.setting_value, {});
    const portalRaw = safeParseJson(map[KEY_PORTAL_SETTINGS]?.setting_value, {});

    const fallbackPrincipal = cleanStr(portalRaw.principal_name, 150, DEFAULT_PRINT_SETTINGS.principal_name) || DEFAULT_PRINT_SETTINGS.principal_name;
    const kopElements = sanitizeKopElements(raw.kop_elements, DEFAULT_KOP_ELEMENTS);

    return {
      show_logo: raw.show_logo === undefined ? DEFAULT_PRINT_SETTINGS.show_logo : Boolean(raw.show_logo),
      logo_url: raw.logo_url !== undefined ? String(raw.logo_url || '').trim() : DEFAULT_PRINT_SETTINGS.logo_url,
      foundation_name: cleanStr(raw.foundation_name, 160, DEFAULT_PRINT_SETTINGS.foundation_name),
      school_name: cleanStr(raw.school_name, 160, DEFAULT_PRINT_SETTINGS.school_name) || DEFAULT_PRINT_SETTINGS.school_name,
      school_address: cleanStr(raw.school_address, 260, DEFAULT_PRINT_SETTINGS.school_address),
      school_contact: cleanStr(raw.school_contact, 200, DEFAULT_PRINT_SETTINGS.school_contact),
      kop_align: VALID_KOP_ALIGNS.has(raw.kop_align) ? raw.kop_align : DEFAULT_PRINT_SETTINGS.kop_align,
      header_font_family: VALID_HEADER_FONTS.has(raw.header_font_family) ? raw.header_font_family : DEFAULT_PRINT_SETTINGS.header_font_family,
      logo_size_px: clampInt(raw.logo_size_px, 40, 130, DEFAULT_PRINT_SETTINGS.logo_size_px),
      logo_text_gap_px: clampInt(raw.logo_text_gap_px, 4, 44, DEFAULT_PRINT_SETTINGS.logo_text_gap_px),
      logo_offset_x_px: clampInt(raw.logo_offset_x_px, -60, 100, kopElements.logo.offset_x),
      logo_offset_y_px: clampInt(raw.logo_offset_y_px, -35, 35, kopElements.logo.offset_y),
      header_offset_x_px: clampInt(raw.header_offset_x_px, -120, 120, DEFAULT_PRINT_SETTINGS.header_offset_x_px),
      header_offset_y_px: clampInt(raw.header_offset_y_px, -30, 30, DEFAULT_PRINT_SETTINGS.header_offset_y_px),
      header_font_scale_pct: clampInt(raw.header_font_scale_pct, 75, 140, DEFAULT_PRINT_SETTINGS.header_font_scale_pct),
      header_line_gap_px: clampInt(raw.header_line_gap_px, 0, 16, DEFAULT_PRINT_SETTINGS.header_line_gap_px),
      header_line_style: VALID_LINE_STYLES.has(raw.header_line_style) ? raw.header_line_style : DEFAULT_PRINT_SETTINGS.header_line_style,
      header_line_top_gap_px: clampInt(raw.header_line_top_gap_px, 2, 30, DEFAULT_PRINT_SETTINGS.header_line_top_gap_px),
      header_line_bottom_gap_px: clampInt(raw.header_line_bottom_gap_px, 4, 34, DEFAULT_PRINT_SETTINGS.header_line_bottom_gap_px),
      kop_elements: kopElements,
      principal_title: cleanStr(raw.principal_title, 100, DEFAULT_PRINT_SETTINGS.principal_title) || DEFAULT_PRINT_SETTINGS.principal_title,
      principal_name: cleanStr(raw.principal_name, 150, fallbackPrincipal) || fallbackPrincipal,
      principal_nip: cleanStr(raw.principal_nip, 80, DEFAULT_PRINT_SETTINGS.principal_nip),
      sign_city: cleanStr(raw.sign_city, 80, DEFAULT_PRINT_SETTINGS.sign_city) || DEFAULT_PRINT_SETTINGS.sign_city,
      signature_mode: VALID_SIGNATURE_MODES.has(raw.signature_mode) ? raw.signature_mode : DEFAULT_PRINT_SETTINGS.signature_mode,
      qr_style: VALID_QR_STYLES.has(raw.qr_style) ? raw.qr_style : DEFAULT_PRINT_SETTINGS.qr_style,
      qr_verify_url: cleanStr(raw.qr_verify_url, 300, DEFAULT_PRINT_SETTINGS.qr_verify_url),
      show_stamp: raw.show_stamp === undefined ? DEFAULT_PRINT_SETTINGS.show_stamp : Boolean(raw.show_stamp),
      signature_img: raw.signature_img !== undefined ? String(raw.signature_img || '').trim() : DEFAULT_PRINT_SETTINGS.signature_img,
      stamp_img: raw.stamp_img !== undefined ? String(raw.stamp_img || '').trim() : DEFAULT_PRINT_SETTINGS.stamp_img,
      default_paper_size: VALID_PAPER_SIZES.has(raw.default_paper_size) ? raw.default_paper_size : DEFAULT_PRINT_SETTINGS.default_paper_size,
      margin_mm: clampInt(raw.margin_mm, 6, 20, DEFAULT_PRINT_SETTINGS.margin_mm),
      show_print_timestamp: raw.show_print_timestamp === undefined ? DEFAULT_PRINT_SETTINGS.show_print_timestamp : Boolean(raw.show_print_timestamp),
      footer_note: cleanStr(raw.footer_note, 220, DEFAULT_PRINT_SETTINGS.footer_note)
    };
  }

  async updatePrintSettings(payload = {}, user = null) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestError('Payload pengaturan cetak tidak valid.');
    }

    const current = await this.getPrintSettings();

    const sigMode = payload.signature_mode !== undefined ? String(payload.signature_mode).trim() : current.signature_mode;
    if (!VALID_SIGNATURE_MODES.has(sigMode)) {
      throw new BadRequestError('Mode tanda tangan tidak valid (pilih qr, qr_stamp, physical, atau blank).');
    }

    const qrStyle = payload.qr_style !== undefined ? String(payload.qr_style).trim() : current.qr_style;
    if (!VALID_QR_STYLES.has(qrStyle)) {
      throw new BadRequestError('Model QR tidak valid (pilih tte_compact atau qr_only_crest).');
    }

    const paperSize = payload.default_paper_size !== undefined ? String(payload.default_paper_size).trim().toUpperCase() : current.default_paper_size;
    if (!VALID_PAPER_SIZES.has(paperSize)) {
      throw new BadRequestError('Ukuran kertas tidak valid (pilih A4 atau F4).');
    }

    const kopAlign = payload.kop_align !== undefined ? String(payload.kop_align).trim() : current.kop_align;
    if (!VALID_KOP_ALIGNS.has(kopAlign)) {
      throw new BadRequestError('Perataan header tidak valid (pilih center_page, center_remain, atau left).');
    }

    const headerFont = payload.header_font_family !== undefined ? String(payload.header_font_family).trim() : current.header_font_family;
    if (!VALID_HEADER_FONTS.has(headerFont)) {
      throw new BadRequestError('Jenis font header tidak valid (pilih sans atau serif).');
    }

    const lineStyle = payload.header_line_style !== undefined ? String(payload.header_line_style).trim() : current.header_line_style;
    if (!VALID_LINE_STYLES.has(lineStyle)) {
      throw new BadRequestError('Gaya garis header tidak valid.');
    }

    let verifyUrl = payload.qr_verify_url !== undefined ? cleanStr(payload.qr_verify_url, 300, '') : current.qr_verify_url;
    if (verifyUrl && !/^https?:\/\//i.test(verifyUrl)) {
      verifyUrl = 'https://' + verifyUrl;
    }

    const kopElements = payload.kop_elements !== undefined
      ? sanitizeKopElements(payload.kop_elements, current.kop_elements)
      : current.kop_elements;

    const logoOffX = payload.logo_offset_x_px !== undefined
      ? clampInt(payload.logo_offset_x_px, -60, 100, current.logo_offset_x_px)
      : kopElements.logo.offset_x;
    const logoOffY = payload.logo_offset_y_px !== undefined
      ? clampInt(payload.logo_offset_y_px, -35, 35, current.logo_offset_y_px)
      : kopElements.logo.offset_y;
    kopElements.logo.offset_x = logoOffX;
    kopElements.logo.offset_y = logoOffY;

    const next = {
      show_logo: payload.show_logo !== undefined ? Boolean(payload.show_logo) : current.show_logo,
      logo_url: sanitizeImageRef(payload.logo_url, current.logo_url),
      foundation_name: payload.foundation_name !== undefined ? cleanStr(payload.foundation_name, 160, '') : current.foundation_name,
      school_name: payload.school_name !== undefined ? (cleanStr(payload.school_name, 160, '') || DEFAULT_PRINT_SETTINGS.school_name) : current.school_name,
      school_address: payload.school_address !== undefined ? cleanStr(payload.school_address, 260, '') : current.school_address,
      school_contact: payload.school_contact !== undefined ? cleanStr(payload.school_contact, 200, '') : current.school_contact,
      kop_align: kopAlign,
      header_font_family: headerFont,
      logo_size_px: clampInt(payload.logo_size_px, 40, 130, current.logo_size_px),
      logo_text_gap_px: clampInt(payload.logo_text_gap_px, 4, 44, current.logo_text_gap_px),
      logo_offset_x_px: logoOffX,
      logo_offset_y_px: logoOffY,
      header_offset_x_px: clampInt(payload.header_offset_x_px, -120, 120, current.header_offset_x_px),
      header_offset_y_px: clampInt(payload.header_offset_y_px, -30, 30, current.header_offset_y_px),
      header_font_scale_pct: clampInt(payload.header_font_scale_pct, 75, 140, current.header_font_scale_pct),
      header_line_gap_px: clampInt(payload.header_line_gap_px, 0, 16, current.header_line_gap_px),
      header_line_style: lineStyle,
      header_line_top_gap_px: clampInt(payload.header_line_top_gap_px, 2, 30, current.header_line_top_gap_px),
      header_line_bottom_gap_px: clampInt(payload.header_line_bottom_gap_px, 4, 34, current.header_line_bottom_gap_px),
      kop_elements: kopElements,
      principal_title: payload.principal_title !== undefined ? (cleanStr(payload.principal_title, 100, '') || DEFAULT_PRINT_SETTINGS.principal_title) : current.principal_title,
      principal_name: payload.principal_name !== undefined ? (cleanStr(payload.principal_name, 150, '') || DEFAULT_PRINT_SETTINGS.principal_name) : current.principal_name,
      principal_nip: payload.principal_nip !== undefined ? cleanStr(payload.principal_nip, 80, '') : current.principal_nip,
      sign_city: payload.sign_city !== undefined ? (cleanStr(payload.sign_city, 80, '') || DEFAULT_PRINT_SETTINGS.sign_city) : current.sign_city,
      signature_mode: sigMode,
      qr_style: qrStyle,
      qr_verify_url: verifyUrl.slice(0, 300),
      show_stamp: payload.show_stamp !== undefined ? Boolean(payload.show_stamp) : current.show_stamp,
      signature_img: sanitizeImageRef(payload.signature_img, current.signature_img),
      stamp_img: sanitizeImageRef(payload.stamp_img, current.stamp_img),
      default_paper_size: paperSize,
      margin_mm: clampInt(payload.margin_mm, 6, 20, current.margin_mm),
      show_print_timestamp: payload.show_print_timestamp !== undefined ? Boolean(payload.show_print_timestamp) : current.show_print_timestamp,
      footer_note: payload.footer_note !== undefined ? cleanStr(payload.footer_note, 220, '') : current.footer_note
    };

    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_PRINT_SETTINGS,
      JSON.stringify(next),
      'Pengaturan fleksibel kop surat, logo, ukuran kertas, & tanda tangan Kepala Madrasah SIMATA',
      user?.user_id || null
    );

    // Sync principal_name into grades_portal_settings when present so Menu Nilai stays consistent
    try {
      const pMap = await attendanceEvidenceRepository.getSystemSettings([KEY_PORTAL_SETTINGS]);
      const pRaw = safeParseJson(pMap[KEY_PORTAL_SETTINGS]?.setting_value, null);
      if (pRaw && typeof pRaw === 'object') {
        pRaw.principal_name = next.principal_name;
        await attendanceEvidenceRepository.upsertSystemSetting(
          KEY_PORTAL_SETTINGS,
          JSON.stringify(pRaw),
          null,
          user?.user_id || null
        );
      }
    } catch (_) {}

    return next;
  }
}

module.exports = new PrintSettingsService();
module.exports.DEFAULT_PRINT_SETTINGS = DEFAULT_PRINT_SETTINGS;
module.exports.DEFAULT_KOP_ELEMENTS = DEFAULT_KOP_ELEMENTS;
