const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getTodayISODate, getCurrentISOTime } = require('../src/utils/date.util');

async function runBug61WibTimezoneTests() {
  console.log('\n===============================================================');
  console.log('BUG 61: ATTENDANCE WIB (ASIA/JAKARTA UTC+7) TIMEZONE REGRESSION');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const clientCode = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  // 1. Verify no naive UTC date slicing remains in dashboard.html or simata-client.js
  assert.strictEqual(
    /new Date\(\)\.toISOString\(\)\.(?:split\('T'\)|slice\(0,\s*10\))/.test(html),
    false,
    'public/dashboard.html must not slice new Date().toISOString() for today date (fails 00:00-06:59 WIB)'
  );
  assert.strictEqual(
    /new Date\(\)\.toISOString\(\)\.(?:split\('T'\)|slice\(0,\s*10\))/.test(clientCode),
    false,
    'public/js/simata-client.js must not slice new Date().toISOString() for today date (fails 00:00-06:59 WIB)'
  );
  assert.ok(
    html.includes('/js/simata-client.js?v=bug61'),
    'public/dashboard.html must reference /js/simata-client.js?v=bug61'
  );
  assert.ok(
    html.includes("typeof formatAttendanceTime === 'function' ? formatAttendanceTime(timeStr)"),
    'openTeacherPhotoModal must format timestamp via formatAttendanceTime instead of showing raw UTC ISO string'
  );

  // 2. Extract and execute dashboard.html WIB helpers in isolated VM sandbox
  const helperStart = html.indexOf('const SIMATA_WIB_OFFSET_MS = 7 * 60 * 60 * 1000;');
  const helperEnd = html.indexOf('function formatAttendancePeriod(period)', helperStart);
  assert.ok(helperStart > 0 && helperEnd > helperStart, 'Must locate WIB & formatAttendanceTime block in dashboard.html');
  const timeHelperCode = html.slice(helperStart, helperEnd);

  const indoStart = html.indexOf('function formatDateTimeIndo(isoStr)');
  const indoEnd = html.indexOf('window.addEventListener(\'beforeunload\'', indoStart);
  assert.ok(indoStart > 0 && indoEnd > indoStart, 'Must locate formatDateTimeIndo in dashboard.html');
  const indoHelperCode = html.slice(indoStart, indoEnd);

  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    parseInt,
    isNaN,
    isFinite
  };
  vm.createContext(sandbox);
  vm.runInContext(`${timeHelperCode}\n${indoHelperCode}`, sandbox);

  // Exact production cases reported by user in BUG 61:
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-17T00:49:10.000Z'), '07:49', '00:49 UTC must display 07:49 WIB');
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-17T01:01:44.679Z'), '08:01', '01:01 UTC must display 08:01 WIB');
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-16T05:21:49.858Z'), '12:21', '05:21 UTC must display 12:21 WIB');
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-16T05:36:01.450Z'), '12:36', '05:36 UTC must display 12:36 WIB');

  // Midnight wrap, explicit offsets, PG text format, GMT string, epoch ms, Date object
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-17T18:15:00.000Z'), '01:15', '18:15 UTC wraps to 01:15 WIB next day');
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-17T08:01:44+07:00'), '08:01', '+07:00 ISO must not double-shift');
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-17 01:01:44.679+00'), '08:01', 'PG timestamptz text must convert to WIB');
  assert.strictEqual(sandbox.formatAttendanceTime('Tue Nov 17 2026 01:01:44 GMT+0000 (Coordinated Universal Time)'), '08:01');
  assert.strictEqual(sandbox.formatAttendanceTime(Date.parse('2026-11-17T01:01:44.679Z')), '08:01', 'Epoch ms must format in WIB');
  assert.strictEqual(sandbox.formatAttendanceTime(new Date('2026-11-17T01:01:44.679Z')), '08:01', 'Date instance must format in WIB');

  // Timezone-less legacy WIB strings remain intact
  assert.strictEqual(sandbox.formatAttendanceTime('2026-11-17T08:01:44'), '08:01');
  assert.strictEqual(sandbox.formatAttendanceTime('08:01'), '08:01');
  assert.strictEqual(sandbox.formatAttendanceTime('08:01:44'), '08:01');
  assert.strictEqual(sandbox.formatAttendanceTime(''), '-');
  assert.strictEqual(sandbox.formatAttendanceTime(null), '-');

  // Early-morning WIB calendar boundary (06:30 WIB = 23:30 UTC previous day)
  assert.strictEqual(
    sandbox.getWibTodayISODate(new Date('2026-11-16T23:30:00.000Z')),
    '2026-11-17',
    '23:30 UTC must resolve to 2026-11-17 WIB (06:30 WIB)'
  );
  assert.strictEqual(
    sandbox.formatDateTimeIndo('2026-11-17T01:01:44.679Z'),
    '17 November 2026 08:01 WIB'
  );
  console.log('1. PASS: Frontend formatAttendanceTime, getWibTodayISODate & formatDateTimeIndo verified across UTC/+07/PG/legacy formats.');

  // 3. Verify backend date.util.js & service files enforce WIB (Asia/Jakarta, UTC+7)
  assert.strictEqual(getTodayISODate(new Date('2026-11-16T23:30:00.000Z')), '2026-11-17');
  assert.strictEqual(getCurrentISOTime(new Date('2026-11-17T01:01:44.679Z')), '08:01:44');

  const evidenceSvc = fs.readFileSync(path.join(rootDir, 'backend/src/services/evidence.service.js'), 'utf8');
  const saSvc = fs.readFileSync(path.join(rootDir, 'backend/src/services/student-attendance.service.js'), 'utf8');
  const taSvc = fs.readFileSync(path.join(rootDir, 'backend/src/services/teacher-attendance.service.js'), 'utf8');
  assert.ok(!evidenceSvc.includes('.toISOString().split(\'T\')[0]'), 'evidence.service.js must use WIB getTodayISODate');
  assert.ok(!saSvc.includes('toTimeString()'), 'student-attendance.service.js must use WIB getCurrentISOTime');
  assert.ok(!taSvc.includes('toTimeString()'), 'teacher-attendance.service.js must use WIB getCurrentISOTime');

  // 4. Verify simata-client.js normalizeCalendarDate helper on UTC vs WIB rollover
  const clientNormStart = clientCode.indexOf('const SIMATA_WIB_OFFSET_MS = 7 * 60 * 60 * 1000;');
  const clientNormEnd = clientCode.indexOf('async function apiFetch(', clientNormStart);
  assert.ok(clientNormStart > 0 && clientNormEnd > clientNormStart, 'Must locate normalizeCalendarDate in simata-client.js');
  const clientNormSandbox = { Date, String, isNaN };
  vm.createContext(clientNormSandbox);
  vm.runInContext(clientCode.slice(clientNormStart, clientNormEnd), clientNormSandbox);
  assert.strictEqual(clientNormSandbox.normalizeCalendarDate('2026-11-16T23:30:00.000Z'), '2026-11-17');
  assert.strictEqual(clientNormSandbox.normalizeCalendarDate('2026-11-17'), '2026-11-17');
  assert.strictEqual(clientNormSandbox.getWibTodayISODate(new Date('2026-11-16T23:30:00.000Z')), '2026-11-17');

  console.log('2. PASS: Backend date.util.js, attendance services & simata-client.js WIB helpers verified.');
  console.log('===============================================================');
  console.log('BUG 61 WIB TIMEZONE REGRESSION: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug61WibTimezoneTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 61 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug61WibTimezoneTests;
