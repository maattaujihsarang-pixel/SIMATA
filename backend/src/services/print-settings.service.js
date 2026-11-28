const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const { BadRequestError } = require('../errors');

const KEY_PRINT_SETTINGS = 'simata_print_settings';
const KEY_PORTAL_SETTINGS = 'grades_portal_settings';

const VALID_SIGNATURE_MODES = new Set(['qr', 'qr_stamp', 'physical', 'blank']);
const VALID_QR_STYLES = new Set(['tte_compact', 'qr_only_crest']);
const VALID_PAPER_SIZES = new Set(['A4', 'F4']);

const DEFAULT_PRINT_SETTINGS = {
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
    const rawMargin = Number(raw.margin_mm);
    const marginMm = Number.isFinite(rawMargin) ? Math.min(20, Math.max(6, Math.round(rawMargin))) : DEFAULT_PRINT_SETTINGS.margin_mm;

    return {
      show_logo: raw.show_logo === undefined ? DEFAULT_PRINT_SETTINGS.show_logo : Boolean(raw.show_logo),
      logo_url: raw.logo_url !== undefined ? String(raw.logo_url || '').trim() : DEFAULT_PRINT_SETTINGS.logo_url,
      foundation_name: cleanStr(raw.foundation_name, 160, DEFAULT_PRINT_SETTINGS.foundation_name),
      school_name: cleanStr(raw.school_name, 160, DEFAULT_PRINT_SETTINGS.school_name) || DEFAULT_PRINT_SETTINGS.school_name,
      school_address: cleanStr(raw.school_address, 260, DEFAULT_PRINT_SETTINGS.school_address),
      school_contact: cleanStr(raw.school_contact, 200, DEFAULT_PRINT_SETTINGS.school_contact),
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
      margin_mm: marginMm,
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

    const rawMargin = payload.margin_mm !== undefined ? Number(payload.margin_mm) : current.margin_mm;
    const marginMm = Number.isFinite(rawMargin) ? Math.min(20, Math.max(6, Math.round(rawMargin))) : current.margin_mm;

    let verifyUrl = payload.qr_verify_url !== undefined ? cleanStr(payload.qr_verify_url, 300, '') : current.qr_verify_url;
    if (verifyUrl && !/^https?:\/\//i.test(verifyUrl)) {
      verifyUrl = 'https://' + verifyUrl;
    }

    const next = {
      show_logo: payload.show_logo !== undefined ? Boolean(payload.show_logo) : current.show_logo,
      logo_url: sanitizeImageRef(payload.logo_url, current.logo_url),
      foundation_name: payload.foundation_name !== undefined ? cleanStr(payload.foundation_name, 160, '') : current.foundation_name,
      school_name: payload.school_name !== undefined ? (cleanStr(payload.school_name, 160, '') || DEFAULT_PRINT_SETTINGS.school_name) : current.school_name,
      school_address: payload.school_address !== undefined ? cleanStr(payload.school_address, 260, '') : current.school_address,
      school_contact: payload.school_contact !== undefined ? cleanStr(payload.school_contact, 200, '') : current.school_contact,
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
      margin_mm: marginMm,
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
