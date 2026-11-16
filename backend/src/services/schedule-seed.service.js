/**
 * Official MA At-Taujih Sarang Schedule Seed & Canonical Timetable Metadata
 * Source: JADWAL_MA_AT-TAUJIH_GANJIL_THN_AJARAN_2026,2027 (user-verified)
 * Notes:
 * - Active days: Sabtu (6), Ahad (0), Senin (1), Selasa (2), Rabu (3), Kamis (4). Jumat off.
 * - PB = Pembelajaran Bahasa (compulsory non-KBM language program; no subject teacher assigned)
 * - Senin Jam ke-2 Kelas XI populated with PB (confirmed by user)
 * - Default bell schedule runs 07:00 - 12:50 WIB with Istirahat 09:40 - 10:10
 */

const ACTIVE_DAYS = [
  { day_of_week: 6, code: 'SABTU', short_label: 'Sab', label: 'Sabtu' },
  { day_of_week: 0, code: 'AHAD', short_label: 'Ahd', label: 'Ahad' },
  { day_of_week: 1, code: 'SENIN', short_label: 'Sen', label: 'Senin' },
  { day_of_week: 2, code: 'SELASA', short_label: 'Sel', label: 'Selasa' },
  { day_of_week: 3, code: 'RABU', short_label: 'Rab', label: 'Rabu' },
  { day_of_week: 4, code: 'KAMIS', short_label: 'Kam', label: 'Kamis' }
];

const DEFAULT_PERIODS = [
  { sort_order: 1, period_number: 1, label: 'Jam ke-1', start_time: '07:00', end_time: '07:40', is_break: false },
  { sort_order: 2, period_number: 2, label: 'Jam ke-2', start_time: '07:40', end_time: '08:10', is_break: false },
  { sort_order: 3, period_number: 3, label: 'Jam ke-3', start_time: '08:10', end_time: '08:40', is_break: false },
  { sort_order: 4, period_number: 4, label: 'Jam ke-4', start_time: '08:40', end_time: '09:10', is_break: false },
  { sort_order: 5, period_number: 5, label: 'Jam ke-5', start_time: '09:10', end_time: '09:40', is_break: false },
  { sort_order: 6, period_number: null, label: 'Istirahat', start_time: '09:40', end_time: '10:10', is_break: true },
  { sort_order: 7, period_number: 6, label: 'Jam ke-6', start_time: '10:10', end_time: '10:40', is_break: false },
  { sort_order: 8, period_number: 7, label: 'Jam ke-7', start_time: '10:40', end_time: '11:10', is_break: false },
  { sort_order: 9, period_number: 8, label: 'Jam ke-8', start_time: '11:10', end_time: '11:40', is_break: false },
  { sort_order: 10, period_number: 9, label: 'Jam ke-9', start_time: '11:40', end_time: '12:10', is_break: false },
  { sort_order: 11, period_number: 10, label: 'Jam ke-10', start_time: '12:10', end_time: '12:50', is_break: false }
];

