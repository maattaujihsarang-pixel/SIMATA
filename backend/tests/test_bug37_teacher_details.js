const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');

async function runBug37TeacherDetailsTest() {
  console.log('\n===============================================================');
  console.log('BUG 37: TEACHER DETAIL FIELDS (NIK, NUPTK, BIRTH, ETC.) PERSISTENCE TEST');
  console.log('===============================================================');

  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Authenticate as Admin
    console.log('1. Authenticating Admin user...');
    const adminSession = await authService.login({ username: 'Admin1', password: '12345' });
    const token = adminSession.token;
    assert.ok(token, 'Admin session token should exist');

    // 2. Initial state: Check teacher TCH-0001
    console.log('2. Fetching initial teacher TCH-0001...');
    const getRes1 = await fetch(`${baseUrl}/api/v1/teachers/TCH-0001`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getJson1 = await getRes1.json();
    assert.strictEqual(getRes1.status, 200);
    assert.strictEqual(getJson1.data.teacher_id, 'TCH-0001');

    // 3. Update all detail fields including NIK
    console.log('3. Updating teacher TCH-0001 detail fields (NIK, NUPTK, birth info, contact, education, teaching hours)...');
    const updatePayload = {
      teacherId: 'TCH-0001',
      name: 'IQNAUL BADRIL FALAH, S.Ag',
      full_name: 'IQNAUL BADRIL FALAH, S.Ag',
      position: 'Kepala Madrasah',
      subject: 'Fiqih & Ushul Fiqih',
      gender: 'L',
      nip: '197001012000031001',
      nuptk: '1234567890123456',
      nik: '3317010101700099', // Updated NIK
      birthPlace: 'Rembang',
      birthDate: '1970-01-01',
      village: 'Karangmangu',
      district: 'Sarang',
      regency: 'Rembang',
      phone: '081234567899',
      email: 'iqnaul@attaujih.sch.id',
      education: 'S2',
      major: 'Dirasat Islamiyah',
      graduationYear: '2010',
      teachingHours: 18,
      status: 'Active'
    };

    const putRes = await fetch(`${baseUrl}/api/v1/teachers/TCH-0001`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });
    const putJson = await putRes.json();
    assert.strictEqual(putRes.status, 200, `PUT /teachers/TCH-0001 failed: ${JSON.stringify(putJson)}`);
    assert.strictEqual(putJson.status, 'success');
    assert.strictEqual(putJson.data.nik, '3317010101700099', 'NIK should be updated in response');
    assert.strictEqual(putJson.data.position, 'Kepala Madrasah');
    assert.strictEqual(putJson.data.birth_place, 'Rembang');
    assert.strictEqual(putJson.data.birth_date, '1970-01-01');
    assert.strictEqual(putJson.data.village, 'Karangmangu');
    assert.strictEqual(putJson.data.district, 'Sarang');
    assert.strictEqual(putJson.data.regency, 'Rembang');
    assert.strictEqual(putJson.data.phone, '081234567899');
    assert.strictEqual(putJson.data.email, 'iqnaul@attaujih.sch.id');
    assert.strictEqual(putJson.data.education, 'S2');
    assert.strictEqual(putJson.data.major, 'Dirasat Islamiyah');
    assert.strictEqual(putJson.data.graduation_year, '2010');
    assert.strictEqual(putJson.data.teaching_hours, 18);
    console.log('   PASS: Teacher update succeeded with all detail fields.');

    // 4. Verify persisted record via GET /teachers/TCH-0001
    console.log('4. Verifying persistence via GET /teachers/TCH-0001...');
    const getRes2 = await fetch(`${baseUrl}/api/v1/teachers/TCH-0001`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getJson2 = await getRes2.json();
    assert.strictEqual(getRes2.status, 200);
    assert.strictEqual(getJson2.data.nik, '3317010101700099', 'NIK must persist in database');
    assert.strictEqual(getJson2.data.position, 'Kepala Madrasah');
    assert.strictEqual(getJson2.data.nuptk, '1234567890123456');
    assert.strictEqual(getJson2.data.birth_place, 'Rembang');
    assert.strictEqual(getJson2.data.birth_date, '1970-01-01');
    assert.strictEqual(getJson2.data.village, 'Karangmangu');
    assert.strictEqual(getJson2.data.district, 'Sarang');
    assert.strictEqual(getJson2.data.regency, 'Rembang');
    assert.strictEqual(getJson2.data.education, 'S2');
    assert.strictEqual(getJson2.data.major, 'Dirasat Islamiyah');
    assert.strictEqual(getJson2.data.graduation_year, '2010');
    assert.strictEqual(getJson2.data.teaching_hours, 18);
    console.log('   PASS: Persisted data verified via GET endpoint.');

    // 5. Verify list endpoint GET /teachers includes NIK
    console.log('5. Verifying teacher list GET /teachers includes updated NIK...');
    const listRes = await fetch(`${baseUrl}/api/v1/teachers`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const listJson = await listRes.json();
    assert.strictEqual(listRes.status, 200);
    const listedTeacher = listJson.data.find(t => t.teacher_id === 'TCH-0001');
    assert.ok(listedTeacher, 'TCH-0001 should be present in list');
    assert.strictEqual(listedTeacher.nik, '3317010101700099', 'NIK must be present in teacher list for table view');
    console.log('   PASS: List endpoint includes updated NIK.');

    // 6. Test partial update does not wipe detail fields
    console.log('6. Testing partial update (changing only phone) preserves NIK and detail fields...');
    const partialRes = await fetch(`${baseUrl}/api/v1/teachers/TCH-0001`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone: '081200001111' })
    });
    const partialJson = await partialRes.json();
    assert.strictEqual(partialRes.status, 200);
    assert.strictEqual(partialJson.data.phone, '081200001111');
    assert.strictEqual(partialJson.data.nik, '3317010101700099', 'Partial update must not wipe out NIK');
    assert.strictEqual(partialJson.data.birth_place, 'Rembang', 'Partial update must not wipe out birth place');
    console.log('   PASS: Partial update preserved all existing detail fields.');

    // 7. Test creating new teacher with full detail fields
    console.log('7. Testing creating new teacher with full detail fields...');
    const createRes = await fetch(`${baseUrl}/api/v1/teachers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        teacherId: 'TCH-0010',
        name: 'USTADZ FULAN, S.Pd.I',
        position: 'Guru Mapel',
        subject: 'Tajwid',
        gender: 'L',
        nip: '198501012010011005',
        nuptk: '5566778899001122',
        nik: '3317010101850010',
        birthPlace: 'Kudus',
        birthDate: '1985-06-20',
        village: 'Demaan',
        district: 'Kota Kudus',
        regency: 'Kudus',
        phone: '081345678901',
        email: 'fulan@attaujih.sch.id',
        education: 'S1',
        major: 'Ilmu Al-Qur`an dan Tafsir',
        graduationYear: '2008',
        teachingHours: 16,
        status: 'Active'
      })
    });
    const createJson = await createRes.json();
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createJson.data.teacher_id, 'TCH-0010');
    assert.strictEqual(createJson.data.nik, '3317010101850010');
    assert.strictEqual(createJson.data.teaching_hours, 16);
    console.log('   PASS: New teacher creation with full detail fields validated.');

    console.log('\n===============================================================');
    console.log('BUG 37 VERIFICATION RESULT: ALL TESTS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runBug37TeacherDetailsTest().then(pass => {
    process.exit(pass ? 0 : 1);
  }).catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}

module.exports = runBug37TeacherDetailsTest;
