const db = require('../config/database');
const { getTodayISODate } = require('../utils/date.util');
const { generateUUID } = require('../utils/id-generator.util');
const { BadRequestError, NotFoundError } = require('../errors');

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PRESETS = ['7d', 'month', 'semester', 'custom'];
const VALID_TAZIR_TYPES = ['HARIAN', 'JAM', 'GABUNGAN'];
const TAZIR_HARIAN_THRESHOLD_DAYS = 4;
const TAZIR_JAM_THRESHOLD_JP = 3;
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

function resolveSemesterStartForDate(endDateIso, activeYear) {
  const [yearStr, monthStr] = String(endDateIso).split('-');
  const monthNum = parseInt(monthStr, 10);
  const fallbackSemesterStart = monthNum >= 7 ? `${yearStr}-07-01` : `${yearStr}-01-01`;
  const ayStart = activeYear && activeYear.start_date ? String(activeYear.start_date).slice(0, 10) : null;
  return ayStart && parseISODateUTC(ayStart) && ayStart <= endDateIso
    ? ayStart
    : fallbackSemesterStart;
}

/**
 * Shared PostgreSQL CTE that collapses multi-period attendance logs into 1 row per
 * (student_id, class_id, attendance_date) with canonical daily status & partial-JP counts.
 */
function buildClassifiedStudentDaysCte(saFilterClause = '') {
  return `
    WITH class_days AS (
      SELECT sa2.class_id, sa2.attendance_date, COUNT(DISTINCT sa2.period)::int AS class_periods_day
      FROM student_attendance sa2
      WHERE sa2.attendance_date BETWEEN $1 AND $2
      GROUP BY sa2.class_id, sa2.attendance_date
    ),
    student_days AS (
      SELECT
        sa.student_id,
        sa.class_id,
        sa.attendance_date,
        COUNT(*)::int AS total_jp,
        COUNT(*) FILTER (WHERE sa.status = 'Hadir')::int AS hadir_jp,
        COUNT(*) FILTER (WHERE sa.status = 'Izin')::int AS izin_jp,
        COUNT(*) FILTER (WHERE sa.status = 'Sakit')::int AS sakit_jp,
        COUNT(*) FILTER (WHERE sa.status = 'Alpa')::int AS alpa_jp
      FROM student_attendance sa
      WHERE sa.attendance_date BETWEEN $1 AND $2
      ${saFilterClause}
      GROUP BY sa.student_id, sa.class_id, sa.attendance_date
    ),
    classified_days AS (
      SELECT
        sd.student_id,
        sd.class_id,
        sd.attendance_date,
        sd.total_jp,
        sd.hadir_jp,
        sd.izin_jp,
        sd.sakit_jp,
        sd.alpa_jp,
        COALESCE(cd.class_periods_day, sd.total_jp)::int AS class_periods_day,
        (
          sd.hadir_jp = 0 AND sd.izin_jp = 0 AND sd.sakit_jp = 0 AND sd.alpa_jp > 0
          AND COALESCE(cd.class_periods_day, sd.total_jp) >= 2
          AND sd.alpa_jp >= COALESCE(cd.class_periods_day, sd.total_jp)
        ) AS is_full_alpa_day,
        CASE
          WHEN sd.hadir_jp > 0 THEN 'Hadir'
          WHEN sd.sakit_jp > 0 AND sd.sakit_jp >= sd.izin_jp AND (sd.alpa_jp = 0 OR sd.sakit_jp >= sd.alpa_jp) THEN 'Sakit'
          WHEN sd.izin_jp > 0 AND sd.izin_jp > sd.sakit_jp AND (sd.alpa_jp = 0 OR sd.izin_jp >= sd.alpa_jp) THEN 'Izin'
          WHEN sd.izin_jp = 0 AND sd.sakit_jp = 0 AND sd.alpa_jp > 0
            AND COALESCE(cd.class_periods_day, sd.total_jp) >= 2
            AND sd.alpa_jp >= COALESCE(cd.class_periods_day, sd.total_jp) THEN 'Alpa'
          WHEN sd.sakit_jp > 0 AND sd.sakit_jp >= sd.izin_jp THEN 'Sakit'
          WHEN sd.izin_jp > 0 THEN 'Izin'
          ELSE 'Alpa'
        END AS day_status
      FROM student_days sd
      LEFT JOIN class_days cd
        ON cd.class_id = sd.class_id
       AND cd.attendance_date = sd.attendance_date
    )
  `;
}

