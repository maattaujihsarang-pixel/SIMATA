const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

async function requestJson(baseUrl, method, urlPath, { token = null, body = undefined } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await globalThis.fetch(`${baseUrl}${urlPath}`, opts);
  const json = await res.json();
  return { status: res.status, json };
}

function buildMockClassifiedDays(startDate, endDate, classId = null) {
  const classDayPeriods = new Map();
  for (const sa of testDbEngine.student_attendance) {
    if (sa.attendance_date < startDate || sa.attendance_date > endDate) continue;
    const ck = `${sa.class_id}::${sa.attendance_date}`;
    if (!classDayPeriods.has(ck)) classDayPeriods.set(ck, new Set());
    classDayPeriods.get(ck).add(sa.period);
  }

  const dayMap = new Map();
  for (const sa of testDbEngine.student_attendance) {
    if (sa.attendance_date < startDate || sa.attendance_date > endDate) continue;
    if (classId && sa.class_id !== classId) continue;
    const sk = `${sa.student_id}::${sa.class_id}::${sa.attendance_date}`;
    if (!dayMap.has(sk)) {
      dayMap.set(sk, {
        student_id: sa.student_id,
        class_id: sa.class_id,
        attendance_date: sa.attendance_date,
        total_jp: 0,
        hadir_jp: 0,
        izin_jp: 0,
        sakit_jp: 0,
        alpa_jp: 0
      });
    }
    const d = dayMap.get(sk);
    d.total_jp += 1;
    if (sa.status === 'Hadir') d.hadir_jp += 1;
    else if (sa.status === 'Izin') d.izin_jp += 1;
    else if (sa.status === 'Sakit') d.sakit_jp += 1;
    else if (sa.status === 'Alpa') d.alpa_jp += 1;
  }

  return [...dayMap.values()].map((d) => {
    const pSet = classDayPeriods.get(`${d.class_id}::${d.attendance_date}`);
    const classPeriodsDay = pSet ? pSet.size : d.total_jp;
    const isFullAlpaDay = (
      d.hadir_jp === 0 &&
      d.izin_jp === 0 &&
      d.sakit_jp === 0 &&
      d.alpa_jp > 0 &&
      classPeriodsDay >= 2 &&
      d.alpa_jp >= classPeriodsDay
    );
    let dayStatus = 'Alpa';
    if (d.hadir_jp > 0) dayStatus = 'Hadir';
    else if (d.sakit_jp > 0 && d.sakit_jp >= d.izin_jp && (d.alpa_jp === 0 || d.sakit_jp >= d.alpa_jp)) dayStatus = 'Sakit';
    else if (d.izin_jp > 0 && d.izin_jp > d.sakit_jp && (d.alpa_jp === 0 || d.izin_jp >= d.alpa_jp)) dayStatus = 'Izin';
    else if (isFullAlpaDay) dayStatus = 'Alpa';
    else if (d.sakit_jp > 0 && d.sakit_jp >= d.izin_jp) dayStatus = 'Sakit';
    else if (d.izin_jp > 0) dayStatus = 'Izin';

    return {
      ...d,
      class_periods_day: classPeriodsDay,
      is_full_alpa_day: isFullAlpaDay,
      day_status: dayStatus,
      partial_alpa_jp: isFullAlpaDay ? 0 : d.alpa_jp
    };
  });
}

function summarizeClassifiedDays(days) {
  return days.reduce((acc, d) => {
    acc.total_records += d.total_jp;
    acc.hadir += d.hadir_jp;
    acc.izin += d.izin_jp;
    acc.sakit += d.sakit_jp;
    acc.alpa += d.alpa_jp;
    acc.total_days += 1;
    if (d.day_status === 'Hadir') acc.hadir_days += 1;
    else if (d.day_status === 'Izin') acc.izin_days += 1;
    else if (d.day_status === 'Sakit') acc.sakit_days += 1;
    else if (d.day_status === 'Alpa') acc.alpa_days += 1;
    acc.partial_alpa_jp += d.partial_alpa_jp;
    return acc;
  }, {
    total_records: 0,
    hadir: 0,
    izin: 0,
    sakit: 0,
    alpa: 0,
    total_days: 0,
    hadir_days: 0,
    izin_days: 0,
    sakit_days: 0,
    alpa_days: 0,
    partial_alpa_jp: 0
  });
}

