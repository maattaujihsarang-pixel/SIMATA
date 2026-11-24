const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const authService = require('../src/services/auth.service');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const { getTodayISODate } = require('../src/utils/date.util');

function reqJson(server, method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (raw) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(raw);
    }
    const req = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: reqPath, method, headers: h },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: res.statusCode, body: json, text });
        });
      }
    );
    req.on('error', reject);
    if (raw) req.write(raw);
    req.end();
  });
}

async function runBug72Tests() {
  console.log('\n===============================================================');
  console.log('BUG 72: ADMIN BATCH STUDENT SUSULAN (BACKDATED) & RBAC SUITE');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'public/css/style.css'), 'utf8');

  assert.ok(html.includes('id="openBatchStudentSusulanBtn"'), 'Missing openBatchStudentSusulanBtn');
  assert.ok(html.includes('id="batchSusulanPickerBar"') && html.includes('id="batchSusulanDateInput"'), 'Missing batchSusulanPickerBar');
  assert.ok(html.includes('openAdminBatchStudentAttendance') && html.includes('markBatchFilledPeriods'), 'Missing admin susulan batch helpers');
  assert.ok(clientJs.includes('/roster?date='), 'simata-client getClassAttendanceRoster must forward date query');
  assert.ok(css.includes('openBatchStudentSusulanBtn') && css.includes('is-filled-period'), 'style.css must style button and filled period badge');
  console.log('1. PASS: Frontend Admin Batch Susulan UI, filled-period guard, CSS & REST client date param verified.');

  await testDbEngine.reset();
  setMockQueryHandler((t, p) => testDbEngine.handleQuery(t, p));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const today = getTodayISODate();
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
  const guruLogin = await authService.login({ username: 'Guru_001', password: 'Guru001' });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const samplePayload = {
      class_id: 'CLS-2627-10',
      periods: [2, 3],
      attendances: [
        { student_id: 'STD-0001', status: 'Hadir', note: '' },
        { student_id: 'STD-0002', status: 'Izin', note: 'Surat izin' }
      ],
      method: 'Susulan Batch (Admin)'
    };

    // GURU backdated batch -> 403 Forbidden (Opsi 2)
    const guruPast = await reqJson(
      server,
      'POST',
      '/api/v1/attendance/students/batch',
      { ...samplePayload, attendance_date: yesterday },
      { Authorization: `Bearer ${guruLogin.token}` }
    );
    assert.strictEqual(guruPast.status, 403, `GURU backdated batch must return 403, got ${guruPast.status}`);

    // Future date batch -> 400 BadRequest
    const adminFuture = await reqJson(
      server,
      'POST',
      '/api/v1/attendance/students/batch',
      { ...samplePayload, attendance_date: tomorrow },
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminFuture.status, 400, `Future date batch must return 400, got ${adminFuture.status}`);

    // ADMIN backdated batch -> 201 Created (4 rows: 2 students x 2 periods)
    const adminPast = await reqJson(
      server,
      'POST',
      '/api/v1/attendance/students/batch',
      { ...samplePayload, attendance_date: yesterday },
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminPast.status, 201, `ADMIN backdated batch must return 201, got ${adminPast.status}: ${adminPast.text}`);
    assert.strictEqual(adminPast.body.data.total_inserted, 4);
    assert.strictEqual(adminPast.body.data.records[0].method, 'Susulan Batch (Admin)');

    // Duplicate backdated batch on same periods -> 409 Conflict
    const adminDup = await reqJson(
      server,
      'POST',
      '/api/v1/attendance/students/batch',
      { ...samplePayload, attendance_date: yesterday },
      { Authorization: `Bearer ${adminLogin.token}` }
    );
    assert.strictEqual(adminDup.status, 409, `Duplicate batch must return 409, got ${adminDup.status}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log('2. PASS: Live HTTP RBAC (GURU 403 backdate, future 400, ADMIN 201 Susulan Batch, duplicate 409) verified.');

  console.log('===============================================================');
  console.log('BUG 72 ADMIN BATCH STUDENT SUSULAN: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug72Tests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 72 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug72Tests;
