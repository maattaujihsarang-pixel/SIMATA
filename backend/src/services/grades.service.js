const db = require('../config/database');
const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../errors');
const {
  ASSESSMENT_PERIODS,
  GRADE_SUBJECT_CATALOG,
  DEFAULT_SUBJECT_CODES_BY_LEVEL,
  DEFAULT_HOMEROOM_BY_LEVEL,
  ASTS_GANJIL_2026_SEED
} = require('./grades-asts-seed.data');

const KEY_PORTAL_SETTINGS = 'grades_portal_settings';

const DEFAULT_PORTAL_SETTINGS = {
  rdm_url: '',
  rdm_label: 'Portal Rapor Digital Madrasah (Kemenag)',
  principal_name: 'Moch. Iqnaul Badril Falah, S.Ag',
  default_kkm: 75,
  show_ranking_default: true
};

const SCHEDULE_TO_GRADE_CODE = {};
Object.values(GRADE_SUBJECT_CATALOG).forEach((item) => {
  SCHEDULE_TO_GRADE_CODE[item.code.toUpperCase()] = item.code;
  SCHEDULE_TO_GRADE_CODE[item.name.toUpperCase()] = item.code;
  (item.schedule_codes || []).forEach((sc) => {
    SCHEDULE_TO_GRADE_CODE[String(sc).toUpperCase()] = item.code;
  });
});

function parseScoreValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const cleaned = String(raw).trim().replace(',', '.');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new BadRequestError(`Nilai '${raw}' tidak valid. Masukkan angka 0 sampai 100.`);
  }
  return Math.round(num * 100) / 100;
}

function normalizeSubjectCode(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (SCHEDULE_TO_GRADE_CODE[s]) return SCHEDULE_TO_GRADE_CODE[s];
  if (s === 'B.INGGRIS' || s === 'BAHASA INGGRIS') return 'B.ING';
  if (s === 'BAHASA ARAB' || s === 'B.A') return 'B.ARAB';
  if (s === 'BAHASA JAWA' || s === 'B.J') return 'B.JAWA';
  if (s === 'AKIDAH AKHLAK' || s === 'A.A') return 'AA';
  if (s === 'SOSIOLOGI' || s === 'SOS') return 'SOSIO';
  if (s === 'NAHWU' || s === 'NHW') return 'NAHWU';
  if (s === 'SHOROF' || s === 'SRF') return 'SHOROF';
  if (s === 'PKN' || s === 'PPKN') return 'PPKN';
  return s.slice(0, 30);
}

function getPeriodMeta(code) {
  const clean = String(code || 'ASTS_GANJIL').trim().toUpperCase();
  return ASSESSMENT_PERIODS.find((p) => p.code === clean) || null;
}

function computePredicate(score, kkm = 75) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return { predicate: '-', label: 'Belum Diisi', is_tuntas: null };
  }
  const s = Number(score);
  const k = Number(kkm || 75);
  const step = Math.max(1, (100 - k) / 3);
  let predicate = 'D';
  let label = 'Perlu Bimbingan';
  if (s >= k + step * 2) {
    predicate = 'A';
    label = 'Sangat Baik';
  } else if (s >= k + step) {
    predicate = 'B';
    label = 'Baik';
  } else if (s >= k) {
    predicate = 'C';
    label = 'Cukup';
  }
  return {
    predicate,
    label,
    is_tuntas: s >= k
  };
}

function safeParseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

class GradesService {
  async getPortalSettings() {
    let map = {};
    try {
      map = await attendanceEvidenceRepository.getSystemSettings([KEY_PORTAL_SETTINGS]);
    } catch (_) {
      map = {};
    }
    const raw = safeParseJson(map[KEY_PORTAL_SETTINGS]?.setting_value, {});
    const kkmNum = Number(raw.default_kkm);
    return {
      rdm_url: String(raw.rdm_url || '').trim(),
      rdm_label: String(raw.rdm_label || DEFAULT_PORTAL_SETTINGS.rdm_label).trim(),
      principal_name: String(raw.principal_name || DEFAULT_PORTAL_SETTINGS.principal_name).trim(),
      default_kkm: Number.isFinite(kkmNum) && kkmNum >= 0 && kkmNum <= 100 ? kkmNum : DEFAULT_PORTAL_SETTINGS.default_kkm,
      show_ranking_default: raw.show_ranking_default === undefined ? true : Boolean(raw.show_ranking_default)
    };
  }

