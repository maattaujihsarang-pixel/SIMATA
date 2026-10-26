const assert = require('assert');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const masterService = require('../src/services/master.service');

async function runMasterCrudTests() {
  console.log('\n--- Running Master Data CRUD Tests ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  // 1. Teachers
  console.log('1. Testing Teachers CRUD...');
  const teachers = await masterService.getAllTeachers();
  assert.strictEqual(teachers.length, 2);
  const teacher1 = await masterService.getTeacherById('TCH-0001');
  assert.strictEqual(teacher1.name, 'IQNAUL BADRIL FALAH, S.Ag');
  const newTeacher = await masterService.createTeacher({
    teacher_id: 'TCH-0003',
    name: 'MUHAMMAD HASAN, S.Pd',
    subject: 'Matematika'
  });
  assert.strictEqual(newTeacher.teacher_id, 'TCH-0003');
  await masterService.setTeacherStatus('TCH-0003', 'Inactive');
  console.log('   PASS: Teachers CRUD validated.');

  // 2. Classes & BUG 29 Dynamic Roster
  console.log('2. Testing Classes & BUG 29 Dynamic Roster Query...');
  const classes = await masterService.getAllClasses();
  assert.strictEqual(classes.length, 3);
  const roster = await masterService.getClassRoster('CLS-2627-10', '2026-09-22');
  assert.strictEqual(roster.length, 2, 'Should find 2 enrolled students');
  assert.strictEqual(roster[0].name, 'AHMAD FAIZ');
  console.log('   PASS: Classes and BUG 29 roster query validated.');

  // 3. Students & QR Lookup
  console.log('3. Testing Students CRUD & QR Lookup...');
  const students = await masterService.getAllStudents();
  assert.strictEqual(students.length, 2);
  const studentByQr = await masterService.getStudentByQr('SQR-10001');
  assert.strictEqual(studentByQr.name, 'AHMAD FAIZ');
  // Duplicate QR code rejection
  let dupFailed = false;
  try {
    await masterService.createStudent({
      class_id: 'CLS-2627-10',
      name: 'NEW STUDENT',
      qr_code_id: 'SQR-10001' // Duplicate!
    });
  } catch (err) {
    dupFailed = true;
    assert.strictEqual(err.statusCode, 409);
  }
  assert.ok(dupFailed, 'Should reject duplicate QR code with 409 Conflict');
  console.log('   PASS: Student CRUD and QR code uniqueness verified.');

  // 4. Users & Self-Delete Guard
  console.log('4. Testing Users & Self-Delete Guard...');
  const users = await masterService.getAllUsers();
  assert.strictEqual(users.length, 2);
  // Attempt self-delete (Admin1 with user_id 1 deletes user_id 1)
  let selfDeleteFailed = false;
  try {
    await masterService.deleteUser(1, 1);
  } catch (err) {
    selfDeleteFailed = true;
    assert.strictEqual(err.statusCode, 400);
  }
  assert.ok(selfDeleteFailed, 'Self-delete must be blocked');
  console.log('   PASS: Users management and Self-Delete Guard verified.');

  console.log('Master Data CRUD Tests: ALL PASS');
  return true;
}

if (require.main === module) {
  runMasterCrudTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runMasterCrudTests;