const DEFAULT_SUBJECTS = [
  { subject_id: 'SUBJ-FQ', code: 'FQ', name: 'Fiqih', category: 'KBM', color_tone: 'emerald' },
  { subject_id: 'SUBJ-SKI', code: 'SKI', name: 'Sejarah Kebudayaan Islam', category: 'KBM', color_tone: 'teal' },
  { subject_id: 'SUBJ-QH', code: 'QH', name: 'Al-Qur\'an Hadits', category: 'KBM', color_tone: 'emerald' },
  { subject_id: 'SUBJ-AA', code: 'A.A', name: 'Akidah Akhlak', category: 'KBM', color_tone: 'teal' },
  { subject_id: 'SUBJ-TAFSIR', code: 'TAFSIR', name: 'Tafsir', category: 'KBM', color_tone: 'emerald' },
  { subject_id: 'SUBJ-NHW', code: 'NHW', name: 'Nahwu', category: 'KBM', color_tone: 'indigo' },
  { subject_id: 'SUBJ-SRF', code: 'SRF', name: 'Shorof', category: 'KBM', color_tone: 'violet' },
  { subject_id: 'SUBJ-BA', code: 'B.A', name: 'Bahasa Arab', category: 'KBM', color_tone: 'indigo' },
  { subject_id: 'SUBJ-BINDO', code: 'B.INDO', name: 'Bahasa Indonesia', category: 'KBM', color_tone: 'sky' },
  { subject_id: 'SUBJ-BING', code: 'B.ING', name: 'Bahasa Inggris', category: 'KBM', color_tone: 'sky' },
  { subject_id: 'SUBJ-BJ', code: 'B.J', name: 'Bahasa Jawa', category: 'KBM', color_tone: 'amber' },
  { subject_id: 'SUBJ-MTK', code: 'MTK', name: 'Matematika', category: 'KBM', color_tone: 'rose' },
  { subject_id: 'SUBJ-KIMIA', code: 'KIMIA', name: 'Kimia', category: 'KBM', color_tone: 'violet' },
  { subject_id: 'SUBJ-FISIKA', code: 'FISIKA', name: 'Fisika', category: 'KBM', color_tone: 'indigo' },
  { subject_id: 'SUBJ-BIOLOGI', code: 'BIOLOGI', name: 'Biologi', category: 'KBM', color_tone: 'teal' },
  { subject_id: 'SUBJ-SOS', code: 'SOS', name: 'Sosiologi', category: 'KBM', color_tone: 'amber' },
  { subject_id: 'SUBJ-GEO', code: 'GEO', name: 'Geografi', category: 'KBM', color_tone: 'teal' },
  { subject_id: 'SUBJ-SJR', code: 'SJR', name: 'Sejarah', category: 'KBM', color_tone: 'amber' },
  { subject_id: 'SUBJ-EKO', code: 'EKO', name: 'Ekonomi', category: 'KBM', color_tone: 'emerald' },
  { subject_id: 'SUBJ-PKN', code: 'PKN', name: 'PPKn', category: 'KBM', color_tone: 'rose' },
  { subject_id: 'SUBJ-PKWU', code: 'PKWU', name: 'Prakarya & Kewirausahaan', category: 'KBM', color_tone: 'amber' },
  { subject_id: 'SUBJ-INF', code: 'INF', name: 'Informatika', category: 'KBM', color_tone: 'sky' },
  { subject_id: 'SUBJ-PJOK', code: 'PJOK', name: 'PJOK', category: 'KBM', color_tone: 'sky' },
  { subject_id: 'SUBJ-SBK', code: 'SBK', name: 'Seni Budaya', category: 'KBM', color_tone: 'violet' },
  { subject_id: 'SUBJ-PB', code: 'PB', name: 'Pembelajaran Bahasa (Pembina)', category: 'NON_KBM', color_tone: 'slate' },
  { subject_id: 'SUBJ-UPACARA', code: 'UPACARA', name: 'Upacara Bendera', category: 'NON_KBM', color_tone: 'slate' }
];

const SUBJECT_ALIAS_MAP = {
  'FQ': 'FQ',
  'F.Q': 'FQ',
  'FIQIH': 'FQ',
  'FIKIH': 'FQ',
  'SKI': 'SKI',
  'QH': 'QH',
  'Q.H': 'QH',
  'AA': 'A.A',
  'A.A': 'A.A',
  'AKIDAH': 'A.A',
  'AKIDAH AKHLAK': 'A.A',
  'TAFSIR': 'TAFSIR',
  'NHW': 'NHW',
  'NAHWU': 'NHW',
  'SRF': 'SRF',
  'SHOROF': 'SRF',
  'BA': 'B.A',
  'B.A': 'B.A',
  'BAHASA ARAB': 'B.A',
  'BI': 'B.INDO',
  'B.I': 'B.INDO',
  'B.INDO': 'B.INDO',
  'BINDO': 'B.INDO',
  'BAHASA INDONESIA': 'B.INDO',
  'BING': 'B.ING',
  'B.ING': 'B.ING',
  'BAHASA INGGRIS': 'B.ING',
  'BJ': 'B.J',
  'B.J': 'B.J',
  'BAHASA JAWA': 'B.J',
  'MTK': 'MTK',
  'MATEMATIKA': 'MTK',
  'KIMIA': 'KIMIA',
  'FISIKA': 'FISIKA',
  'BIOLOGI': 'BIOLOGI',
  'SOS': 'SOS',
  'SOSIOLOGI': 'SOS',
  'GEO': 'GEO',
  'GEOGRAFI': 'GEO',
  'SJR': 'SJR',
  'SEJARAH': 'SJR',
  'EKO': 'EKO',
  'EKONOMI': 'EKO',
  'PKN': 'PKN',
  'PPKN': 'PKN',
  'PKWU': 'PKWU',
  'INF': 'INF',
  'INFORMATIKA': 'INF',
  'PJOK': 'PJOK',
  'SBK': 'SBK',
  'SENI BUDAYA': 'SBK',
  'PB': 'PB',
  'PEMBELAJARAN BAHASA': 'PB',
  'UPACARA': 'UPACARA'
};

