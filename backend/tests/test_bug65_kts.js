const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');
const xlsxUtil = require('../src/utils/xlsx.util');

function assertFrontendKtsIntegrity() {
  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'public/css/style.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  // CSS balanced braces + KTS classes
  let openBraces = 0;
  for (const ch of css) {
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    assert.ok(openBraces >= 0, 'style.css has unexpected closing brace');
  }
  assert.strictEqual(openBraces, 0, 'style.css must have balanced curly braces');
  assert.ok(css.includes('.kts-studio-grid'), 'style.css must define .kts-studio-grid');
  assert.ok(css.includes('#ktsPreviewCanvas'), 'style.css must style #ktsPreviewCanvas');

  // HTML structure & Menu Siswa + KTS Studio elements
  for (const requiredToken of [
    'id="menu-kts"',
    '<span class="menu-text">KTS</span>',
    'id="sheetMenuKts"',
    'id="ktsContent"',
    'id="ktsPreviewCanvas"',
    'id="ktsQuickEditModal"',
    'id="ktsTemplateModal"',
    'id="ktsEditLayoutBtn"',
    'id="ktsLayoutEditorModal"',
    'id="ktsLayoutCanvas"',
    'DEFAULT_KTS_LAYOUT',
    'id="ktsLayUndoBtn"',
    'id="ktsLayRedoBtn"',
    'id="ktsLaySmartGuidesToggle"',
    'id="ktsLaySelectAllTextBtn"',
    'id="ktsLayAlignElsCenterH"',
    'computeKtsSmartGuides',
    'undoKtsLayout',
    'redoKtsLayout',
    'id="ktsTpl_headerTitle"',
    'id="ktsBatchPrintModal"',
    'id="f_birthPlace"',
    'id="f_address"',
    'id="f_dormitory"',
    'KARTU IDENTITAS SISWA',
    'Yayasan Muwajjihul Ulum Asy-Syariyyah',
    'MA AT-TAUJIH',
    'Dk. Pulorejo, Desa Bajingjowo, Kec. Sarang, Kab. Rembang, Jawa Tengah (59274)',
    '/js/simata-client.js?v=bug61'
  ]) {
    assert.ok(html.includes(requiredToken), `public/dashboard.html missing required KTS token: ${requiredToken}`);
  }

  // Inline JS + simata-client.js compilation check
  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptCount = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].trim()) {
      new vm.Script(match[1], { filename: 'dashboard-inline.js' });
      scriptCount++;
    }
  }
  assert.ok(scriptCount >= 2, 'dashboard.html inline scripts must compile cleanly');
  new vm.Script(clientJs, { filename: 'simata-client.js' });
  for (const methodName of ['downloadKtsTemplate', 'importKtsExcel', 'getKtsSettings', 'updateKtsSettings']) {
    assert.ok(clientJs.includes(methodName), `simata-client.js must expose ${methodName}`);
  }
}

function assertXlsxUtility() {
  const headers = ['ID Siswa', 'NISN', 'Nama', 'Tanggal Lahir (DD/MM/YYYY)', 'Tempat Lahir', 'Alamat Lengkap', 'Pondok / Asrama'];
  const rows = [
    ['STD-K10001', '0012345671', 'AHMAD FAIZ', '26/10/2011', 'Rembang', 'Desa Kalipang, Kec. Sarang', 'PP. At-Taujih Sarang']
  ];
  const xlsxBuf = xlsxUtil.buildXlsxBuffer(headers, rows, 'Data KTS');
  assert.strictEqual(xlsxBuf[0], 0x50);
  assert.strictEqual(xlsxBuf[1], 0x4b);

  const parsed = xlsxUtil.parseXlsxOrCsvBuffer(xlsxBuf, 'template.xlsx');
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].nisn, '0012345671', 'Leading zero in NISN must be preserved in XLSX');
  assert.strictEqual(parsed.rows[0].tempat_lahir, 'Rembang');
  assert.strictEqual(parsed.rows[0].pondok_asrama, 'PP. At-Taujih Sarang');

  // Also check UTF-8 BOM semicolon CSV support
  const csvBuf = Buffer.from('\uFEFFID Siswa;Tempat Lahir;Alamat Lengkap;Pondok / Asrama\nSTD-K10002;Tuban;Kec. Bancar;PP. Putri', 'utf8');
  const parsedCsv = xlsxUtil.parseXlsxOrCsvBuffer(csvBuf, 'import.csv');
  assert.strictEqual(parsedCsv.rows.length, 1);
  assert.strictEqual(parsedCsv.rows[0].tempat_lahir, 'Tuban');
}