function classifyStudentRisk({
  alpaFullDaysSem = 0,
  alpaPartialJpWeek = 0,
  izinDays = 0,
  sakitDays = 0,
  izin = 0,
  sakit = 0,
  alpaDisplay = 0,
  totalDays = 0,
  attendancePct = null,
  totalTazirCount = 0
}) {
  const hitHarian = alpaFullDaysSem >= TAZIR_HARIAN_THRESHOLD_DAYS;
  const hitJam = alpaPartialJpWeek >= TAZIR_JAM_THRESHOLD_JP;

  if (hitHarian) {
    return {
      risk_level: 'HIGH',
      risk_label: "Ta'zir Alpa Harian",
      risk_rank: 1,
      needs_tazir: true,
      dual_trigger: hitJam,
      recommended_tazir_type: hitJam ? 'GABUNGAN' : 'HARIAN',
      trigger_reason: hitJam
        ? `${alpaFullDaysSem} hr penuh/smt • ${alpaPartialJpWeek} JP/7 hr`
        : `${alpaFullDaysSem} hr penuh/smt`
    };
  }

  if (hitJam) {
    return {
      risk_level: 'MEDIUM',
      risk_label: "Ta'zir Bolos Jam",
      risk_rank: 2,
      needs_tazir: true,
      dual_trigger: false,
      recommended_tazir_type: 'JAM',
      trigger_reason: `${alpaPartialJpWeek} JP bolos / 7 hr`
    };
  }

  if (alpaFullDaysSem > 0 || alpaPartialJpWeek > 0 || alpaDisplay > 0) {
    let reason = `Alpa periode: ${alpaDisplay} JP`;
    if (alpaPartialJpWeek > 0) {
      reason = `Alpa: ${alpaPartialJpWeek}/${TAZIR_JAM_THRESHOLD_JP} JP (7 hr)`;
    } else if (alpaFullDaysSem > 0) {
      reason = `Alpa: ${alpaFullDaysSem}/${TAZIR_HARIAN_THRESHOLD_DAYS} hr penuh (smt)`;
    }
    return {
      risk_level: 'WATCH',
      risk_label: 'Pantauan',
      risk_rank: 3,
      needs_tazir: false,
      dual_trigger: false,
      recommended_tazir_type: null,
      trigger_reason: reason
    };
  }

  const isDaysTotal = izinDays + sakitDays;
  const isJpTotal = izin + sakit;
  if (isDaysTotal >= 3 || (totalDays > 0 && attendancePct !== null && attendancePct < 92)) {
    return {
      risk_level: 'WATCH',
      risk_label: 'Pantauan',
      risk_rank: 3,
      needs_tazir: false,
      dual_trigger: false,
      recommended_tazir_type: null,
      trigger_reason: `Sakit/Izin: ${isDaysTotal} hr (${isJpTotal} JP, Alpa 0)`
    };
  }

  return {
    risk_level: 'SAFE',
    risk_label: 'Aman',
    risk_rank: 4,
    needs_tazir: false,
    dual_trigger: false,
    recommended_tazir_type: null,
    trigger_reason: totalTazirCount > 0 ? `Tuntas ${totalTazirCount}x Ta'zir` : null
  };
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
        total: Number(row.total || 0),
        hadirDays: Number(row.hadir_days ?? row.hadir ?? 0),
        totalDays: Number(row.total_days ?? row.total ?? 0),
        partialAlpaJp: Number(row.partial_alpa_jp || 0)
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
          const s = studentByDate.get(iso) || { hadir: 0, izin: 0, sakit: 0, alpa: 0, total: 0, hadirDays: 0, totalDays: 0, partialAlpaJp: 0 };
          const t = teacherByDate.get(iso) || { hadir: 0, tugas_luar: 0, izin: 0, sakit: 0, total: 0 };
          return {
            key: iso,
            label: formatShortDateID(iso),
            student_rate: computeRatePct(s.hadirDays, s.totalDays),
            student_hadir_days: s.hadirDays,
            student_total_days: s.totalDays,
            student_partial_alpa_jp: s.partialAlpaJp,
            student_rate_jp: computeRatePct(s.hadir, s.total),
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
          sHadirDays: 0,
          sTotalDays: 0,
          sPartialAlpaJp: 0,
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
        b.sHadirDays += s.hadirDays;
        b.sTotalDays += s.totalDays;
        b.sPartialAlpaJp += s.partialAlpaJp;
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
        student_rate: computeRatePct(b.sHadirDays, b.sTotalDays),
        student_hadir_days: b.sHadirDays,
        student_total_days: b.sTotalDays,
        student_partial_alpa_jp: b.sPartialAlpaJp,
        student_rate_jp: computeRatePct(b.sHadir, b.sTotal),
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
    const semesterStart = resolveSemesterStartForDate(range.endDate, activeYear);
    const weekStart = addDaysISO(range.endDate, -6);
    const evalMinDate = [range.startDate, semesterStart, weekStart].sort()[0];

    // Query parameter builders
    const currParams = cleanClassId
      ? [range.startDate, range.endDate, cleanClassId]
      : [range.startDate, range.endDate];
    const prevParams = cleanClassId
      ? [range.prevStartDate, range.prevEndDate, cleanClassId]
      : [range.prevStartDate, range.prevEndDate];
    const evalParams = cleanClassId
      ? [evalMinDate, range.endDate, cleanClassId]
      : [evalMinDate, range.endDate];

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
      studentAlpaDailyRes,
      studentTazirSummaryRes,
      teacherPerfRes,
      recentJournalRes,
      studentAuditRes,
      teacherAuditRes,
      teacherScheduleRes
    ] = await Promise.all([
      // 2. Current Period Student Attendance Totals (Daily Student-Days + JP totals)
      db.query(
        `/* REPORTS: STUDENT_SUMMARY_CURR */
         ${buildClassifiedStudentDaysCte(saClassClause)}
         SELECT
           COALESCE(SUM(total_jp), 0)::int AS total_records,
           COALESCE(SUM(hadir_jp), 0)::int AS hadir,
           COALESCE(SUM(izin_jp), 0)::int AS izin,
           COALESCE(SUM(sakit_jp), 0)::int AS sakit,
           COALESCE(SUM(alpa_jp), 0)::int AS alpa,
           COUNT(DISTINCT attendance_date)::int AS active_days,
           COUNT(*)::int AS total_days,
           COUNT(*) FILTER (WHERE day_status = 'Hadir')::int AS hadir_days,
           COUNT(*) FILTER (WHERE day_status = 'Izin')::int AS izin_days,
           COUNT(*) FILTER (WHERE day_status = 'Sakit')::int AS sakit_days,
           COUNT(*) FILTER (WHERE day_status = 'Alpa')::int AS alpa_days,
           COALESCE(SUM(CASE WHEN is_full_alpa_day THEN 0 ELSE alpa_jp END), 0)::int AS partial_alpa_jp
         FROM classified_days`,
        currParams
      ),

      // 3. Previous Period Student Attendance Totals (Delta)
      db.query(
        `/* REPORTS: STUDENT_SUMMARY_PREV */
         ${buildClassifiedStudentDaysCte(saClassClause)}
         SELECT
           COALESCE(SUM(total_jp), 0)::int AS total_records,
           COALESCE(SUM(hadir_jp), 0)::int AS hadir,
           COUNT(*)::int AS total_days,
           COUNT(*) FILTER (WHERE day_status = 'Hadir')::int AS hadir_days
         FROM classified_days`,
        prevParams
      ),

      // 4. Student Daily Breakdown
      db.query(
        `/* REPORTS: STUDENT_DAILY */
         ${buildClassifiedStudentDaysCte(saClassClause)}
         SELECT
           attendance_date::text AS date_str,
           COALESCE(SUM(total_jp), 0)::int AS total,
           COALESCE(SUM(hadir_jp), 0)::int AS hadir,
           COALESCE(SUM(izin_jp), 0)::int AS izin,
           COALESCE(SUM(sakit_jp), 0)::int AS sakit,
           COALESCE(SUM(alpa_jp), 0)::int AS alpa,
           COUNT(*)::int AS total_days,
           COUNT(*) FILTER (WHERE day_status = 'Hadir')::int AS hadir_days,
           COUNT(*) FILTER (WHERE day_status = 'Izin')::int AS izin_days,
           COUNT(*) FILTER (WHERE day_status = 'Sakit')::int AS sakit_days,
           COUNT(*) FILTER (WHERE day_status = 'Alpa')::int AS alpa_days,
           COALESCE(SUM(CASE WHEN is_full_alpa_day THEN 0 ELSE alpa_jp END), 0)::int AS partial_alpa_jp
         FROM classified_days
         GROUP BY attendance_date
         ORDER BY attendance_date ASC`,
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
            COUNT(*) FILTER (WHERE ta.status = 'Sakit')::int AS sakit,
            COUNT(*) FILTER (WHERE ta.status = 'Alpa')::int AS alpa
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
         ${buildClassifiedStudentDaysCte('')}
         SELECT
           c.class_id,
           c.class_name,
           c.level,
           ht.name AS homeroom_teacher_name,
           COUNT(DISTINCT s.student_id) FILTER (WHERE s.status = 'Active')::int AS active_students,
           COALESCE(SUM(cd.total_jp), 0)::int AS total_records,
           COALESCE(SUM(cd.hadir_jp), 0)::int AS hadir,
           COALESCE(SUM(cd.izin_jp), 0)::int AS izin,
           COALESCE(SUM(cd.sakit_jp), 0)::int AS sakit,
           COALESCE(SUM(cd.alpa_jp), 0)::int AS alpa,
           COUNT(cd.attendance_date)::int AS total_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Hadir')::int AS hadir_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Izin')::int AS izin_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Sakit')::int AS sakit_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Alpa')::int AS alpa_days,
           COALESCE(SUM(CASE WHEN cd.attendance_date IS NULL OR cd.is_full_alpa_day THEN 0 ELSE cd.alpa_jp END), 0)::int AS partial_alpa_jp
         FROM classes c
         LEFT JOIN teachers ht ON c.homeroom_teacher_id = ht.teacher_id
         LEFT JOIN students s ON s.class_id = c.class_id AND s.status = 'Active'
         LEFT JOIN classified_days cd ON cd.student_id = s.student_id
         WHERE c.status = 'Active'
         GROUP BY c.class_id, c.class_name, c.level, ht.name
         ORDER BY c.level ASC, c.class_name ASC`,
        [range.startDate, range.endDate]
      ),

      // 7. Student Discipline & Early Warning
      db.query(
        `/* REPORTS: STUDENT_DISCIPLINE */
         ${buildClassifiedStudentDaysCte('')}
         SELECT
           s.student_id,
           s.name,
           s.nis,
           s.nisn,
           s.class_id,
           c.class_name,
           ht.name AS homeroom_teacher_name,
           COALESCE(SUM(cd.total_jp), 0)::int AS total_records,
           COALESCE(SUM(cd.hadir_jp), 0)::int AS hadir,
           COALESCE(SUM(cd.izin_jp), 0)::int AS izin,
           COALESCE(SUM(cd.sakit_jp), 0)::int AS sakit,
           COALESCE(SUM(cd.alpa_jp), 0)::int AS alpa,
           COUNT(cd.attendance_date)::int AS total_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Hadir')::int AS hadir_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Izin')::int AS izin_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Sakit')::int AS sakit_days,
           COUNT(cd.attendance_date) FILTER (WHERE cd.day_status = 'Alpa')::int AS alpa_days,
           COALESCE(SUM(CASE WHEN cd.attendance_date IS NULL OR cd.is_full_alpa_day THEN 0 ELSE cd.alpa_jp END), 0)::int AS partial_alpa_jp
         FROM students s
         JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN teachers ht ON c.homeroom_teacher_id = ht.teacher_id
         LEFT JOIN classified_days cd ON cd.student_id = s.student_id
         WHERE s.status = 'Active'
         ${studentClassClause}
         GROUP BY s.student_id, s.name, s.nis, s.nisn, s.class_id, c.class_name, ht.name`,
        currParams
      ),

      // 7b. Per-Student Daily Alpa Profile (evaluates Full-Day vs Per-JP Alpa across semester & week windows)
      db.query(
        `/* REPORTS: STUDENT_ALPA_DAILY */
         WITH class_days AS (
           SELECT sa2.class_id, sa2.attendance_date, COUNT(DISTINCT sa2.period)::int AS class_periods_day
           FROM student_attendance sa2
           WHERE sa2.attendance_date BETWEEN $1 AND $2
           GROUP BY sa2.class_id, sa2.attendance_date
         ),
         student_days AS (
           SELECT
             sa.student_id,
             sa.class_id,
             sa.attendance_date,
             COUNT(*)::int AS recorded_periods,
             COUNT(*) FILTER (WHERE sa.status = 'Hadir')::int AS hadir_day,
             COUNT(*) FILTER (WHERE sa.status = 'Izin')::int AS izin_day,
             COUNT(*) FILTER (WHERE sa.status = 'Sakit')::int AS sakit_day,
             COUNT(*) FILTER (WHERE sa.status = 'Alpa')::int AS alpa_day
           FROM student_attendance sa
           JOIN students s ON s.student_id = sa.student_id
           WHERE s.status = 'Active'
             AND sa.attendance_date BETWEEN $1 AND $2
             ${studentClassClause}
           GROUP BY sa.student_id, sa.class_id, sa.attendance_date
           HAVING COUNT(*) FILTER (WHERE sa.status = 'Alpa') > 0
         )
         SELECT
           sd.student_id,
           sd.attendance_date::text AS attendance_date,
           sd.hadir_day,
           sd.izin_day,
           sd.sakit_day,
           sd.alpa_day,
           COALESCE(cd.class_periods_day, sd.recorded_periods)::int AS class_periods_day
         FROM student_days sd
         LEFT JOIN class_days cd
           ON cd.class_id = sd.class_id
          AND cd.attendance_date = sd.attendance_date`,
        evalParams
      ),

      // 7c. Student Ta'zir Settlement History Summary (within active semester up to endDate)
      db.query(
        `/* REPORTS: STUDENT_TAZIR_SUMMARY */
         SELECT
           sta.student_id,
           MAX(sta.action_date) FILTER (WHERE sta.tazir_type IN ('HARIAN', 'GABUNGAN'))::text AS last_harian_date,
           MAX(sta.action_date) FILTER (WHERE sta.tazir_type IN ('JAM', 'GABUNGAN'))::text AS last_jam_date,
           MAX(sta.action_date)::text AS last_action_date,
           COUNT(*)::int AS total_actions
         FROM student_tazir_actions sta
         JOIN students s ON s.student_id = sta.student_id
         WHERE s.status = 'Active'
           AND sta.action_date <= $1
           AND sta.action_date >= $2
         GROUP BY sta.student_id`,
        [range.endDate, semesterStart]
      ).catch((err) => {
        if (err && err.code === '42P01') return { rows: [] };
        throw err;
      }),

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
            COUNT(ta.attendance_id) FILTER (WHERE ta.status = 'Alpa')::int AS alpa_logs,
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
           (pp.photo_id IS NOT NULL) AS has_photo
         FROM students s
         JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN profile_photos pp ON pp.student_id = s.student_id
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
      ),

      // 12. Scheduled Weekly JP Load per Teacher (active year / schedule semester, non-breaking on unmigrated/mock DB)
      db.query(
        `/* REPORTS: TEACHER_SCHEDULE_LOAD */
         SELECT
           cs.teacher_id,
           COUNT(*) FILTER (WHERE sub.category = 'KBM')::int AS scheduled_weekly_jp,
           COUNT(DISTINCT cs.class_id)::int AS scheduled_classes_count
         FROM class_schedules cs
         JOIN subjects sub ON sub.subject_id = cs.subject_id
         WHERE cs.teacher_id IS NOT NULL
           AND ($1::text IS NULL OR cs.academic_year_id = $1)
           AND cs.semester = COALESCE(
             (SELECT semester FROM class_schedules
              WHERE ($1::text IS NULL OR academic_year_id = $1)
              GROUP BY semester ORDER BY COUNT(*) DESC LIMIT 1),
             'GANJIL'
           )
         GROUP BY cs.teacher_id`,
        [activeYear.academic_year_id || null]
      ).catch((err) => {
        if (err && err.code === '42P01') return { rows: [] };
        throw err;
      })
    ]);

    // Aggregate Student KPI & Prev Delta (Daily Student-Days primary + JP preserved)
    const sc = studentSummaryCurrRes.rows[0] || {};
    const sp = studentSummaryPrevRes.rows[0] || {};
    const scTotal = Number(sc.total_records || 0);
    const scHadir = Number(sc.hadir || 0);
    const scIzin = Number(sc.izin || 0);
    const scSakit = Number(sc.sakit || 0);
    const scAlpa = Number(sc.alpa || 0);

    const scTotalDays = Number(sc.total_days ?? scTotal);
    const scHadirDays = Number(sc.hadir_days ?? scHadir);
    const scIzinDays = Number(sc.izin_days ?? scIzin);
    const scSakitDays = Number(sc.sakit_days ?? scSakit);
    const scAlpaDays = Number(sc.alpa_days ?? scAlpa);
    const scPartialAlpaJp = Number(sc.partial_alpa_jp || 0);

    const studentRate = computeRatePct(scHadirDays, scTotalDays);
    const prevRate = computeRatePct(Number(sp.hadir_days ?? sp.hadir ?? 0), Number(sp.total_days ?? sp.total_records ?? 0));
    const studentDelta = studentRate !== null && prevRate !== null
      ? roundOneDecimal(studentRate - prevRate)
      : null;

    const studentRateJp = computeRatePct(scHadir, scTotal);
    const prevRateJp = computeRatePct(Number(sp.hadir || 0), Number(sp.total_records || 0));
    const studentDeltaJp = studentRateJp !== null && prevRateJp !== null
      ? roundOneDecimal(studentRateJp - prevRateJp)
      : null;

    // Index settled Ta'zir actions per student
    const tazirSummaryByStudent = new Map();
    for (const row of (studentTazirSummaryRes.rows || [])) {
      tazirSummaryByStudent.set(row.student_id, {
        last_harian_date: row.last_harian_date ? String(row.last_harian_date).slice(0, 10) : null,
        last_jam_date: row.last_jam_date ? String(row.last_jam_date).slice(0, 10) : null,
        last_action_date: row.last_action_date ? String(row.last_action_date).slice(0, 10) : null,
        total_actions: Number(row.total_actions || 0)
      });
    }

    // Classify daily Alpa per student into Full-Day (semester) vs Partial-JP (weekly)
    const alpaStatsByStudent = new Map();
    for (const row of (studentAlpaDailyRes.rows || [])) {
      const sid = row.student_id;
      const dt = String(row.attendance_date).slice(0, 10);
      const hadirDay = Number(row.hadir_day || 0);
      const izinDay = Number(row.izin_day || 0);
      const sakitDay = Number(row.sakit_day || 0);
      const alpaDay = Number(row.alpa_day || 0);
      const classPeriodsDay = Number(row.class_periods_day || 0);

      if (!alpaStatsByStudent.has(sid)) {
        alpaStatsByStudent.set(sid, {
          unsettledFullDaysSem: 0,
          unsettledPartialJpWeek: 0,
          totalFullDaysSem: 0,
          totalPartialJpWeek: 0
        });
      }
      const bucket = alpaStatsByStudent.get(sid);
      const settle = tazirSummaryByStudent.get(sid) || {};

      // Full-day Alpa requires >= 2 periods recorded for class on that day AND 0 Hadir/Izin/Sakit
      const isFullDayAlpa =
        alpaDay > 0 &&
        hadirDay === 0 &&
        izinDay === 0 &&
        sakitDay === 0 &&
        classPeriodsDay >= 2 &&
        alpaDay >= classPeriodsDay;

      if (isFullDayAlpa && dt >= semesterStart && dt <= range.endDate) {
        bucket.totalFullDaysSem += 1;
        if (!settle.last_harian_date || dt > settle.last_harian_date) {
          bucket.unsettledFullDaysSem += 1;
        }
      } else if (!isFullDayAlpa && dt >= weekStart && dt <= range.endDate) {
        bucket.totalPartialJpWeek += alpaDay;
        if (!settle.last_jam_date || dt > settle.last_jam_date) {
          bucket.unsettledPartialJpWeek += alpaDay;
        }
      }
    }

    // Build Discipline Rows & Counters
    const discCounters = {
      high: 0,
      medium: 0,
      watch: 0,
      safe: 0,
      alpa_3plus: 0,
      tazir_total: 0,
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
      const totalDays = Number(row.total_days ?? totalRecords);
      const hadirDays = Number(row.hadir_days ?? hadir);
      const izinDays = Number(row.izin_days ?? izin);
      const sakitDays = Number(row.sakit_days ?? sakit);
      const alpaDays = Number(row.alpa_days ?? alpa);
      const partialAlpaJp = Number(row.partial_alpa_jp || 0);

      const pctDaily = computeRatePct(hadirDays, totalDays);
      const pctJp = computeRatePct(hadir, totalRecords);

      const alpaStats = alpaStatsByStudent.get(row.student_id) || {
        unsettledFullDaysSem: 0,
        unsettledPartialJpWeek: 0,
        totalFullDaysSem: 0,
        totalPartialJpWeek: 0
      };
      const tazirInfo = tazirSummaryByStudent.get(row.student_id) || {
        last_harian_date: null,
        last_jam_date: null,
        last_action_date: null,
        total_actions: 0
      };

      const risk = classifyStudentRisk({
        alpaFullDaysSem: alpaStats.unsettledFullDaysSem,
        alpaPartialJpWeek: alpaStats.unsettledPartialJpWeek,
        izinDays,
        sakitDays,
        izin,
        sakit,
        alpaDisplay: alpa,
        totalDays,
        attendancePct: pctDaily,
        totalTazirCount: tazirInfo.total_actions
      });

      if (risk.risk_level === 'HIGH') discCounters.high += 1;
      else if (risk.risk_level === 'MEDIUM') discCounters.medium += 1;
      else if (risk.risk_level === 'WATCH') discCounters.watch += 1;
      else discCounters.safe += 1;

      if (alpa >= 3) discCounters.alpa_3plus += 1;
      if (risk.needs_tazir) discCounters.tazir_total += 1;
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
        total_days: totalDays,
        hadir_days: hadirDays,
        izin_days: izinDays,
        sakit_days: sakitDays,
        alpa_days: alpaDays,
        partial_alpa_jp: partialAlpaJp,
        attendance_pct: pctDaily,
        total_records: totalRecords,
        hadir,
        izin,
        sakit,
        alpa,
        attendance_pct_jp: pctJp,
        alpa_full_days_sem: alpaStats.unsettledFullDaysSem,
        alpa_partial_jp_week: alpaStats.unsettledPartialJpWeek,
        total_semester_full_alpa_days: alpaStats.totalFullDaysSem,
        total_week_partial_alpa_jp: alpaStats.totalPartialJpWeek,
        tazir_count: tazirInfo.total_actions,
        last_tazir_date: tazirInfo.last_action_date,
        last_harian_tazir_date: tazirInfo.last_harian_date,
        last_jam_tazir_date: tazirInfo.last_jam_date,
        ...risk
      };
    }).sort((a, b) => {
      if (a.risk_rank !== b.risk_rank) return a.risk_rank - b.risk_rank;
      if (a.alpa_full_days_sem !== b.alpa_full_days_sem) return b.alpa_full_days_sem - a.alpa_full_days_sem;
      if (a.alpa_partial_jp_week !== b.alpa_partial_jp_week) return b.alpa_partial_jp_week - a.alpa_partial_jp_week;
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
    const teacherSchedMap = new Map();
    for (const sRow of (teacherScheduleRes.rows || [])) {
      teacherSchedMap.set(sRow.teacher_id, {
        scheduled_weekly_jp: Number(sRow.scheduled_weekly_jp || 0),
        scheduled_classes_count: Number(sRow.scheduled_classes_count || 0)
      });
    }

    let tTotalLogs = 0;
    let tTotalExec = 0;
    let tTotalEvidence = 0;
    let tActiveTeachingTeachers = 0;

    const teacherRows = (teacherPerfRes.rows || []).map((t) => {
      const totalLogs = Number(t.total_logs || 0);
      const hadirLogs = Number(t.hadir_logs || 0);
      const izinLogs = Number(t.izin_logs || 0);
      const sakitLogs = Number(t.sakit_logs || 0);
      const alpaLogs = Number(t.alpa_logs || 0);
      const tugasLuarLogs = Number(t.tugas_luar_logs || 0);
      const verifiedCount = Number(t.verified_evidence_count || 0);

      tTotalLogs += totalLogs;
      tTotalExec += hadirLogs + tugasLuarLogs;
      tTotalEvidence += verifiedCount;
      if (totalLogs > 0) tActiveTeachingTeachers += 1;

      const latest = latestJournalByTeacher.get(t.teacher_id) || null;
      const schedInfo = teacherSchedMap.get(t.teacher_id) || { scheduled_weekly_jp: 0, scheduled_classes_count: 0 };
      const manualTargetHours = Number(t.target_weekly_hours || 0);
      const effectiveTargetHours = manualTargetHours > 0 ? manualTargetHours : schedInfo.scheduled_weekly_jp;
      return {
        teacher_id: t.teacher_id,
        name: t.name,
        position: t.position,
        subject: t.subject,
        target_weekly_hours: effectiveTargetHours,
        scheduled_weekly_hours: schedInfo.scheduled_weekly_jp,
        scheduled_classes_count: schedInfo.scheduled_classes_count,
        total_logs: totalLogs,
        hadir_logs: hadirLogs,
        izin_logs: izinLogs,
        sakit_logs: sakitLogs,
        alpa_logs: alpaLogs,
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

    // Per-Class Comparison (Daily Student-Days + JP totals)
    const perClass = (classPerfRes.rows || []).map((c) => {
      const totalRecords = Number(c.total_records || 0);
      const hadir = Number(c.hadir || 0);
      const totalDays = Number(c.total_days ?? totalRecords);
      const hadirDays = Number(c.hadir_days ?? hadir);
      const izinDays = Number(c.izin_days ?? Number(c.izin || 0));
      const sakitDays = Number(c.sakit_days ?? Number(c.sakit || 0));
      const alpaDays = Number(c.alpa_days ?? Number(c.alpa || 0));
      const partialAlpaJp = Number(c.partial_alpa_jp || 0);

      return {
        class_id: c.class_id,
        class_name: c.class_name,
        level: Number(c.level || 0),
        homeroom_teacher_name: c.homeroom_teacher_name || null,
        active_students: Number(c.active_students || 0),
        total_days: totalDays,
        hadir_days: hadirDays,
        izin_days: izinDays,
        sakit_days: sakitDays,
        alpa_days: alpaDays,
        partial_alpa_jp: partialAlpaJp,
        attendance_pct: computeRatePct(hadirDays, totalDays),
        total_records: totalRecords,
        hadir,
        izin: Number(c.izin || 0),
        sakit: Number(c.sakit || 0),
        alpa: Number(c.alpa || 0),
        attendance_pct_jp: computeRatePct(hadir, totalRecords),
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

      const missing = [];
      if (!hasNis) missing.push('NIS');
      if (!hasNisn) missing.push('NISN');
      if (!hasGender) missing.push('Gender');
      if (!hasPhoto) missing.push('Pasfoto');

      const isComplete = missing.length === 0;

      if (!classAuditMap.has(s.class_id)) {
        classAuditMap.set(s.class_id, {
          class_id: s.class_id,
          class_name: s.class_name,
          total_students: 0,
          complete_students: 0,
          nisn_count: 0,
          photo_count: 0
        });
      }
      const ca = classAuditMap.get(s.class_id);
      ca.total_students += 1;
      if (isComplete) ca.complete_students += 1;
      if (hasNisn) ca.nisn_count += 1;
      if (hasPhoto) ca.photo_count += 1;

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
        student_attendance_rate_jp: studentRateJp,
        student_attendance_delta_jp: studentDeltaJp,
        student_total_days: scTotalDays,
        student_total_records: scTotal,
        student_active_days: Number(sc.active_days || 0),
        student_daily_breakdown: {
          hadir: scHadirDays,
          izin: scIzinDays,
          sakit: scSakitDays,
          alpa: scAlpaDays,
          partial_alpa_jp: scPartialAlpaJp
        },
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
        harian_tazir_count: discCounters.high,
        jam_tazir_count: discCounters.medium,
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
        rules: {
          harian_threshold_days: TAZIR_HARIAN_THRESHOLD_DAYS,
          jam_threshold_jp: TAZIR_JAM_THRESHOLD_JP,
          semester_start: semesterStart,
          week_start: weekStart,
          window_end: range.endDate
        },
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

  /**
   * Fetch Ta'zir execution history for a student.
   */
  async getStudentTazirHistory(studentId) {
    if (!studentId || !String(studentId).trim()) {
      throw new BadRequestError('studentId wajib diisi');
    }
    const cleanId = String(studentId).trim();

    const stuRes = await db.query(
      `/* REPORTS: TAZIR_STUDENT_LOOKUP */
       SELECT s.student_id, s.name, s.nis, s.class_id, c.class_name
       FROM students s
       JOIN classes c ON s.class_id = c.class_id
       WHERE s.student_id = $1
       LIMIT 1`,
      [cleanId]
    );
    if (!stuRes.rows || stuRes.rows.length === 0) {
      throw new NotFoundError(`Siswa '${cleanId}' tidak ditemukan`);
    }

    const histRes = await db.query(
      `/* REPORTS: TAZIR_HISTORY_LIST */
       SELECT
         sta.tazir_id,
         sta.student_id,
         sta.academic_year_id,
         sta.tazir_type,
         sta.action_date::text AS action_date,
         sta.trigger_summary,
         sta.tazir_note,
         sta.created_at,
         u.full_name AS recorded_by_name
       FROM student_tazir_actions sta
       LEFT JOIN users u ON u.user_id = sta.recorded_by_user_id
       WHERE sta.student_id = $1
       ORDER BY sta.action_date DESC, sta.created_at DESC`,
      [cleanId]
    );

    return {
      student: stuRes.rows[0],
      history: histRes.rows || []
    };
  }

  /**
   * Record execution of a student's Ta'zir action (resets unsettled counter up to actionDate).
   */
  async recordStudentTazirAction({ studentId, tazirType, actionDate, triggerSummary, note, operatorUserId }) {
    if (!studentId || !String(studentId).trim()) {
      throw new BadRequestError('student_id wajib diisi');
    }
    const cleanStudentId = String(studentId).trim();
    const cleanType = String(tazirType || '').toUpperCase().trim();
    if (!VALID_TAZIR_TYPES.includes(cleanType)) {
      throw new BadRequestError(`tazir_type tidak valid. Gunakan: ${VALID_TAZIR_TYPES.join(', ')}`);
    }

    const today = getTodayISODate();
    const cleanDate = actionDate ? String(actionDate).trim() : today;
    if (!parseISODateUTC(cleanDate)) {
      throw new BadRequestError('Format tanggal action_date harus YYYY-MM-DD yang valid');
    }
    if (cleanDate > today) {
      throw new BadRequestError('Tanggal eksekusi Ta\'zir tidak boleh di masa depan');
    }

    const [stuRes, yearRes] = await Promise.all([
      db.query(
        `/* REPORTS: TAZIR_STUDENT_CHECK */
         SELECT student_id, name, status FROM students WHERE student_id = $1 LIMIT 1`,
        [cleanStudentId]
      ),
      db.query(
        `/* REPORTS: ACTIVE_YEAR */
         SELECT academic_year_id, name, start_date, end_date
         FROM academic_years
         WHERE is_active = TRUE
         LIMIT 1`
      )
    ]);

    if (!stuRes.rows || stuRes.rows.length === 0) {
      throw new NotFoundError(`Siswa '${cleanStudentId}' tidak ditemukan`);
    }

    const activeYear = yearRes.rows[0] || {};
    const tazirId = `TZR-${generateUUID().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
    const cleanSummary = triggerSummary ? String(triggerSummary).trim().slice(0, 160) : null;
    const cleanNote = note ? String(note).trim().slice(0, 1000) : null;

    const insertRes = await db.query(
      `/* REPORTS: TAZIR_INSERT */
       INSERT INTO student_tazir_actions (
         tazir_id, student_id, academic_year_id, tazir_type, action_date,
         trigger_summary, tazir_note, recorded_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING tazir_id, student_id, academic_year_id, tazir_type,
                 action_date::text AS action_date, trigger_summary, tazir_note, created_at`,
      [
        tazirId,
        cleanStudentId,
        activeYear.academic_year_id || null,
        cleanType,
        cleanDate,
        cleanSummary,
        cleanNote,
        operatorUserId || null
      ]
    );

    return insertRes.rows[0];
  }

  /**
   * Delete an existing Ta'zir record (Admin undo).
   */
  async deleteStudentTazirAction(tazirId) {
    if (!tazirId || !String(tazirId).trim()) {
      throw new BadRequestError('tazirId wajib diisi');
    }
    const res = await db.query(
      `/* REPORTS: TAZIR_DELETE */
       DELETE FROM student_tazir_actions
       WHERE tazir_id = $1
       RETURNING tazir_id, student_id`,
      [String(tazirId).trim()]
    );
    if (!res.rows || res.rows.length === 0) {
      throw new NotFoundError(`Riwayat Ta'zir '${tazirId}' tidak ditemukan`);
    }
    return res.rows[0];
  }
}

module.exports = new ReportsService();