function createReportsMockQueryHandler() {
  return async (text, params = []) => {
    const q = String(text || '');
    const photos = testDbEngine.profile_photos || [];
    const docs = testDbEngine.student_documents || [];

    if (q.includes('/* REPORTS: ACTIVE_YEAR */')) {
      const ay = testDbEngine.academic_years.find((a) => a.is_active) || testDbEngine.academic_years[0];
      return { rows: ay ? [ay] : [], rowCount: ay ? 1 : 0 };
    }

    if (q.includes('/* REPORTS: CLASSES_MASTER */')) {
      const rows = testDbEngine.classes
        .filter((c) => c.status === 'Active')
        .sort((a, b) => a.level - b.level || a.class_name.localeCompare(b.class_name))
        .map((c) => {
          const ht = testDbEngine.teachers.find((t) => t.teacher_id === c.homeroom_teacher_id);
          return {
            class_id: c.class_id,
            class_name: c.class_name,
            level: c.level,
            homeroom_teacher_id: c.homeroom_teacher_id,
            homeroom_teacher_name: ht ? ht.name : null
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: STUDENT_SUMMARY_CURR */') || q.includes('/* REPORTS: STUDENT_SUMMARY_PREV */')) {
      const [startDate, endDate, classId] = params;
      const days = buildMockClassifiedDays(startDate, endDate, classId);
      const activeDays = new Set(days.map((d) => d.attendance_date)).size;
      const sum = summarizeClassifiedDays(days);
      return { rows: [{ ...sum, active_days: activeDays }], rowCount: 1 };
    }

    if (q.includes('/* REPORTS: STUDENT_DAILY */')) {
      const [startDate, endDate, classId] = params;
      const days = buildMockClassifiedDays(startDate, endDate, classId);
      const byDate = new Map();
      for (const d of days) {
        if (!byDate.has(d.attendance_date)) byDate.set(d.attendance_date, []);
        byDate.get(d.attendance_date).push(d);
      }
      const rows = [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateStr, list]) => {
          const sum = summarizeClassifiedDays(list);
          return {
            date_str: dateStr,
            total: sum.total_records,
            hadir: sum.hadir,
            izin: sum.izin,
            sakit: sum.sakit,
            alpa: sum.alpa,
            total_days: sum.total_days,
            hadir_days: sum.hadir_days,
            izin_days: sum.izin_days,
            sakit_days: sum.sakit_days,
            alpa_days: sum.alpa_days,
            partial_alpa_jp: sum.partial_alpa_jp
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: TEACHER_DAILY */')) {
      const [startDate, endDate, classId] = params;
      const byDate = new Map();
      for (const ta of testDbEngine.teacher_attendance) {
        if (ta.attendance_date < startDate || ta.attendance_date > endDate) continue;
        if (classId && ta.class_id !== classId) continue;
        if (!byDate.has(ta.attendance_date)) {
          byDate.set(ta.attendance_date, { date_str: ta.attendance_date, total: 0, hadir: 0, tugas_luar: 0, izin: 0, sakit: 0 });
        }
        const entry = byDate.get(ta.attendance_date);
        entry.total += 1;
        if (ta.status === 'Hadir') entry.hadir += 1;
        else if (ta.status === 'TugasLuar') entry.tugas_luar += 1;
        else if (ta.status === 'Izin') entry.izin += 1;
        else if (ta.status === 'Sakit') entry.sakit += 1;
      }
      const rows = [...byDate.values()].sort((a, b) => a.date_str.localeCompare(b.date_str));
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: CLASS_COMPARISON */')) {
      const [startDate, endDate] = params;
      const allDays = buildMockClassifiedDays(startDate, endDate, null);
      const rows = testDbEngine.classes
        .filter((c) => c.status === 'Active')
        .sort((a, b) => a.level - b.level || a.class_name.localeCompare(b.class_name))
        .map((c) => {
          const ht = testDbEngine.teachers.find((t) => t.teacher_id === c.homeroom_teacher_id);
          const activeStudents = testDbEngine.students.filter((s) => s.class_id === c.class_id && s.status === 'Active');
          const studentIdSet = new Set(activeStudents.map((s) => s.student_id));
          const sum = summarizeClassifiedDays(allDays.filter((d) => studentIdSet.has(d.student_id)));
          return {
            class_id: c.class_id,
            class_name: c.class_name,
            level: c.level,
            homeroom_teacher_name: ht ? ht.name : null,
            active_students: activeStudents.length,
            ...sum
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: STUDENT_DISCIPLINE */')) {
      const [startDate, endDate, classId] = params;
      const allDays = buildMockClassifiedDays(startDate, endDate, null);
      const rows = testDbEngine.students
        .filter((s) => s.status === 'Active' && (!classId || s.class_id === classId))
        .map((s) => {
          const cls = testDbEngine.classes.find((c) => c.class_id === s.class_id) || {};
          const ht = testDbEngine.teachers.find((t) => t.teacher_id === cls.homeroom_teacher_id);
          const sum = summarizeClassifiedDays(allDays.filter((d) => d.student_id === s.student_id));
          return {
            student_id: s.student_id,
            name: s.name,
            nis: s.nis,
            nisn: s.nisn,
            class_id: s.class_id,
            class_name: cls.class_name || s.class_id,
            homeroom_teacher_name: ht ? ht.name : null,
            ...sum
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: TEACHER_PERFORMANCE */')) {
      const [startDate, endDate, classId] = params;
      const rows = testDbEngine.teachers
        .filter((t) => t.status === 'Active')
        .map((t) => {
          const logs = testDbEngine.teacher_attendance.filter((ta) => {
            if (ta.teacher_id !== t.teacher_id) return false;
            if (ta.attendance_date < startDate || ta.attendance_date > endDate) return false;
            if (classId && ta.class_id !== classId) return false;
            return true;
          });
          const logIds = new Set(logs.map((l) => l.attendance_id));
          const evCount = testDbEngine.attendance_evidences.filter((e) => logIds.has(e.attendance_id)).length;
          const dates = logs.map((l) => l.attendance_date).sort();
          return {
            teacher_id: t.teacher_id,
            name: t.name,
            position: t.position,
            subject: t.subject,
            target_weekly_hours: t.teaching_hours || 0,
            total_logs: logs.length,
            hadir_logs: logs.filter((r) => r.status === 'Hadir').length,
            izin_logs: logs.filter((r) => r.status === 'Izin').length,
            sakit_logs: logs.filter((r) => r.status === 'Sakit').length,
            tugas_luar_logs: logs.filter((r) => r.status === 'TugasLuar').length,
            verified_evidence_count: evCount,
            active_days: new Set(logs.map((l) => l.attendance_date)).size,
            classes_taught_count: new Set(logs.map((l) => l.class_id)).size,
            latest_date: dates.length ? dates[dates.length - 1] : null
          };
        })
        .sort((a, b) => b.total_logs - a.total_logs || a.name.localeCompare(b.name));
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: RECENT_JOURNALS */')) {
      const [startDate, endDate, classId] = params;
      const rows = testDbEngine.teacher_attendance
        .filter((ta) => ta.attendance_date >= startDate && ta.attendance_date <= endDate && (!classId || ta.class_id === classId))
        .sort((a, b) => b.attendance_date.localeCompare(a.attendance_date) || b.period - a.period)
        .slice(0, 30)
        .map((ta) => {
          const t = testDbEngine.teachers.find((x) => x.teacher_id === ta.teacher_id) || {};
          const c = testDbEngine.classes.find((x) => x.class_id === ta.class_id) || {};
          const hasEv = testDbEngine.attendance_evidences.some((e) => e.attendance_id === ta.attendance_id);
          return {
            attendance_id: ta.attendance_id,
            teacher_id: ta.teacher_id,
            teacher_name: t.name || ta.teacher_id,
            class_id: ta.class_id,
            class_name: c.class_name || ta.class_id,
            attendance_date: ta.attendance_date,
            period: ta.period,
            subject: ta.subject,
            materi: ta.materi,
            status: ta.status,
            has_evidence: hasEv
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: STUDENT_DATA_AUDIT */')) {
      const [classId] = params;
      const rows = testDbEngine.students
        .filter((s) => s.status === 'Active' && (!classId || s.class_id === classId))
        .map((s) => {
          const c = testDbEngine.classes.find((x) => x.class_id === s.class_id) || {};
          return {
            student_id: s.student_id,
            name: s.name,
            class_id: s.class_id,
            class_name: c.class_name || s.class_id,
            nis: s.nis,
            nisn: s.nisn,
            gender: s.gender,
            has_photo: photos.some((p) => p.student_id === s.student_id),
            has_kartu_pelajar: docs.some((d) => d.student_id === s.student_id && d.document_type === 'KARTU_PELAJAR')
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: STUDENT_ALPA_DAILY */')) {
      const [startDate, endDate, classId] = params;
      const classDayPeriods = new Map();
      for (const sa of testDbEngine.student_attendance) {
        if (sa.attendance_date < startDate || sa.attendance_date > endDate) continue;
        const ck = `${sa.class_id}::${sa.attendance_date}`;
        if (!classDayPeriods.has(ck)) classDayPeriods.set(ck, new Set());
        classDayPeriods.get(ck).add(sa.period);
      }

      const activeStudentSet = new Set(
        testDbEngine.students
          .filter((s) => s.status === 'Active' && (!classId || s.class_id === classId))
          .map((s) => s.student_id)
      );
      const stuDayMap = new Map();
      for (const sa of testDbEngine.student_attendance) {
        if (!activeStudentSet.has(sa.student_id)) continue;
        if (sa.attendance_date < startDate || sa.attendance_date > endDate) continue;
        const sk = `${sa.student_id}::${sa.class_id}::${sa.attendance_date}`;
        if (!stuDayMap.has(sk)) {
          stuDayMap.set(sk, {
            student_id: sa.student_id,
            class_id: sa.class_id,
            attendance_date: sa.attendance_date,
            recorded_periods: 0,
            hadir_day: 0,
            izin_day: 0,
            sakit_day: 0,
            alpa_day: 0
          });
        }
        const entry = stuDayMap.get(sk);
        entry.recorded_periods += 1;
        if (sa.status === 'Hadir') entry.hadir_day += 1;
        else if (sa.status === 'Izin') entry.izin_day += 1;
        else if (sa.status === 'Sakit') entry.sakit_day += 1;
        else if (sa.status === 'Alpa') entry.alpa_day += 1;
      }

      const rows = [...stuDayMap.values()]
        .filter((d) => d.alpa_day > 0)
        .map((d) => {
          const pSet = classDayPeriods.get(`${d.class_id}::${d.attendance_date}`);
          return {
            student_id: d.student_id,
            attendance_date: d.attendance_date,
            hadir_day: d.hadir_day,
            izin_day: d.izin_day,
            sakit_day: d.sakit_day,
            alpa_day: d.alpa_day,
            class_periods_day: pSet ? pSet.size : d.recorded_periods
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: STUDENT_TAZIR_SUMMARY */')) {
      const [endDate, semesterStart] = params;
      const activeStudentSet = new Set(
        testDbEngine.students.filter((s) => s.status === 'Active').map((s) => s.student_id)
      );
      const tazirRows = (testDbEngine.student_tazir_actions || []).filter(
        (sta) => activeStudentSet.has(sta.student_id) && sta.action_date <= endDate && sta.action_date >= semesterStart
      );
      const byStu = new Map();
      for (const sta of tazirRows) {
        if (!byStu.has(sta.student_id)) {
          byStu.set(sta.student_id, {
            student_id: sta.student_id,
            last_harian_date: null,
            last_jam_date: null,
            last_action_date: null,
            total_actions: 0
          });
        }
        const cur = byStu.get(sta.student_id);
        cur.total_actions += 1;
        if (!cur.last_action_date || sta.action_date > cur.last_action_date) cur.last_action_date = sta.action_date;
        if (sta.tazir_type === 'HARIAN' || sta.tazir_type === 'GABUNGAN') {
          if (!cur.last_harian_date || sta.action_date > cur.last_harian_date) cur.last_harian_date = sta.action_date;
        }
        if (sta.tazir_type === 'JAM' || sta.tazir_type === 'GABUNGAN') {
          if (!cur.last_jam_date || sta.action_date > cur.last_jam_date) cur.last_jam_date = sta.action_date;
        }
      }
      const rows = [...byStu.values()];
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: TAZIR_STUDENT_LOOKUP */')) {
      const [studentId] = params;
      const stu = testDbEngine.students.find((s) => s.student_id === studentId);
      if (!stu) return { rows: [], rowCount: 0 };
      const cls = testDbEngine.classes.find((c) => c.class_id === stu.class_id) || {};
      return {
        rows: [{
          student_id: stu.student_id,
          name: stu.name,
          nis: stu.nis,
          class_id: stu.class_id,
          class_name: cls.class_name || stu.class_id
        }],
        rowCount: 1
      };
    }

    if (q.includes('/* REPORTS: TAZIR_HISTORY_LIST */')) {
      const [studentId] = params;
      const rows = (testDbEngine.student_tazir_actions || [])
        .filter((sta) => sta.student_id === studentId)
        .sort((a, b) => b.action_date.localeCompare(a.action_date) || String(b.created_at).localeCompare(String(a.created_at)))
        .map((sta) => {
          const u = testDbEngine.users.find((x) => x.user_id === sta.recorded_by_user_id) || {};
          return {
            tazir_id: sta.tazir_id,
            student_id: sta.student_id,
            academic_year_id: sta.academic_year_id,
            tazir_type: sta.tazir_type,
            action_date: sta.action_date,
            trigger_summary: sta.trigger_summary,
            tazir_note: sta.tazir_note,
            created_at: sta.created_at,
            recorded_by_name: u.full_name || null
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: TAZIR_STUDENT_CHECK */')) {
      const [studentId] = params;
      const stu = testDbEngine.students.find((s) => s.student_id === studentId);
      return { rows: stu ? [{ student_id: stu.student_id, name: stu.name, status: stu.status }] : [], rowCount: stu ? 1 : 0 };
    }

    if (q.includes('/* REPORTS: TAZIR_INSERT */')) {
      const [tazirId, studentId, academicYearId, tazirType, actionDate, triggerSummary, tazirNote, recordedByUserId] = params;
      const row = {
        tazir_id: tazirId,
        student_id: studentId,
        academic_year_id: academicYearId,
        tazir_type: tazirType,
        action_date: actionDate,
        trigger_summary: triggerSummary,
        tazir_note: tazirNote,
        recorded_by_user_id: recordedByUserId,
        created_at: new Date().toISOString()
      };
      testDbEngine.student_tazir_actions.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (q.includes('/* REPORTS: TAZIR_DELETE */')) {
      const [tazirId] = params;
      const idx = (testDbEngine.student_tazir_actions || []).findIndex((r) => r.tazir_id === tazirId);
      if (idx < 0) return { rows: [], rowCount: 0 };
      const [removed] = testDbEngine.student_tazir_actions.splice(idx, 1);
      return { rows: [{ tazir_id: removed.tazir_id, student_id: removed.student_id }], rowCount: 1 };
    }

    if (q.includes('/* REPORTS: TEACHER_DATA_AUDIT */')) {
      const rows = testDbEngine.teachers
        .filter((t) => t.status === 'Active')
        .map((t) => ({
          teacher_id: t.teacher_id,
          name: t.name,
          position: t.position,
          subject: t.subject,
          has_nuptk: Boolean(t.nuptk && String(t.nuptk).trim()),
          has_nik: Boolean(t.nik && String(t.nik).trim()),
          has_nip: Boolean(t.nip && String(t.nip).trim()),
          has_photo: photos.some((p) => p.teacher_id === t.teacher_id)
        }));
      return { rows, rowCount: rows.length };
    }

    return testDbEngine.handleQuery(text, params);
  };
}

function assertCssAndHtmlIntegrity() {
  const rootDir = path.resolve(__dirname, '../..');
  const htmlPath = path.join(rootDir, 'public/dashboard.html');
  const cssPath = path.join(rootDir, 'public/css/dashboard.css');
  const clientPath = path.join(rootDir, 'public/js/simata-client.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const clientJs = fs.readFileSync(clientPath, 'utf8');

  // 1. CSS Brace Balance & Modern Responsive Hooks
  let openBraces = 0;
  for (const ch of css) {
    if (ch === '{') openBraces += 1;
    else if (ch === '}') openBraces -= 1;
    assert.ok(openBraces >= 0, 'CSS has unexpected closing brace');
  }
  assert.strictEqual(openBraces, 0, 'CSS must have balanced curly braces');
  assert.ok(css.includes('@container (width < 640px)'), 'CSS must include container query card layout for narrow viewports');
  assert.ok(css.includes('.rpt-acad-tab[aria-selected="true"]::after'), 'CSS must include non-color active indicator pseudo-element for tabs');
  assert.ok(css.includes('#reportsContent [hidden]'), 'CSS must enforce display:none for [hidden] elements inside #reportsContent');
  assert.ok(css.includes('dialog.rpt-tazir-dialog[open]'), 'CSS must scope dialog display via [open] state');
  assert.ok(css.includes('dialog.rpt-tazir-dialog:modal'), 'CSS must contain modal overscroll containment');
  assert.ok(
    css.includes('#rptAcadExportCsvBtn,\n  #rptAcadPrintBtn {\n    display: none !important;') ||
    css.includes('#rptAcadExportCsvBtn,\r\n  #rptAcadPrintBtn {\r\n    display: none !important;'),
    'Mobile CSS must hide #rptAcadExportCsvBtn and #rptAcadPrintBtn'
  );
  assert.ok(css.includes('.dashboard-layout #reportsContent .section-heading.rpt-acad-header'), 'Mobile CSS must standardize #reportsContent inline pill header layout');

  // 2. HTML UI Structure & Scope Boundaries
  const reportsSectionMatch = html.match(/<section id="reportsContent"[\s\S]*?<\/section>/);
  assert.ok(reportsSectionMatch, 'dashboard.html must contain #reportsContent section');
  const reportsHtml = reportsSectionMatch[0];
  assert.ok(!reportsHtml.includes('development-notice'), '#reportsContent placeholder development-notice must be removed');
  assert.ok(reportsHtml.includes('role="tablist"'), '#reportsContent must render accessible role="tablist"');
  assert.ok(reportsHtml.includes('focusgroup="tablist nomemory"'), '#reportsContent tablist must include focusgroup="tablist nomemory"');
  assert.ok(reportsHtml.includes('<dialog id="rptAcadTazirDialog"'), '#reportsContent must include native <dialog id="rptAcadTazirDialog">');
  assert.ok(!/id="rptAcadTazirDialog"[^>]*\brole=["']dialog["']/.test(reportsHtml), 'Native modal <dialog> must not set redundant role="dialog"');
  const tabPanelMatches = reportsHtml.match(/role="tabpanel"/g) || [];
  assert.strictEqual(tabPanelMatches.length, 4, '#reportsContent must contain exactly 4 tab panels');
  assert.ok(reportsHtml.includes('id="rptAcadUnitGroup"'), '#reportsContent must include Harian/Detail JP unit toggle');
  assert.ok(reportsHtml.includes('data-unit="days"'), '#reportsContent must support daily student-days mode');
  assert.ok(reportsHtml.includes('data-unit="jp"'), '#reportsContent must support JP detail mode');
  assert.ok(/\/css\/dashboard\.css\?v=bug5(?:8[c-z]|9[a-z]*)/.test(html), 'dashboard.html must reference up-to-date dashboard.css cache-buster (>= ?v=bug58c)');

  // Grades menu untouched (reserved for external RDM integration later)
  const gradesSectionMatch = html.match(/<section id="gradesContent"[\s\S]*?<\/section>/);
  assert.ok(gradesSectionMatch && gradesSectionMatch[0].includes('development-notice'), '#gradesContent must remain unchanged for future RDM redirect');

  // 3. Inline Script Compilation Check in dashboard.html & simata-client.js
  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let compiledScripts = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    if (code.trim()) {
      new vm.Script(code, { filename: 'dashboard-inline.js' });
      compiledScripts += 1;
    }
  }
  assert.ok(compiledScripts >= 2, 'dashboard.html inline scripts must compile cleanly');
  new vm.Script(clientJs, { filename: 'simata-client.js' });
  assert.ok(clientJs.includes('getAcademicReports'), 'simata-client.js must expose getAcademicReports');
  assert.ok(clientJs.includes('getStudentTazirHistory'), 'simata-client.js must expose getStudentTazirHistory');
  assert.ok(clientJs.includes('recordStudentTazir'), 'simata-client.js must expose recordStudentTazir');
  assert.ok(clientJs.includes('deleteStudentTazir'), 'simata-client.js must expose deleteStudentTazir');
}

async function runBug56ReportsTests() {
  console.log('\n===============================================================');
  console.log('BUG 56: ACADEMIC REPORTS ANALYTICS & TAZIR DISCIPLINE SUITE');
  console.log('===============================================================');

  assertCssAndHtmlIntegrity();
  console.log('1. PASS: HTML (<dialog> rules), CSS braces/container queries, and inline JS compilation verified.');

  await testDbEngine.reset();
  testDbEngine.profile_photos = [];
  testDbEngine.student_tazir_actions = [];

  setMockQueryHandler(createReportsMockQueryHandler());
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 2. Unauthenticated rejection
    const unauthRes = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic');
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated GET /reports/academic must return 401');

    // Login Admin & Guru
    const adminLogin = await requestJson(baseUrl, 'POST', '/api/v1/auth/login', {
      token: null
    });
    assert.strictEqual(adminLogin.status, 400);

    const doLogin = async (username, password) => {
      const r = await globalThis.fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      return r.json();
    };

    const adminAuth = await doLogin('Admin1', '12345');
    const guruAuth = await doLogin('Guru_001', 'Guru001');
    const adminToken = adminAuth.data.token;
    const guruToken = guruAuth.data.token;

    // 3. Seed representative students, attendance, journals, photos, documents
    testDbEngine.students.push(
      {
        student_id: 'STD-K11001',
        class_id: 'CLS-2627-11',
        name: 'MUHAMMAD RIZQI',
        gender: 'L',
        nis: '1101',
        nisn: '',
        qr_code_id: 'SQR-11001',
        status: 'Active'
      },
      {
        student_id: 'STD-K11002',
        class_id: 'CLS-2627-11',
        name: 'HISYAM IZIN SAKIT',
        gender: 'L',
        nis: '1102',
        nisn: '001102',
        qr_code_id: 'SQR-11002',
        status: 'Active'
      },
      {
        student_id: 'STD-K11003',
        class_id: 'CLS-2627-11',
        name: 'AHMAD DUAL TRIGGER',
        gender: 'L',
        nis: '1103',
        nisn: '001103',
        qr_code_id: 'SQR-11003',
        status: 'Active'
      }
    );
    testDbEngine.teachers[0].teaching_hours = 24;
    testDbEngine.teachers[1].teaching_hours = 18;

    testDbEngine.profile_photos.push(
      { photo_id: 'PHT-1', student_id: 'STD-K10002', teacher_id: null },
      { photo_id: 'PHT-2', student_id: null, teacher_id: 'TCH-0001' }
    );
    testDbEngine.student_documents.push({
      document_id: 'DOC-1',
      student_id: 'STD-K10002',
      document_type: 'KARTU_PELAJAR'
    });

    // Previous period (2026-10-17 .. 2026-10-31): 4 Hadir out of 4 = 100%
    for (let p = 1; p <= 4; p += 1) {
      testDbEngine.student_attendance.push({
        attendance_id: `SA-PREV-${p}`,
        student_id: 'STD-K10001',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: '2026-10-20',
        period: p,
        status: 'Hadir'
      });
    }

    // Earlier in semester (2026-09-01..2026-09-04):
    // STD-K11003 gets 4 full-day Alpa (2 periods/day, all Alpa) -> triggers Harian from semester window!
    for (const dt of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      for (let p = 1; p <= 2; p += 1) {
        testDbEngine.student_attendance.push({
          attendance_id: `SA-SEP-DUAL-${dt}-${p}`,
          student_id: 'STD-K11003',
          class_id: 'CLS-2627-11',
          academic_year_id: '2026/2027',
          attendance_date: dt,
          period: p,
          status: 'Alpa'
        });
      }
    }

    // Current period (2026-11-01 .. 2026-11-15):
    // CLS-2627-10: STD-K10001 has 4 full-day Alpa (2 periods/day on Nov 2..5) + 2 Hadir (Nov 10) => 4 full days => HIGH ("Ta'zir Alpa Harian")
    //              STD-K10002 has 10 Hadir on those same 5 days => 100% => SAFE ("Aman")
    let seqId = 1;
    for (const dt of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) {
      for (let p = 1; p <= 2; p += 1) {
        testDbEngine.student_attendance.push(
          {
            attendance_id: `SA-CURR-${seqId++}`,
            student_id: 'STD-K10001',
            class_id: 'CLS-2627-10',
            academic_year_id: '2026/2027',
            attendance_date: dt,
            period: p,
            status: 'Alpa'
          },
          {
            attendance_id: `SA-CURR-${seqId++}`,
            student_id: 'STD-K10002',
            class_id: 'CLS-2627-10',
            academic_year_id: '2026/2027',
            attendance_date: dt,
            period: p,
            status: 'Hadir'
          }
        );
      }
    }
    for (let p = 1; p <= 2; p += 1) {
      testDbEngine.student_attendance.push(
        {
          attendance_id: `SA-CURR-${seqId++}`,
          student_id: 'STD-K10001',
          class_id: 'CLS-2627-10',
          academic_year_id: '2026/2027',
          attendance_date: '2026-11-10',
          period: p,
          status: 'Hadir'
        },
        {
          attendance_id: `SA-CURR-${seqId++}`,
          student_id: 'STD-K10002',
          class_id: 'CLS-2627-10',
          academic_year_id: '2026/2027',
          attendance_date: '2026-11-10',
          period: p,
          status: 'Hadir'
        }
      );
    }

    // CLS-2627-11:
    // STD-K11002: 3 Izin + 3 Sakit, 0 Hadir, 0 Alpa on Nov 9 -> MUST remain WATCH ("Pantauan"), NEVER Ta'zir!
    for (let p = 1; p <= 6; p += 1) {
      testDbEngine.student_attendance.push({
        attendance_id: `SA-CURR-${seqId++}`,
        student_id: 'STD-K11002',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-09',
        period: p,
        status: p <= 3 ? 'Izin' : 'Sakit'
      });
    }

    // STD-K11001: 3 partial-JP Alpa in rolling 7 days (Nov 10 p2, Nov 11 p2, Nov 12 sparse 1-period day p1!) => MEDIUM ("Ta'zir Alpa Jam")
    // STD-K11003: 3 partial-JP Alpa in rolling 7 days (Nov 10 p2, Nov 11 p2, Nov 13 p2) + 4 Sept full days => HIGH Dual Trigger (GABUNGAN)
    for (const dt of ['2026-11-10', '2026-11-11']) {
      testDbEngine.student_attendance.push(
        {
          attendance_id: `SA-CURR-${seqId++}`,
          student_id: 'STD-K11001',
          class_id: 'CLS-2627-11',
          academic_year_id: '2026/2027',
          attendance_date: dt,
          period: 1,
          status: 'Hadir'
        },
        {
          attendance_id: `SA-CURR-${seqId++}`,
          student_id: 'STD-K11001',
          class_id: 'CLS-2627-11',
          academic_year_id: '2026/2027',
          attendance_date: dt,
          period: 2,
          status: 'Alpa'
        },
        {
          attendance_id: `SA-CURR-${seqId++}`,
          student_id: 'STD-K11003',
          class_id: 'CLS-2627-11',
          academic_year_id: '2026/2027',
          attendance_date: dt,
          period: 1,
          status: 'Hadir'
        },
        {
          attendance_id: `SA-CURR-${seqId++}`,
          student_id: 'STD-K11003',
          class_id: 'CLS-2627-11',
          academic_year_id: '2026/2027',
          attendance_date: dt,
          period: 2,
          status: 'Alpa'
        }
      );
    }
    // Sparse 1-period class day (2026-11-12): ONLY 1 period in CLS-2627-11 -> counts as Alpa per jam!
    testDbEngine.student_attendance.push({
      attendance_id: `SA-CURR-${seqId++}`,
      student_id: 'STD-K11001',
      class_id: 'CLS-2627-11',
      academic_year_id: '2026/2027',
      attendance_date: '2026-11-12',
      period: 1,
      status: 'Alpa'
    });
    // 2026-11-13 (2 periods): STD-K11001 Hadir x2, STD-K11003 Hadir+Alpa
    testDbEngine.student_attendance.push(
      {
        attendance_id: `SA-CURR-${seqId++}`,
        student_id: 'STD-K11001',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-13',
        period: 1,
        status: 'Hadir'
      },
      {
        attendance_id: `SA-CURR-${seqId++}`,
        student_id: 'STD-K11001',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-13',
        period: 2,
        status: 'Hadir'
      },
      {
        attendance_id: `SA-CURR-${seqId++}`,
        student_id: 'STD-K11003',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-13',
        period: 1,
        status: 'Hadir'
      },
      {
        attendance_id: `SA-CURR-${seqId++}`,
        student_id: 'STD-K11003',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-13',
        period: 2,
        status: 'Alpa'
      }
    );

    // Teacher attendance + 1 verified photo evidence
    testDbEngine.teacher_attendance.push(
      {
        attendance_id: 'TA-CURR-1',
        teacher_id: 'TCH-0001',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-03',
        period: 1,
        subject: 'Fiqih',
        materi: 'Bab Zakat Mal & Fitrah',
        status: 'Hadir'
      },
      {
        attendance_id: 'TA-CURR-2',
        teacher_id: 'TCH-0001',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-04',
        period: 2,
        subject: 'Fiqih',
        materi: 'Praktik Manasik',
        status: 'TugasLuar'
      },
      {
        attendance_id: 'TA-CURR-3',
        teacher_id: 'TCH-0002',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-05',
        period: 3,
        subject: 'Bahasa Arab',
        materi: 'Mufrodat Madrasah',
        status: 'Sakit'
      }
    );
    testDbEngine.attendance_evidences.push({
      evidence_id: 'EVD-1',
      session_id: 'SES-1',
      attendance_id: 'TA-CURR-1'
    });

    // 4. Input Validation Checks
    const badPreset = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=yearly', { token: adminToken });
    assert.strictEqual(badPreset.status, 400, 'Invalid preset must return 400');

    const badCustomDates = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-20&endDate=2026-11-01', { token: adminToken });
    assert.strictEqual(badCustomDates.status, 400, 'startDate > endDate must return 400');

    const badClass = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?classId=CLS-NOPE', { token: adminToken });
    assert.strictEqual(badClass.status, 400, 'Unknown classId must return 400');

    // 5. Full Report Assertion (ADMIN)
    const rptRes = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-01&endDate=2026-11-15', { token: adminToken });
    assert.strictEqual(rptRes.status, 200, 'Authorized academic report request must succeed');
    const data = rptRes.json.data;

    // Overview KPI assertions (BUG 58): Daily student-days primary (12 Hadir / 18 total_days = 66.7%, prev = 100%, delta = -33.3) + JP metrics preserved (19/39 = 48.7%)
    assert.strictEqual(data.overview.student_attendance_rate, 66.7);
    assert.strictEqual(data.overview.student_attendance_delta, -33.3);
    assert.strictEqual(data.overview.student_total_days, 18);
    assert.deepStrictEqual(data.overview.student_daily_breakdown, {
      hadir: 12,
      izin: 0,
      sakit: 1,
      alpa: 5,
      partial_alpa_jp: 6
    });
    assert.strictEqual(data.overview.student_attendance_rate_jp, 48.7);
    assert.strictEqual(data.overview.student_attendance_delta_jp, -51.3);
    assert.strictEqual(data.overview.student_breakdown.alpa, 14);
    assert.strictEqual(data.overview.teacher_execution_rate, 66.7); // (1 Hadir + 1 TugasLuar) / 3
    assert.strictEqual(data.overview.teacher_evidence_verified, 1);
    assert.strictEqual(data.overview.harian_tazir_count, 2); // STD-K10001 + STD-K11003
    assert.strictEqual(data.overview.jam_tazir_count, 1);    // STD-K11001
    assert.strictEqual(data.overview.attention_students_count, 3); // Perlu Ta'zir (HIGH + MEDIUM)
    assert.strictEqual(data.overview.rdm_notice.system_name, 'RDM Madrasah Kemenag');
    assert.deepStrictEqual(data.discipline.rules, {
      harian_threshold_days: 4,
      jam_threshold_jp: 3,
      semester_start: '2026-07-01',
      week_start: '2026-11-09',
      window_end: '2026-11-15'
    });

    // Discipline sorting, Opsi A classifications & custom rules verification
    const stuById = new Map(data.discipline.students.map((s) => [s.student_id, s]));
    const sK10001 = stuById.get('STD-K10001');
    const sK10002 = stuById.get('STD-K10002');
    const sK11001 = stuById.get('STD-K11001');
    const sK11002 = stuById.get('STD-K11002');
    const sK11003 = stuById.get('STD-K11003');

    // STD-K10001: 4 full days Alpa (8 JP across 4 full days must NOT double-count into partial JP!)
    assert.strictEqual(sK10001.risk_level, 'HIGH');
    assert.strictEqual(sK10001.risk_label, "Ta'zir Alpa Harian");
    assert.strictEqual(sK10001.hadir_days, 1);
    assert.strictEqual(sK10001.alpa_days, 4);
    assert.strictEqual(sK10001.partial_alpa_jp, 0);
    assert.strictEqual(sK10001.alpa_full_days_sem, 4);
    assert.strictEqual(sK10001.alpa_partial_jp_week, 0);
    assert.strictEqual(sK10001.needs_tazir, true);
    assert.strictEqual(sK10001.dual_trigger, false);
    assert.strictEqual(sK10001.recommended_tazir_type, 'HARIAN');

    // STD-K11003: Dual Trigger (4 full days in Sept + 3 partial JP in Nov 7d) -> GABUNGAN
    assert.strictEqual(sK11003.risk_level, 'HIGH');
    assert.strictEqual(sK11003.risk_label, "Ta'zir Alpa Harian");
    assert.strictEqual(sK11003.hadir_days, 3);
    assert.strictEqual(sK11003.alpa_days, 0);
    assert.strictEqual(sK11003.partial_alpa_jp, 3);
    assert.strictEqual(sK11003.attendance_pct, 100);
    assert.strictEqual(sK11003.attendance_pct_jp, 50);
    assert.strictEqual(sK11003.alpa_full_days_sem, 4);
    assert.strictEqual(sK11003.alpa_partial_jp_week, 3);
    assert.strictEqual(sK11003.dual_trigger, true);
    assert.strictEqual(sK11003.recommended_tazir_type, 'GABUNGAN');

    // STD-K11001: 3 partial-JP Alpa in 7d (including sparse 1-period day on Nov 12) -> Ta'zir Bolos Jam
    assert.strictEqual(sK11001.risk_level, 'MEDIUM');
    assert.strictEqual(sK11001.risk_label, "Ta'zir Bolos Jam");
    assert.strictEqual(sK11001.hadir_days, 3);
    assert.strictEqual(sK11001.alpa_days, 1);
    assert.strictEqual(sK11001.partial_alpa_jp, 3);
    assert.strictEqual(sK11001.alpa_full_days_sem, 0);
    assert.strictEqual(sK11001.alpa_partial_jp_week, 3);
    assert.strictEqual(sK11001.recommended_tazir_type, 'JAM');

    // STD-K11002: Heavy Izin+Sakit (3+3 JP on 1 day, 0% hadir) -> 1 Sakit day, Alpa=0 -> MUST remain WATCH ("Pantauan"), NEVER Ta'zir!
    assert.strictEqual(sK11002.risk_level, 'WATCH');
    assert.strictEqual(sK11002.risk_label, 'Pantauan');
    assert.strictEqual(sK11002.sakit_days + sK11002.izin_days, 1);
    assert.strictEqual(sK11002.alpa_days, 0);
    assert.strictEqual(sK11002.partial_alpa_jp, 0);
    assert.strictEqual(sK11002.needs_tazir, false);
    assert.ok(sK11002.trigger_reason.includes('1 hr') && sK11002.trigger_reason.includes('Alpa 0'), 'Izin/Sakit-only student must display daily unit + Alpa 0 note');

    // STD-K10002: Clean -> Aman
    assert.strictEqual(sK10002.risk_level, 'SAFE');
    assert.strictEqual(sK10002.risk_label, 'Aman');

    // Per-Class comparison includes both daily student-days + partial_alpa_jp + JP totals
    const cls10 = data.per_class.find((c) => c.class_id === 'CLS-2627-10');
    const cls11 = data.per_class.find((c) => c.class_id === 'CLS-2627-11');
    assert.strictEqual(cls10.hadir_days, 6);
    assert.strictEqual(cls10.alpa_days, 4);
    assert.strictEqual(cls10.partial_alpa_jp, 0);
    assert.strictEqual(cls10.attendance_pct, 60);
    assert.strictEqual(cls11.hadir_days, 6);
    assert.strictEqual(cls11.sakit_days, 1);
    assert.strictEqual(cls11.alpa_days, 1);
    assert.strictEqual(cls11.partial_alpa_jp, 6);
    assert.strictEqual(cls11.attendance_pct, 75);

    // Teacher latest journal enrichment
    const tch1 = data.teacher_performance.teachers.find((t) => t.teacher_id === 'TCH-0001');
    assert.ok(tch1 && tch1.total_logs === 2 && tch1.verified_evidence_count === 1);
    assert.strictEqual(tch1.latest_materi, 'Praktik Manasik');

    // Data Audit completeness & privacy check (no raw NIK/NUPTK leaked)
    assert.strictEqual(data.data_audit.summary.complete_students, 1);
    assert.strictEqual(data.data_audit.summary.student_photo_count, 1);
    assert.strictEqual(data.data_audit.summary.student_kartu_count, 1);
    const serializedAudit = JSON.stringify(data.data_audit);
    assert.ok(!serializedAudit.includes('3317010101700001'), 'Raw teacher NIK must NOT be serialized into report audit JSON');
    assert.ok(!serializedAudit.includes('197001012000031001'), 'Raw teacher NIP must NOT be serialized into report audit JSON');

    // 6. GURU access + class filter check (CLS-2627-10 only)
    const guruClassRes = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-01&endDate=2026-11-15&classId=CLS-2627-10', { token: guruToken });
    assert.strictEqual(guruClassRes.status, 200, 'GURU must be allowed access to academic reports');
    assert.strictEqual(guruClassRes.json.data.discipline.students.length, 2, 'Class filter must restrict discipline students to CLS-2627-10');
    assert.strictEqual(guruClassRes.json.data.overview.student_attendance_rate, 60); // 12 Hadir / 20 records

    // 7. Ta'zir Execution, Settlement Reset, History Retrieval & Admin Undo Flow
    // 7a. Invalid type rejected (400) & Student lookup 404
    const badTazir = await requestJson(baseUrl, 'POST', '/api/v1/reports/tazir', {
      token: guruToken,
      body: { student_id: 'STD-K10001', tazir_type: 'INVALID', action_date: '2026-11-15' }
    });
    assert.strictEqual(badTazir.status, 400, 'Invalid tazir_type must return 400');

    // 7b. Record Harian Ta'zir on 2026-11-03 (partially settles Nov 2-3, leaving Nov 4-5 = 2 days -> Pantauan!)
    const partialSettle = await requestJson(baseUrl, 'POST', '/api/v1/reports/tazir', {
      token: guruToken,
      body: {
        student_id: 'STD-K10001',
        tazir_type: 'HARIAN',
        action_date: '2026-11-03',
        trigger_summary: '2 hr awal',
        tazir_note: 'Pembinaan awal'
      }
    });
    assert.strictEqual(partialSettle.status, 201, 'GURU must be allowed to record Ta\'zir execution');
    const partialTazirId = partialSettle.json.data.tazir_id;

    const afterPartial = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-01&endDate=2026-11-15', { token: guruToken });
    const k1Partial = afterPartial.json.data.discipline.students.find((s) => s.student_id === 'STD-K10001');
    assert.strictEqual(k1Partial.alpa_full_days_sem, 2, 'Settlement up to 2026-11-03 must count only subsequent days (Nov 4, Nov 5)');
    assert.strictEqual(k1Partial.risk_level, 'WATCH', 'With 2 unsettled full days remaining, student drops to Pantauan');
    assert.strictEqual(k1Partial.tazir_count, 1);

    // 7c. Record GABUNGAN Ta'zir on 2026-11-15 for STD-K11003 (resets both Harian & Jam -> Aman!)
    const dualSettle = await requestJson(baseUrl, 'POST', '/api/v1/reports/tazir', {
      token: guruToken,
      body: {
        student_id: 'STD-K11003',
        tazir_type: 'GABUNGAN',
        action_date: '2026-11-15',
        trigger_summary: '4 hr penuh + 3 JP',
        tazir_note: 'Pemanggilan wali murid & hafalan'
      }
    });
    assert.strictEqual(dualSettle.status, 201);
    const afterDual = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-01&endDate=2026-11-15', { token: adminToken });
    const k11003After = afterDual.json.data.discipline.students.find((s) => s.student_id === 'STD-K11003');
    assert.strictEqual(k11003After.risk_level, 'WATCH', 'After Ta\'zir settlement with Alpa visible in view range, student drops from Ta\'zir to Pantauan');
    // Actually verify dual unsettlement specifically:
    assert.strictEqual(k11003After.alpa_full_days_sem, 0, 'GABUNGAN settles Harian full-day count to 0');
    assert.strictEqual(k11003After.alpa_partial_jp_week, 0, 'GABUNGAN settles Jam partial-JP count to 0');
    assert.strictEqual(k11003After.needs_tazir, false);

    // Query when view window is after action_date (2026-11-16..2026-11-20 with 0 new Alpa) -> SAFE ("Tuntas 1x Ta'zir")
    const afterCleanPeriod = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-16&endDate=2026-11-20', { token: adminToken });
    const k11003Clean = afterCleanPeriod.json.data.discipline.students.find((s) => s.student_id === 'STD-K11003');
    assert.strictEqual(k11003Clean.risk_level, 'SAFE');
    assert.strictEqual(k11003Clean.trigger_reason, "Tuntas 1x Ta'zir");

    // 7d. History GET (GURU allowed) & DELETE RBAC (GURU 403 -> ADMIN 200 restores counts)
    const histRes = await requestJson(baseUrl, 'GET', '/api/v1/reports/tazir/STD-K10001', { token: guruToken });
    assert.strictEqual(histRes.status, 200);
    assert.strictEqual(histRes.json.data.history.length, 1);
    assert.strictEqual(histRes.json.data.history[0].tazir_id, partialTazirId);

    const guruDelRes = await requestJson(baseUrl, 'DELETE', `/api/v1/reports/tazir/${partialTazirId}`, { token: guruToken });
    assert.strictEqual(guruDelRes.status, 403, 'Only ADMIN may delete Ta\'zir history');

    const adminDelRes = await requestJson(baseUrl, 'DELETE', `/api/v1/reports/tazir/${partialTazirId}`, { token: adminToken });
    assert.strictEqual(adminDelRes.status, 200, 'ADMIN delete Ta\'zir history must return 200');

    const restoredReport = await requestJson(baseUrl, 'GET', '/api/v1/reports/academic?preset=custom&startDate=2026-11-01&endDate=2026-11-15', { token: adminToken });
    const k1Restored = restoredReport.json.data.discipline.students.find((s) => s.student_id === 'STD-K10001');
    assert.strictEqual(k1Restored.alpa_full_days_sem, 4, 'Deleting Ta\'zir record must restore unsettled full-day count to 4');
    assert.strictEqual(k1Restored.risk_level, 'HIGH');

    // 8. Standard presets (7d, month, semester)
    for (const preset of ['7d', 'month', 'semester']) {
      const pRes = await requestJson(baseUrl, 'GET', `/api/v1/reports/academic?preset=${preset}`, { token: adminToken });
      assert.strictEqual(pRes.status, 200, `Preset '${preset}' must return HTTP 200`);
    }

    console.log('2. PASS: Reports RBAC, Ta\'zir rules (Harian/Jam/Dual/Alpa=0 Pantauan), settlement & history undo verified.');
    console.log('ALL BUG 56 ACADEMIC REPORT & TAZIR TESTS PASSED.');
    return true;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runBug56ReportsTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 56 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug56ReportsTests;
