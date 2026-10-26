const assert = require('assert');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const studentAttendanceService = require('../src/services/student-attendance.service');

async function runStudentAttendanceTests() {
  console.log('\n--- Running Student Attendance Tests ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const today = '2026-09-22';

  // 1. Single attendance submission
  console.log('1. Testing single student attendance recording...');
  const att1 = await studentAttendanceService.recordSingleAttendance({
    student_id: 'STD-K10001',
    attendance_date: today,
    period: 1,
    status: 'Hadir',
    method: 'Manual'
  }, 1);
  assert.ok(att1.attendance_id);
  assert.strictEqual(att1.student_id, 'STD-K10001');
  assert.strictEqual(att1.period, 1);
  assert.strictEqual(att1.status, 'Hadir');
  console.log('   PASS: Single attendance record successfully created.');

  // 2. Duplicate protection on business key (student_id, attendance_date, period)
  console.log('2. Testing duplicate detection (Strict 409 Conflict, NO silent overwrite)...');
  let duplicateFailed = false;
  try {
    await studentAttendanceService.recordSingleAttendance({
      student_id: 'STD-K10001',
      attendance_date: today,
      period: 1, // Same student, date, period!
      status: 'Sakit', // Attempting overwrite
      method: 'Manual'
    }, 1);
  } catch (err) {
    duplicateFailed = true;
    assert.strictEqual(err.statusCode, 409, 'Must return 409 Conflict');
    assert.strictEqual(err.errorCode, 'DUPLICATE_STUDENT_ATTENDANCE');
    assert.ok(err.message.includes('sudah tercatat'), 'Message must reflect legacy duplicate rule');
  }
  assert.ok(duplicateFailed, 'Duplicate insert must be rejected with 409 Conflict');

  // Verify record was NOT overwritten in DB!
  const currentInDb = testDbEngine.student_attendance.find(a =>
    a.student_id === 'STD-K10001' && a.attendance_date === today && a.period === 1
  );
  assert.strictEqual(currentInDb.status, 'Hadir', 'Status must remain "Hadir", NO silent overwrite occurred!');
  console.log('   PASS: Strict 409 Conflict verified. Zero silent overwrite confirmed.');

  // 3. Batch Class Attendance (Atomic All-or-Nothing)
  console.log('3. Testing batch class attendance atomicity...');
  // Batch for Period 2 with 2 students
  const batchRes = await studentAttendanceService.recordBatchAttendance({
    class_id: 'CLS-2627-10',
    attendance_date: today,
    periods: [2],
    attendances: [
      { student_id: 'STD-K10001', status: 'Hadir' },
      { student_id: 'STD-K10002', status: 'Hadir' }
    ]
  }, 1);
  assert.strictEqual(batchRes.total_inserted, 2);
  console.log('   PASS: Clean batch attendance succeeded.');

  // Now attempt batch where 1 student is already recorded for Period 2
  console.log('4. Testing batch atomic rejection when conflict exists...');
  let batchConflict = false;
  try {
    await studentAttendanceService.recordBatchAttendance({
      class_id: 'CLS-2627-10',
      attendance_date: today,
      periods: [2], // Already exists for STD-K10001 & STD-K10002
      attendances: [
        { student_id: 'STD-K10001', status: 'Izin' }
      ]
    }, 1);
  } catch (err) {
    batchConflict = true;
    assert.strictEqual(err.statusCode, 409);
    assert.strictEqual(err.errorCode, 'DUPLICATE_STUDENT_ATTENDANCE');
  }
  assert.ok(batchConflict, 'Batch containing duplicate must be rejected atomically');
  console.log('   PASS: Batch atomic rejection verified.');

  // 5. QR Scan Attendance
  console.log('5. Testing QR code student attendance...');
  const qrAtt = await studentAttendanceService.recordQrAttendance({
    qr_code_id: 'SQR-10002',
    period: 3,
    status: 'Hadir'
  }, 1);
  assert.strictEqual(qrAtt.student_id, 'STD-K10002');
  assert.strictEqual(qrAtt.period, 3);
  assert.strictEqual(qrAtt.method, 'QR');
  console.log('   PASS: QR code attendance recorded.');

  console.log('Student Attendance Tests: ALL PASS');
  return true;
}

if (require.main === module) {
  runStudentAttendanceTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runStudentAttendanceTests;

