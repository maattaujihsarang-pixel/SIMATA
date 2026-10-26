const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

// Polyfill minimal browser globals for testing simata-client.js in Node
const rootDir = path.resolve(__dirname, '../..');
const clientSource = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

async function runFrontendMigrationTest() {
  console.log('\n===============================================================');
  console.log('STEP 12: FRONTEND REST MIGRATION RUNTIME VERIFICATION');
  console.log('===============================================================');

  // PART 1: STATIC CALLSITE AUDIT
  console.log('\n--- 1. Static Callsite Audit (ACTIVE google.script.run = 0) ---');
  const filesToAudit = [
    { name: 'archive_gas/Index.html', expectedActive: 0, expectedSimata: 2 },
    { name: 'archive_gas/ChatbotScript.html', expectedActive: 0, expectedSimata: 1 },
    { name: 'archive_gas/DashboardScript.html', expectedActive: 0, expectedSimata: 72 },
    { name: 'public/index.html', expectedActive: 0, expectedSimata: 2 },
    { name: 'public/dashboard.html', expectedActive: 0, expectedSimata: 73 }
  ];

  let totalActiveGas = 0;
  let totalSimataCalls = 0;

  filesToAudit.forEach(({ name, expectedActive, expectedSimata }) => {
    const fullPath = path.join(rootDir, name);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    let activeGasCount = 0;
    let commentGasCount = 0;

    lines.forEach((l, idx) => {
      if (l.includes('google.script.run')) {
        const trimmed = l.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          commentGasCount++;
        } else {
          activeGasCount++;
        }
      }
    });

    const simataCount = (content.match(/simataClient/g) || []).length;
    totalActiveGas += activeGasCount;
    totalSimataCalls += simataCount;

    console.log(`[FILE] ${name}:`);
    console.log(`       Active google.script.run : ${activeGasCount} (Target: 0)`);
    console.log(`       Comments google.script.run: ${commentGasCount}`);
    console.log(`       Active simataClient calls: ${simataCount}`);

    assert.strictEqual(activeGasCount, 0, `File ${name} must have 0 active google.script.run calls`);
    assert.ok(simataCount >= expectedSimata, `File ${name} must have at least ${expectedSimata} simataClient calls`);
  });

  console.log(`\n>> TOTAL ACTIVE google.script.run CALLS: ${totalActiveGas}`);
  console.log(`>> TOTAL ACTIVE simataClient CALLS     : ${totalSimataCalls}`);
  assert.strictEqual(totalActiveGas, 0, 'OVERALL: ACTIVE google.script.run CALLS MUST BE EXACTLY 0');
  console.log('   PASS: Static Callsite Audit Cleared (0 GAS calls, 100% REST Client calls).');

  // PART 2: RUNTIME INTEGRATION VERIFICATION WITH LIVE EXPRESS SERVER
  console.log('\n--- 2. Runtime Simulation & Verification ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Setup isolated browser-like sandbox
    const mockSessionStore = {};
    const mockWindow = {
      sessionStorage: {
        getItem: (k) => mockSessionStore[k] || null,
        setItem: (k, v) => { mockSessionStore[k] = String(v); },
        removeItem: (k) => { delete mockSessionStore[k]; }
      },
      fetch: async (url, options = {}) => {
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return globalThis.fetch(fullUrl, options);
      },
      console: console,
      atob: (str) => Buffer.from(str, 'base64').toString('binary'),
      Blob: globalThis.Blob,
      FormData: globalThis.FormData
    };

    // Execute simata-client.js inside our mock window
    const vm = require('vm');
    const sandbox = {
      window: mockWindow,
      sessionStorage: mockWindow.sessionStorage,
      fetch: mockWindow.fetch,
      console: console,
      atob: mockWindow.atob,
      Blob: mockWindow.Blob,
      FormData: mockWindow.FormData,
      queueMicrotask: queueMicrotask,
      URLSearchParams: URLSearchParams,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    };
    vm.createContext(sandbox);
    vm.runInContext(clientSource, sandbox);

    const client = sandbox.window.simataClient;
    assert.ok(client, 'simataClient must be registered on window');

    // Test 1: Callback checkLogin (withSuccessHandler & withFailureHandler)
    console.log('1. Testing simataClient.checkLogin() withSuccessHandler callback...');
    const loginResult = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .checkLogin('Admin1', '12345');
    });

    assert.strictEqual(loginResult.success, true, 'Login should succeed');
    assert.ok(loginResult.token, 'Must return token');
    assert.strictEqual(loginResult.role.toUpperCase(), 'ADMIN');
    assert.strictEqual(loginResult.nama, "Imam Sa'adi", 'Must return nama for legacy greeting');
    assert.strictEqual(mockWindow.sessionStorage.getItem('SIMATA_TOKEN'), loginResult.token, 'Token stored in SIMATA_TOKEN');
    assert.strictEqual(mockWindow.sessionStorage.getItem('simata_token'), loginResult.token, 'Token stored in simata_token');
    console.log('   PASS: checkLogin successful, dual tokens stored, nama returned.');

    const token = loginResult.token;

    // Test 2: Callback validateSession
    console.log('2. Testing simataClient.validateSession()...');
    const sessionResult = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .validateSession(token);
    });
    assert.strictEqual(sessionResult.valid, true, 'Session should be valid');
    assert.strictEqual(sessionResult.role.toUpperCase(), 'ADMIN');
    assert.strictEqual(sessionResult.username, 'Admin1');
    console.log('   PASS: validateSession verified.');

    // Test 3: Callback getDashboardData
    console.log('3. Testing simataClient.getDashboardData()...');
    const dashResult = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .getDashboardData(token);
    });
    assert.strictEqual(dashResult.success, true);
    assert.ok(dashResult.statistics, 'Must contain statistics');
    assert.ok(dashResult.user, 'Must contain user');
    console.log(`   PASS: getDashboardData verified (Students: ${dashResult.statistics.students}, Teachers: ${dashResult.statistics.teachers}).`);

    // Test 4: Callback getClasses
    console.log('4. Testing simataClient.getClasses()...');
    const classesResult = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .getClasses();
    });
    assert.strictEqual(classesResult.success, true);
    assert.ok(Array.isArray(classesResult.classes));
    assert.ok(classesResult.classes.length > 0);
    const testClass = classesResult.classes[0];
    console.log(`   PASS: getClasses returned ${classesResult.classes.length} classes.`);

    // Test 5: Callback getStudents
    console.log('5. Testing simataClient.getStudents()...');
    const studentsResult = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .getStudents();
    });
    assert.strictEqual(studentsResult.success, true);
    assert.ok(Array.isArray(studentsResult.students));
    assert.ok(studentsResult.students.length > 0);
    const testStudent = studentsResult.students[0];
    console.log(`   PASS: getStudents returned ${studentsResult.students.length} students.`);

    // Test 6: BUG 29 getClassAttendanceRoster
    console.log(`6. Testing simataClient.getClassAttendanceRoster() for class ${testClass.classId}...`);
    const rosterResult = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .getClassAttendanceRoster(token, testClass.classId, 'session-test');
    });
    assert.strictEqual(rosterResult.success, true);
    assert.ok(rosterResult.class.className, 'Must contain class name');
    assert.ok(Array.isArray(rosterResult.students), 'Must contain students array');
    console.log(`   PASS: getClassAttendanceRoster returned ${rosterResult.students.length} students for class.`);

    // Test 7: lookupStudentByQr
    console.log(`7. Testing simataClient.lookupStudentByQr() for QR '${testStudent.qrCodeId}'...`);
    const qrLookup = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .lookupStudentByQr(token, 'session-test', testStudent.qrCodeId);
    });
    assert.strictEqual(qrLookup.success, true);
    assert.strictEqual(qrLookup.student.studentId, testStudent.studentId);
    console.log(`   PASS: lookupStudentByQr found student '${qrLookup.student.name}'.`);

    // Test 8: Chatbot sendChatbotMessage
    console.log('8. Testing simataClient.sendChatbotMessage()...');
    const chatbotRes = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .sendChatbotMessage(token, 'Halo SIMATA');
    });
    assert.strictEqual(chatbotRes.success, true);
    assert.ok(chatbotRes.reply, 'Chatbot must reply');
    console.log(`   PASS: sendChatbotMessage returned reply: "${chatbotRes.reply.substring(0, 40)}..."`);

    // Test 9: Direct Promise invocation (modern await syntax)
    console.log('9. Testing direct modern Promise syntax: await simataClient.getAccounts()...');
    const accountsRes = await client.getAccounts(token);
    assert.strictEqual(accountsRes.success, true);
    assert.ok(Array.isArray(accountsRes.accounts));
    console.log(`   PASS: Direct Promise call successful (${accountsRes.accounts.length} accounts).`);

    // Test 10: Logout
    console.log('10. Testing simataClient.logout()...');
    const logoutRes = await new Promise((resolve, reject) => {
      client
        .withSuccessHandler(res => resolve(res))
        .withFailureHandler(err => reject(err))
        .logout(token);
    });
    assert.strictEqual(logoutRes.success, true);
    assert.strictEqual(mockWindow.sessionStorage.getItem('SIMATA_TOKEN'), null, 'SIMATA_TOKEN cleared');
    assert.strictEqual(mockWindow.sessionStorage.getItem('simata_token'), null, 'simata_token cleared');
    console.log('   PASS: Logout successful and both tokens cleared.');

    console.log('\n===============================================================');
    console.log('FRONTEND REST MIGRATION VERIFICATION: ALL 10 TESTS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runFrontendMigrationTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('FRONTEND MIGRATION TEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = runFrontendMigrationTest;
