const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const authService = require('../src/services/auth.service');
const { ASTS_GANJIL_2026_SEED } = require('../src/services/grades-asts-seed.data');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

function reqJson(server, method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (raw) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(raw);
    }
    const req = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: reqPath, method, headers: h },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: res.statusCode, body: json, text });
        });
      }
    );
    req.on('error', reject);
    if (raw) req.write(raw);
    req.end();
  });
}

async function runBug74Tests() {
  console.log('\n=====================================================================');
  console.log('BUG 74: MENU NILAI 2-CARD (ASTS/ASAS SIMATA & RDM) + EXCEL AUDIT SEED');
  console.log('=====================================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const gradesJs = fs.readFileSync(path.join(rootDir, 'public/js/grades-module.js'), 'utf8');
  const gradesCss = fs.readFileSync(path.join(rootDir, 'public/css/grades.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  assert.ok(html.includes('id="gradesGatewayView"') && html.includes('id="grdGatewayRdmCard"'), 'Missing 2-card gateway in dashboard.html');
  assert.ok(html.includes('id="grdOpenRdmSettingsBtn"') && html.includes('id="gradesPrintSheet"'), 'Missing Admin RDM config button or print sheet');
  assert.ok(html.includes('id="grdAcademicYearSelect"') && html.includes('id="gradesYearArchiveModal"'), 'Missing Academic Year selector & Archive modal');
  assert.ok(!html.includes('id="grdCfgDefaultKkm"'), 'KKM Standar Madrasah must be removed from RDM settings modal');
  assert.ok(html.includes('testGradesRdmUrl()') && html.includes('grd-gw-checklist'), 'Missing redesigned symmetrical gateway & Uji Buka button');
  assert.ok(html.includes('id="grdSubjectList"') && html.includes('grd-nav-unified-bar') && html.includes('grd-pub-toggle'), 'Missing Option 4 unified bar, publish toggle switch, or 1-click subject sidebar');
  assert.ok(!html.includes('Soft-Filter Guru') && !html.includes('Draft Internal'), 'Technical jargon Soft-Filter Guru / Draft Internal must not appear in workspace HTML');
  assert.ok(gradesJs.includes('grd-kpi-grid') && gradesJs.includes('data-select-subject'), 'Missing Option 4 4-card KPI grid or clickable sidebar subjects in grades-module.js');
  assert.ok(html.includes('focusgroup="tablist nomemory"'), 'Sub-tabs must use accessible focusgroup tablist');
  assert.ok(gradesJs.includes('NILAI RATA-RATA SATU KELAS / MAPEL') && gradesJs.includes('MADRASAH ALIYAH AT-TAUJIH'), 'Missing official Madrasah Excel Leger print layout');
  assert.ok(gradesCss.includes('@container grd-input-grid (width < 640px)'), 'Missing mobile container query cards for grade input');
  assert.ok(clientJs.includes('getGradesOverview') && clientJs.includes('seedAstsGanjilGrades'), 'Missing grades REST methods in simata-client.js');
  console.log('1. PASS: Frontend 2-Card Hub, Accessible Tabs, Mobile Container Query, & Madrasah Print Layout verified.');

  await testDbEngine.reset();
  setMockQueryHandler((t, p) => testDbEngine.handleQuery(t, p));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  // Populate all 47 production students from ASTS_GANJIL_2026_SEED into mock DB
  testDbEngine.students = [];
  let seq = 1;
  for (const cls of ASTS_GANJIL_2026_SEED.classes) {
    for (const r of cls.rows) {
      testDbEngine.students.push({
        student_id: r.student_id,
        class_id: cls.class_id,
        name: r.name,
        gender: 'L',
        nis: `1312331700${String(seq).padStart(4, '0')}`,
        nisn: `009988${String(seq).padStart(4, '0')}`,
        qr_code_id: `SQR-ASTS-${seq++}`,
        status: 'Active'
      });
    }
  }

  // Add an ORANG_TUA user mapped to STD-K10015 (Abdul Hamid Al Muthohhar)
  const { hashPassword } = require('../src/utils/password.util');
  const parentHash = await hashPassword('Parent123');
  testDbEngine.users.push({
    user_id: 10,
    username: 'wali_hamid',
    password_hash: parentHash,
    full_name: 'Wali Abdul Hamid',
    role: 'ORANG_TUA',
    status: 'Active',
    teacher_id: null,
    must_change_password: false
  });
  testDbEngine.parent_student_mappings.push({
    mapping_id: 1,
    parent_user_id: 10,
    student_id: 'STD-K10015',
    relationship_type: 'AYAH',
    created_at: new Date().toISOString()
  });

  const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
  const guruLogin = await authService.login({ username: 'Guru_001', password: 'Guru001' });
  const parentLogin = await authService.login({ username: 'wali_hamid', password: 'Parent123' });

  const adminAuth = { Authorization: `Bearer ${adminLogin.token}` };
  const guruAuth = { Authorization: `Bearer ${guruLogin.token}` };
  const parentAuth = { Authorization: `Bearer ${parentLogin.token}` };

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));

  try {
    // 2. Seed all 47 students' ASTS Ganjil 2026/2027 scores
    const seedRes = await reqJson(server, 'POST', '/api/v1/grades/seed-asts-ganjil', {}, adminAuth);
    assert.strictEqual(seedRes.status, 200, `Seed failed: ${seedRes.text}`);
    assert.strictEqual(seedRes.body.data.seeded_students, 47);
    assert.strictEqual(seedRes.body.data.seeded_grades, 1025);
    console.log('2. PASS: Seeded 47 students (1,025 ASTS Ganjil scores across Kelas X, XI, XII).');

    // 3. Verify corrected accumulations & rankings in Kelas X (23 subjects)
    const ov10 = await reqJson(server, 'GET', '/api/v1/grades/overview?assessment_type=ASTS_GANJIL&class_id=CLS-2627-10', null, adminAuth);
    assert.strictEqual(ov10.status, 200);
    assert.strictEqual(ov10.body.data.periods.length, 4, 'Must have exactly 4 pure ASTS/ASAS periods');
    assert.strictEqual(ov10.body.data.subjects.length, 23, 'Kelas 10 must have 23 subjects');

    const m10 = ov10.body.data.matrix;
    const alaudin = m10.find((r) => r.student_id === 'STD-K10010');
    const safiq = m10.find((r) => r.student_id === 'STD-K10001');
    const hamid = m10.find((r) => r.student_id === 'STD-K10015');
    const fathur = m10.find((r) => r.student_id === 'STD-K10018');
    const anji = m10.find((r) => r.student_id === 'STD-K10017');

    assert.strictEqual(alaudin.total_score, 1846);
    assert.strictEqual(alaudin.rank, 1);
    assert.strictEqual(safiq.total_score, 1318.5, 'Safiq PKWU 38,5 comma decimal must be included');
    assert.strictEqual(safiq.rank, 6, 'Safiq corrected rank must be 6');
    assert.strictEqual(hamid.total_score, 1554.5, 'Abdul Hamid 3 comma decimals must be included');
    assert.strictEqual(hamid.rank, 5);
    assert.strictEqual(fathur.total_score, 1288.5);
    assert.strictEqual(fathur.rank, 9);
    assert.strictEqual(anji.total_score, 0);
    assert.strictEqual(anji.rank, 17, 'Zero-score tie rank in Kelas X must be 17');

    // 4. Verify Kelas XI & Kelas XII corrected rankings
    const ov11 = await reqJson(server, 'GET', '/api/v1/grades/overview?assessment_type=ASTS_GANJIL&class_id=CLS-2627-11', null, adminAuth);
    const m11 = ov11.body.data.matrix;
    assert.strictEqual(m11.find((r) => r.student_id === 'STD-K11002').total_score, 1761.5);
    assert.strictEqual(m11.find((r) => r.student_id === 'STD-K11010').rank, 10);
    assert.strictEqual(m11.find((r) => r.student_id === 'STD-K11012').rank, 11);
    assert.strictEqual(m11.find((r) => r.student_id === 'STD-K11017').rank, 18);

    const ov12 = await reqJson(server, 'GET', '/api/v1/grades/overview?assessment_type=ASTS_GANJIL&class_id=CLS-2627-12', null, adminAuth);
    const m12 = ov12.body.data.matrix;
    assert.strictEqual(m12.find((r) => r.student_id === 'STD-K12004').total_score, 1623);
    assert.strictEqual(m12.find((r) => r.student_id === 'STD-K12006').rank, 4);
    assert.strictEqual(m12.find((r) => r.student_id === 'STD-K12001').rank, 5);
    console.log('3. PASS: All corrected sums, averages, and rankings verified across Kelas X, XI, and XII.');

    // 5. Verify Admin-only RDM Portal Link RBAC + Guru Soft-Filter
    const guruRdmAttempt = await reqJson(server, 'PUT', '/api/v1/grades/portal-settings', {
      rdm_url: 'https://rdm.maattaujih.my.id'
    }, guruAuth);
    assert.strictEqual(guruRdmAttempt.status, 403, 'Guru must be forbidden from changing RDM portal settings');

    const adminRdmOk = await reqJson(server, 'PUT', '/api/v1/grades/portal-settings', {
      rdm_url: 'rdm.maattaujih.my.id',
      principal_name: 'Moch. Iqnaul Badril Falah, S.Ag',
      default_kkm: 75
    }, adminAuth);
    assert.strictEqual(adminRdmOk.status, 200);
    assert.strictEqual(adminRdmOk.body.data.rdm_url, 'https://rdm.maattaujih.my.id');

    const guruOv = await reqJson(server, 'GET', '/api/v1/grades/overview?assessment_type=ASTS_GANJIL&class_id=CLS-2627-10', null, guruAuth);
    assert.strictEqual(guruOv.status, 200);
    const fqSubj = guruOv.body.data.subjects.find((s) => s.subject_code === 'FQ');
    assert.ok(fqSubj && fqSubj.is_my_subject === true, 'Guru_001 (Fiqih) must have FQ marked is_my_subject in Soft-Filter');
    assert.strictEqual(guruOv.body.data.subjects.length, 23, 'Soft-filter still allows Guru to access other subjects when substituting');

    // Guru batch save with comma decimal & custom KKM per mapel
    const batchRes = await reqJson(server, 'POST', '/api/v1/grades/batch', {
      academic_year_id: '2026/2027',
      class_id: 'CLS-2627-10',
      assessment_type: 'ASAS_GANJIL',
      subject_code: 'FQ',
      kkm: 78,
      entries: [
        { student_id: 'STD-K10015', score: '88,5', remarks: 'Sangat baik' }
      ]
    }, guruAuth);
    assert.strictEqual(batchRes.status, 200);
    assert.strictEqual(batchRes.body.data.kkm, 78);
    console.log('4. PASS: Admin-only RDM link RBAC, Guru Soft-Filter, flexible KKM, & comma-decimal batch input verified.');

    // 6. Verify Parent (ORANG_TUA) privacy & publication gating
    const parentBeforePub = await reqJson(server, 'GET', '/api/v1/grades/overview?assessment_type=ASTS_GANJIL', null, parentAuth);
    assert.strictEqual(parentBeforePub.status, 200);
    assert.strictEqual(parentBeforePub.body.data.parent_unpublished_notice, true);
    assert.strictEqual(parentBeforePub.body.data.matrix.length, 0);

    const pubOk = await reqJson(server, 'PUT', '/api/v1/grades/publish', {
      academic_year_id: '2026/2027',
      assessment_type: 'ASTS_GANJIL',
      is_published: true
    }, adminAuth);
    assert.strictEqual(pubOk.status, 200);

    const parentAfterPub = await reqJson(server, 'GET', '/api/v1/grades/overview?assessment_type=ASTS_GANJIL', null, parentAuth);
    assert.strictEqual(parentAfterPub.status, 200);
    assert.strictEqual(parentAfterPub.body.data.matrix.length, 1, 'Parent must only see their own linked child');
    assert.strictEqual(parentAfterPub.body.data.matrix[0].student_id, 'STD-K10015');

    const parentOtherChild = await reqJson(server, 'GET', '/api/v1/grades/student/STD-K10001/khs?assessment_type=ASTS_GANJIL', null, parentAuth);
    assert.strictEqual(parentOtherChild.status, 403, 'Parent must be blocked from viewing another student KHS');

    const parentOwnKhs = await reqJson(server, 'GET', '/api/v1/grades/student/STD-K10015/khs?assessment_type=ASTS_GANJIL', null, parentAuth);
    assert.strictEqual(parentOwnKhs.status, 200);
    assert.strictEqual(parentOwnKhs.body.data.trend.length, 4);
    console.log('5. PASS: Parent publication switch & child-ownership isolation verified.');

    // 7. Verify Multi-Year Academic Year Creation, Archive Lock, & Historical Student Preservation
    const guruCreateYear = await reqJson(server, 'POST', '/api/v1/grades/academic-years', {
      academic_year_id: '2027/2028'
    }, guruAuth);
    assert.strictEqual(guruCreateYear.status, 403, 'Guru must be forbidden from creating academic years');

    const createYearRes = await reqJson(server, 'POST', '/api/v1/grades/academic-years', {
      academic_year_id: '2027/2028',
      name: 'Tahun Ajaran 2027/2028',
      set_active: true,
      archive_previous: true,
      copy_subjects_from_year: '2026/2027'
    }, adminAuth);
    assert.strictEqual(createYearRes.status, 201, `Create academic year failed: ${createYearRes.text}`);
    assert.ok(createYearRes.body.data.copied_subject_configs >= 65, 'Must copy subject configs (23+21+21)');
    assert.ok(createYearRes.body.data.archived_previous_years.includes('2026/2027'), 'Previous year 2026/2027 must be archived');

    // Attempt to overwrite grades in archived 2026/2027 -> must be 403 Forbidden
    const editArchivedAttempt = await reqJson(server, 'POST', '/api/v1/grades/batch', {
      academic_year_id: '2026/2027',
      class_id: 'CLS-2627-10',
      assessment_type: 'ASTS_GANJIL',
      subject_code: 'FQ',
      entries: [{ student_id: 'STD-K10015', score: 99 }]
    }, adminAuth);
    assert.strictEqual(editArchivedAttempt.status, 403, 'Archived academic year must block grade edits');

    // Simulate graduating a Kelas 12 student (status = Inactive) -> historical archive 2026/2027 must still preserve all 7 students!
    const gradStudent = testDbEngine.students.find((s) => s.student_id === 'STD-K12004');
    gradStudent.status = 'Inactive';
    const archivedK12 = await reqJson(server, 'GET', '/api/v1/grades/overview?academic_year_id=2026/2027&assessment_type=ASTS_GANJIL&class_id=CLS-2627-12', null, adminAuth);
    assert.strictEqual(archivedK12.status, 200);
    assert.strictEqual(archivedK12.body.data.is_year_archived, true);
    assert.strictEqual(archivedK12.body.data.matrix.length, 7, 'Archived 2026/2027 Kelas 12 must retain graduated students');
    assert.ok(archivedK12.body.data.matrix.some((r) => r.student_id === 'STD-K12004' && r.total_score === 1623));

    // Unlock 2026/2027 archive temporarily & verify edit works again
    const unlockRes = await reqJson(server, 'PUT', '/api/v1/grades/academic-years/archive', {
      academic_year_id: '2026/2027',
      is_archived: false
    }, adminAuth);
    assert.strictEqual(unlockRes.status, 200);
    assert.strictEqual(unlockRes.body.data.is_archived, false);
    console.log('6. PASS: Multi-year creation, archive lock (403), graduated-student historical retention, & unlock verified.');
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log('=====================================================================');
  console.log('BUG 74 MENU NILAI & ASTS GANJIL SEED: ALL TESTS PASSED (GREEN)');
  console.log('=====================================================================');
  return true;
}

if (require.main === module) {
  runBug74Tests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 74 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug74Tests;
