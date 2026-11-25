const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const authService = require('../src/services/auth.service');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

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

async function runBug73Tests() {
  console.log('\n===============================================================');
  console.log('BUG 73: ACCOUNT TEACHER_ID LINKING (GURU REQUIRED, ADMIN OPT)');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  assert.ok(html.includes('id="acc_teacherId"') && html.includes('id="edit_acc_teacherId"'), 'Missing teacherId dropdowns in Pengaturan Akun');
  assert.ok(html.includes('onAccountRoleChange') && html.includes('Belum Tertaut ID Guru'), 'Missing role toggle & unlinked badge');
  assert.ok(clientJs.includes('teacherId: u.teacher_id || null') && clientJs.includes('teacher_id: data.teacher_id || data.teacherId || null'), 'simata-client.js must forward teacher_id');
  assert.ok(clientJs.includes('teacher_id: currentUser ? (currentUser.teacher_id || null) : null'), 'getDashboardData must forward teacher_id to currentResponderUser');
  console.log('1. PASS: Frontend Pengaturan Akun teacher_id UI & simata-client contract verified.');

  await testDbEngine.reset();
  setMockQueryHandler((t, p) => testDbEngine.handleQuery(t, p));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
  const authHeader = { Authorization: `Bearer ${adminLogin.token}` };

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    // 1. Create GURU without teacher_id -> 400 (Opsi 1)
    const guruNoTid = await reqJson(server, 'POST', '/api/v1/users', {
      username: 'guru_tanpa_id',
      password: 'Password123',
      full_name: 'Pak Tanpa ID',
      role: 'GURU'
    }, authHeader);
    assert.strictEqual(guruNoTid.status, 400, `Expected 400 for GURU without teacher_id, got ${guruNoTid.status}`);

    // 2. Create GURU with duplicate teacher_id (TCH-0001 already used by Guru_001) -> 409
    const guruDupTid = await reqJson(server, 'POST', '/api/v1/users', {
      username: 'guru_duplikat_id',
      password: 'Password123',
      full_name: 'Pak Duplikat',
      role: 'GURU',
      teacher_id: 'TCH-0001'
    }, authHeader);
    assert.strictEqual(guruDupTid.status, 409, `Expected 409 for duplicate teacher_id, got ${guruDupTid.status}: ${guruDupTid.text}`);

    // 3. Create GURU with valid unused teacher_id (TCH-0002) and shortened name -> 201
    const guruOk = await reqJson(server, 'POST', '/api/v1/users', {
      username: 'guru_budi',
      password: 'Password123',
      full_name: 'Pak Budi',
      role: 'GURU',
      teacher_id: 'TCH-0002'
    }, authHeader);
    assert.strictEqual(guruOk.status, 201, `Expected 201 for valid GURU with teacher_id, got ${guruOk.status}: ${guruOk.text}`);
    assert.strictEqual(guruOk.body?.data?.teacher_id, 'TCH-0002');

    // 4. Attempting to clear teacher_id on GURU via PUT -> 400 (Opsi 1)
    const guruClearTid = await reqJson(server, 'PUT', `/api/v1/users/${guruOk.body.data.user_id}`, {
      full_name: 'Pak Budi',
      role: 'GURU',
      teacher_id: null
    }, authHeader);
    assert.strictEqual(guruClearTid.status, 400, `Expected 400 when clearing teacher_id on GURU, got ${guruClearTid.status}`);

    // 5. Create ADMIN without teacher_id (optional) -> 201
    const adminOpt = await reqJson(server, 'POST', '/api/v1/users', {
      username: 'admin_baru',
      password: 'Password123',
      full_name: 'Admin Baru',
      role: 'ADMIN'
    }, authHeader);
    assert.strictEqual(adminOpt.status, 201, `Expected 201 for ADMIN without teacher_id, got ${adminOpt.status}: ${adminOpt.text}`);
    assert.strictEqual(adminOpt.body?.data?.teacher_id, null);

    // 6. Verify /auth/me returns linked teacher_id for shortened-name GURU
    const guruLogin = await authService.login({ username: 'guru_budi', password: 'Password123' });
    const meRes = await reqJson(server, 'GET', '/api/v1/auth/me', null, { Authorization: `Bearer ${guruLogin.token}` });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body?.data?.user?.teacher_id, 'TCH-0002');
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log('2. PASS: Backend GURU required teacher_id (400), 1-to-1 duplicate guard (409), ADMIN optional & /auth/me verified.');

  console.log('===============================================================');
  console.log('BUG 73 USER TEACHER_ID LINKING: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug73Tests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 73 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug73Tests;