const TEACHER_CODE_CATALOG_2026 = [
  { code: 'A', names: ['MOCH. IQNAUL BADRIL FALAH, S.Ag', 'IQNAUL BADRIL FALAH'], weekly_jp: 17 },
  { code: 'B', names: ['YUYUN YULIANINGSIH, S.Sos', 'YUYUN YULIANINGSIH'], weekly_jp: 8 },
  { code: 'C', names: ['A. MUAFAQ, S.Pd', 'MUAFAQ', 'A MUAFAQ'], weekly_jp: 8 },
  { code: 'D', names: ['BELLATUL FAUZIYAH, S.Pd', 'BELLATUL FAUZIYAH'], weekly_jp: 8 },
  { code: 'E', names: ['UMI ASROH, S.Pd', 'UMI ASROH'], weekly_jp: 6 },
  { code: 'F', names: ['MUHAMMAD LUTFI, S.Ag', 'MUHAMMAD LUTFI', 'M LUTFI', 'LUTFI'], weekly_jp: 12 },
  { code: 'G', names: ['SAMSUL'], weekly_jp: 6 },
  { code: 'H', names: ['TSURRAYYA ROCHMANIA, S.E', 'TSURRAYYA ROCHMANIA', 'TSUROYAH ROCHMANIA', 'TSURAYYA'], weekly_jp: 16 },
  { code: 'I', names: ['FARIDATUN NI\'MAH, S.Pd', 'FARIDATUN NIMAH', 'FARIDATUN NI MAH'], weekly_jp: 12 },
  { code: 'J', names: ['MOCH. SOHIBUL MAHBUB, S.Ag', 'SOHIBUL MAHBUB'], weekly_jp: 12 },
  { code: 'K', names: ['ZUHAD AWWAB SYAHBANA', 'ZUHAD AWWAB'], weekly_jp: 4 },
  { code: 'L', names: ['NAQIYUHSADIQIN', 'NAQIYUH SADIQIN'], weekly_jp: 4 },
  { code: 'M', names: ['MOCH. SHOFIYUL ALBAB, S.H', 'SHOFIYUL ALBAB', 'SHOFYUL ALBAB'], weekly_jp: 6 },
  { code: 'N', names: ['WASIUL ULA, S.Ag', 'WASIUL ULA'], weekly_jp: 6 },
  { code: 'O', names: ['SITI DUROTUL BAIDHO, S.Pd', 'SITI DUROTUL BAIDHO', 'DUROTUL BAIDHO'], weekly_jp: 12 },
  { code: 'P', names: ['NAILATUL HIDAYAH'], weekly_jp: 6 },
  { code: 'Q', names: ['MUHAMMAD ALI MURTADLO', 'ALI MURTADLO'], weekly_jp: 6 },
  { code: 'R', names: ['MUHAMMAD MA\'RUF AMIN', 'MARUF AMIN', 'MA RUF AMIN'], weekly_jp: 6 },
  { code: 'S', names: ['MUHAMMAD KHOZINUL ASROR', 'KHOZINUL ASROR'], weekly_jp: 4 }
];