  async updatePortalSettings(payload = {}, user = null) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestError('Payload pengaturan portal nilai tidak valid.');
    }
    const current = await this.getPortalSettings();
    let rdmUrl = payload.rdm_url !== undefined ? String(payload.rdm_url || '').trim() : current.rdm_url;
    if (rdmUrl && !/^https?:\/\//i.test(rdmUrl)) {
      rdmUrl = 'https://' + rdmUrl;
    }
    const kkmVal = payload.default_kkm !== undefined ? parseScoreValue(payload.default_kkm) : current.default_kkm;
    const next = {
      rdm_url: rdmUrl.slice(0, 300),
      rdm_label: payload.rdm_label !== undefined
        ? (String(payload.rdm_label || '').trim().slice(0, 140) || DEFAULT_PORTAL_SETTINGS.rdm_label)
        : current.rdm_label,
      principal_name: payload.principal_name !== undefined
        ? (String(payload.principal_name || '').trim().slice(0, 150) || DEFAULT_PORTAL_SETTINGS.principal_name)
        : current.principal_name,
      default_kkm: kkmVal !== null ? kkmVal : current.default_kkm,
      show_ranking_default: payload.show_ranking_default !== undefined
        ? Boolean(payload.show_ranking_default)
        : current.show_ranking_default
    };

    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_PORTAL_SETTINGS,
      JSON.stringify(next),
      'Pengaturan portal RDM, Kepala Madrasah, & default KKM Menu Nilai (BUG 74)',
      user?.user_id || null
    );
    return next;
  }

  async resolveAcademicYear(requestedYearId) {
    const yearsRes = await db.query('SELECT academic_year_id, name, is_active FROM academic_years ORDER BY academic_year_id DESC');
    const rawYears = yearsRes.rows || [];

    const archMap = {};
    try {
      const archRes = await db.query(
        'SELECT academic_year_id, is_archived, archived_at, archive_note FROM grade_year_archives'
      );
      for (const a of archRes.rows || []) {
        archMap[a.academic_year_id] = a;
      }
    } catch (_) {}

    const statsMap = {};
    try {
      const statsRes = await db.query(
        `SELECT academic_year_id,
                COUNT(*)::int AS total_grades,
                COUNT(DISTINCT student_id)::int AS total_students,
                COUNT(DISTINCT class_id)::int AS total_classes
         FROM grades
         GROUP BY academic_year_id`
      );
      for (const st of statsRes.rows || []) {
        statsMap[st.academic_year_id] = st;
      }
    } catch (_) {}

    const allYears = rawYears.map((y) => {
      const arch = archMap[y.academic_year_id];
      const st = statsMap[y.academic_year_id];
      return {
        ...y,
        is_archived: Boolean(arch?.is_archived),
        archived_at: arch?.archived_at || null,
        archive_note: arch?.archive_note || null,
        total_grades: Number(st?.total_grades || 0),
        total_students: Number(st?.total_students || 0),
        total_classes: Number(st?.total_classes || 0)
      };
    });

    const active = allYears.find((y) => y.is_active) || allYears[0] || {
      academic_year_id: '2026/2027',
      name: 'Tahun Ajaran 2026/2027',
      is_active: true,
      is_archived: false,
      archived_at: null,
      archive_note: null,
      total_grades: 0,
      total_students: 0,
      total_classes: 0
    };
    const selected = requestedYearId
      ? (allYears.find((y) => y.academic_year_id === requestedYearId) || active)
      : active;
    return { allYears, activeYear: selected };
  }

  assertYearEditable(yearObj) {
    if (yearObj && yearObj.is_archived) {
      throw new ForbiddenError(
        `Tahun Ajaran ${yearObj.academic_year_id} berstatus Arsip (Terkunci). Admin dapat membuka kunci sementara jika diperlukan revisi.`
      );
    }
  }

  async listAcademicYearsWithArchiveStats() {
    const { allYears, activeYear } = await this.resolveAcademicYear();
    return { academic_years: allYears, active_academic_year: activeYear };
  }

  async createAcademicYear(payload = {}, user = null) {
    const rawId = String(payload.academic_year_id || '').trim();
    if (!/^\d{4}\/\d{4}$/.test(rawId)) {
      throw new BadRequestError('Format Tahun Ajaran harus YYYY/YYYY, contoh: 2027/2028.');
    }
    const [y1, y2] = rawId.split('/').map(Number);
    if (y2 !== y1 + 1) {
      throw new BadRequestError('Tahun Ajaran harus berurutan 1 tahun, contoh: 2027/2028.');
    }

    const existing = await db.query('SELECT academic_year_id FROM academic_years WHERE academic_year_id = $1', [rawId]);
    if (existing.rows && existing.rows.length > 0) {
      throw new ConflictError(`Tahun Ajaran ${rawId} sudah terdaftar.`);
    }

    const name = String(payload.name || `Tahun Ajaran ${rawId}`).trim().slice(0, 50);
    const setActive = payload.set_active !== false;
    const archivePrevious = Boolean(payload.archive_previous);
    const copyFromYear = payload.copy_subjects_from_year ? String(payload.copy_subjects_from_year).trim() : '';

    const prevRes = await db.query('SELECT academic_year_id FROM academic_years WHERE is_active = TRUE');
    const prevActiveIds = (prevRes.rows || []).map((r) => r.academic_year_id);

    let copiedConfigsCount = 0;

    await db.withTransaction(async (client) => {
      if (setActive) {
        await client.query('UPDATE academic_years SET is_active = FALSE WHERE is_active = TRUE');
      }

      await client.query(
        `INSERT INTO academic_years (academic_year_id, name, is_active, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [rawId, name, setActive, `${y1}-07-01`, `${y2}-06-30`]
      );

      if (archivePrevious && prevActiveIds.length > 0) {
        for (const prevId of prevActiveIds) {
          await client.query(
            `INSERT INTO grade_year_archives (academic_year_id, is_archived, archived_at, archived_by_user_id, archive_note, updated_at)
             VALUES ($1, TRUE, CURRENT_TIMESTAMP, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (academic_year_id) DO UPDATE
             SET is_archived = TRUE,
                 archived_at = CURRENT_TIMESTAMP,
                 archived_by_user_id = EXCLUDED.archived_by_user_id,
                 archive_note = COALESCE(EXCLUDED.archive_note, grade_year_archives.archive_note),
                 updated_at = CURRENT_TIMESTAMP`,
            [prevId, user?.user_id || null, `Diarsipkan otomatis saat pembukaan Tahun Ajaran ${rawId}`]
          );
        }
      }

      if (copyFromYear) {
        const srcRes = await client.query(
          `SELECT class_id, subject_code, subject_name, kkm, sort_order
           FROM grade_subject_configs
           WHERE academic_year_id = $1 AND is_active = TRUE
           ORDER BY class_id ASC, sort_order ASC`,
          [copyFromYear]
        );
        for (const cfg of srcRes.rows || []) {
          const newCfgId = `GSC-${rawId.replace('/', '')}-${cfg.class_id}-${cfg.subject_code}`.slice(0, 60);
          await client.query(
            `INSERT INTO grade_subject_configs (config_id, academic_year_id, class_id, subject_code, subject_name, kkm, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
             ON CONFLICT (academic_year_id, class_id, subject_code) DO NOTHING`,
            [newCfgId, rawId, cfg.class_id, cfg.subject_code, cfg.subject_name, Number(cfg.kkm || 75), cfg.sort_order]
          );
          copiedConfigsCount++;
        }
      }
    });

    const refreshed = await this.listAcademicYearsWithArchiveStats();
    return {
      created_year_id: rawId,
      copied_subject_configs: copiedConfigsCount,
      archived_previous_years: archivePrevious ? prevActiveIds : [],
      ...refreshed
    };
  }

  async setAcademicYearArchiveState(payload = {}, user = null) {
    const yearId = String(payload.academic_year_id || '').trim();
    if (!yearId) throw new BadRequestError('ID Tahun Ajaran wajib diisi.');
    const exists = await db.query('SELECT academic_year_id FROM academic_years WHERE academic_year_id = $1', [yearId]);
    if (!exists.rows || exists.rows.length === 0) {
      throw new NotFoundError(`Tahun Ajaran ${yearId} tidak ditemukan.`);
    }

    const isArchived = Boolean(payload.is_archived);
    const note = payload.archive_note !== undefined && payload.archive_note !== null
      ? String(payload.archive_note).trim().slice(0, 300)
      : (isArchived ? 'Diarsipkan & dikunci oleh Admin SIMATA' : null);

    await db.query(
      `INSERT INTO grade_year_archives (academic_year_id, is_archived, archived_at, archived_by_user_id, archive_note, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id) DO UPDATE
       SET is_archived = EXCLUDED.is_archived,
           archived_at = EXCLUDED.archived_at,
           archived_by_user_id = EXCLUDED.archived_by_user_id,
           archive_note = EXCLUDED.archive_note,
           updated_at = CURRENT_TIMESTAMP`,
      [yearId, isArchived, isArchived ? new Date().toISOString() : null, user?.user_id || null, note]
    );

    const refreshed = await this.listAcademicYearsWithArchiveStats();
    return { academic_year_id: yearId, is_archived: isArchived, ...refreshed };
  }

  async setActiveAcademicYear(payload = {}, user = null) {
    const yearId = String(payload.academic_year_id || '').trim();
    if (!yearId) throw new BadRequestError('ID Tahun Ajaran wajib diisi.');
    const exists = await db.query('SELECT academic_year_id FROM academic_years WHERE academic_year_id = $1', [yearId]);
    if (!exists.rows || exists.rows.length === 0) {
      throw new NotFoundError(`Tahun Ajaran ${yearId} tidak ditemukan.`);
    }

    await db.withTransaction(async (client) => {
      await client.query('UPDATE academic_years SET is_active = FALSE WHERE is_active = TRUE');
      await client.query('UPDATE academic_years SET is_active = TRUE WHERE academic_year_id = $1', [yearId]);
      // Ensure activated year is unlocked for active entry
      await client.query(
        `INSERT INTO grade_year_archives (academic_year_id, is_archived, archived_at, archived_by_user_id, archive_note, updated_at)
         VALUES ($1, FALSE, NULL, $2, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT (academic_year_id) DO UPDATE
         SET is_archived = FALSE, archived_at = NULL, updated_at = CURRENT_TIMESTAMP`,
        [yearId, user?.user_id || null]
      );
    });

    const refreshed = await this.listAcademicYearsWithArchiveStats();
    return { academic_year_id: yearId, is_active: true, ...refreshed };
  }

  async ensureClassSubjectConfigs(academicYearId, classRow, defaultKkm = 75) {
    const existingRes = await db.query(
      `SELECT config_id, academic_year_id, class_id, subject_code, subject_name, kkm, sort_order, is_active
       FROM grade_subject_configs
       WHERE academic_year_id = $1 AND class_id = $2
       ORDER BY sort_order ASC, subject_code ASC`,
      [academicYearId, classRow.class_id]
    );
    if (existingRes.rows && existingRes.rows.length > 0) {
      return existingRes.rows.filter((r) => r.is_active !== false);
    }

    const level = Number(classRow.level) || 10;
    const codes = DEFAULT_SUBJECT_CODES_BY_LEVEL[level] || DEFAULT_SUBJECT_CODES_BY_LEVEL[10];
    const inserted = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const meta = GRADE_SUBJECT_CATALOG[code] || { code, name: code };
      const cfgId = `GSC-${academicYearId.replace('/', '')}-${classRow.class_id}-${code}`.slice(0, 60);
      const sortOrder = i + 1;
      await db.query(
        `INSERT INTO grade_subject_configs (config_id, academic_year_id, class_id, subject_code, subject_name, kkm, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (academic_year_id, class_id, subject_code) DO NOTHING`,
        [cfgId, academicYearId, classRow.class_id, code, meta.name, defaultKkm, sortOrder]
      );
      inserted.push({
        config_id: cfgId,
        academic_year_id: academicYearId,
        class_id: classRow.class_id,
        subject_code: code,
        subject_name: meta.name,
        kkm: defaultKkm,
        sort_order: sortOrder,
        is_active: true
      });
    }
    return inserted;
  }

  async getTeacherScheduleAssignments(academicYearId, scheduleSemester, teacherId) {
    if (!teacherId) return [];
    const assignments = [];
    const seen = new Set();
    try {
      const schedRes = await db.query(
        `SELECT DISTINCT cs.class_id, s.code AS subject_code, s.name AS subject_name
         FROM class_schedules cs
         JOIN subjects s ON cs.subject_id = s.subject_id
         WHERE cs.academic_year_id = $1
           AND cs.semester = $2
           AND cs.teacher_id = $3
           AND s.category = 'KBM'`,
        [academicYearId, scheduleSemester || 'GANJIL', teacherId]
      );
      for (const r of schedRes.rows || []) {
        const gCode = normalizeSubjectCode(r.subject_code || r.subject_name);
        const key = `${r.class_id}|${gCode}`;
        if (gCode && !seen.has(key)) {
          seen.add(key);
          assignments.push({
            class_id: r.class_id,
            subject_code: gCode,
            subject_name: GRADE_SUBJECT_CATALOG[gCode]?.name || r.subject_name || gCode
          });
        }
      }
    } catch (_) {}

    if (assignments.length === 0) {
      try {
        const tRes = await db.query('SELECT subject FROM teachers WHERE teacher_id = $1', [teacherId]);
        const subjRaw = tRes.rows[0]?.subject || '';
        if (subjRaw) {
          subjRaw.split(/[,;/]+/).forEach((part) => {
            const gCode = normalizeSubjectCode(part);
            if (gCode && GRADE_SUBJECT_CATALOG[gCode]) {
              assignments.push({
                class_id: null,
                subject_code: gCode,
                subject_name: GRADE_SUBJECT_CATALOG[gCode].name
              });
            }
          });
        }
      } catch (_) {}
    }
    return assignments;
  }

  async getParentStudentIds(parentUserId) {
    const res = await db.query(
      `SELECT student_id FROM parent_student_mappings WHERE parent_user_id = $1`,
      [parentUserId]
    );
    return (res.rows || []).map((r) => r.student_id);
  }

  async getOverview(params = {}, user = null) {
    const roleUpper = String(user?.role || '').toUpperCase();
    const isAdmin = roleUpper === 'ADMIN';
    const isParent = roleUpper === 'ORANG_TUA';
    const viewerTeacherId = user?.teacher_id || null;

    const portalSettings = await this.getPortalSettings();
    const { allYears, activeYear } = await this.resolveAcademicYear(params.academic_year_id);
    const yearId = activeYear.academic_year_id;

    const periodMeta = getPeriodMeta(params.assessment_type) || ASSESSMENT_PERIODS[0];
    if (params.assessment_type && !getPeriodMeta(params.assessment_type)) {
      throw new BadRequestError(`Periode asesmen '${params.assessment_type}' tidak valid.`);
    }

    // Load active classes with homeroom teacher info
    const classesRes = await db.query(
      `SELECT c.class_id, c.class_name, c.level, c.academic_year_id, c.homeroom_teacher_id,
              t.name AS homeroom_teacher_name
       FROM classes c
       LEFT JOIN teachers t ON c.homeroom_teacher_id = t.teacher_id
       WHERE c.status = 'Active'
       ORDER BY c.level ASC, c.class_name ASC`
    );
    let classes = (classesRes.rows || []).map((c) => ({
      ...c,
      homeroom_teacher_name: c.homeroom_teacher_name || DEFAULT_HOMEROOM_BY_LEVEL[Number(c.level)] || '-'
    }));

    let parentAllowedStudentIds = null;
    if (isParent) {
      parentAllowedStudentIds = await this.getParentStudentIds(user.user_id);
      if (parentAllowedStudentIds.length > 0) {
        const stClassRes = await db.query(
          `SELECT DISTINCT class_id FROM students WHERE student_id = ANY($1)`,
          [parentAllowedStudentIds]
        );
        const allowedClassSet = new Set((stClassRes.rows || []).map((r) => r.class_id));
        classes = classes.filter((c) => allowedClassSet.has(c.class_id));
      } else {
        classes = [];
      }
    }

    // Ensure subject configs exist for all classes
    const configsByClass = {};
    for (const cls of classes) {
      configsByClass[cls.class_id] = await this.ensureClassSubjectConfigs(yearId, cls, portalSettings.default_kkm);
    }

    // Teacher soft-filter assignments
    const teacherAssignments = (!isParent && viewerTeacherId)
      ? await this.getTeacherScheduleAssignments(yearId, periodMeta.schedule_semester, viewerTeacherId)
      : [];

    // Choose selected class (soft-default to teacher's scheduled class if none explicitly passed)
    let selectedClass = null;
    if (params.class_id) {
      selectedClass = classes.find((c) => c.class_id === params.class_id) || null;
    }
    if (!selectedClass && teacherAssignments.length > 0) {
      const firstAssignedClassId = teacherAssignments.find((a) => a.class_id)?.class_id;
      if (firstAssignedClassId) {
        selectedClass = classes.find((c) => c.class_id === firstAssignedClassId) || null;
      }
    }
    if (!selectedClass && classes.length > 0) {
      selectedClass = classes[0];
    }

    // Publications across the 4 periods
    const pubRes = await db.query(
      `SELECT assessment_type, is_published, published_at
       FROM grade_period_publications
       WHERE academic_year_id = $1`,
      [yearId]
    );
    const pubMap = {};
    for (const p of pubRes.rows || []) {
      pubMap[p.assessment_type] = p;
    }

    // Period-level progress across the selected class (or all classes)
    const periodCountsRes = selectedClass
      ? await db.query(
          `SELECT assessment_type, COUNT(DISTINCT subject_code)::int AS subjects_with_scores, COUNT(*)::int AS filled_cells
           FROM grades
           WHERE academic_year_id = $1 AND class_id = $2
           GROUP BY assessment_type`,
          [yearId, selectedClass.class_id]
        )
      : { rows: [] };
    const pCountMap = {};
    for (const r of periodCountsRes.rows || []) {
      pCountMap[r.assessment_type] = r;
    }

    const selectedConfigs = selectedClass ? (configsByClass[selectedClass.class_id] || []) : [];
    const periods = ASSESSMENT_PERIODS.map((p) => {
      const pub = pubMap[p.code];
      const cnt = pCountMap[p.code] || { subjects_with_scores: 0, filled_cells: 0 };
      return {
        ...p,
        is_published: Boolean(pub?.is_published),
        published_at: pub?.published_at || null,
        completed_subjects: cnt.subjects_with_scores,
        total_subjects: selectedConfigs.length,
        filled_cells: cnt.filled_cells
      };
    });

    const isSelectedPeriodPublished = Boolean(pubMap[periodMeta.code]?.is_published);

    if (!selectedClass) {
      return {
        portal_settings: isParent ? { ...portalSettings, rdm_url: '' } : portalSettings,
        viewer: {
          user_id: user?.user_id || null,
          role: roleUpper,
          is_admin: isAdmin,
          is_parent: isParent,
          teacher_id: viewerTeacherId,
          teacher_assignments: teacherAssignments
        },
        academic_years: allYears,
        active_academic_year: activeYear,
        selected_period: { ...periodMeta, is_published: isSelectedPeriodPublished },
        periods,
        classes,
        selected_class: null,
        subjects: [],
        matrix: [],
        subject_averages: {},
        class_summary: { student_count: 0, class_average: 0, completed_subjects: 0, total_subjects: 0 }
      };
    }

    // Load students in selected class — preserve historical archive students (promoted/graduated) when present
    let students = [];
    const histRes = await db.query(
      `SELECT DISTINCT student_id
       FROM grades
       WHERE academic_year_id = $1 AND class_id = $2`,
      [yearId, selectedClass.class_id]
    );
    const historicalIds = (histRes.rows || []).map((r) => r.student_id).filter(Boolean);

    if (activeYear.is_archived && historicalIds.length > 0) {
      const histStudentsRes = await db.query(
        `SELECT s.student_id, s.class_id, s.name, s.gender, s.nis, s.nisn, s.status
         FROM students s
         WHERE s.student_id = ANY($1)
         ORDER BY s.student_id ASC, s.name ASC`,
        [historicalIds]
      );
      students = histStudentsRes.rows || [];
    } else {
      const studentsRes = await db.query(
        `SELECT s.student_id, s.class_id, s.name, s.gender, s.nis, s.nisn, s.status
         FROM students s
         WHERE s.class_id = $1 AND s.status = $2
         ORDER BY s.student_id ASC, s.name ASC`,
        [selectedClass.class_id, 'Active']
      );
      students = studentsRes.rows || [];
      const activeIdSet = new Set(students.map((s) => s.student_id));
      const missingHistoricalIds = historicalIds.filter((id) => !activeIdSet.has(id));
      if (missingHistoricalIds.length > 0) {
        const extraRes = await db.query(
          `SELECT s.student_id, s.class_id, s.name, s.gender, s.nis, s.nisn, s.status
           FROM students s
           WHERE s.student_id = ANY($1)
           ORDER BY s.student_id ASC, s.name ASC`,
          [missingHistoricalIds]
        );
        students = students.concat(extraRes.rows || []);
      }
    }

    // Preserve official Madrasah Excel ordering if seeded order matches this class
    const seedClass = ASTS_GANJIL_2026_SEED.classes.find((sc) => sc.class_id === selectedClass.class_id);
    if (seedClass) {
      const orderMap = new Map();
      seedClass.rows.forEach((r, idx) => orderMap.set(r.student_id, idx));
      students.sort((a, b) => {
        const ia = orderMap.has(a.student_id) ? orderMap.get(a.student_id) : 9999;
        const ib = orderMap.has(b.student_id) ? orderMap.get(b.student_id) : 9999;
        if (ia !== ib) return ia - ib;
        return String(a.name).localeCompare(String(b.name), 'id');
      });
    }

    // Load grades for selected class & period (unless Parent and period not published)
    const hideScoresForParent = isParent && !isSelectedPeriodPublished;
    const gradesRes = hideScoresForParent
      ? { rows: [] }
      : await db.query(
          `SELECT grade_id, student_id, subject_code, subject, score, remarks, updated_at
           FROM grades
           WHERE academic_year_id = $1 AND class_id = $2 AND assessment_type = $3`,
          [yearId, selectedClass.class_id, periodMeta.code]
        );

    const notesRes = hideScoresForParent
      ? { rows: [] }
      : await db.query(
          `SELECT student_id, homeroom_note
           FROM grade_student_notes
           WHERE academic_year_id = $1 AND assessment_type = $2`,
          [yearId, periodMeta.code]
        );
    const notesMap = {};
    for (const n of notesRes.rows || []) {
      notesMap[n.student_id] = n.homeroom_note || '';
    }

    // Attendance summary per student in this academic year
    const attRes = await db.query(
      `SELECT student_id, attendance_date, status
       FROM student_attendance
       WHERE academic_year_id = $1 AND class_id = $2`,
      [yearId, selectedClass.class_id]
    );
    const attByStudent = {};
    for (const row of attRes.rows || []) {
      if (!attByStudent[row.student_id]) {
        attByStudent[row.student_id] = new Map();
      }
      const dKey = String(row.attendance_date).slice(0, 10);
      const prev = attByStudent[row.student_id].get(dKey);
      // Daily worst/priority status aggregation consistent with Academic Reports
      const rankStatus = { Alpa: 4, Sakit: 3, Izin: 2, Hadir: 1 };
      if (!prev || (rankStatus[row.status] || 0) > (rankStatus[prev] || 0)) {
        attByStudent[row.student_id].set(dKey, row.status);
      }
    }

    const gradeMap = new Map();
    for (const g of gradesRes.rows || []) {
      const code = normalizeSubjectCode(g.subject_code || g.subject);
      gradeMap.set(`${g.student_id}|${code}`, {
        score: Number(g.score),
        remarks: g.remarks || '',
        updated_at: g.updated_at
      });
    }

    const kkmByCode = {};
    selectedConfigs.forEach((cfg) => {
      kkmByCode[cfg.subject_code] = Number(cfg.kkm || portalSettings.default_kkm || 75);
    });

    const totalSubjectCount = selectedConfigs.length;

    // Compute full class matrix first so rankings & class subject averages stay accurate
    const fullMatrix = students.map((st, idx) => {
      const scoresObj = {};
      let sum = 0;
      let filled = 0;
      let tuntasCount = 0;

      for (const cfg of selectedConfigs) {
        const entry = gradeMap.get(`${st.student_id}|${cfg.subject_code}`);
        const kkm = kkmByCode[cfg.subject_code];
        if (entry && entry.score !== null && entry.score !== undefined && !Number.isNaN(entry.score)) {
          const val = Math.round(Number(entry.score) * 100) / 100;
          const pred = computePredicate(val, kkm);
          sum += val;
          filled++;
          if (pred.is_tuntas) tuntasCount++;
          scoresObj[cfg.subject_code] = {
            score: val,
            remarks: entry.remarks || '',
            kkm,
            predicate: pred.predicate,
            predicate_label: pred.label,
            is_tuntas: pred.is_tuntas
          };
        } else {
          scoresObj[cfg.subject_code] = {
            score: null,
            remarks: '',
            kkm,
            predicate: '-',
            predicate_label: 'Belum Diisi',
            is_tuntas: null
          };
        }
      }

      const totalScore = Math.round(sum * 100) / 100;
      const avgScore = totalSubjectCount > 0 && filled > 0
        ? Math.round((totalScore / totalSubjectCount) * 100) / 100
        : 0;

      const dayMap = attByStudent[st.student_id];
      const attSummary = { hadir: 0, sakit: 0, izin: 0, alpa: 0, total_days: 0, hadir_pct: null };
      if (dayMap && dayMap.size > 0) {
        for (const stVal of dayMap.values()) {
          attSummary.total_days++;
          if (stVal === 'Hadir') attSummary.hadir++;
          else if (stVal === 'Sakit') attSummary.sakit++;
          else if (stVal === 'Izin') attSummary.izin++;
          else if (stVal === 'Alpa') attSummary.alpa++;
        }
        attSummary.hadir_pct = Math.round((attSummary.hadir / attSummary.total_days) * 1000) / 10;
      }

      return {
        row_no: idx + 1,
        student_id: st.student_id,
        nis: st.nis || '-',
        nisn: st.nisn || '-',
        name: st.name,
        gender: st.gender || null,
        scores: scoresObj,
        total_score: totalScore,
        average_score: avgScore,
        filled_subjects: filled,
        total_subjects: totalSubjectCount,
        tuntas_subjects: tuntasCount,
        homeroom_note: notesMap[st.student_id] || '',
        attendance: attSummary,
        rank: null
      };
    });

    // Competition ranking (1, 2, 3...; ties share exact same rank like 17,17,17 or 18,18,18,18)
    const anyScoresInClass = fullMatrix.some((r) => r.filled_subjects > 0);
    if (anyScoresInClass) {
      fullMatrix.forEach((row) => {
        const strictlyHigher = fullMatrix.filter((other) => other.total_score > row.total_score + 0.0001).length;
        row.rank = strictlyHigher + 1;
      });
    }

    // Subject-level stats & Madrasah bottom row (divides across all class students when filled, matching Madrasah Excel formula)
    const subjectAverages = {};
    let completedSubjectsCount = 0;
    const subjectsWithStats = selectedConfigs.map((cfg) => {
      const code = cfg.subject_code;
      const kkm = kkmByCode[code];
      let subSum = 0;
      let filledCount = 0;
      let tuntasCount = 0;
      let remedialCount = 0;
      const dist = { A: 0, B: 0, C: 0, D: 0 };

      for (const stRow of fullMatrix) {
        const cell = stRow.scores[code];
        if (cell && cell.score !== null) {
          subSum += cell.score;
          filledCount++;
          if (cell.is_tuntas) tuntasCount++;
          else remedialCount++;
          if (dist[cell.predicate] !== undefined) dist[cell.predicate]++;
        }
      }

      const isComplete = fullMatrix.length > 0 && filledCount >= fullMatrix.length;
      if (isComplete) completedSubjectsCount++;

      // Class average per subject follows Madrasah Excel formula: sum across class / student count when filled > 0
      const denom = fullMatrix.length > 0 ? fullMatrix.length : 1;
      const classSubjAvg = filledCount > 0 ? Math.round((subSum / denom) * 100) / 100 : null;
      subjectAverages[code] = classSubjAvg;

      const isAssignedToViewer = teacherAssignments.some(
        (a) => a.subject_code === code && (!a.class_id || a.class_id === selectedClass.class_id)
      );

      return {
        config_id: cfg.config_id,
        subject_code: code,
        subject_name: cfg.subject_name,
        kkm,
        sort_order: cfg.sort_order,
        is_my_subject: isAssignedToViewer,
        filled_count: filledCount,
        student_count: fullMatrix.length,
        is_complete: isComplete,
        avg_score: classSubjAvg,
        tuntas_count: tuntasCount,
        remedial_count: remedialCount,
        predicate_distribution: dist
      };
    });

    // Update periods array with exact completed_subjects for selected class
    const currentPeriodItem = periods.find((p) => p.code === periodMeta.code);
    if (currentPeriodItem) {
      currentPeriodItem.completed_subjects = completedSubjectsCount;
      currentPeriodItem.total_subjects = subjectsWithStats.length;
    }

    const visibleMatrix = isParent
      ? fullMatrix.filter((r) => parentAllowedStudentIds.includes(r.student_id))
      : fullMatrix;

    const studentCount = fullMatrix.length;
    const avgOfTotals = studentCount > 0 && anyScoresInClass
      ? Math.round((fullMatrix.reduce((acc, r) => acc + r.total_score, 0) / studentCount) * 100) / 100
      : 0;
    const avgOfAverages = studentCount > 0 && anyScoresInClass
      ? Math.round((fullMatrix.reduce((acc, r) => acc + r.average_score, 0) / studentCount) * 100) / 100
      : 0;
    const highestAvg = anyScoresInClass ? Math.max(...fullMatrix.map((r) => r.average_score)) : 0;

    return {
      portal_settings: isParent ? { ...portalSettings, rdm_url: '' } : portalSettings,
      viewer: {
        user_id: user?.user_id || null,
        role: roleUpper,
        is_admin: isAdmin,
        is_parent: isParent,
        teacher_id: viewerTeacherId,
        teacher_assignments: teacherAssignments
      },
      academic_years: allYears,
      active_academic_year: activeYear,
      is_year_archived: Boolean(activeYear.is_archived),
      year_grade_summary: {
        total_grades: Number(activeYear.total_grades || 0),
        total_students: Number(activeYear.total_students || 0),
        total_classes: Number(activeYear.total_classes || 0)
      },
      selected_period: {
        ...periodMeta,
        is_published: isSelectedPeriodPublished,
        published_at: pubMap[periodMeta.code]?.published_at || null
      },
      periods,
      classes,
      selected_class: selectedClass,
      subjects: subjectsWithStats,
      matrix: hideScoresForParent ? [] : visibleMatrix,
      parent_unpublished_notice: hideScoresForParent,
      subject_averages: hideScoresForParent ? {} : subjectAverages,
      class_summary: {
        student_count: studentCount,
        any_scores: anyScoresInClass && !hideScoresForParent,
        class_total_average: hideScoresForParent ? 0 : avgOfTotals,
        class_average: hideScoresForParent ? 0 : avgOfAverages,
        highest_average: hideScoresForParent ? 0 : highestAvg,
        completed_subjects: completedSubjectsCount,
        total_subjects: subjectsWithStats.length
      }
    };
  }

  async getStudentKhs(studentId, params = {}, user = null) {
    if (!studentId) throw new BadRequestError('ID Siswa wajib diisi.');
    const roleUpper = String(user?.role || '').toUpperCase();
    const isParent = roleUpper === 'ORANG_TUA';

    if (isParent) {
      const allowed = await this.getParentStudentIds(user.user_id);
      if (!allowed.includes(studentId)) {
        throw new ForbiddenError('Akses ditolak. Anda hanya dapat melihat nilai putra/putri Anda sendiri.');
      }
    }

    const stRes = await db.query(
      `SELECT s.student_id, s.name, s.nis, s.nisn, s.gender, s.class_id,
              c.class_name, c.level, c.homeroom_teacher_id, t.name AS homeroom_teacher_name
       FROM students s
       JOIN classes c ON s.class_id = c.class_id
       LEFT JOIN teachers t ON c.homeroom_teacher_id = t.teacher_id
       WHERE s.student_id = $1`,
      [studentId]
    );
    const student = stRes.rows[0];
    if (!student) throw new NotFoundError('Data siswa tidak ditemukan.');

    const overview = await this.getOverview(
      {
        academic_year_id: params.academic_year_id,
        assessment_type: params.assessment_type || 'ASTS_GANJIL',
        class_id: student.class_id
      },
      user
    );

    const yearId = overview.active_academic_year.academic_year_id;

    // Compute 4-period trend for this student across the academic year
    const pubRes = await db.query(
      `SELECT assessment_type, is_published FROM grade_period_publications WHERE academic_year_id = $1`,
      [yearId]
    );
    const pubSet = new Set((pubRes.rows || []).filter((p) => p.is_published).map((p) => p.assessment_type));

    const allStudentGradesRes = await db.query(
      `SELECT assessment_type, subject_code, score
       FROM grades
       WHERE academic_year_id = $1 AND student_id = $2`,
      [yearId, studentId]
    );
    const byPeriod = {};
    for (const r of allStudentGradesRes.rows || []) {
      if (isParent && !pubSet.has(r.assessment_type)) continue;
      if (!byPeriod[r.assessment_type]) byPeriod[r.assessment_type] = [];
      byPeriod[r.assessment_type].push(Number(r.score));
    }

    const subjCount = overview.subjects.length || 1;
    const trend = ASSESSMENT_PERIODS.map((p) => {
      const arr = byPeriod[p.code] || [];
      const sum = arr.reduce((a, b) => a + b, 0);
      const avg = arr.length > 0 ? Math.round((sum / subjCount) * 100) / 100 : null;
      return {
        code: p.code,
        short_label: p.short_label,
        full_label: p.full_label,
        is_published: pubSet.has(p.code),
        filled_subjects: arr.length,
        total_subjects: subjCount,
        total_score: arr.length > 0 ? Math.round(sum * 100) / 100 : null,
        average_score: avg
      };
    });

    const studentRow = (overview.matrix || []).find((r) => r.student_id === studentId) || null;

    return {
      student: {
        ...student,
        homeroom_teacher_name: student.homeroom_teacher_name || DEFAULT_HOMEROOM_BY_LEVEL[Number(student.level)] || '-'
      },
      academic_year: overview.active_academic_year,
      selected_period: overview.selected_period,
      portal_settings: overview.portal_settings,
      subjects: overview.subjects,
      subject_averages: overview.subject_averages,
      student_row: studentRow,
      class_student_count: overview.class_summary.student_count,
      parent_unpublished_notice: Boolean(overview.parent_unpublished_notice),
      trend
    };
  }

  async saveBatchGrades(payload = {}, user = null) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestError('Payload penyimpanan nilai tidak valid.');
    }
    const { activeYear } = await this.resolveAcademicYear(payload.academic_year_id);
    this.assertYearEditable(activeYear);
    const yearId = activeYear.academic_year_id;

    const periodMeta = getPeriodMeta(payload.assessment_type);
    if (!periodMeta) {
      throw new BadRequestError('Periode asesmen wajib dipilih (ASTS_GANJIL, ASAS_GANJIL, ASTS_GENAP, atau ASAS_GENAP).');
    }

    const classId = String(payload.class_id || '').trim();
    if (!classId) throw new BadRequestError('Kelas wajib dipilih.');

    const clsRes = await db.query('SELECT class_id, class_name, level FROM classes WHERE class_id = $1', [classId]);
    const cls = clsRes.rows[0];
    if (!cls) throw new NotFoundError('Kelas tidak ditemukan.');

    const subjectCode = normalizeSubjectCode(payload.subject_code);
    if (!subjectCode) throw new BadRequestError('Mata pelajaran wajib dipilih.');

    const portalSettings = await this.getPortalSettings();
    const configs = await this.ensureClassSubjectConfigs(yearId, cls, portalSettings.default_kkm);
    const existingCfg = configs.find((c) => c.subject_code === subjectCode);
    const subjectName = String(
      payload.subject_name || existingCfg?.subject_name || GRADE_SUBJECT_CATALOG[subjectCode]?.name || subjectCode
    ).trim().slice(0, 100);

    const kkmVal = payload.kkm !== undefined && payload.kkm !== null && payload.kkm !== ''
      ? parseScoreValue(payload.kkm)
      : (existingCfg ? Number(existingCfg.kkm) : portalSettings.default_kkm);

    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (entries.length === 0) {
      throw new BadRequestError('Daftar nilai siswa kosong.');
    }

    let upsertedCount = 0;
    let clearedCount = 0;

    await db.withTransaction(async (client) => {
      // Ensure/update subject config & KKM
      const cfgId = existingCfg?.config_id || `GSC-${yearId.replace('/', '')}-${classId}-${subjectCode}`.slice(0, 60);
      const sortOrder = existingCfg?.sort_order || (configs.length + 1);
      await client.query(
        `INSERT INTO grade_subject_configs (config_id, academic_year_id, class_id, subject_code, subject_name, kkm, sort_order, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, CURRENT_TIMESTAMP)
         ON CONFLICT (academic_year_id, class_id, subject_code) DO UPDATE
         SET subject_name = EXCLUDED.subject_name,
             kkm = EXCLUDED.kkm,
             is_active = TRUE,
             updated_at = CURRENT_TIMESTAMP`,
        [cfgId, yearId, classId, subjectCode, subjectName, kkmVal, sortOrder]
      );

      for (const item of entries) {
        const studentId = String(item?.student_id || '').trim();
        if (!studentId) continue;

        const parsedScore = parseScoreValue(item.score);
        const remarks = item.remarks !== undefined && item.remarks !== null
          ? String(item.remarks).trim().slice(0, 300)
          : null;

        if (parsedScore === null) {
          const del = await client.query(
            `DELETE FROM grades
             WHERE academic_year_id = $1 AND assessment_type = $2 AND student_id = $3 AND subject_code = $4`,
            [yearId, periodMeta.code, studentId, subjectCode]
          );
          clearedCount += del.rowCount || 0;
        } else {
          const gradeId = `GRD-${yearId.replace('/', '')}-${periodMeta.code}-${studentId}-${subjectCode}`.slice(0, 50);
          await client.query(
            `INSERT INTO grades (
               grade_id, student_id, class_id, academic_year_id,
               subject, subject_code, assessment_type, score, semester,
               assessment_date, remarks, recorded_by_user_id, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, $10, $11, CURRENT_TIMESTAMP)
             ON CONFLICT (academic_year_id, assessment_type, student_id, subject_code) DO UPDATE
             SET class_id = EXCLUDED.class_id,
                 subject = EXCLUDED.subject,
                 score = EXCLUDED.score,
                 semester = EXCLUDED.semester,
                 remarks = EXCLUDED.remarks,
                 recorded_by_user_id = EXCLUDED.recorded_by_user_id,
                 updated_at = CURRENT_TIMESTAMP`,
            [
              gradeId,
              studentId,
              classId,
              yearId,
              subjectName,
              subjectCode,
              periodMeta.code,
              parsedScore,
              periodMeta.semester,
              remarks,
              user?.user_id || null
            ]
          );
          upsertedCount++;
        }
      }
    });

    return {
      academic_year_id: yearId,
      class_id: classId,
      assessment_type: periodMeta.code,
      subject_code: subjectCode,
      subject_name: subjectName,
      kkm: kkmVal,
      saved_count: upsertedCount,
      cleared_count: clearedCount
    };
  }

  async updateSubjectKkm(payload = {}) {
    const { activeYear } = await this.resolveAcademicYear(payload.academic_year_id);
    this.assertYearEditable(activeYear);
    const yearId = activeYear.academic_year_id;
    const classId = String(payload.class_id || '').trim();
    const subjectCode = normalizeSubjectCode(payload.subject_code);
    const kkmVal = parseScoreValue(payload.kkm);

    if (!classId || !subjectCode || kkmVal === null) {
      throw new BadRequestError('Kelas, mata pelajaran, dan angka KKM (0-100) wajib diisi.');
    }

    const clsRes = await db.query('SELECT class_id, level FROM classes WHERE class_id = $1', [classId]);
    const cls = clsRes.rows[0];
    if (!cls) throw new NotFoundError('Kelas tidak ditemukan.');

    const portalSettings = await this.getPortalSettings();
    const configs = await this.ensureClassSubjectConfigs(yearId, cls, portalSettings.default_kkm);
    const existingCfg = configs.find((c) => c.subject_code === subjectCode);
    const subjectName = String(
      payload.subject_name || existingCfg?.subject_name || GRADE_SUBJECT_CATALOG[subjectCode]?.name || subjectCode
    ).trim().slice(0, 120);
    const cfgId = existingCfg?.config_id || `GSC-${yearId.replace('/', '')}-${classId}-${subjectCode}`.slice(0, 60);
    const sortOrder = existingCfg?.sort_order || (configs.length + 1);

    await db.query(
      `INSERT INTO grade_subject_configs (config_id, academic_year_id, class_id, subject_code, subject_name, kkm, sort_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id, class_id, subject_code) DO UPDATE
       SET subject_name = EXCLUDED.subject_name,
           kkm = EXCLUDED.kkm,
           is_active = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
      [cfgId, yearId, classId, subjectCode, subjectName, kkmVal, sortOrder]
    );

    return { academic_year_id: yearId, class_id: classId, subject_code: subjectCode, subject_name: subjectName, kkm: kkmVal };
  }

  async updatePeriodPublication(payload = {}, user = null) {
    const { activeYear } = await this.resolveAcademicYear(payload.academic_year_id);
    const yearId = activeYear.academic_year_id;
    const periodMeta = getPeriodMeta(payload.assessment_type);
    if (!periodMeta) throw new BadRequestError('Periode asesmen tidak valid.');

    const isPublished = Boolean(payload.is_published);
    const pubAt = isPublished ? new Date().toISOString() : null;

    await db.query(
      `INSERT INTO grade_period_publications (academic_year_id, assessment_type, is_published, published_at, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id, assessment_type) DO UPDATE
       SET is_published = EXCLUDED.is_published,
           published_at = EXCLUDED.published_at,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = CURRENT_TIMESTAMP`,
      [yearId, periodMeta.code, isPublished, pubAt, user?.user_id || null]
    );

    return {
      academic_year_id: yearId,
      assessment_type: periodMeta.code,
      is_published: isPublished,
      published_at: pubAt
    };
  }

  async updateStudentNote(payload = {}, user = null) {
    const { activeYear } = await this.resolveAcademicYear(payload.academic_year_id);
    this.assertYearEditable(activeYear);
    const yearId = activeYear.academic_year_id;
    const periodMeta = getPeriodMeta(payload.assessment_type);
    if (!periodMeta) throw new BadRequestError('Periode asesmen tidak valid.');
    const studentId = String(payload.student_id || '').trim();
    if (!studentId) throw new BadRequestError('ID Siswa wajib diisi.');

    const note = String(payload.homeroom_note || '').trim().slice(0, 600);
    await db.query(
      `INSERT INTO grade_student_notes (academic_year_id, assessment_type, student_id, homeroom_note, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (academic_year_id, assessment_type, student_id) DO UPDATE
       SET homeroom_note = EXCLUDED.homeroom_note,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = CURRENT_TIMESTAMP`,
      [yearId, periodMeta.code, studentId, note, user?.user_id || null]
    );

    return { academic_year_id: yearId, assessment_type: periodMeta.code, student_id: studentId, homeroom_note: note };
  }

  async seedOfficialAstsGanjil2026(user = null) {
    const seed = ASTS_GANJIL_2026_SEED;
    const yearId = seed.academic_year_id;
    const periodCode = seed.assessment_type;
    const semester = seed.semester;

    // Fetch existing student IDs in DB so seed works seamlessly in both full prod DB (47 students) and test subsets
    const stRes = await db.query('SELECT student_id, class_id, name FROM students');
    const existingStudentIds = new Set((stRes.rows || []).map((s) => s.student_id));
    const clsRes = await db.query('SELECT class_id, level FROM classes');
    const existingClassIds = new Set((clsRes.rows || []).map((c) => c.class_id));

    let insertedGrades = 0;
    let seededStudents = 0;

    await db.withTransaction(async (client) => {
      for (const clsBlock of seed.classes) {
        if (!existingClassIds.has(clsBlock.class_id)) continue;

        // 1. Seed subject configs in exact Madrasah Excel column order (default KKM 75)
        for (let i = 0; i < clsBlock.subjects.length; i++) {
          const code = clsBlock.subjects[i];
          const meta = GRADE_SUBJECT_CATALOG[code] || { code, name: code };
          const cfgId = `GSC-${yearId.replace('/', '')}-${clsBlock.class_id}-${code}`.slice(0, 60);
          await client.query(
            `INSERT INTO grade_subject_configs (config_id, academic_year_id, class_id, subject_code, subject_name, kkm, sort_order, is_active, updated_at)
             VALUES ($1, $2, $3, $4, $5, 75.00, $6, TRUE, CURRENT_TIMESTAMP)
             ON CONFLICT (academic_year_id, class_id, subject_code) DO UPDATE
             SET sort_order = EXCLUDED.sort_order,
                 is_active = TRUE`,
            [cfgId, yearId, clsBlock.class_id, code, meta.name, i + 1]
          );
        }

        // 2. Upsert every student's scores across all subjects in this class
        for (const row of clsBlock.rows) {
          if (!existingStudentIds.has(row.student_id)) continue;
          seededStudents++;
          for (let i = 0; i < clsBlock.subjects.length; i++) {
            const code = clsBlock.subjects[i];
            const meta = GRADE_SUBJECT_CATALOG[code] || { code, name: code };
            const scoreVal = Number(row.scores[i] ?? 0);
            const gradeId = `GRD-${yearId.replace('/', '')}-${periodCode}-${row.student_id}-${code}`.slice(0, 50);
            await client.query(
              `INSERT INTO grades (
                 grade_id, student_id, class_id, academic_year_id,
                 subject, subject_code, assessment_type, score, semester,
                 assessment_date, remarks, recorded_by_user_id, updated_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, NULL, $10, CURRENT_TIMESTAMP)
               ON CONFLICT (academic_year_id, assessment_type, student_id, subject_code) DO UPDATE
               SET class_id = EXCLUDED.class_id,
                   subject = EXCLUDED.subject,
                   score = EXCLUDED.score,
                   semester = EXCLUDED.semester,
                   updated_at = CURRENT_TIMESTAMP`,
              [
                gradeId,
                row.student_id,
                clsBlock.class_id,
                yearId,
                meta.name,
                code,
                periodCode,
                scoreVal,
                semester,
                user?.user_id || null
              ]
            );
            insertedGrades++;
          }
        }
      }
    });

    return {
      academic_year_id: yearId,
      assessment_type: periodCode,
      seeded_students: seededStudents,
      seeded_grades: insertedGrades
    };
  }
}

module.exports = new GradesService();
