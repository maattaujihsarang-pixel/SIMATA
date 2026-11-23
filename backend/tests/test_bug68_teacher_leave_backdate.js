const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const teacherAttendanceService = require('../src/services/teacher-attendance.service');
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
  assert.ok(html.includes('syncResponderStatusMode'), 'Responder must define syncResponderStatusMode for optional photo on Izin/Sakit');
  assert.ok(!/\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(html), 'dashboard.html must not contain native confirm/prompt calls');

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

  console.log('===============================================================');
  console.log('BUG 68 TEACHER LEAVE, SUSULAN & 4-STATUS: ALL TESTS PASSED (GREEN)');
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