// Canonical 2026/2027 Semester Ganjil timetable per day_of_week -> period_number (1..10) -> level 10/11/12
// Tuple: [subjectCode, teacherCodeOrNull]
const SCHEDULE_GRID_2026_GANJIL = {
  // SABTU (6)
  6: {
    1: { 10: ['PB', null], 11: ['PB', null], 12: ['PB', null] },
    2: { 10: ['PKN', 'M'], 11: ['PKWU', 'H'], 12: ['PJOK', 'F'] },
    3: { 10: ['PKN', 'M'], 11: ['PKWU', 'H'], 12: ['PJOK', 'F'] },
    4: { 10: ['EKO', 'H'], 11: ['PJOK', 'F'], 12: ['B.ING', 'L'] },
    5: { 10: ['EKO', 'H'], 11: ['PJOK', 'F'], 12: ['B.ING', 'L'] },
    6: { 10: ['SKI', 'A'], 11: ['SJR', 'D'], 12: ['EKO', 'H'] },
    7: { 10: ['SKI', 'A'], 11: ['SJR', 'D'], 12: ['PKN', 'M'] },
    8: { 10: ['SRF', 'R'], 11: ['SJR', 'D'], 12: ['PKN', 'M'] },
    9: { 10: ['SJR', 'D'], 11: ['PKN', 'M'], 12: ['SRF', 'R'] },
    10: { 10: ['SJR', 'D'], 11: ['PKN', 'M'], 12: ['SRF', 'R'] }
  },
  // AHAD (0)
  0: {
    1: { 10: ['PB', null], 11: ['PB', null], 12: ['PB', null] },
    2: { 10: ['PJOK', 'F'], 11: ['MTK', 'I'], 12: ['B.A', 'K'] },
    3: { 10: ['PJOK', 'F'], 11: ['MTK', 'I'], 12: ['B.A', 'K'] },
    4: { 10: ['MTK', 'I'], 11: ['A.A', 'F'], 12: ['NHW', 'Q'] },
    5: { 10: ['MTK', 'I'], 11: ['A.A', 'F'], 12: ['NHW', 'Q'] },
    6: { 10: ['NHW', 'Q'], 11: ['EKO', 'H'], 12: ['QH', 'G'] },
    7: { 10: ['B.J', 'N'], 11: ['B.A', 'K'], 12: ['QH', 'G'] },
    8: { 10: ['B.J', 'N'], 11: ['B.A', 'K'], 12: ['EKO', 'H'] },
    9: { 10: ['B.ING', 'S'], 11: ['QH', 'G'], 12: ['EKO', 'H'] },
    10: { 10: ['B.ING', 'S'], 11: ['QH', 'G'], 12: ['EKO', 'H'] }
  },
  // SENIN (1) - XI jam ke-2 disempurnakan menjadi PB sesuai konfirmasi
  1: {
    1: { 10: ['UPACARA', null], 11: ['UPACARA', null], 12: ['UPACARA', null] },
    2: { 10: ['PB', null], 11: ['PB', null], 12: ['PB', null] },
    3: { 10: ['KIMIA', 'E'], 11: ['FQ', 'A'], 12: ['INF', 'J'] },
    4: { 10: ['KIMIA', 'E'], 11: ['FQ', 'A'], 12: ['INF', 'J'] },
    5: { 10: ['A.A', 'F'], 11: ['INF', 'J'], 12: ['FQ', 'A'] },
    6: { 10: ['A.A', 'F'], 11: ['INF', 'J'], 12: ['FQ', 'A'] },
    7: { 10: ['FISIKA', 'E'], 11: ['MTK', 'I'], 12: ['B.J', 'N'] },
    8: { 10: ['FISIKA', 'E'], 11: ['MTK', 'I'], 12: ['B.J', 'N'] },
    9: { 10: ['INF', 'J'], 11: ['B.J', 'N'], 12: ['A.A', 'F'] },
    10: { 10: ['INF', 'J'], 11: ['B.J', 'N'], 12: ['A.A', 'F'] }
  },
  // SELASA (2)
  2: {
    1: { 10: ['PB', null], 11: ['PB', null], 12: ['PB', null] },
    2: { 10: ['B.INDO', 'O'], 11: ['SOS', 'B'], 12: ['TAFSIR', 'J'] },
    3: { 10: ['B.INDO', 'O'], 11: ['SOS', 'B'], 12: ['TAFSIR', 'J'] },
    4: { 10: ['SBK', 'P'], 11: ['TAFSIR', 'J'], 12: ['B.INDO', 'O'] },
    5: { 10: ['SBK', 'P'], 11: ['TAFSIR', 'J'], 12: ['B.INDO', 'O'] },
    6: { 10: ['TAFSIR', 'J'], 11: ['B.INDO', 'O'], 12: ['MTK', 'I'] },
    7: { 10: ['TAFSIR', 'J'], 11: ['B.INDO', 'O'], 12: ['MTK', 'I'] },
    8: { 10: ['FQ', 'A'], 11: ['GEO', 'C'], 12: ['SJR', 'D'] },
    9: { 10: ['FQ', 'A'], 11: ['GEO', 'C'], 12: ['SJR', 'D'] },
    10: { 10: ['FQ', 'A'], 11: ['GEO', 'C'], 12: ['SJR', 'D'] }
  },
  // RABU (3)
  3: {
    1: { 10: ['PB', null], 11: ['PB', null], 12: ['PB', null] },
    2: { 10: ['PKWU', 'H'], 11: ['SBK', 'P'], 12: ['SKI', 'A'] },
    3: { 10: ['PKWU', 'H'], 11: ['SBK', 'P'], 12: ['SKI', 'A'] },
    4: { 10: ['QH', 'G'], 11: ['EKO', 'H'], 12: ['SBK', 'P'] },
    5: { 10: ['QH', 'G'], 11: ['EKO', 'H'], 12: ['SBK', 'P'] },
    6: { 10: ['BIOLOGI', 'E'], 11: ['EKO', 'H'], 12: ['MTK', 'I'] },
    7: { 10: ['BIOLOGI', 'E'], 11: ['FQ', 'A'], 12: ['MTK', 'I'] },
    8: { 10: ['SRF', 'R'], 11: ['FQ', 'A'], 12: ['GEO', 'C'] },
    9: { 10: ['MTK', 'I'], 11: ['SRF', 'R'], 12: ['GEO', 'C'] },
    10: { 10: ['MTK', 'I'], 11: ['SRF', 'R'], 12: ['SOS', 'B'] }
  },
  // KAMIS (4)
  4: {
    1: { 10: ['PB', null], 11: ['PB', null], 12: ['PB', null] },
    2: { 10: ['SOS', 'B'], 11: ['B.ING', 'L'], 12: ['B.INDO', 'O'] },
    3: { 10: ['SOS', 'B'], 11: ['B.ING', 'L'], 12: ['B.INDO', 'O'] },
    4: { 10: ['B.INDO', 'O'], 11: ['SKI', 'A'], 12: ['PKWU', 'H'] },
    5: { 10: ['B.INDO', 'O'], 11: ['SKI', 'A'], 12: ['PKWU', 'H'] },
    6: { 10: ['B.A', 'S'], 11: ['B.INDO', 'O'], 12: ['SOS', 'B'] },
    7: { 10: ['B.A', 'S'], 11: ['B.INDO', 'O'], 12: ['SOS', 'B'] },
    8: { 10: ['NHW', 'Q'], 11: ['SOS', 'B'], 12: ['GEO', 'C'] },
    9: { 10: ['GEO', 'C'], 11: ['NHW', 'Q'], 12: ['FQ', 'A'] },
    10: { 10: ['GEO', 'C'], 11: ['NHW', 'Q'], 12: ['FQ', 'A'] }
  }
};

