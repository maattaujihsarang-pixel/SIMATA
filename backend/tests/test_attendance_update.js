const assert = require('assert');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const studentAttendanceService = require('../src/services/student-attendance.service');
const teacherAttendanceService = require('../src/services/teacher-attendance.service');

async function runAttendanceUpdateTests() {
  console.log('\n--- Running Attendance Update Tests (BUG 35) ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const today = '2026-09-22';

  // 1. Setup initial student attendance record
  console.log('1. Setting up initial student attendance...');
  const sAtt = await studentAttendanceService.recordSingleAttendance({
    student_id: 'STD-K10001',
    attendance_date: today,
    period: 1,
    status: 'Hadir',
    method: 'Manual'
  }, 1);
  assert.ok(sAtt.attendance_id);
  assert.strictEqual(sAtt.status, 'Hadir');

  // 2. Test successful student attendance update
  console.log('2. Testing student attendance update...');
  const updatedStudent = await studentAttendanceService.updateAttendance(sAtt.attendance_id, {
    status: 'Sakit',
    note: 'Sakit flu berat',
    period: 1,
    attendance_date: today
  }, 1);
  assert.strictEqual(updatedStudent.attendance_id, sAtt.attendance_id);
  assert.strictEqual(updatedStudent.status, 'Sakit');
  assert.strictEqual(updatedStudent.note, 'Sakit flu berat');
  console.log('   PASS: Student attendance successfully updated to Sakit.');

  // 3. Test student attendance duplicate rejection on slot change
  console.log('3. Testing student attendance duplicate conflict prevention...');
  // Create another record on period 2
  await studentAttendanceService.recordSingleAttendance({
    student_id: 'STD-K10001',
    attendance_date: today,
    period: 2,
    status: 'Hadir',
    method: 'Manual'
  }, 1);
  // Attempt to update sAtt (period 1) to period 2 (which already exists for STD-K10001)
  let studentConflict = false;
  try {
    await studentAttendanceService.updateAttendance(sAtt.attendance_id, {
      period: 2,
      attendance_date: today,
      status: 'Izin'
    }, 1);
  } catch (err) {
    studentConflict = true;
    assert.strictEqual(err.statusCode, 409);
    assert.strictEqual(err.errorCode, 'DUPLICATE_STUDENT_ATTENDANCE');
  }
  assert.ok(studentConflict, 'Changing student attendance to existing period must return 409');
  console.log('   PASS: Student attendance update conflict caught with 409.');

  // 4. Test student invalid status validation
  console.log('4. Testing student invalid status rejection...');
  let invalidStatusCaught = false;
  try {
    await studentAttendanceService.updateAttendance(sAtt.attendance_id, {
      status: 'InvalidStatus'
    }, 1);
  } catch (err) {
    invalidStatusCaught = true;
    assert.strictEqual(err.statusCode, 400);
  }
  assert.ok(invalidStatusCaught, 'Invalid status must return 400');
  console.log('   PASS: Student attendance invalid status rejected.');

  // 5. Setup initial teacher attendance record
  console.log('5. Setting up initial teacher attendance...');
  // We can insert teacher attendance in testDbEngine
  const teacherAttId = 'ATT-T-TEST-001';
  testDbEngine.teacher_attendance.push({
    attendance_id: teacherAttId,
    teacher_id: 'TCH-001',
    class_id: 'CLS-2627-10',
    academic_year_id: 'AY-2026-2027',
    attendance_date: today,
    period: 1,
    subject: 'Fiqih',
    materi: 'Bab Thaharah',
    status: 'Hadir',
    method: 'Manual',
    note: null,
    recorded_by_user_id: 1,
    created_at: new Date(),
    updated_at: new Date()
  });

  // 6. Test successful teacher attendance update
  console.log('6. Testing teacher attendance update...');
  const updatedTeacher = await teacherAttendanceService.updateAttendance(teacherAttId, {
    status: 'TugasLuar',
    subject: 'Fiqih Lanjutan',
    materi: 'Bab Wudhu dan Tayammum',
    note: 'Mengisi seminar fiqih',
    period: 1,
    class_id: 'CLS-2627-10',
    attendance_date: today
  }, 1);
  assert.strictEqual(updatedTeacher.attendance_id, teacherAttId);
  assert.strictEqual(updatedTeacher.status, 'TugasLuar');
  assert.strictEqual(updatedTeacher.subject, 'Fiqih Lanjutan');
  assert.strictEqual(updatedTeacher.materi, 'Bab Wudhu dan Tayammum');
  assert.strictEqual(updatedTeacher.note, 'Mengisi seminar fiqih');
  console.log('   PASS: Teacher attendance successfully updated.');

  // 7. Test teacher attendance subject/materi mandatory validation
  console.log('7. Testing teacher attendance mandatory subject/materi validation...');
  let missingSubjectCaught = false;
  try {
    await teacherAttendanceService.updateAttendance(teacherAttId, {
      subject: '',
      materi: 'Ada materi'
    }, 1);
  } catch (err) {
    missingSubjectCaught = true;
    assert.strictEqual(err.statusCode, 400);
    assert.strictEqual(err.errorCode, 'BAD_REQUEST');
  }
  assert.ok(missingSubjectCaught, 'Missing subject must return 400');

  let missingMateriCaught = false;
  try {
    await teacherAttendanceService.updateAttendance(teacherAttId, {
      subject: 'Ada subject',
      materi: '   '
    }, 1);
  } catch (err) {
    missingMateriCaught = true;
    assert.strictEqual(err.statusCode, 400);
    assert.strictEqual(err.errorCode, 'BAD_REQUEST');
  }
  assert.ok(missingMateriCaught, 'Missing materi must return 400');
  console.log('   PASS: Teacher attendance requires non-empty subject and materi.');

  // 8. Test teacher attendance duplicate slot conflict
  console.log('8. Testing teacher attendance duplicate slot conflict...');
  testDbEngine.teacher_attendance.push({
    attendance_id: 'ATT-T-TEST-002',
    teacher_id: 'TCH-001',
    class_id: 'CLS-2627-10',
    academic_year_id: 'AY-2026-2027',
    attendance_date: today,
    period: 3,
    subject: 'Akidah',
    materi: 'Rukun Iman',
    status: 'Hadir',
    method: 'Manual',
    note: null,
    recorded_by_user_id: 1,
    created_at: new Date(),
    updated_at: new Date()
  });

  let teacherConflict = false;
  try {
    await teacherAttendanceService.updateAttendance(teacherAttId, {
      period: 3,
      attendance_date: today,
      subject: 'Fiqih',
      materi: 'Bab Wudhu'
    }, 1);
  } catch (err) {
    teacherConflict = true;
    assert.strictEqual(err.statusCode, 409);
    assert.strictEqual(err.errorCode, 'DUPLICATE_TEACHER_ATTENDANCE');
  }
  assert.ok(teacherConflict, 'Updating teacher attendance to slot already taken must return 409');
  console.log('   PASS: Teacher attendance update conflict caught with 409.');

  console.log('\nAttendance Update Tests: ALL PASS');
  return true;
}

if (require.main === module) {
  runAttendanceUpdateTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runAttendanceUpdateTests;
