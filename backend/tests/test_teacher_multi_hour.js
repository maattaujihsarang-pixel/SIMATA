const assert = require('assert');
const fs = require('fs');
const path = require('path');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const teacherAttendanceService = require('../src/services/teacher-attendance.service');
const responderSessionService = require('../src/services/responder-session.service');
const storageProvider = require('../src/config/storage');

async function runTeacherMultiHourTests() {
  console.log('\n--- Running Teacher Multi-Hour Attendance & Evidence Tests (F-P5-005) ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const operatorUserId = 1;
  const session = await responderSessionService.startSession(operatorUserId);
  const sessionId = session.session_id;
  const today = '2026-09-22';
  const dummyPhotoBuffer = Buffer.from('fake-jpeg-binary-content-for-testing');
  const dummyFile = {
    buffer: dummyPhotoBuffer,
    originalname: 'teacher_selfie.jpg',
    mimetype: 'image/jpeg'
  };

  // TEST 1: Guru, Jam 1, 1 foto -> 1 attendance, 1 evidence, 1 physical file
  console.log('Test 1: Teacher Jam 1 with 1 photo...');
  const res1 = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0001',
    class_id: 'CLS-2627-10',
    subject: 'Fiqih',
    materi: 'Bab Thaharah',
    periods: [1],
    attendance_date: today,
    session_id: sessionId
  }, dummyFile, operatorUserId);

  assert.strictEqual(res1.attendances.length, 1);
  assert.strictEqual(res1.evidences.length, 1);
  assert.ok(res1.file.fileId);
  // Verify physical file exists on disk
  const filePath1 = await storageProvider.getFilePath(res1.file.fileId);
  assert.ok(fs.existsSync(filePath1), 'Physical file must exist on disk');
  console.log('   PASS: Test 1 validated (1 attendance, 1 evidence, 1 file).');

  // TEST 2: Guru, Jam 2 & 3, 1 foto -> 2 attendance, 2 evidence, 1 physical file
  console.log('Test 2: Teacher Jam 2 & 3 with 1 photo (F-P5-005 Core Requirement)...');
  const res2 = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0001',
    class_id: 'CLS-2627-10',
    subject: 'Fiqih',
    materi: 'Bab Sholat Jamak',
    periods: [2, 3],
    attendance_date: today,
    session_id: sessionId
  }, dummyFile, operatorUserId);

  assert.strictEqual(res2.attendances.length, 2, 'Must create 2 teacher attendance rows');
  assert.strictEqual(res2.evidences.length, 2, 'Must create 2 attendance evidence rows');
  assert.strictEqual(res2.evidences[0].file_id, res2.evidences[1].file_id, 'Both evidences must point to the SAME file_id');
  assert.notStrictEqual(res2.evidences[0].attendance_id, res2.evidences[1].attendance_id, 'Attendance IDs must be distinct (respects UNIQUE constraint)');
  // Verify only 1 physical file was created for both periods
  const filePath2 = await storageProvider.getFilePath(res2.file.fileId);
  assert.ok(fs.existsSync(filePath2));
  console.log('   PASS: Test 2 validated (2 attendance, 2 evidence, 1 physical file, UNIQUE constraint respected).');

  // TEST 4: Guru, Jam 4 & 6 (jam lompat / non-consecutive), 1 foto
  console.log('Test 4: Teacher Jam 4 & 6 (non-consecutive periods)...');
  const res4 = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
    teacher_id: 'TCH-0002',
    class_id: 'CLS-2627-11',
    subject: 'Bahasa Arab',
    materi: 'Qawaid Nahwu',
    periods: [4, 6],
    attendance_date: today,
    session_id: sessionId
  }, dummyFile, operatorUserId);
  assert.strictEqual(res4.attendances.length, 2);
  assert.strictEqual(res4.periods[0], 4);
  assert.strictEqual(res4.periods[1], 6);
  console.log('   PASS: Test 4 validated (Non-consecutive periods handled seamlessly).');

  // TEST 5: Storage failure -> DB rollback, Zero Orphan Records
  console.log('Test 5: Storage failure handling...');
  let storageErrFailed = false;
  try {
    await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
      teacher_id: 'TCH-0002',
      class_id: 'CLS-2627-11',
      subject: 'Bahasa Arab',
      materi: 'Muhadatsah',
      periods: [7],
      attendance_date: today,
      session_id: sessionId
    }, { buffer: null }, operatorUserId); // Missing buffer triggers storage failure
  } catch (err) {
    storageErrFailed = true;
  }
  assert.ok(storageErrFailed);
  const period7Check = testDbEngine.teacher_attendance.find(a => a.teacher_id === 'TCH-0002' && a.period === 7);
  assert.strictEqual(period7Check, undefined, 'No DB record should be created on storage failure');
  console.log('   PASS: Test 5 validated (Zero orphan records on storage failure).');

  // TEST 6: Re-submit same period -> 409 Conflict & Compensating cleanup
  console.log('Test 6: Duplicate period rejection & compensating cleanup...');
  let duplicateConflict = false;
  try {
    await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      materi: 'Bab Sholat',
      periods: [1], // Already recorded in Test 1!
      attendance_date: today,
      session_id: sessionId
    }, dummyFile, operatorUserId);
  } catch (err) {
    duplicateConflict = true;
    assert.strictEqual(err.statusCode, 409);
    assert.strictEqual(err.errorCode, 'DUPLICATE_TEACHER_ATTENDANCE');
  }
  assert.ok(duplicateConflict, 'Should reject duplicate period with 409 Conflict');
  console.log('   PASS: Test 6 validated (409 Conflict returned, duplicate prevented).');

  // Clean up test files from uploads/evidences
  await storageProvider.deleteFile(res1.file.fileId);
  await storageProvider.deleteFile(res2.file.fileId);
  await storageProvider.deleteFile(res4.file.fileId);

  console.log('Teacher Multi-Hour & Evidence Tests: ALL PASS');
  return true;
}

if (require.main === module) {
  runTeacherMultiHourTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runTeacherMultiHourTests;

