const db = require('../config/database');
const { getTodayISODate } = require('../utils/date.util');
const { BadRequestError } = require('../errors');

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PRESETS = ['7d', 'month', 'semester', 'custom'];
const MAX_CUSTOM_SPAN_DAYS = 366;

const MONTH_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseISODateUTC(isoStr) {
  if (typeof isoStr !== 'string' || !ISO_DATE_REGEX.test(isoStr.trim())) {
    return null;
  }
  const [y, m, d] = isoStr.trim().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function formatUTCDateISO(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysISO(isoStr, deltaDays) {
  const dt = parseISODateUTC(isoStr);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatUTCDateISO(dt);
}

function diffDaysInclusive(startIso, endIso) {
  const startDt = parseISODateUTC(startIso);
  const endDt = parseISODateUTC(endIso);
  if (!startDt || !endDt) return 0;
  return Math.floor((endDt.getTime() - startDt.getTime()) / 86400000) + 1;
}

function formatShortDateID(isoStr) {
  const dt = parseISODateUTC(isoStr);
  if (!dt) return isoStr || '-';
  return `${dt.getUTCDate()} ${MONTH_SHORT_ID[dt.getUTCMonth()]}`;
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function computeRatePct(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return roundOneDecimal((numerator / denominator) * 100);
}

function classifyStudentRisk(hadir, izin, sakit, alpa, totalRecords, attendancePct) {
  if (alpa >= 3) {
    return { risk_level: 'HIGH', risk_label: 'Panggil Wali', risk_rank: 1 };
  }
  if (alpa >= 1 || (totalRecords > 0 && attendancePct !== null && attendancePct < 85)) {
    return { risk_level: 'MEDIUM', risk_label: 'Peringatan', risk_rank: 2 };
  }
  if (izin + sakit >= 4 || (totalRecords > 0 && attendancePct !== null && attendancePct < 92)) {
    return { risk_level: 'WATCH', risk_label: 'Perlu Pantauan', risk_rank: 3 };
  }
  return { risk_level: 'SAFE', risk_label: 'Aman', risk_rank: 4 };
}

class ReportsService {
  /**
   * Resolve and validate period filter presets / custom dates against active academic year.
   */
  resolveDateRange({ preset = 'month', startDate, endDate, activeYear }) {
    const normalizedPreset = String(preset || 'month').toLowerCase().trim();
    if (!VALID_PRESETS.includes(normalizedPreset)) {
      throw new BadRequestError(`Parameter preset tidak valid. Gunakan: ${VALID_PRESETS.join(', ')}`);
    }

    const today = getTodayISODate();
    let resolvedStart = today;
    let resolvedEnd = today;

    if (normalizedPreset === '7d') {
      resolvedStart = addDaysISO(today, -6);
      resolvedEnd = today;
    } else if (normalizedPreset === 'month') {
      resolvedStart = `${today.slice(0, 7)}-01`;
      resolvedEnd = today;
    } else if (normalizedPreset === 'semester') {
      const [yearStr, monthStr] = today.split('-');
      const monthNum = parseInt(monthStr, 10);
      const fallbackSemesterStart = monthNum >= 7 ? `${yearStr}-07-01` : `${yearStr}-01-01`;
      const ayStart = activeYear && activeYear.start_date ? String(activeYear.start_date).slice(0, 10) : null;
      resolvedStart = ayStart && parseISODateUTC(ayStart) && ayStart <= today ? ayStart : fallbackSemesterStart;
      resolvedEnd = today;
    } else {
      if (!startDate || !endDate) {
        throw new BadRequestError('startDate dan endDate (YYYY-MM-DD) wajib diisi untuk preset custom');
      }
      const parsedStart = parseISODateUTC(startDate);
      const parsedEnd = parseISODateUTC(endDate);
      if (!parsedStart || !parsedEnd) {
        throw new BadRequestError('Format tanggal harus YYYY-MM-DD yang valid');
      }
      if (startDate > endDate) {
        throw new BadRequestError('Tanggal mulai tidak boleh melebihi tanggal akhir');
      }
      const span = diffDaysInclusive(startDate, endDate);
      if (span > MAX_CUSTOM_SPAN_DAYS) {
        throw new BadRequestError(`Rentang tanggal maksimal ${MAX_CUSTOM_SPAN_DAYS} hari`);
      }
      resolvedStart = startDate.trim();
      resolvedEnd = endDate.trim();
    }

    const spanDays = Math.max(1, diffDaysInclusive(resolvedStart, resolvedEnd));
    const prevEndDate = addDaysISO(resolvedStart, -1);
    const prevStartDate = addDaysISO(resolvedStart, -spanDays);

    return {
      preset: normalizedPreset,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      spanDays,
      prevStartDate,
      prevEndDate
    };
  }

  /**
   * Build chronological chart trend series (daily when <= 35 days, weekly buckets otherwise).
   */
  buildTrendSeries(studentDailyRows, teacherDailyRows, startDate, endDate, spanDays) {
    const studentByDate = new Map();
    for (const row of studentDailyRows) {
      studentByDate.set(String(row.date_str).slice(0, 10), {
        hadir: Number(row.hadir || 0),
        izin: Number(row.izin || 0),
        sakit: Number(row.sakit || 0),
        alpa: Number(row.alpa || 0),
        total: Number(row.total || 0)
      });
    }

    const teacherByDate = new Map();
    for (const row of teacherDailyRows) {
      teacherByDate.set(String(row.date_str).slice(0, 10), {
        hadir: Number(row.hadir || 0),
        tugas_luar: Number(row.tugas_luar || 0),
        izin: Number(row.izin || 0),
        sakit: Number(row.sakit || 0),
        total: Number(row.total || 0)
      });
    }

    const allDatesSet = new Set([...studentByDate.keys(), ...teacherByDate.keys()]);
    const allDates = [...allDatesSet].sort();

    if (spanDays <= 35) {
      // For concise ranges, show every date that has data OR full 7d span for crisp visual rhythm
      let datesToEmit = allDates;
      if (spanDays <= 14) {
        const denseDates = [];
        let cursor = startDate;
        while (cursor <= endDate && denseDates.length <= 14) {
          denseDates.push(cursor);
          cursor = addDaysISO(cursor, 1);
        }
        datesToEmit = denseDates;
      }

      return {
        granularity: 'daily',
        points: datesToEmit.map((iso) => {
          const s = studentByDate.get(iso) || { hadir: 0, izin: 0, sakit: 0, alpa: 0, total: 0 };
          const t = teacherByDate.get(iso) || { hadir: 0, tugas_luar: 0, izin: 0, sakit: 0, total: 0 };
          return {
            key: iso,
            label: formatShortDateID(iso),
            student_rate: computeRatePct(s.hadir, s.total),
            student_total: s.total,
            student_hadir: s.hadir,
            teacher_rate: computeRatePct(t.hadir + t.tugas_luar, t.total),
            teacher_total: t.total,
            teacher_hadir: t.hadir + t.tugas_luar
          };
        })
      };
    }

    // Weekly bucketing for longer ranges (semester / multi-month)
    const buckets = new Map();
    for (const iso of allDates) {
      const offsetDays = Math.max(0, diffDaysInclusive(startDate, iso) - 1);
      const weekIdx = Math.floor(offsetDays / 7);
      const bucketStart = addDaysISO(startDate, weekIdx * 7);
      const rawEnd = addDaysISO(bucketStart, 6);
      const bucketEnd = rawEnd > endDate ? endDate : rawEnd;
      const key = `${bucketStart}..${bucketEnd}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          label: `${formatShortDateID(bucketStart)}`,
          range_label: `${formatShortDateID(bucketStart)} - ${formatShortDateID(bucketEnd)}`,
          sHadir: 0,
          sTotal: 0,
          tExec: 0,
          tTotal: 0
        });
      }
      const b = buckets.get(key);
      const s = studentByDate.get(iso);
      const t = teacherByDate.get(iso);
      if (s) {
        b.sHadir += s.hadir;
        b.sTotal += s.total;
      }
      if (t) {
        b.tExec += t.hadir + t.tugas_luar;
        b.tTotal += t.total;
      }
    }

    return {
      granularity: 'weekly',
      points: [...buckets.values()].map((b) => ({
        key: b.key,
        label: b.label,
        range_label: b.range_label,
        student_rate: computeRatePct(b.sHadir, b.sTotal),
        student_total: b.sTotal,
        student_hadir: b.sHadir,
        teacher_rate: computeRatePct(b.tExec, b.tTotal),
        teacher_total: b.tTotal,
        teacher_hadir: b.tExec
      }))
    };
  }

  /**
   * Generate comprehensive academic executive report across attendance, discipline,
   * teacher instructional logs, and data/archive completeness.
   */
  async getAcademicReport({ preset = 'month', startDate, endDate, classId } = {}) {
    const cleanClassId = classId && classId !== 'ALL' ? String(classId).trim() : null;

    // 1. Academic Year & Active Classes Metadata
    const [yearRes, classesRes] = await Promise.all([
      db.query(
        `/* REPORTS: ACTIVE_YEAR */
         SELECT academic_year_id, name, start_date, end_date
         FROM academic_years
         WHERE is_active = TRUE
         LIMIT 1`
      ),
      db.query(
        `/* REPORTS: CLASSES_MASTER */
         SELECT c.class_id, c.class_name, c.level, c.homeroom_teacher_id,
                ht.name AS homeroom_teacher_name
         FROM classes c
         LEFT JOIN teachers ht ON c.homeroom_teacher_id = ht.teacher_id
         WHERE c.status = 'Active'
         ORDER BY c.level ASC, c.class_name ASC`
      )
    ]);

    const activeYear = yearRes.rows[0] || { academic_year_id: null, name: 'Tahun Ajaran Aktif' };
    const classes = classesRes.rows || [];

    if (cleanClassId && !classes.some((c) => c.class_id === cleanClassId)) {
      throw new BadRequestError(`Kelas '${cleanClassId}' tidak ditemukan atau tidak aktif`);
    }

    const range = this.resolveDateRange({ preset, startDate, endDate, activeYear });

    // Query parameter builders
    const currParams = cleanClassId
      ? [range.startDate, range.endDate, cleanClassId]
      : [range.startDate, range.endDate];
    const prevParams = cleanClassId
      ? [range.prevStartDate, range.prevEndDate, cleanClassId]
      : [range.prevStartDate, range.prevEndDate];

    const saClassClause = cleanClassId ? 'AND sa.class_id = $3' : '';
    const taClassClause = cleanClassId ? 'AND ta.class_id = $3' : '';
    const studentClassClause = cleanClassId ? 'AND s.class_id = $3' : '';
    const auditStudentClassClause = cleanClassId ? 'AND s.class_id = $1' : '';

    const [
      studentSummaryCurrRes,
      studentSummaryPrevRes,
      studentDailyRes,
      teacherDailyRes,
      classPerfRes,
      disciplineRes,
      teacherPerfRes,
      recentJournalRes,
      studentAuditRes,
      teacherAuditRes
    ] = await Promise.all([
      // 2. Current Period Student Attendance Totals
      db.query(
        `/* REPORTS: STUDENT_SUMMARY_CURR */
         SELECT
           COUNT(*)::int AS total_records,
           COUNT(*) FILTER (WHERE sa.status = 'Hadir')::int AS hadir,
           COUNT(*) FILTER (WHERE sa.status = 'Izin')::int AS izin,
           COUNT(*) FILTER (WHERE sa.status = 'Sakit')::int AS sakit,
           COUNT(*) FILTER (WHERE sa.status = 'Alpa')::int AS alpa,
           COUNT(DISTINCT sa.attendance_date)::int AS active_days
         FROM student_attendance sa
         WHERE sa.attendance_date BETWEEN $1 AND $2
         ${saClassClause}`,
        currParams
      ),

      // 3. Previous Period Student Attendance Totals (Delta)
      db.query(
        `/* REPORTS: STUDENT_SUMMARY_PREV */
         SELECT
           COUNT(*)::int AS total_records,
           COUNT(*) FILTER (WHERE sa.status = 'Hadir')::int AS hadir
         FROM student_attendance sa
         WHERE sa.attendance_date BETWEEN $1 AND $2
         ${saClassClause}`,
        prevParams
      ),

      // 4. Student Daily Breakdown
      db.query(
        `/* REPORTS: STUDENT_DAILY */
         SELECT
           sa.attendance_date::text AS date_str,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE sa.status = 'Hadir')::int AS hadir,
           COUNT(*) FILTER (WHERE sa.status = 'Izin')::int AS izin,
           COUNT(*) FILTER (WHERE sa.status = 'Sakit')::int AS sakit,
           COUNT(*) FILTER (WHERE sa.status = 'Alpa')::int AS alpa
         FROM student_attendance sa
         WHERE sa.attendance_date BETWEEN $1 AND $2
         ${saClassClause}
         GROUP BY sa.attendance_date
         ORDER BY sa.attendance_date ASC`,
        currParams
      ),

      // 5. Teacher Daily Breakdown
      db.query(
        `/* REPORTS: TEACHER_DAILY */
         SELECT
           ta.attendance_date::text AS date_str,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ta.status = 'Hadir')::int AS hadir,
           COUNT(*) FILTER (WHERE ta.status = 'TugasLuar')::int AS tugas_luar,
           COUNT(*) FILTER (WHERE ta.status = 'Izin')::int AS izin,
           COUNT(*) FILTER (WHERE ta.status = 'Sakit')::int AS sakit
         FROM teacher_attendance ta
         WHERE ta.attendance_date BETWEEN $1 AND $2
         ${taClassClause}
         GROUP BY ta.attendance_date
         ORDER BY ta.attendance_date ASC`,
        currParams
      ),

      // 6. Per-Class Attendance Comparison (Always show all active classes for comparison bar, marking selected)
      db.query(
        `/* REPORTS: CLASS_COMPARISON */
         SELECT
           c.class_id,
           c.class_name,
           c.level,
           ht.name AS homeroom_teacher_name,
           COUNT(DISTINCT s.student_id) FILTER (WHERE s.status = 'Active')::int AS active_students,
           COUNT(sa.attendance_id)::int AS total_records,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Hadir')::int AS hadir,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Izin')::int AS izin,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Sakit')::int AS sakit,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Alpa')::int AS alpa
         FROM classes c
         LEFT JOIN teachers ht ON c.homeroom_teacher_id = ht.teacher_id
         LEFT JOIN students s ON s.class_id = c.class_id AND s.status = 'Active'
         LEFT JOIN student_attendance sa
           ON sa.student_id = s.student_id
           AND sa.attendance_date BETWEEN $1 AND $2
         WHERE c.status = 'Active'
         GROUP BY c.class_id, c.class_name, c.level, ht.name
         ORDER BY c.level ASC, c.class_name ASC`,
        [range.startDate, range.endDate]
      ),

      // 7. Student Discipline & Early Warning
      db.query(
        `/* REPORTS: STUDENT_DISCIPLINE */
         SELECT
           s.student_id,
           s.name,
           s.nis,
           s.nisn,
           s.class_id,
           c.class_name,
           ht.name AS homeroom_teacher_name,
           COUNT(sa.attendance_id)::int AS total_records,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Hadir')::int AS hadir,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Izin')::int AS izin,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Sakit')::int AS sakit,
           COUNT(sa.attendance_id) FILTER (WHERE sa.status = 'Alpa')::int AS alpa
         FROM students s
         JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN teachers ht ON c.homeroom_teacher_id = ht.teacher_id
         LEFT JOIN student_attendance sa
           ON sa.student_id = s.student_id
           AND sa.attendance_date BETWEEN $1 AND $2
         WHERE s.status = 'Active'
         ${studentClassClause}
         GROUP BY s.student_id, s.name, s.nis, s.nisn, s.class_id, c.class_name, ht.name`,
        currParams
      ),

      // 8. Teacher Performance & Verified Evidence Counts
      db.query(
        `/* REPORTS: TEACHER_PERFORMANCE */
         SELECT
           t.teacher_id,
           t.name,
           t.position,
           t.subject,
           COALESCE(t.teaching_hours, 0)::int AS target_weekly_hours,
           COUNT(ta.attendance_id)::int AS total_logs,
           COUNT(ta.attendance_id) FILTER (WHERE ta.status = 'Hadir')::int AS hadir_logs,
           COUNT(ta.attendance_id) FILTER (WHERE ta.status = 'Izin')::int AS izin_logs,
           COUNT(ta.attendance_id) FILTER (WHERE ta.status = 'Sakit')::int AS sakit_logs,
           COUNT(ta.attendance_id) FILTER (WHERE ta.status = 'TugasLuar')::int AS tugas_luar_logs,
           COUNT(ae.evidence_id)::int AS verified_evidence_count,
           COUNT(DISTINCT ta.attendance_date)::int AS active_days,
           COUNT(DISTINCT ta.class_id)::int AS classes_taught_count,
           MAX(ta.attendance_date)::text AS latest_date
         FROM teachers t
         LEFT JOIN teacher_attendance ta
           ON ta.teacher_id = t.teacher_id
           AND ta.attendance_date BETWEEN $1 AND $2
           ${taClassClause}
         LEFT JOIN attendance_evidences ae
           ON ae.attendance_id = ta.attendance_id
         WHERE t.status = 'Active'
         GROUP BY t.teacher_id, t.name, t.position, t.subject, t.teaching_hours
         ORDER BY total_logs DESC, t.name ASC`,
        currParams
      ),

      // 9. Recent Teaching Journal Feed (for latest topic lookup & feed)
      db.query(
        `/* REPORTS: RECENT_JOURNALS */
         SELECT
           ta.attendance_id,
           ta.teacher_id,
           t.name AS teacher_name,
           ta.class_id,
           c.class_name,
           ta.attendance_date::text AS attendance_date,
           ta.period,
           ta.subject,
           ta.materi,
           ta.status,
           (ae.evidence_id IS NOT NULL) AS has_evidence
         FROM teacher_attendance ta
         JOIN teachers t ON ta.teacher_id = t.teacher_id
         JOIN classes c ON ta.class_id = c.class_id
         LEFT JOIN attendance_evidences ae ON ae.attendance_id = ta.attendance_id
         WHERE ta.attendance_date BETWEEN $1 AND $2
         ${taClassClause}
         ORDER BY ta.attendance_date DESC, ta.period DESC, ta.recorded_at DESC
         LIMIT 30`,
        currParams
      ),

      // 10. Active Student Data & Document Completeness Audit
      db.query(
        `/* REPORTS: STUDENT_DATA_AUDIT */
         SELECT
           s.student_id,
           s.name,
           s.class_id,
           c.class_name,
           s.nis,
           s.nisn,
           s.gender,
           (pp.photo_id IS NOT NULL) AS has_photo,
           (sd.document_id IS NOT NULL) AS has_kartu_pelajar
         FROM students s
         JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN profile_photos pp ON pp.student_id = s.student_id
         LEFT JOIN student_documents sd
           ON sd.student_id = s.student_id
           AND sd.document_type = 'KARTU_PELAJAR'
         WHERE s.status = 'Active'
         ${auditStudentClassClause}
         ORDER BY c.level ASC, c.class_name ASC, s.name ASC`,
        cleanClassId ? [cleanClassId] : []
      ),

      // 11. Active Teacher Data Completeness Audit (privacy-safe booleans only)
      db.query(
        `/* REPORTS: TEACHER_DATA_AUDIT */
         SELECT
           t.teacher_id,
           t.name,
           t.position,
           t.subject,
           (NULLIF(TRIM(COALESCE(t.nuptk, '')), '') IS NOT NULL) AS has_nuptk,
           (NULLIF(TRIM(COALESCE(t.nik, '')), '') IS NOT NULL) AS has_nik,
           (NULLIF(TRIM(COALESCE(t.nip, '')), '') IS NOT NULL) AS has_nip,
           (pp.photo_id IS NOT NULL) AS has_photo
         FROM teachers t
         LEFT JOIN profile_photos pp ON pp.teacher_id = t.teacher_id
         WHERE t.status = 'Active'
         ORDER BY t.name ASC`
      )
    ]);

    // Aggregate Student KPI & Prev Delta
    const sc = studentSummaryCurrRes.rows[0] || {};
    const sp = studentSummaryPrevRes.rows[0] || {};
    const scTotal = Number(sc.total_records || 0);
    const scHadir = Number(sc.hadir || 0);
    const scIzin = Number(sc.izin || 0);
    const scSakit = Number(sc.sakit || 0);
    const scAlpa = Number(sc.alpa || 0);
    const studentRate = computeRatePct(scHadir, scTotal);
    const prevRate = computeRatePct(Number(sp.hadir || 0), Number(sp.total_records || 0));
    const studentDelta = studentRate !== null && prevRate !== null
      ? roundOneDecimal(studentRate - prevRate)
      : null;

    // Build Discipline Rows & Counters
    const discCounters = {
      high: 0,
      medium: 0,
      watch: 0,
      safe: 0,
      alpa_3plus: 0,
      total_alpa: 0,
      total_izin: 0,
      total_sakit: 0
    };

    const disciplineStudents = (disciplineRes.rows || []).map((row) => {
      const hadir = Number(row.hadir || 0);
      const izin = Number(row.izin || 0);
      const sakit = Number(row.sakit || 0);
      const alpa = Number(row.alpa || 0);
      const totalRecords = Number(row.total_records || 0);
      const pct = computeRatePct(hadir, totalRecords);
      const risk = classifyStudentRisk(hadir, izin, sakit, alpa, totalRecords, pct);

      if (risk.risk_level === 'HIGH') discCounters.high += 1;
      else if (risk.risk_level === 'MEDIUM') discCounters.medium += 1;
      else if (risk.risk_level === 'WATCH') discCounters.watch += 1;
      else discCounters.safe += 1;

      if (alpa >= 3) discCounters.alpa_3plus += 1;
      discCounters.total_alpa += alpa;
      discCounters.total_izin += izin;
      discCounters.total_sakit += sakit;

      return {
        student_id: row.student_id,
        name: row.name,
        nis: row.nis || null,
        nisn: row.nisn || null,
        class_id: row.class_id,
        class_name: row.class_name,
        homeroom_teacher_name: row.homeroom_teacher_name || null,
        total_records: totalRecords,
        hadir,
        izin,
        sakit,
        alpa,
        attendance_pct: pct,
        ...risk
      };
    }).sort((a, b) => {
      if (a.risk_rank !== b.risk_rank) return a.risk_rank - b.risk_rank;
      if (a.alpa !== b.alpa) return b.alpa - a.alpa;
      const aPct = a.attendance_pct === null ? 999 : a.attendance_pct;
      const bPct = b.attendance_pct === null ? 999 : b.attendance_pct;
      if (aPct !== bPct) return aPct - bPct;
      return String(a.name).localeCompare(String(b.name), 'id');
    });

    // Latest journal topic per teacher map
    const latestJournalByTeacher = new Map();
    const recentJournals = (recentJournalRes.rows || []).map((j) => {
      if (!latestJournalByTeacher.has(j.teacher_id)) {
        latestJournalByTeacher.set(j.teacher_id, {
          attendance_date: j.attendance_date,
          period: Number(j.period || 0),
          class_name: j.class_name,
          subject: j.subject,
          materi: j.materi
        });
      }
      return {
        attendance_id: j.attendance_id,
        teacher_id: j.teacher_id,
        teacher_name: j.teacher_name,
        class_id: j.class_id,
        class_name: j.class_name,
        attendance_date: j.attendance_date,
        period: Number(j.period || 0),
        subject: j.subject,
        materi: j.materi,
        status: j.status,
        has_evidence: Boolean(j.has_evidence)
      };
    });

    // Teacher Performance Aggregation
    let tTotalLogs = 0;
    let tTotalExec = 0;
    let tTotalEvidence = 0;
    let tActiveTeachingTeachers = 0;

    const teacherRows = (teacherPerfRes.rows || []).map((t) => {
      const totalLogs = Number(t.total_logs || 0);
      const hadirLogs = Number(t.hadir_logs || 0);
      const izinLogs = Number(t.izin_logs || 0);
      const sakitLogs = Number(t.sakit_logs || 0);
      const tugasLuarLogs = Number(t.tugas_luar_logs || 0);
      const verifiedCount = Number(t.verified_evidence_count || 0);

      tTotalLogs += totalLogs;
      tTotalExec += hadirLogs + tugasLuarLogs;
      tTotalEvidence += verifiedCount;
      if (totalLogs > 0) tActiveTeachingTeachers += 1;

      const latest = latestJournalByTeacher.get(t.teacher_id) || null;
      return {
        teacher_id: t.teacher_id,
        name: t.name,
        position: t.position,
        subject: t.subject,
        target_weekly_hours: Number(t.target_weekly_hours || 0),
        total_logs: totalLogs,
        hadir_logs: hadirLogs,
        izin_logs: izinLogs,
        sakit_logs: sakitLogs,
        tugas_luar_logs: tugasLuarLogs,
        execution_pct: computeRatePct(hadirLogs + tugasLuarLogs, totalLogs),
        verified_evidence_count: verifiedCount,
        active_days: Number(t.active_days || 0),
        classes_taught_count: Number(t.classes_taught_count || 0),
        latest_date: t.latest_date || (latest ? latest.attendance_date : null),
        latest_subject: latest ? latest.subject : null,
        latest_materi: latest ? latest.materi : null,
        latest_class_name: latest ? latest.class_name : null
      };
    });

    const teacherExecRate = computeRatePct(tTotalExec, tTotalLogs);

    // Per-Class Comparison
    const perClass = (classPerfRes.rows || []).map((c) => {
      const totalRecords = Number(c.total_records || 0);
      const hadir = Number(c.hadir || 0);
      return {
        class_id: c.class_id,
        class_name: c.class_name,
        level: Number(c.level || 0),
        homeroom_teacher_name: c.homeroom_teacher_name || null,
        active_students: Number(c.active_students || 0),
        total_records: totalRecords,
        hadir,
        izin: Number(c.izin || 0),
        sakit: Number(c.sakit || 0),
        alpa: Number(c.alpa || 0),
        attendance_pct: computeRatePct(hadir, totalRecords),
        is_selected: cleanClassId ? c.class_id === cleanClassId : false
      };
    });

    // Data & Archive Completeness Audit
    const classAuditMap = new Map();
    const auditStudentRows = (studentAuditRes.rows || []).map((s) => {
      const hasNis = Boolean(s.nis && String(s.nis).trim());
      const hasNisn = Boolean(s.nisn && String(s.nisn).trim());
      const hasGender = Boolean(s.gender && String(s.gender).trim());
      const hasPhoto = Boolean(s.has_photo);
      const hasKartu = Boolean(s.has_kartu_pelajar);

      const missing = [];
      if (!hasNis) missing.push('NIS');
      if (!hasNisn) missing.push('NISN');
      if (!hasGender) missing.push('Gender');
      if (!hasPhoto) missing.push('Pasfoto');
      if (!hasKartu) missing.push('Kartu Pelajar');

      const isComplete = missing.length === 0;

      if (!classAuditMap.has(s.class_id)) {
        classAuditMap.set(s.class_id, {
          class_id: s.class_id,
          class_name: s.class_name,
          total_students: 0,
          complete_students: 0,
          nisn_count: 0,
          photo_count: 0,
          kartu_count: 0
        });
      }
      const ca = classAuditMap.get(s.class_id);
      ca.total_students += 1;
      if (isComplete) ca.complete_students += 1;
      if (hasNisn) ca.nisn_count += 1;
      if (hasPhoto) ca.photo_count += 1;
      if (hasKartu) ca.kartu_count += 1;

      return {
        entity_type: 'STUDENT',
        id: s.student_id,
        name: s.name,
        subtitle: s.class_name,
        class_id: s.class_id,
        nis: s.nis || null,
        nisn: s.nisn || null,
        has_nis: hasNis,
        has_nisn: hasNisn,
        has_gender: hasGender,
        has_photo: hasPhoto,
        has_kartu_pelajar: hasKartu,
        is_complete: isComplete,
        missing_items: missing
      };
    });

    const auditTeacherRows = (teacherAuditRes.rows || []).map((t) => {
      const hasNuptk = Boolean(t.has_nuptk);
      const hasNik = Boolean(t.has_nik);
      const hasNip = Boolean(t.has_nip);
      const hasPhoto = Boolean(t.has_photo);

      const missing = [];
      if (!hasNuptk && !hasNip) missing.push('NUPTK/NIP');
      if (!hasNik) missing.push('NIK');
      if (!hasPhoto) missing.push('Pasfoto');

      return {
        entity_type: 'TEACHER',
        id: t.teacher_id,
        name: t.name,
        subtitle: `${t.position || 'Guru'}${t.subject ? ` • ${t.subject}` : ''}`,
        has_nuptk: hasNuptk,
        has_nip: hasNip,
        has_nik: hasNik,
        has_photo: hasPhoto,
        is_complete: missing.length === 0,
        missing_items: missing
      };
    });

    const studentCompleteCount = auditStudentRows.filter((r) => r.is_complete).length;
    const studentPhotoCount = auditStudentRows.filter((r) => r.has_photo).length;
    const studentKartuCount = auditStudentRows.filter((r) => r.has_kartu_pelajar).length;
    const studentNisnCount = auditStudentRows.filter((r) => r.has_nisn).length;

    const teacherCompleteCount = auditTeacherRows.filter((r) => r.is_complete).length;
    const teacherPhotoCount = auditTeacherRows.filter((r) => r.has_photo).length;

    const totalEntities = auditStudentRows.length + auditTeacherRows.length;
    const completeEntities = studentCompleteCount + teacherCompleteCount;
    const overallAuditPct = totalEntities > 0
      ? roundOneDecimal((completeEntities / totalEntities) * 100)
      : 100;

    const incompleteItems = [
      ...auditStudentRows.filter((r) => !r.is_complete),
      ...auditTeacherRows.filter((r) => !r.is_complete)
    ].sort((a, b) => b.missing_items.length - a.missing_items.length);

    const perClassAudit = [...classAuditMap.values()].map((ca) => ({
      ...ca,
      completeness_pct: computeRatePct(ca.complete_students, ca.total_students) ?? 0
    }));

    const attentionStudentsCount = discCounters.high + discCounters.medium;

    return {
      meta: {
        academic_year_id: activeYear.academic_year_id,
        academic_year_name: activeYear.name,
        preset: range.preset,
        start_date: range.startDate,
        end_date: range.endDate,
        prev_start_date: range.prevStartDate,
        prev_end_date: range.prevEndDate,
        span_days: range.spanDays,
        class_id: cleanClassId,
        generated_at: new Date().toISOString(),
        classes: classes.map((c) => ({
          class_id: c.class_id,
          class_name: c.class_name,
          level: Number(c.level || 0),
          homeroom_teacher_name: c.homeroom_teacher_name || null
        }))
      },
      overview: {
        student_attendance_rate: studentRate,
        student_attendance_delta: studentDelta,
        student_total_records: scTotal,
        student_active_days: Number(sc.active_days || 0),
        student_breakdown: {
          hadir: scHadir,
          izin: scIzin,
          sakit: scSakit,
          alpa: scAlpa
        },
        teacher_execution_rate: teacherExecRate,
        teacher_total_logs: tTotalLogs,
        teacher_active_count: tActiveTeachingTeachers,
        teacher_total_count: teacherRows.length,
        teacher_evidence_verified: tTotalEvidence,
        attention_students_count: attentionStudentsCount,
        alpa_3plus_count: discCounters.alpa_3plus,
        data_readiness_rate: overallAuditPct,
        total_active_students: disciplineStudents.length,
        rdm_notice: {
          system_name: 'RDM Madrasah Kemenag',
          status: 'EXTERNAL_PLANNED',
          note: 'Pengelolaan nilai & rapor akademik akan diarahkan langsung ke RDM Madrasah Kemenag pada integrasi tahap berikutnya.'
        }
      },
      trends: this.buildTrendSeries(
        studentDailyRes.rows || [],
        teacherDailyRes.rows || [],
        range.startDate,
        range.endDate,
        range.spanDays
      ),
      per_class: perClass,
      discipline: {
        summary: {
          total_students: disciplineStudents.length,
          ...discCounters
        },
        students: disciplineStudents
      },
      teacher_performance: {
        summary: {
          total_teachers: teacherRows.length,
          active_teaching_teachers: tActiveTeachingTeachers,
          total_logs: tTotalLogs,
          execution_rate: teacherExecRate,
          verified_evidence_count: tTotalEvidence
        },
        teachers: teacherRows,
        recent_journals: recentJournals.slice(0, 15)
      },
      data_audit: {
        summary: {
          overall_pct: overallAuditPct,
          total_students: auditStudentRows.length,
          complete_students: studentCompleteCount,
          student_photo_count: studentPhotoCount,
          student_kartu_count: studentKartuCount,
          student_nisn_count: studentNisnCount,
          total_teachers: auditTeacherRows.length,
          complete_teachers: teacherCompleteCount,
          teacher_photo_count: teacherPhotoCount,
          incomplete_count: incompleteItems.length
        },
        per_class: perClassAudit,
        incomplete_items: incompleteItems,
        all_students: auditStudentRows,
        all_teachers: auditTeacherRows
      }
    };
  }
}

module.exports = new ReportsService();