async function runBug65KtsTests() {
  console.log('\n===============================================================');
  console.log('BUG 65: MENU KTS (KARTU PELAJAR) & 2-WAY STUDENT SYNC SUITE');
  console.log('===============================================================');

  assertFrontendKtsIntegrity();
  console.log('1. PASS: Frontend HTML, CSS braces, KTS Studio DOM & JS compilation verified.');

  assertXlsxUtility();
  console.log('2. PASS: XLSX ZIP generation/parsing (leading-zero preservation) & CSV import verified.');

  await testDbEngine.reset();
  testDbEngine.profile_photos = [
    { photo_id: 'PHT-1', student_id: 'STD-K10002', teacher_id: null }
  ];
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const adminSession = await authService.login({ username: 'Admin1', password: '12345' });
    const guruSession = await authService.login({ username: 'Guru_001', password: 'Guru001' });
    const adminToken = adminSession.token;
    const guruToken = guruSession.token;

    // 3. Verify students list returns has_photo + KTS fields
    const listRes = await fetch(`${baseUrl}/api/v1/students`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    assert.strictEqual(listRes.status, 200);
    const listJson = await listRes.json();
    const s1 = listJson.data.find((s) => s.student_id === 'STD-K10001');
    const s2 = listJson.data.find((s) => s.student_id === 'STD-K10002');
    assert.strictEqual(Boolean(s1.has_photo), false);
    assert.strictEqual(Boolean(s2.has_photo), true);

    // 4. Verify Menu Siswa PUT & POST persist birth_place, address, dormitory
    const putRes = await fetch(`${baseUrl}/api/v1/students/STD-K10001`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'AHMAD FAIZ',
        class_id: 'CLS-2627-10',
        nis: '1001',
        nisn: '0012345671',
        birth_place: 'Rembang',
        birth_date: '2011-05-12',
        address: 'Desa Kalipang RT 01 RW 02, Kec. Sarang, Kab. Rembang',
        dormitory: 'PP. At-Taujih Sarang'
      })
    });
    assert.strictEqual(putRes.status, 200);

    const createRes = await fetch(`${baseUrl}/api/v1/students`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'ZAINAL ABIDIN',
        class_id: 'CLS-2627-11',
        qr_code_id: 'SQR-ZAINAL',
        birth_place: 'Blora',
        birth_date: '2010-03-14',
        address: 'Kec. Jepon, Kab. Blora',
        dormitory: 'PP. Al-Hidayah'
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createJson = await createRes.json();
    assert.strictEqual(createJson.data.birth_place, 'Blora');
    assert.strictEqual(createJson.data.dormitory, 'PP. Al-Hidayah');

    // 5. Download XLSX Template & Re-Upload Modified XLSX -> Two-way sync back to Menu Siswa
    const tplRes = await fetch(`${baseUrl}/api/v1/students/kts/template`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    assert.strictEqual(tplRes.status, 200);
    const tplBuf = Buffer.from(await tplRes.arrayBuffer());
    assert.strictEqual(tplBuf[0], 0x50);
    assert.strictEqual(tplBuf[1], 0x4b);
    const parsedTpl = xlsxUtil.parseXlsxOrCsvBuffer(tplBuf, 'Template_Data_KTS_SIMATA.xlsx');
    assert.strictEqual(parsedTpl.rows.length, 3);
    const faizTplRow = parsedTpl.rows.find((r) => r.id_siswa === 'STD-K10001');
    assert.strictEqual(faizTplRow.tempat_lahir, 'Rembang');
    assert.strictEqual(faizTplRow.tanggal_lahir, '12/05/2011');

    // Upload modified XLSX as Guru (must 403), then as Admin (must 200 & update Menu Siswa)
    const uploadHeaders = [
      'ID Siswa', 'NIS', 'NISN', 'Nama Lengkap', 'Kelas',
      'Tanggal Lahir (DD/MM/YYYY)', 'Tempat Lahir', 'Alamat Lengkap', 'Pondok / Asrama'
    ];
    const modifiedRows = [
      ['STD-K10001', '1001', '0012345671', 'AHMAD FAIZ', 'Kelas 10', '26/10/2011', 'Sarang', 'Jl. Raya Kalipang No. 5, Sarang, Rembang', 'PP. At-Taujih Pusat'],
      ['STD-K10002', '1002', '0012345672', 'SITI AISYAH', 'Kelas 10', '10/08/2010', 'Lasem', 'Kec. Lasem, Kab. Rembang', 'PP. Putri At-Taujih']
    ];
    const modifiedXlsx = xlsxUtil.buildXlsxBuffer(uploadHeaders, modifiedRows, 'Data KTS Siswa');

    const makeForm = () => {
      const fd = new FormData();
      fd.append('file', new Blob([modifiedXlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'update_kts.xlsx');
      return fd;
    };

    const guruImpRes = await fetch(`${baseUrl}/api/v1/students/kts/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guruToken}` },
      body: makeForm()
    });
    assert.strictEqual(guruImpRes.status, 403, 'Guru must receive 403 Forbidden on KTS Excel import');

    const admImpRes = await fetch(`${baseUrl}/api/v1/students/kts/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: makeForm()
    });
    assert.strictEqual(admImpRes.status, 200);
    const admImpJson = await admImpRes.json();
    assert.strictEqual(admImpJson.data.updated_count, 2);

    // Confirm two-way sync visible in GET /api/v1/students/:id
    const checkS1 = await (await fetch(`${baseUrl}/api/v1/students/STD-K10001`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    assert.strictEqual(checkS1.data.birth_place, 'Sarang');
    assert.strictEqual(checkS1.data.birth_date, '2011-10-26');
    assert.strictEqual(checkS1.data.address, 'Jl. Raya Kalipang No. 5, Sarang, Rembang');
    assert.strictEqual(checkS1.data.dormitory, 'PP. At-Taujih Pusat');

    // 6. KTS Template Settings RBAC & Persistence
    const getSetGuru = await fetch(`${baseUrl}/api/v1/students/kts/settings`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    assert.strictEqual(getSetGuru.status, 200);
    const getSetJson = await getSetGuru.json();
    assert.strictEqual(getSetJson.data.header_title, 'KARTU IDENTITAS SISWA');
    assert.strictEqual(getSetJson.data.header_arabic, 'Yayasan Muwajjihul Ulum Asy-Syariyyah');
    assert.strictEqual(getSetJson.data.school_name, 'MA AT-TAUJIH');
    assert.strictEqual(
      getSetJson.data.school_address,
      'Dk. Pulorejo, Desa Bajingjowo, Kec. Sarang, Kab. Rembang, Jawa Tengah (59274)'
    );

    const putSetGuru = await fetch(`${baseUrl}/api/v1/students/kts/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${guruToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_name: 'HACKED' })
    });
    assert.strictEqual(putSetGuru.status, 403);

    const putSetAdmin = await fetch(`${baseUrl}/api/v1/students/kts/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_name: 'MA AT-TAUJIH SARANG',
        line5_mode: 'both',
        headmaster_name: 'KH. Ahmad Sample'
      })
    });
    assert.strictEqual(putSetAdmin.status, 200);
    const putSetJson = await putSetAdmin.json();
    assert.strictEqual(putSetJson.data.line5_mode, 'both');
    assert.strictEqual(putSetJson.data.headmaster_name, 'KH. Ahmad Sample');

    // Invalid layout_config JSON must be rejected with 400
    const badLayoutRes = await fetch(`${baseUrl}/api/v1/students/kts/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_config: '{bad-json' })
    });
    assert.strictEqual(badLayoutRes.status, 400);

    // Valid layout_config JSON must persist in KTS settings
    const customLayoutStr = JSON.stringify({
      front: {
        student_name: { x: 320, y: 280, fontSize: 36, letterSpacing: 1.5, bold: true }
      }
    });
    const goodLayoutRes = await fetch(`${baseUrl}/api/v1/students/kts/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_config: customLayoutStr })
    });
    assert.strictEqual(goodLayoutRes.status, 200);
    const goodLayoutJson = await goodLayoutRes.json();
    assert.strictEqual(goodLayoutJson.data.layout_config, customLayoutStr);

    console.log('3. PASS: Students KTS fields, Excel Template/Import 2-way sync, layout_config & Settings RBAC verified.');
    console.log('===============================================================');
    console.log('BUG 65 MENU KTS & STUDENT SYNC: ALL TESTS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  runBug65KtsTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 65 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug65KtsTests;
