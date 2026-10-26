const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');
const responderSessionService = require('../src/services/responder-session.service');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runSecurityRbacTests() {
  console.log('\n--- Running Security & RBAC Tests ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Unauthenticated request to protected endpoint -> 401 Unauthorized
    console.log('1. Testing unauthenticated request to /api/v1/teachers...');
    const res1 = await makeRequest(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/teachers',
      method: 'GET'
    });
    assert.strictEqual(res1.status, 401);
    assert.strictEqual(res1.body.code, 'UNAUTHORIZED');
    console.log('   PASS: Unauthenticated request rejected with 401.');

    // 2. Obtain tokens for Admin and Guru
    console.log('2. Authenticating Admin and Guru test accounts...');
    const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
    const guruLogin = await authService.login({ username: 'Guru_001', password: 'Guru001' });

    // 3. Guru attempting to access Admin-only /api/v1/users -> 403 Forbidden
    console.log('3. Testing GURU accessing /api/v1/users (ADMIN only)...');
    const res3 = await makeRequest(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/users',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${guruLogin.token}`
      }
    });
    assert.strictEqual(res3.status, 403);
    assert.strictEqual(res3.body.code, 'FORBIDDEN');
    console.log('   PASS: Guru access to Admin endpoint correctly rejected with 403 Forbidden.');

    // 4. Admin accessing /api/v1/users -> 200 OK
    console.log('4. Testing ADMIN accessing /api/v1/users...');
    const res4 = await makeRequest(server, {
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/users',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminLogin.token}`
      }
    });
    assert.strictEqual(res4.status, 200);
    assert.strictEqual(res4.body.status, 'success');
    console.log('   PASS: Admin access authorized.');

    // 5. Operator Session Ownership Guard
    console.log('5. Testing responder session operator guard...');
    const session = await responderSessionService.startSession(adminLogin.user.user_id);
    let operatorBlocked = false;
    try {
      // Guru (user_id 2) tries to access Admin's (user_id 1) session
      await responderSessionService.getSession(session.session_id, guruLogin.user.user_id, 'GURU');
    } catch (err) {
      operatorBlocked = true;
      assert.strictEqual(err.statusCode, 403);
    }
    assert.ok(operatorBlocked, 'Operator guard must prevent other users from hijacking session');
    console.log('   PASS: Operator session guard verified (403 Forbidden).');

    console.log('Security & RBAC Tests: ALL PASS');
    return true;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runSecurityRbacTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runSecurityRbacTests;

