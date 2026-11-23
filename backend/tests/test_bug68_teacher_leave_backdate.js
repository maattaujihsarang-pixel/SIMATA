const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const teacherAttendanceService = require('../src/services/teacher-attendance.service');
const teacherAttendanceRepository = require('../src/repositories/teacher-attendance.repository');
const attendanceEvidenceRepository = require('../src/repositories/attendance-evidence.repository');
const schedulesService = require('../src/services/schedules.service');
const notificationsService = require('../src/services/notifications.service');
const authService = require('../src/services/auth.service');
const { getTodayISODate } = require('../src/utils/date.util');

function requestJson(server, method, reqPath, bodyObj = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const rawBody = bodyObj ? JSON.stringify(bodyObj) : null;
    const reqHeaders = { ...headers };
    if (rawBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(rawBody);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: reqPath, method, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, body: json, text });
      });
    });
    req.on('error', reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

function getYesterdayISODate(todayIso) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function runBug68Tests() {
  console.log('\n===============================================================');
  console.log('BUG 68: TEACHER LEAVE (NO PHOTO), BACKDATED ADMIN & 4-STATUS SUITE');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');
  const migrationSql = fs.readFileSync(path.join(rootDir, 'backend/migrations/012_teacher_attendance_alpa.sql'), 'utf8');

  // 1. Frontend & Migration Integrity Checks
  assert.ok(migrationSql.includes("'Alpa'"), 'Migration 012 must add Alpa to teacher_attendance status CHECK');
  assert.ok(!html.includes('<option value="TugasLuar">'), 'Active UI dropdowns must NOT contain TugasLuar option');
  assert.ok(html.includes('id="ta_period_multi_wrap"'), 'Teacher modal must include multi-period wrap for create mode');
  assert.ok(html.includes('id="ta_scheduleAssistBox"'), 'Teacher modal must include schedule assist box');
  assert.ok(html.includes('id="runAutoAlpaTeacherBtn"'), 'Teacher attendance view must include runAutoAlpaTeacherBtn');
  assert.ok(html.includes('handleRunTeacherAutoAlpa'), 'dashboard.html must define handleRunTeacherAutoAlpa');
  assert.ok(html.includes('id="ta_autoAlpaSiblingWrap"'), 'Teacher modal must include ta_autoAlpaSiblingWrap');
  assert.ok(html.includes('id="ta_applySiblingAutoAlpa"'), 'Teacher modal must include ta_applySiblingAutoAlpa');
  assert.ok(html.includes('id="ta_autoAlpaSiblingCountHint"'), 'Teacher modal must include ta_autoAlpaSiblingCountHint');
  assert.ok(html.includes('id="settingsTab_auto_alpa"'), 'Settings menu must include Auto-Alpa Guru tab');
  assert.ok(html.includes('id="settingsPanel_auto_alpa"'), 'Settings view must include settingsPanel_auto_alpa');
  assert.ok(html.includes('id="aa_enabled"'), 'Auto-Alpa settings panel must include aa_enabled toggle');
  assert.ok(html.includes('id="aa_cutoffTime"'), 'Auto-Alpa settings panel must include aa_cutoffTime input');
  assert.ok(html.includes('id="aa_effectiveFrom"'), 'Auto-Alpa settings panel must include aa_effectiveFrom input');
  assert.ok(html.includes('id="aa_runNowBtn"'), 'Auto-Alpa settings panel must include aa_runNowBtn button');
  assert.ok(html.includes('syncResponderStatusMode'), 'Responder must define syncResponderStatusMode for optional photo on Izin/Sakit');
  assert.ok(!/\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(html), 'dashboard.html must not contain native confirm/prompt calls');

  const studentTbodyFnMatch = html.match(/function renderStudentAttendanceTbody\([\s\S]*?\nfunction /);
  const teacherTbodyFnMatch = html.match(/function renderTeacherAttendanceTbody\([\s\S]*?\nfunction /);
  assert.ok(studentTbodyFnMatch && !studentTbodyFnMatch[0].includes('Otomatis Sistem'), 'Student table renderer must NOT display teacher Auto-Alpa tag');
  assert.ok(teacherTbodyFnMatch && teacherTbodyFnMatch[0].includes('Otomatis Sistem') && teacherTbodyFnMatch[0].includes('Koreksi Admin'), 'Teacher table renderer must display Auto-Alpa & Koreksi Admin tags');

  const rgStatusMatch = html.match(/<select id="rg_status"[\s\S]*?<\/select>/);
  const taStatusMatch = html.match(/<select id="ta_status"[\s\S]*?<\/select>/);
  const filterStatusMatch = html.match(/<select id="teacherAttendanceStatusFilter"[\s\S]*?<\/select>/);
  for (const [label, block] of [['rg_status', rgStatusMatch?.[0]], ['ta_status', taStatusMatch?.[0]], ['teacherAttendanceStatusFilter', filterStatusMatch?.[0]]]) {
    assert.ok(block, `${label} select must exist`);
    for (const st of ['Hadir', 'Izin', 'Sakit', 'Alpa']) {
      assert.ok(block.includes(`value="${st}"`), `${label} must contain ${st}`);
    }
    assert.ok(!block.includes('TugasLuar'), `${label} must NOT contain TugasLuar`);
  }

  assert.ok(clientJs.includes('createTeacherAttendance'), 'simata-client.js must expose createTeacherAttendance');
  assert.ok(clientJs.includes('is_admin_manual'), 'simata-client.js must support is_admin_manual flag');
  assert.ok(clientJs.includes('runTeacherAutoAlpa'), 'simata-client.js must expose runTeacherAutoAlpa');
  assert.ok(clientJs.includes('getTeacherAutoAlpaConfig'), 'simata-client.js must expose getTeacherAutoAlpaConfig');
  assert.ok(clientJs.includes('updateTeacherAutoAlpaConfig'), 'simata-client.js must expose updateTeacherAutoAlpaConfig');
  assert.ok(clientJs.includes('apply_to_same_day_auto_alpa'), 'simata-client.js must forward apply_to_same_day_auto_alpa');

  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let compiled = 0;
  while ((m = scriptRegex.exec(html)) !== null) {
    if (!m[1].trim()) continue;
    new vm.Script(m[1], { filename: `dashboard.bug68.${++compiled}.js` });
  }
  new vm.Script(clientJs, { filename: 'simata-client.bug68.js' });
  console.log(`1. PASS: UI 4-status cleanup (zero TugasLuar options), modal multi-period & ${compiled} JS blocks compiled.`);

  // 2. Service-level validation (GURU vs ADMIN permissions, optional photo, backdating)
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const today = getTodayISODate();
  const yesterday = getYesterdayISODate(today);

  // 2a. GURU submits Izin without photo & without materi for today -> MUST SUCCEED
  const guruIzinRes = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0001',
    class_id: 'CLS-2627-10',
    subject: 'Fiqih',
    materi: '',
    note: 'Keperluan keluarga',
    periods: [2, 3],
    attendance_date: today,
    status: 'Izin'
  }, null, 2, 'GURU', 'TCH-0001');

  assert.strictEqual(guruIzinRes.attendances.length, 2);
  assert.strictEqual(guruIzinRes.evidences.length, 0, 'Izin without photo must create 0 evidence rows');
  assert.strictEqual(guruIzinRes.file, null);
  assert.strictEqual(guruIzinRes.attendances[0].status, 'Izin');
  assert.strictEqual(guruIzinRes.attendances[0].materi, 'Keperluan keluarga');

  // 2b. GURU submits Sakit without photo & without note/materi -> MUST SUCCEED with default text
  const guruSakitRes = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0002',
    class_id: 'CLS-2627-11',
    subject: 'Bahasa Arab',
    materi: '',
    periods: [4],
    attendance_date: today,
    status: 'Sakit'
  }, null, 2, 'GURU', 'TCH-0002');
  assert.strictEqual(guruSakitRes.attendances[0].status, 'Sakit');
  assert.ok(guruSakitRes.attendances[0].materi.includes('Sakit'), 'Blank materi for Sakit must auto-populate cleanly');

  // 2c. GURU submits Hadir without photo -> MUST FAIL 400
  let guruHadirNoPhotoErr = null;
  try {
    await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      materi: 'Bab Puasa',
      periods: [5],
      attendance_date: today,
      status: 'Hadir'
    }, null, 2, 'GURU', 'TCH-0001');
  } catch (err) {
    guruHadirNoPhotoErr = err;
  }
  assert.ok(guruHadirNoPhotoErr && guruHadirNoPhotoErr.statusCode === 400, 'GURU Hadir without photo must return 400');

  // 2d. GURU submits Alpa -> MUST FAIL 403
  let guruAlpaErr = null;
  try {
    await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      periods: [6],
      attendance_date: today,
      status: 'Alpa'
    }, null, 2, 'GURU', 'TCH-0001');
  } catch (err) {
    guruAlpaErr = err;
  }
  assert.ok(guruAlpaErr && guruAlpaErr.statusCode === 403, 'GURU attempting Alpa must return 403 Forbidden');

  // 2e. GURU submits backdated Izin (yesterday) -> MUST FAIL 403 (Option A)
  let guruBackdateErr = null;
  try {
    await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      periods: [2],
      attendance_date: yesterday,
      status: 'Izin'
    }, null, 2, 'GURU', 'TCH-0001');
  } catch (err) {
    guruBackdateErr = err;
  }
  assert.ok(guruBackdateErr && guruBackdateErr.statusCode === 403, 'GURU attempting backdated attendance must return 403 Forbidden');

  // 2f. ADMIN submits backdated Hadir Susulan & backdated Alpa without photo -> MUST SUCCEED
  const adminSusulanHadir = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0001',
    class_id: 'CLS-2627-10',
    subject: 'Fiqih',
    materi: 'Bab Zakat',
    periods: [2, 3],
    attendance_date: yesterday,
    status: 'Hadir',
    is_admin_manual: true
  }, null, 1, 'ADMIN', null);
  assert.strictEqual(adminSusulanHadir.attendances.length, 2);
  assert.strictEqual(adminSusulanHadir.method, 'Susulan (Admin)');
  assert.strictEqual(adminSusulanHadir.evidences.length, 0);

  const adminAlpa = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0002',
    class_id: 'CLS-2627-11',
    subject: 'Bahasa Arab',
    materi: '',
    periods: [4],
    attendance_date: yesterday,
    status: 'Alpa',
    is_admin_manual: true
  }, null, 1, 'ADMIN', null);
  assert.strictEqual(adminAlpa.attendances[0].status, 'Alpa');
  assert.strictEqual(adminAlpa.attendances[0].method, 'Susulan (Admin)');
  console.log('2. PASS: Service RBAC, optional photo Izin/Sakit, Alpa restriction & Admin Susulan backdate verified.');

  // 3. Full HTTP API Verification (ADMIN + GURU)
  const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
  const guruLogin = await authService.login({ username: 'Guru_001', password: 'Guru001' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    // GURU HTTP Izin without photo or session
    const guruPostIzin = await requestJson(server, 'POST', '/api/v1/attendance/teachers', {
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      materi: '',
      note: 'Rapat luar',
      periods: [8],
      attendance_date: today,
      status: 'Izin'
    }, { Authorization: `Bearer ${guruLogin.token}` });
    assert.strictEqual(guruPostIzin.status, 201, `Expected 201 for GURU no-photo Izin, got ${guruPostIzin.status}: ${guruPostIzin.text}`);

    // GURU HTTP Alpa -> 403
    const guruPostAlpa = await requestJson(server, 'POST', '/api/v1/attendance/teachers', {
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      periods: [9],
      attendance_date: today,
      status: 'Alpa'
    }, { Authorization: `Bearer ${guruLogin.token}` });
    assert.strictEqual(guruPostAlpa.status, 403, 'HTTP GURU Alpa must return 403');

    // GURU HTTP backdated -> 403
    const guruPostBackdate = await requestJson(server, 'POST', '/api/v1/attendance/teachers', {
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      periods: [8],
      attendance_date: yesterday,
      status: 'Izin'
    }, { Authorization: `Bearer ${guruLogin.token}` });
    assert.strictEqual(guruPostBackdate.status, 403, 'HTTP GURU backdate must return 403');

    // ADMIN HTTP Susulan Alpa on yesterday -> 201
    const adminPostSusulan = await requestJson(server, 'POST', '/api/v1/attendance/teachers', {
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      periods: [8],
      attendance_date: yesterday,
      status: 'Alpa',
      is_admin_manual: true
    }, { Authorization: `Bearer ${adminLogin.token}` });
    assert.strictEqual(adminPostSusulan.status, 201, `Expected 201 for ADMIN Susulan Alpa, got ${adminPostSusulan.status}: ${adminPostSusulan.text}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('3. PASS: Live HTTP Express routes & JWT RBAC for GURU Izin/Sakit and ADMIN Susulan/Alpa verified.');

  // 4. BUG 68 Part 2: Auto-Alpa Engine, Anti-False-Positive Guards, Sibling Admin Correction, Notifications & HTTP /auto-alpa
  function addDays(baseIso, deltaDays) {
    const [y, m, d] = baseIso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  function getDayOfWeek(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  let autoAlpaDate = addDays(today, -3);
  while (getDayOfWeek(autoAlpaDate) === 5) autoAlpaDate = addDays(autoAlpaDate, -1);
  let holidayTestDate = addDays(autoAlpaDate, -1);
  while (getDayOfWeek(holidayTestDate) === 5) holidayTestDate = addDays(holidayTestDate, -1);
  let httpAutoAlpaDate = addDays(holidayTestDate, -1);
  while (getDayOfWeek(httpAutoAlpaDate) === 5) httpAutoAlpaDate = addDays(httpAutoAlpaDate, -1);
  let fridayDate = yesterday;
  for (let i = 1; i <= 7; i += 1) {
    const cand = addDays(today, -i);
    if (getDayOfWeek(cand) === 5) { fridayDate = cand; break; }
  }

  // Seed existing records on autoAlpaDate:
  // - TCH-0001 already Hadir at P2 in CLS-2627-10 (must NOT become Auto-Alpa)
  // - TCH-0001 substituted CLS-2627-10 at P5 instead of scheduled TCH-0002 (TCH-0002 must NOT become Auto-Alpa)
  await teacherAttendanceRepository.insertSingle({
    attendance_id: 'TA-AUTO-SEED-P2',
    teacher_id: 'TCH-0001',
    class_id: 'CLS-2627-10',
    academic_year_id: '2026/2027',
    attendance_date: autoAlpaDate,
    period: 2,
    subject: 'Fiqih',
    materi: 'Fiqih P2',
    status: 'Hadir',
    method: 'Manual (Admin)',
    recorded_at: new Date().toISOString(),
    note: null,
    recorded_by_user_id: 1
  });
  await teacherAttendanceRepository.insertSingle({
    attendance_id: 'TA-AUTO-SEED-P5-SUB',
    teacher_id: 'TCH-0001',
    class_id: 'CLS-2627-10',
    academic_year_id: '2026/2027',
    attendance_date: autoAlpaDate,
    period: 5,
    subject: 'Inval Kelas 10',
    materi: 'Guru Pengganti',
    status: 'Hadir',
    method: 'Manual (Admin)',
    recorded_at: new Date().toISOString(),
    note: null,
    recorded_by_user_id: 1
  });

  // Seed custom_holiday for holidayTestDate
  await attendanceEvidenceRepository.upsertSystemSetting(
    'notification_rules_config',
    JSON.stringify({ custom_holidays: [{ date: holidayTestDate, label: 'Hari Libur Uji Coba' }] }),
    'Test notification rules',
    1
  );

  const origGetActiveSched = schedulesService.getActiveNowForResponder;
  const origGetNotifSettings = notificationsService.getRawSettingsState;
  const origGetSchedOverview = schedulesService.getOverview;
  const sampleDaySlots = [
    { period_number: 1, class_id: 'CLS-2627-10', subject_category: 'NON_KBM', subject_code: 'PB', subject_name: 'Pembelajaran Bahasa', teacher_id: null },
    { period_number: 2, class_id: 'CLS-2627-10', subject_category: 'KBM', subject_code: 'FIQ', subject_name: 'Fiqih', teacher_id: 'TCH-0001' },
    { period_number: 3, class_id: 'CLS-2627-10', subject_category: 'KBM', subject_code: 'FIQ', subject_name: 'Fiqih', teacher_id: 'TCH-0001' },
    { period_number: 4, class_id: 'CLS-2627-11', subject_category: 'KBM', subject_code: 'FIQ', subject_name: 'Fiqih', teacher_id: 'TCH-0001' },
    { period_number: 5, class_id: 'CLS-2627-10', subject_category: 'KBM', subject_code: 'BAR', subject_name: 'Bahasa Arab', teacher_id: 'TCH-0002' },
    { period_number: 6, class_id: 'CLS-2627-11', subject_category: 'KBM', subject_code: 'BAR', subject_name: 'Bahasa Arab', teacher_id: 'TCH-0002' }
  ];

  const httpServer2 = http.createServer(app);
  await new Promise((resolve) => httpServer2.listen(0, resolve));
  try {
    schedulesService.getActiveNowForResponder = async ({ date }) => ({
      date,
      is_school_day: getDayOfWeek(date) !== 5,
      day_label: 'Senin',
      day_slots: sampleDaySlots
    });
    notificationsService.getRawSettingsState = async () => ({
      rules: {
        school_end_time: '13:00',
        teacher_remind_time: '12:30',
        upcoming_class_lead_minutes: 15,
        enable_class_incomplete: false,
        enable_teacher_forgot: false,
        enable_schedule_conflict: false,
        enable_responder: false,
        enable_early_warning_alpha: false,
        enable_upcoming_teaching: false,
        enable_daily_digest: false,
        enable_academic_kts: false,
        enable_finance_grades: false,
        custom_holidays: [{ date: holidayTestDate, label: 'Hari Libur Uji Coba' }]
      },
      broadcasts: [],
      events: []
    });
    schedulesService.getOverview = async () => ({ periods: [], summary: { conflict_count: 0 } });

    // 4a. Guard: Friday & custom holiday skipped
    const friRes = await teacherAttendanceService.runAutoAlpaForDate({ date: fridayDate, force: true });
    assert.strictEqual(friRes.skipped, true);
    assert.strictEqual(friRes.reason, 'friday_holiday');

    const holRes = await teacherAttendanceService.runAutoAlpaForDate({ date: holidayTestDate, force: true });
    assert.strictEqual(holRes.skipped, true);
    assert.strictEqual(holRes.reason, 'custom_holiday');

    // Guard: today before cutoff (if today is not Friday)
    if (getDayOfWeek(today) !== 5) {
      const beforeCutRes = await teacherAttendanceService.runAutoAlpaForDate({ date: today, time_wib: '10:00', force: false });
      assert.strictEqual(beforeCutRes.skipped, true);
      assert.strictEqual(beforeCutRes.reason, 'before_cutoff');
    }

    // 4b. Auto-Alpa marks P3, P4 (TCH-0001) & P6 (TCH-0002), skipping PB P1, filled P2 & substitute-covered P5
    const runRes = await teacherAttendanceService.runAutoAlpaForDate({ date: autoAlpaDate, force: true, operatorUserId: 1 });
    assert.strictEqual(runRes.skipped, false);
    assert.strictEqual(runRes.created_count, 3, `Expected 3 Auto-Alpa rows (P3, P4, P6), got ${runRes.created_count}`);
    for (const r of runRes.records) {
      assert.strictEqual(r.status, 'Alpa');
      assert.strictEqual(r.method, 'Auto-Alpa (Sistem)');
    }
    const rerunRes = await teacherAttendanceService.runAutoAlpaForDate({ date: autoAlpaDate, force: true });
    assert.strictEqual(rerunRes.created_count, 0, 'Re-running Auto-Alpa on same date must be idempotent');

    // 4c. Admin corrects TCH-0001 P3 with apply_to_same_day_auto_alpa=true -> updates P3 + sibling P4, leaves TCH-0002 P6 Auto-Alpa
    const p3Auto = runRes.records.find((r) => r.teacher_id === 'TCH-0001' && Number(r.period) === 3);
    assert.ok(p3Auto, 'Expected TCH-0001 P3 Auto-Alpa row');
    const corrRes = await teacherAttendanceService.updateAttendance(
      p3Auto.attendance_id,
      {
        status: 'Hadir',
        materi: 'Koreksi konfirmasi guru ke admin',
        apply_to_same_day_auto_alpa: true
      },
      1,
      'ADMIN'
    );
    assert.strictEqual(corrRes.status, 'Hadir');
    assert.strictEqual(corrRes.method, 'Koreksi Admin (Eks Auto-Alpa)');
    assert.strictEqual(corrRes.updated_siblings_count, 1, 'Expected P4 sibling Auto-Alpa row to be batch-corrected');

    const tch1DayRows = await teacherAttendanceRepository.findByFilters({ date: autoAlpaDate, teacherId: 'TCH-0001' });
    const p4Corrected = tch1DayRows.find((r) => Number(r.period) === 4);
    const p2Original = tch1DayRows.find((r) => Number(r.period) === 2);
    assert.strictEqual(p4Corrected.status, 'Hadir');
    assert.strictEqual(p4Corrected.method, 'Koreksi Admin (Eks Auto-Alpa)');
    assert.strictEqual(p2Original.method, 'Manual (Admin)', 'Non-Auto-Alpa row P2 must retain original method');

    // 4d. Notification Center alerts (Admin summary + affected Guru TCH-0002, none for corrected TCH-0001)
    const adminFeed = await notificationsService.getNotificationsFeed({
      user: { user_id: 1, role: 'ADMIN' },
      date: autoAlpaDate,
      time_wib: '08:00'
    });
    const adminAutoCard = (adminFeed.feed || []).find((n) => n.id === `auto-alpa-summary-${autoAlpaDate}`);
    assert.ok(adminAutoCard, 'Admin notification feed must include auto-alpa-summary card for uncorrected Auto-Alpa rows');

    const tch2Feed = await notificationsService.getNotificationsFeed({
      user: { user_id: 99, role: 'GURU', teacher_id: 'TCH-0002' },
      date: autoAlpaDate,
      time_wib: '08:00'
    });
    const tch2Card = (tch2Feed.feed || []).find((n) => n.id === `teacher-self-auto-alpa-TCH-0002-${autoAlpaDate}`);
    assert.ok(tch2Card, 'Affected GURU (TCH-0002) must receive urgent self Auto-Alpa notification');

    const tch1Feed = await notificationsService.getNotificationsFeed({
      user: { user_id: 2, role: 'GURU', teacher_id: 'TCH-0001' },
      date: autoAlpaDate,
      time_wib: '08:00'
    });
    const tch1Card = (tch1Feed.feed || []).find((n) => n.id === `teacher-self-auto-alpa-TCH-0001-${autoAlpaDate}`);
    assert.strictEqual(tch1Card, undefined, 'Corrected TCH-0001 must NOT receive self Auto-Alpa alert');

    // 4e. HTTP POST /api/v1/attendance/teachers/auto-alpa RBAC (GURU -> 403, ADMIN -> 200)
    const guruAutoHttp = await requestJson(
      httpServer2,
      'POST',
      '/api/v1/attendance/teachers/auto-alpa',
      { date: httpAutoAlpaDate, force: true },
      { Authorization: `Bearer ${guruLogin.token}` }
    );
    assert.strictEqual(guruAutoHttp.status, 403, 'GURU calling /auto-alpa must receive 403');

    const adminAutoHttp = await requestJson(
      httpServer2,
      'POST',
      '/api/v1/attendance/teachers/auto-alpa',
      { date: httpAutoAlpaDate, force: true },
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminAutoHttp.status, 200, `Expected 200 for ADMIN /auto-alpa, got ${adminAutoHttp.status}: ${adminAutoHttp.text}`);
    assert.ok(adminAutoHttp.body?.data?.created_count >= 1, 'HTTP ADMIN /auto-alpa must create Auto-Alpa records');

    // 4f. HTTP GET & PUT /api/v1/attendance/teachers/auto-alpa/config RBAC & H+1 early morning cutoff support
    const guruCfgGet = await requestJson(
      httpServer2,
      'GET',
      '/api/v1/attendance/teachers/auto-alpa/config',
      null,
      { Authorization: `Bearer ${guruLogin.token}` }
    );
    assert.strictEqual(guruCfgGet.status, 403, 'GURU calling GET /auto-alpa/config must receive 403');

    const guruCfgPut = await requestJson(
      httpServer2,
      'PUT',
      '/api/v1/attendance/teachers/auto-alpa/config',
      { enabled: false },
      { Authorization: `Bearer ${guruLogin.token}` }
    );
    assert.strictEqual(guruCfgPut.status, 403, 'GURU calling PUT /auto-alpa/config must receive 403');

    const adminCfgGet = await requestJson(
      httpServer2,
      'GET',
      '/api/v1/attendance/teachers/auto-alpa/config',
      null,
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminCfgGet.status, 200, 'ADMIN calling GET /auto-alpa/config must receive 200');
    assert.strictEqual(adminCfgGet.body?.data?.enabled, true);

    const adminCfgPutH1 = await requestJson(
      httpServer2,
      'PUT',
      '/api/v1/attendance/teachers/auto-alpa/config',
      { enabled: true, cutoff_time: '00:15', effective_from: today },
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminCfgPutH1.status, 200, `Expected 200 for ADMIN PUT /auto-alpa/config, got ${adminCfgPutH1.text}`);
    assert.strictEqual(adminCfgPutH1.body?.data?.cutoff_time, '00:15');
    assert.strictEqual(adminCfgPutH1.body?.data?.cutoff_mode, 'next_day_early');
    assert.strictEqual(adminCfgPutH1.body?.data?.effective_from, today);

    if (getDayOfWeek(today) !== 5) {
      const h1TodaySkip = await teacherAttendanceService.runAutoAlpaForDate({ date: today, time_wib: '23:45', force: false });
      assert.strictEqual(h1TodaySkip.skipped, true);
      assert.strictEqual(h1TodaySkip.reason, 'before_cutoff_next_day');
    }

    const adminCfgRestore = await requestJson(
      httpServer2,
      'PUT',
      '/api/v1/attendance/teachers/auto-alpa/config',
      { enabled: false, cutoff_time: '23:30', effective_from: '2026-11-23' },
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminCfgRestore.status, 200);
    assert.strictEqual(adminCfgRestore.body?.data?.enabled, false);
    assert.strictEqual(adminCfgRestore.body?.data?.cutoff_mode, 'same_day_night');

    const adminCfgVerify = await requestJson(
      httpServer2,
      'GET',
      '/api/v1/attendance/teachers/auto-alpa/config',
      null,
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminCfgVerify.body?.data?.enabled, false);
    assert.strictEqual(adminCfgVerify.body?.data?.cutoff_time, '23:30');
    assert.strictEqual(adminCfgVerify.body?.data?.effective_from, '2026-11-23');
  } finally {
    await new Promise((resolve) => httpServer2.close(resolve));
    schedulesService.getActiveNowForResponder = origGetActiveSched;
    notificationsService.getRawSettingsState = origGetNotifSettings;
    schedulesService.getOverview = origGetSchedOverview;
  }
  console.log('4. PASS: Auto-Alpa engine, Friday/holiday/substitute/PB guards, Admin sibling correction, Notification alerts & HTTP /auto-alpa verified.');

  console.log('===============================================================');
  console.log('BUG 68 TEACHER LEAVE, SUSULAN, AUTO-ALPA & 4-STATUS: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug68Tests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 68 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug68Tests;
