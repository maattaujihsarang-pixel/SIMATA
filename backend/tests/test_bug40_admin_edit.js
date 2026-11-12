const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');

async function runBug40AdminEditTest() {
  console.log('\n===============================================================');
  console.log('BUG 40: ACCOUNT USERNAME, PASSWORD & PROFILE EDIT PERSISTENCE TEST');
  console.log('===============================================================');

  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Login as initial Admin1 and create a secondary Admin to test cross-admin edit of Admin1
    console.log('1. Logging in as Admin1 and creating secondary admin...');
    const admin1Session = await authService.login({ username: 'Admin1', password: '12345' });
    const admin1Token = admin1Session.token;
    assert.ok(admin1Token);

    const createRes = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${admin1Token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin_cadangan',
        password: 'Cadangan2026!',
        full_name: 'Admin Cadangan',
        role: 'Admin'
      })
    });
    assert.strictEqual(createRes.status, 201);

    const admin2Session = await authService.login({ username: 'admin_cadangan', password: 'Cadangan2026!' });
    const admin2Token = admin2Session.token;

    // 2. Edit Guru_001 name only -> verify teacher_id ('TCH-0001') is preserved
    console.log('2. Testing partial update preserves teacher_id...');
    const guruRes = await fetch(`${baseUrl}/api/v1/users/Guru_001`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${admin2Token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'Guru_001',
        full_name: 'IQNAUL BADRIL FALAH',
        role: 'Guru'
      })
    });
    const guruJson = await guruRes.json();
    assert.strictEqual(guruRes.status, 200);
    assert.strictEqual(guruJson.data.full_name, 'IQNAUL BADRIL FALAH');
    assert.strictEqual(guruJson.data.teacher_id, 'TCH-0001', 'Omitted teacher_id must remain preserved');

    // 3. Edit Admin1 username, password, full_name, role via admin_cadangan
    console.log('3. Editing Admin1 username and password via PUT /api/v1/users/Admin1...');
    const editRes = await fetch(`${baseUrl}/api/v1/users/Admin1`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${admin2Token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin_imam',
        password: 'Rahasia2026!',
        full_name: "Imam Sa'adi Updated",
        role: 'Admin'
      })
    });
    const editJson = await editRes.json();
    assert.strictEqual(editRes.status, 200, `PUT /users/Admin1 failed: ${JSON.stringify(editJson)}`);
    assert.strictEqual(editJson.requires_relogin, false, 'Editing another user must not force caller relogin');
    assert.strictEqual(editJson.data.username, 'admin_imam');
    assert.strictEqual(editJson.data.full_name, "Imam Sa'adi Updated");
    assert.strictEqual(editJson.data.must_change_password, false, 'Changing password clears must_change_password');

    // 4. Verify old Admin1 credentials fail and old Admin1 session was revoked
    console.log('4. Verifying old credentials fail and old session is revoked...');
    const oldMeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${admin1Token}` }
    });
    assert.strictEqual(oldMeRes.status, 401, 'Prior Admin1 session must be revoked on password change');

    const oldLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Admin1', password: '12345' })
    });
    assert.strictEqual(oldLoginRes.status, 401, 'Old Admin1 username/password must no longer authenticate');

    const stalePwRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_imam', password: '12345' })
    });
    assert.strictEqual(stalePwRes.status, 401, 'Old password 12345 must not work for updated account');

    const newLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_imam', password: 'Rahasia2026!' })
    });
    const newLoginJson = await newLoginRes.json();
    assert.strictEqual(newLoginRes.status, 200);
    const imamToken = newLoginJson.data.token;

    // 5. Verify duplicate username rejection (case-insensitive)
    console.log('5. Verifying case-insensitive duplicate username rejection (409)...');
    const dupRes = await fetch(`${baseUrl}/api/v1/users/Guru_001`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${imamToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'ADMIN_IMAM',
        full_name: 'IQNAUL BADRIL FALAH',
        role: 'Guru'
      })
    });
    assert.strictEqual(dupRes.status, 409);

    // 6. Verify whitespace-only username/password validation (400)
    console.log('6. Verifying blank/whitespace validation...');
    const blankPwRes = await fetch(`${baseUrl}/api/v1/users/Guru_001`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${imamToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'Guru_001',
        password: '   ',
        full_name: 'IQNAUL BADRIL FALAH',
        role: 'Guru'
      })
    });
    assert.strictEqual(blankPwRes.status, 400);

    // 7. Verify self-edit of name only keeps requires_relogin=false & session active
    console.log('7. Testing self-edit of full_name without credential change...');
    const selfNameRes = await fetch(`${baseUrl}/api/v1/users/admin_imam`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${imamToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin_imam',
        full_name: "H. Imam Sa'adi",
        role: 'Admin'
      })
    });
    const selfNameJson = await selfNameRes.json();
    assert.strictEqual(selfNameRes.status, 200);
    assert.strictEqual(selfNameJson.requires_relogin, false);
    assert.strictEqual(selfNameJson.data.full_name, "H. Imam Sa'adi");

    const stillActiveMe = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${imamToken}` }
    });
    assert.strictEqual(stillActiveMe.status, 200);

    // 8. Verify self-edit of username triggers requires_relogin=true & revokes old token
    console.log('8. Testing self-edit of username triggers requires_relogin=true...');
    const selfCredRes = await fetch(`${baseUrl}/api/v1/users/admin_imam`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${imamToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'Admin_Imam',
        full_name: "H. Imam Sa'adi",
        role: 'Admin'
      })
    });
    const selfCredJson = await selfCredRes.json();
    assert.strictEqual(selfCredRes.status, 200);
    assert.strictEqual(selfCredJson.requires_relogin, true);
    assert.strictEqual(selfCredJson.data.username, 'Admin_Imam');

    const revokedAfterSelfRename = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${imamToken}` }
    });
    assert.strictEqual(revokedAfterSelfRename.status, 401);

    const reloginFinal = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Admin_Imam', password: 'Rahasia2026!' })
    });
    assert.strictEqual(reloginFinal.status, 200);

    console.log('Bug 40 Account Edit Persistence Tests: ALL PASS');
    return true;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  runBug40AdminEditTest()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runBug40AdminEditTest;
