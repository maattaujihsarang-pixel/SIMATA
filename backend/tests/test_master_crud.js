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

  // Bug 37: Test updating teacher detail fields (NIK, NUPTK, birth info, contact, education, etc.)
  const updatedTeacher = await masterService.updateTeacher('TCH-0003', {
    nik: '3317010101900003',
    nuptk: '1234567890123458',
    birthPlace: 'Rembang',
    birthDate: '1990-05-15',
    village: 'Karangmangu',
    district: 'Sarang',
    regency: 'Rembang',
    phone: '081299998888',
    email: 'hasan@attaujih.sch.id',
    education: 'S1',
    major: 'Pendidikan Matematika',
    graduationYear: '2015',
    teachingHours: 24,
    gender: 'L',
    position: 'Guru Mapel'
  });
  assert.strictEqual(updatedTeacher.nik, '3317010101900003');
  assert.strictEqual(updatedTeacher.birth_place, 'Rembang');
  assert.strictEqual(updatedTeacher.birth_date, '1990-05-15');
  assert.strictEqual(updatedTeacher.teaching_hours, 24);

  const reloadedTeacher = await masterService.getTeacherById('TCH-0003');
  assert.strictEqual(reloadedTeacher.nik, '3317010101900003');
  assert.strictEqual(reloadedTeacher.nuptk, '1234567890123458');
  assert.strictEqual(reloadedTeacher.birth_place, 'Rembang');
  assert.strictEqual(reloadedTeacher.birth_date, '1990-05-15');
  assert.strictEqual(reloadedTeacher.village, 'Karangmangu');
  assert.strictEqual(reloadedTeacher.district, 'Sarang');
  assert.strictEqual(reloadedTeacher.regency, 'Rembang');
  assert.strictEqual(reloadedTeacher.phone, '081299998888');
  assert.strictEqual(reloadedTeacher.email, 'hasan@attaujih.sch.id');
  assert.strictEqual(reloadedTeacher.education, 'S1');
  assert.strictEqual(reloadedTeacher.major, 'Pendidikan Matematika');
  assert.strictEqual(reloadedTeacher.graduation_year, '2015');
  assert.strictEqual(reloadedTeacher.teaching_hours, 24);
  assert.strictEqual(reloadedTeacher.gender, 'L');

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

