const assert = require('assert');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');
const { comparePassword } = require('../src/utils/password.util');

async function runAuthTests() {
  console.log('\n--- Running Authentication Tests ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  // 1. Login with valid Admin credentials
  console.log('1. Testing login with valid Admin credentials...');
  const loginRes = await authService.login({ username: 'Admin1', password: '12345' });
  assert.ok(loginRes.token, 'Session token should be returned');
  assert.strictEqual(loginRes.token.length, 64, 'Token must be 64 characters hex');
  assert.strictEqual(loginRes.user.username, 'Admin1');
  assert.strictEqual(loginRes.user.role, 'ADMIN');
  assert.strictEqual(loginRes.user.must_change_password, true, 'Migrated weak password should have must_change_password=true');
  console.log('   PASS: Login successful with 64-char token & 8-hour expiry.');

  // 2. Validate active session
  console.log('2. Testing session validation (GET /me)...');
  const session = await authService.validateSession(loginRes.token);
  assert.strictEqual(session.username, 'Admin1');
  assert.strictEqual(session.role, 'ADMIN');
  console.log('   PASS: Session successfully validated.');

  // 3. Login with wrong password
  console.log('3. Testing login with invalid password...');
  let failed = false;
  try {
    await authService.login({ username: 'Admin1', password: 'wrongpassword' });
  } catch (err) {
    failed = true;
    assert.strictEqual(err.statusCode, 401);
  }
  assert.ok(failed, 'Should throw 401 on wrong password');
  console.log('   PASS: Invalid password correctly rejected with 401 Unauthorized.');

  // 4. Login with non-existent user
  console.log('4. Testing login with non-existent user...');
  failed = false;
  try {
    await authService.login({ username: 'NonExistentUser', password: 'password' });
  } catch (err) {
    failed = true;
    assert.strictEqual(err.statusCode, 401);
  }
  assert.ok(failed, 'Should throw 401 on non-existent user');
  console.log('   PASS: Non-existent user correctly rejected with 401.');

  // 5. Change password flow
  console.log('5. Testing password change flow...');
  const changeRes = await authService.changePassword(1, '12345', 'NewAdminPass2026!');
  assert.ok(changeRes.success);
  // Verify new password can login
  const relogin = await authService.login({ username: 'Admin1', password: 'NewAdminPass2026!' });
  assert.ok(relogin.token);
  console.log('   PASS: Password successfully changed and validated.');

  // 6. Logout
  console.log('6. Testing logout (session revocation)...');
  await authService.logout(relogin.token);
  failed = false;
  try {
    await authService.validateSession(relogin.token);
  } catch (err) {
    failed = true;
    assert.strictEqual(err.statusCode, 401);
  }
  assert.ok(failed, 'Revoked session must not validate');
  console.log('   PASS: Session successfully revoked.');

  console.log('Authentication Tests: ALL PASS');
  return true;
}

if (require.main === module) {
  runAuthTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runAuthTests;