function normalizePersonName(raw) {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .replace(/,?\s*(S\.AG|S\.PD|S\.SOS|S\.E|S\.H|M\.PD|M\.AG|S\.PSI|S\.KOM|S\.SI)\.?/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(MOCH|MOHAMMAD|MUHAMMAD|M)\b/g, 'M')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTeacherRow(teachers, candidateNames) {
  if (!Array.isArray(teachers) || teachers.length === 0) return null;

  // 1. Exact case-insensitive match first
  for (const cand of candidateNames) {
    const clean = String(cand).trim().toLowerCase();
    const exact = teachers.find((t) => String(t.name || '').trim().toLowerCase() === clean);
    if (exact) return exact;
  }

  // 2. Normalized name without academic titles
  for (const cand of candidateNames) {
    const normCand = normalizePersonName(cand);
    const normExact = teachers.find((t) => normalizePersonName(t.name) === normCand);
    if (normExact) return normExact;
  }

  // 3. Substring containment on meaningful tokens (handles spacing/spelling differences)
  for (const cand of candidateNames) {
    const normCand = normalizePersonName(cand);
    if (normCand.length < 4) continue;
    const partial = teachers.find((t) => {
      const nt = normalizePersonName(t.name);
      return nt.includes(normCand) || normCand.includes(nt);
    });
    if (partial) return partial;
  }

  // 4. Distinctive token overlap + character bigram similarity (handles spelling differences like Tsurayya/Tsuroyah)
  function diceSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigramsA = new Map();
    for (let i = 0; i < a.length - 1; i += 1) {
      const bg = a.slice(i, i + 2);
      bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
    }
    let overlap = 0;
    for (let i = 0; i < b.length - 1; i += 1) {
      const bg = b.slice(i, i + 2);
      const cnt = bigramsA.get(bg) || 0;
      if (cnt > 0) {
        overlap += 1;
        bigramsA.set(bg, cnt - 1);
      }
    }
    return (2 * overlap) / (a.length + b.length - 2);
  }

  let best = null;
  let bestScore = 0;
  for (const cand of candidateNames) {
    const normCand = normalizePersonName(cand);
    const candTokens = normCand.split(' ').filter((tok) => tok.length >= 3);
    const candTokenSet = new Set(candTokens);

    for (const t of teachers) {
      const normT = normalizePersonName(t.name);
      const tTokens = normT.split(' ').filter((tok) => tok.length >= 3);
      let hits = 0;
      let longestHit = 0;
      for (const tok of tTokens) {
        if (candTokenSet.has(tok)) {
          hits += 1;
          if (tok.length > longestHit) longestHit = tok.length;
        }
      }
      const sim = diceSimilarity(normCand, normT);
      const strongTokenMatch = hits >= Math.min(2, candTokenSet.size) || (hits === 1 && longestHit >= 6 && sim >= 0.6);
      const score = sim + (hits * 0.25);
      if ((strongTokenMatch || sim >= 0.72) && score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
  }
  return best;
}

function normalizeSubjectCode(rawCode) {
  if (!rawCode) return '';
  const upper = String(rawCode).trim().toUpperCase().replace(/\s+/g, ' ');
  return SUBJECT_ALIAS_MAP[upper] || upper;
}

async function ensureSubjectsSeeded(client, { overwrite = false } = {}) {
  for (const subj of DEFAULT_SUBJECTS) {
    await client.query(
      `INSERT INTO subjects (subject_id, code, name, category, color_tone, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (code) ${overwrite
         ? `DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, color_tone = EXCLUDED.color_tone`
         : `DO NOTHING`}`,
      [subj.subject_id, subj.code, subj.name, subj.category, subj.color_tone]
    );
  }
}

async function ensurePeriodsSeeded(client, academicYearId, semester) {
  const existing = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM schedule_periods WHERE academic_year_id = $1 AND semester = $2`,
    [academicYearId, semester]
  );
  if (Number(existing.rows[0]?.cnt || 0) > 0) return;

  for (const p of DEFAULT_PERIODS) {
    const id = `PRD-${academicYearId.replace(/[^0-9]/g, '')}-${semester}-${String(p.sort_order).padStart(2, '0')}`;
    await client.query(
      `INSERT INTO schedule_periods (period_config_id, academic_year_id, semester, sort_order, period_number, label, start_time, end_time, is_break)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (academic_year_id, semester, sort_order) DO NOTHING`,
      [id, academicYearId, semester, p.sort_order, p.period_number, p.label, p.start_time, p.end_time, p.is_break]
    );
  }
}

async function seedDefaultSchedule2026Ganjil(client, { academicYearId = '2026/2027', semester = 'GANJIL', overwrite = false } = {}) {
  await ensureSubjectsSeeded(client);
  await ensurePeriodsSeeded(client, academicYearId, semester);

  const subjRes = await client.query(`SELECT subject_id, code, category FROM subjects`);
  const subjectByCode = new Map(subjRes.rows.map((r) => [r.code.toUpperCase(), r]));

  const teacherRes = await client.query(`SELECT teacher_id, name, status, teaching_hours FROM teachers ORDER BY status ASC, name ASC`);
  const activeTeachers = teacherRes.rows.filter((t) => t.status === 'Active');
  const poolTeachers = activeTeachers.length > 0 ? activeTeachers : teacherRes.rows;

  const classRes = await client.query(
    `SELECT class_id, class_name, level, academic_year_id, status
     FROM classes
     WHERE level IN (10, 11, 12)
     ORDER BY CASE WHEN academic_year_id = $1 THEN 0 ELSE 1 END,
              CASE WHEN status = 'Active' THEN 0 ELSE 1 END,
              level ASC, class_name ASC`,
    [academicYearId]
  );

  const classByLevel = new Map();
  for (const cls of classRes.rows) {
    const lvl = Number(cls.level);
    if (!classByLevel.has(lvl)) classByLevel.set(lvl, cls);
  }

  // Match teacher short codes A..S cleanly
  const teacherByShortCode = new Map();
  const unmatchedTeachers = [];
  const usedTeacherIds = new Set();

  for (const item of TEACHER_CODE_CATALOG_2026) {
    const availablePool = poolTeachers.filter((t) => !usedTeacherIds.has(t.teacher_id));
    const matched = matchTeacherRow(availablePool, item.names);
    if (matched) {
      usedTeacherIds.add(matched.teacher_id);
      teacherByShortCode.set(item.code, matched);
      await client.query(
        `INSERT INTO teacher_schedule_codes (academic_year_id, semester, teacher_id, short_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (academic_year_id, semester, teacher_id) DO UPDATE SET
           short_code = EXCLUDED.short_code,
           updated_at = CURRENT_TIMESTAMP`,
        [academicYearId, semester, matched.teacher_id, item.code]
      );
      if (!matched.teaching_hours || Number(matched.teaching_hours) === 0) {
        await client.query(
          `UPDATE teachers SET teaching_hours = $2 WHERE teacher_id = $1`,
          [matched.teacher_id, item.weekly_jp]
        );
      }
    } else {
      unmatchedTeachers.push(item.code + ': ' + item.names[0]);
    }
  }

  if (overwrite) {
    await client.query(
      `DELETE FROM class_schedules WHERE academic_year_id = $1 AND semester = $2`,
      [academicYearId, semester]
    );
  }

  let insertedCount = 0;
  let kbmCount = 0;
  let nonKbmCount = 0;

  for (const [dayKey, periodsMap] of Object.entries(SCHEDULE_GRID_2026_GANJIL)) {
    const dayOfWeek = Number(dayKey);
    for (const [periodKey, levelMap] of Object.entries(periodsMap)) {
      const periodNumber = Number(periodKey);
      for (const [lvlKey, tuple] of Object.entries(levelMap)) {
        const level = Number(lvlKey);
        const cls = classByLevel.get(level);
        if (!cls) continue;

        const [subjCodeRaw, teacherShortCode] = tuple;
        const subj = subjectByCode.get(normalizeSubjectCode(subjCodeRaw));
        if (!subj) continue;

        const teacher = teacherShortCode ? teacherByShortCode.get(teacherShortCode) || null : null;
        const teacherId = subj.category === 'KBM' && teacher ? teacher.teacher_id : null;
        const scheduleId = `SCH-${academicYearId.replace(/[^0-9]/g, '')}-${semester}-${dayOfWeek}-P${periodNumber}-L${level}`;

        if (subj.category === 'KBM') kbmCount += 1;
        else nonKbmCount += 1;

        const res = await client.query(
          `INSERT INTO class_schedules (
             schedule_id, academic_year_id, semester, day_of_week, period_number,
             class_id, subject_id, teacher_id, note
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (academic_year_id, semester, day_of_week, period_number, class_id)
           ${overwrite
             ? `DO UPDATE SET subject_id = EXCLUDED.subject_id, teacher_id = EXCLUDED.teacher_id, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP`
             : `DO NOTHING`}`,
          [
            scheduleId,
            academicYearId,
            semester,
            dayOfWeek,
            periodNumber,
            cls.class_id,
            subj.subject_id,
            teacherId,
            subj.code === 'PB' ? 'Program Pembelajaran Bahasa Wajib (Pembina Bahasa)' : null
          ]
        );
        insertedCount += res.rowCount || 0;
      }
    }
  }

  return {
    academic_year_id: academicYearId,
    semester,
    matched_teachers: teacherByShortCode.size,
    unmatched_teachers: unmatchedTeachers,
    classes_mapped: classByLevel.size,
    kbm_slots_expected: kbmCount,
    non_kbm_slots_expected: nonKbmCount,
    rows_written: insertedCount
  };
}

module.exports = {
  ACTIVE_DAYS,
  DEFAULT_PERIODS,
  DEFAULT_SUBJECTS,
  TEACHER_CODE_CATALOG_2026,
  SCHEDULE_GRID_2026_GANJIL,
  normalizePersonName,
  normalizeSubjectCode,
  matchTeacherRow,
  ensureSubjectsSeeded,
  ensurePeriodsSeeded,
  seedDefaultSchedule2026Ganjil
};
