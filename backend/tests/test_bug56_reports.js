const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

async function requestJson(baseUrl, method, urlPath, { token = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await globalThis.fetch(`${baseUrl}${urlPath}`, { method, headers });
  const json = await res.json();
  return { status: res.status, json };
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
      const filtered = testDbEngine.student_attendance.filter((sa) => {
        if (sa.attendance_date < startDate || sa.attendance_date > endDate) return false;
        if (classId && sa.class_id !== classId) return false;
        return true;
      });
      const activeDays = new Set(filtered.map((sa) => sa.attendance_date)).size;
      const row = {
        total_records: filtered.length,
        hadir: filtered.filter((r) => r.status === 'Hadir').length,
        izin: filtered.filter((r) => r.status === 'Izin').length,
        sakit: filtered.filter((r) => r.status === 'Sakit').length,
        alpa: filtered.filter((r) => r.status === 'Alpa').length,
        active_days: activeDays
      };
      return { rows: [row], rowCount: 1 };
    }

    if (q.includes('/* REPORTS: STUDENT_DAILY */')) {
      const [startDate, endDate, classId] = params;
      const byDate = new Map();
      for (const sa of testDbEngine.student_attendance) {
        if (sa.attendance_date < startDate || sa.attendance_date > endDate) continue;
        if (classId && sa.class_id !== classId) continue;
        if (!byDate.has(sa.attendance_date)) {
          byDate.set(sa.attendance_date, { date_str: sa.attendance_date, total: 0, hadir: 0, izin: 0, sakit: 0, alpa: 0 });
        }
        const entry = byDate.get(sa.attendance_date);
        entry.total += 1;
        if (sa.status === 'Hadir') entry.hadir += 1;
        else if (sa.status === 'Izin') entry.izin += 1;
        else if (sa.status === 'Sakit') entry.sakit += 1;
        else if (sa.status === 'Alpa') entry.alpa += 1;
      }
      const rows = [...byDate.values()].sort((a, b) => a.date_str.localeCompare(b.date_str));
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
      const rows = testDbEngine.classes
        .filter((c) => c.status === 'Active')
        .sort((a, b) => a.level - b.level || a.class_name.localeCompare(b.class_name))
        .map((c) => {
          const ht = testDbEngine.teachers.find((t) => t.teacher_id === c.homeroom_teacher_id);
          const activeStudents = testDbEngine.students.filter((s) => s.class_id === c.class_id && s.status === 'Active');
          const studentIdSet = new Set(activeStudents.map((s) => s.student_id));
          const logs = testDbEngine.student_attendance.filter((sa) => studentIdSet.has(sa.student_id) && sa.attendance_date >= startDate && sa.attendance_date <= endDate);
          return {
            class_id: c.class_id,
            class_name: c.class_name,
            level: c.level,
            homeroom_teacher_name: ht ? ht.name : null,
            active_students: activeStudents.length,
            total_records: logs.length,
            hadir: logs.filter((r) => r.status === 'Hadir').length,
            izin: logs.filter((r) => r.status === 'Izin').length,
            sakit: logs.filter((r) => r.status === 'Sakit').length,
            alpa: logs.filter((r) => r.status === 'Alpa').length
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (q.includes('/* REPORTS: STUDENT_DISCIPLINE */')) {
      const [startDate, endDate, classId] = params;
      const rows = testDbEngine.students
        .filter((s) => s.status === 'Active' && (!classId || s.class_id === classId))
        .map((s) => {
          const cls = testDbEngine.classes.find((c) => c.class_id === s.class_id) || {};
          const ht = testDbEngine.teachers.find((t) => t.teacher_id === cls.homeroom_teacher_id);
          const logs = testDbEngine.student_attendance.filter((sa) => sa.student_id === s.student_id && sa.attendance_date >= startDate && sa.attendance_date <= endDate);
          return {
            student_id: s.student_id,
            name: s.name,
            nis: s.nis,
            nisn: s.nisn,
            class_id: s.class_id,
            class_name: cls.class_name || s.class_id,
            homeroom_teacher_name: ht ? ht.name : null,
            total_records: logs.length,
            hadir: logs.filter((r) => r.status === 'Hadir').length,
            izin: logs.filter((r) => r.status === 'Izin').length,
            sakit: logs.filter((r) => r.status === 'Sakit').length,
            alpa: logs.filter((r) => r.status === 'Alpa').length
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

  // 2. HTML UI Structure & Scope Boundaries
  const reportsSectionMatch = html.match(/<section id="reportsContent"[\s\S]*?<\/section>/);
  assert.ok(reportsSectionMatch, 'dashboard.html must contain #reportsContent section');
  const reportsHtml = reportsSectionMatch[0];
  assert.ok(!reportsHtml.includes('development-notice'), '#reportsContent placeholder development-notice must be removed');
  assert.ok(reportsHtml.includes('role="tablist"'), '#reportsContent must render accessible role="tablist"');
  assert.ok(reportsHtml.includes('focusgroup="tablist nomemory"'), '#reportsContent tablist must include focusgroup="tablist nomemory"');
  const tabPanelMatches = reportsHtml.match(/role="tabpanel"/g) || [];
  assert.strictEqual(tabPanelMatches.length, 4, '#reportsContent must contain exactly 4 tab panels');

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
}

async function runBug56ReportsTests() {
  console.log('\n===============================================================');
  console.log('BUG 56: ACADEMIC REPORTS ANALYTICS & MOBILE UI REGRESSION SUITE');
  console.log('===============================================================');

  assertCssAndHtmlIntegrity();
  console.log('1. PASS: HTML, CSS braces/container queries, and inline JS compilation verified.');

  await testDbEngine.reset();
  testDbEngine.profile_photos = [];

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
    testDbEngine.students.push({
      student_id: 'STD-K11001',
      class_id: 'CLS-2627-11',
      name: 'MUHAMMAD RIZQI',
      gender: 'L',
      nis: '1101',
      nisn: '',
      qr_code_id: 'SQR-11001',
      status: 'Active'
    });
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

    // Current period (2026-11-01 .. 2026-11-15):
    // STD-K10001: 7 Hadir, 3 Alpa => 70% & Alpa=3 => HIGH ("Panggil Wali")
    for (let p = 1; p <= 10; p += 1) {
      testDbEngine.student_attendance.push({
        attendance_id: `SA-CURR-1-${p}`,
        student_id: 'STD-K10001',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: p <= 7 ? '2026-11-03' : '2026-11-04',
        period: ((p - 1) % 7) + 1,
        status: p <= 7 ? 'Hadir' : 'Alpa'
      });
    }
    // STD-K10002: 10 Hadir => 100% => SAFE ("Aman")
    for (let p = 1; p <= 10; p += 1) {
      testDbEngine.student_attendance.push({
        attendance_id: `SA-CURR-2-${p}`,
        student_id: 'STD-K10002',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-03',
        period: p,
        status: 'Hadir'
      });
    }
    // STD-K11001: 3 Hadir, 1 Alpa => 75% => MEDIUM ("Peringatan")
    for (let p = 1; p <= 4; p += 1) {
      testDbEngine.student_attendance.push({
        attendance_id: `SA-CURR-3-${p}`,
        student_id: 'STD-K11001',
        class_id: 'CLS-2627-11',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-05',
        period: p,
        status: p === 4 ? 'Alpa' : 'Hadir'
      });
    }

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

    // Overview KPI assertions: 20 Hadir out of 24 total = 83.3%, prev = 100.0%, delta = -16.7
    assert.strictEqual(data.overview.student_attendance_rate, 83.3);
    assert.strictEqual(data.overview.student_attendance_delta, -16.7);
    assert.strictEqual(data.overview.student_breakdown.alpa, 4);
    assert.strictEqual(data.overview.teacher_execution_rate, 66.7); // (1 Hadir + 1 TugasLuar) / 3
    assert.strictEqual(data.overview.teacher_evidence_verified, 1);
    assert.strictEqual(data.overview.alpa_3plus_count, 1);
    assert.strictEqual(data.overview.attention_students_count, 2); // HIGH + MEDIUM
    assert.strictEqual(data.overview.rdm_notice.system_name, 'RDM Madrasah Kemenag');

    // Discipline sorting & risk classification
    assert.strictEqual(data.discipline.students[0].student_id, 'STD-K10001');
    assert.strictEqual(data.discipline.students[0].risk_level, 'HIGH');
    assert.strictEqual(data.discipline.students[0].risk_label, 'Panggil Wali');
    assert.strictEqual(data.discipline.students[1].student_id, 'STD-K11001');
    assert.strictEqual(data.discipline.students[1].risk_level, 'MEDIUM');
    assert.strictEqual(data.discipline.students[2].student_id, 'STD-K10002');
    assert.strictEqual(data.discipline.students[2].risk_level, 'SAFE');

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
    assert.strictEqual(guruClassRes.json.data.overview.student_attendance_rate, 85); // 17 Hadir / 20 records

    // 7. Standard presets (7d, month, semester)
    for (const preset of ['7d', 'month', 'semester']) {
      const pRes = await requestJson(baseUrl, 'GET', `/api/v1/reports/academic?preset=${preset}`, { token: adminToken });
      assert.strictEqual(pRes.status, 200, `Preset '${preset}' must return HTTP 200`);
    }

    console.log('2. PASS: Reports RBAC, validation, attendance deltas, risk detection, teacher journals & archive audit verified.');
    console.log('ALL BUG 56 ACADEMIC REPORT TESTS PASSED.');
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
