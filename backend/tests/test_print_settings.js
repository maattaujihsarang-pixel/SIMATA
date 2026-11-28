const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const authService = require('../src/services/auth.service');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

function reqJson(server, method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body !== null && body !== undefined ? JSON.stringify(body) : null;
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

async function runPrintSettingsTests() {
  console.log('\n=====================================================================');
  console.log('TEST: KHS NOTE HINT REMOVAL + UNIVERSAL LOGO/QR TTE + PRINT SETTINGS');
  console.log('=====================================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const printHelperJs = fs.readFileSync(path.join(rootDir, 'public/js/print-helper.js'), 'utf8');
  const gradesJs = fs.readFileSync(path.join(rootDir, 'public/js/grades-module.js'), 'utf8');
  const gradesCss = fs.readFileSync(path.join(rootDir, 'public/css/grades.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  // 1. Visual Assets & Static Contracts
  assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/logo.png')), 'Missing MA At-Taujih /assets/logo.png');
  assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/kts_signature.png')), 'Missing /assets/kts_signature.png');
  assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/kts_stamp.png')), 'Missing /assets/kts_stamp.png');

  assert.ok(!gradesJs.includes('Tampil di cetakan A4'), 'Hint text "Tampil di cetakan A4 & Portal Wali" must be removed from grades-module.js');
  assert.ok(!gradesCss.includes('.grd-khs-note-hint'), '.grd-khs-note-hint must be removed from grades.css');
  assert.ok(gradesJs.includes('NILAI RATA-RATA SATU KELAS / MAPEL') && gradesJs.includes('MADRASAH ALIYAH AT-TAUJIH'), 'Official Leger print markers must stay intact');
  assert.ok(gradesJs.includes('window.SimataPrint') && gradesJs.includes('renderPrincipalSigHtml') && gradesJs.includes('renderKopHtml'), 'grades-module.js must integrate SimataPrint');

  assert.ok(!printHelperJs.includes('DEFAULT_PRINT_SETTINGS'), 'print-helper.js must reference DEFAULTS, not undefined DEFAULT_PRINT_SETTINGS');
  assert.ok(printHelperJs.includes('window.SimataPrint') && printHelperJs.includes('buildQrSignatureDataUrl') && printHelperJs.includes('/assets/logo.png'), 'Missing core helpers in print-helper.js');
  assert.ok(printHelperJs.includes('buildTrimmedCanvas') && printHelperJs.includes('createQrMatrixSource') && printHelperJs.includes('grid-template-columns'), 'Missing trimmed large logo, multi-level QR fallback, or symmetrical grid Kop CSS');
  assert.ok(printHelperJs.includes('logo_size_px') && printHelperJs.includes('header_line_top_gap_px') && printHelperJs.includes('renderKopDividerHtml'), 'Missing flexible Kop sizing/spacing controls in print-helper.js');

  assert.ok(clientJs.includes('getPrintSettings') && clientJs.includes('updatePrintSettings'), 'Missing print-settings REST methods in simata-client.js');

  assert.ok(html.includes('/js/print-helper.js'), 'dashboard.html must load /js/print-helper.js');
  assert.ok(html.includes('id="settingsTab_cetak"') && html.includes('id="settingsPanel_cetak"'), 'dashboard.html missing Pengaturan Cetak tab/panel');
  assert.ok(html.includes('id="prtCfgLivePreview"') && html.includes('id="prtCfg_logoSizePx"') && html.includes('id="prtCfg_headerLineTopGapPx"') && html.includes('resetKopStyleDefaults') && html.includes('savePrintSettingsFromForm') && html.includes('testPrintSettingsPreview'), 'dashboard.html missing flexible print settings controls');
  assert.ok(html.includes("'cetak'") && html.includes('loadPrintSettingsForm()'), 'switchSettingsCategory must handle cetak tab');

  const simataPrintRefsInDashboard = (html.match(/window\.SimataPrint/g) || []).length;
  assert.ok(simataPrintRefsInDashboard >= 12, `Expected >= 12 SimataPrint hooks across dashboard.html printouts + settings, found ${simataPrintRefsInDashboard}`);
  console.log(`1. PASS: Static & print layout contracts verified (${simataPrintRefsInDashboard} SimataPrint hooks in dashboard.html).`);

  // 2. Backend API, RBAC, Validation & DB Persistence Tests
  await testDbEngine.reset();
  setMockQueryHandler((t, p) => testDbEngine.handleQuery(t, p));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  // Pre-seed grades_portal_settings to test principal_name synchronization
  testDbEngine.system_settings.push({
    setting_key: 'grades_portal_settings',
    setting_value: JSON.stringify({ principal_name: 'Old Principal', show_ranking_on_parent: false }),
    description: 'Portal settings',
    updated_by: 1,
    updated_at: new Date().toISOString()
  });

  const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
  const guruLogin = await authService.login({ username: 'Guru_001', password: 'Guru001' });
  const adminAuth = { Authorization: `Bearer ${adminLogin.token}` };
  const guruAuth = { Authorization: `Bearer ${guruLogin.token}` };

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));

  try {
    // 2a. Unauthenticated GET rejected
    const unauthGet = await reqJson(server, 'GET', '/api/v1/print-settings');
    assert.strictEqual(unauthGet.status, 401, `Expected 401, got ${unauthGet.status}`);

    // 2b. Authenticated GURU GET succeeds with defaults
    const guruGet = await reqJson(server, 'GET', '/api/v1/print-settings', null, guruAuth);
    assert.strictEqual(guruGet.status, 200, `Expected 200 for GURU GET, got ${guruGet.status}: ${guruGet.text}`);
    assert.strictEqual(guruGet.body.data.show_logo, true);
    assert.strictEqual(guruGet.body.data.logo_url, '/assets/logo.png');
    assert.strictEqual(guruGet.body.data.signature_mode, 'qr');
    assert.strictEqual(guruGet.body.data.qr_style, 'tte_compact');
    assert.strictEqual(guruGet.body.data.default_paper_size, 'A4');
    assert.strictEqual(guruGet.body.data.margin_mm, 10);
    assert.strictEqual(guruGet.body.data.kop_align, 'center_page');
    assert.strictEqual(guruGet.body.data.logo_size_px, 64);
    assert.strictEqual(guruGet.body.data.header_line_style, 'double');

    // 2c. RBAC: GURU PUT denied
    const guruPut = await reqJson(server, 'PUT', '/api/v1/print-settings', { signature_mode: 'blank' }, guruAuth);
    assert.strictEqual(guruPut.status, 403, `Expected 403 for GURU PUT, got ${guruPut.status}`);

    // 2d. Validation errors return 400
    const badMode = await reqJson(server, 'PUT', '/api/v1/print-settings', { signature_mode: 'invalid_mode' }, adminAuth);
    assert.strictEqual(badMode.status, 400, 'Expected 400 for invalid signature_mode');

    const badPaper = await reqJson(server, 'PUT', '/api/v1/print-settings', { default_paper_size: 'LETTER' }, adminAuth);
    assert.strictEqual(badPaper.status, 400, 'Expected 400 for invalid default_paper_size');

    const badImg = await reqJson(server, 'PUT', '/api/v1/print-settings', { logo_url: 'javascript:alert(1)' }, adminAuth);
    assert.strictEqual(badImg.status, 400, 'Expected 400 for unsafe logo_url');

    // 2e. ADMIN PUT persists settings, normalizes fields & syncs grades_portal_settings
    const putRes = await reqJson(
      server,
      'PUT',
      '/api/v1/print-settings',
      {
        show_logo: false,
        school_name: 'MADRASAH ALIYAH AT-TAUJIH SARANG (CUSTOM)',
        kop_align: 'center_remain',
        header_font_family: 'serif',
        logo_size_px: 190,
        logo_text_gap_px: 26,
        logo_offset_x_px: 12,
        header_offset_x_px: -10,
        header_font_scale_pct: 125,
        header_line_gap_px: 6,
        header_line_style: 'thick_thin',
        header_line_top_gap_px: 14,
        header_line_bottom_gap_px: 18,
        principal_name: 'K.H. M. Iqnaul Badril Falah, S.Ag., M.Pd.',
        signature_mode: 'qr_stamp',
        qr_style: 'qr_only_crest',
        qr_verify_url: 'simata-attaujih.my.id/tte',
        default_paper_size: 'f4',
        margin_mm: 28,
        show_print_timestamp: false,
        footer_note: 'Dokumen Sahih SIMATA Uji'
      },
      adminAuth
    );
    assert.strictEqual(putRes.status, 200, `Expected 200 on ADMIN PUT, got ${putRes.status}: ${putRes.text}`);
    assert.strictEqual(putRes.body.data.show_logo, false);
    assert.strictEqual(putRes.body.data.kop_align, 'center_remain');
    assert.strictEqual(putRes.body.data.header_font_family, 'serif');
    assert.strictEqual(putRes.body.data.logo_size_px, 130); // clamped to 130
    assert.strictEqual(putRes.body.data.header_font_scale_pct, 125);
    assert.strictEqual(putRes.body.data.header_line_style, 'thick_thin');
    assert.strictEqual(putRes.body.data.header_line_top_gap_px, 14);
    assert.strictEqual(putRes.body.data.signature_mode, 'qr_stamp');
    assert.strictEqual(putRes.body.data.qr_style, 'qr_only_crest');
    assert.strictEqual(putRes.body.data.qr_verify_url, 'https://simata-attaujih.my.id/tte');
    assert.strictEqual(putRes.body.data.default_paper_size, 'F4');
    assert.strictEqual(putRes.body.data.margin_mm, 20); // clamped to 20
    assert.strictEqual(putRes.body.data.show_print_timestamp, false);

    // 2f. Verify GET returns persisted values
    const getAfter = await reqJson(server, 'GET', '/api/v1/print-settings', null, guruAuth);
    assert.strictEqual(getAfter.status, 200);
    assert.strictEqual(getAfter.body.data.school_name, 'MADRASAH ALIYAH AT-TAUJIH SARANG (CUSTOM)');
    assert.strictEqual(getAfter.body.data.logo_size_px, 130);
    assert.strictEqual(getAfter.body.data.kop_align, 'center_remain');
    assert.strictEqual(getAfter.body.data.signature_mode, 'qr_stamp');
    assert.strictEqual(getAfter.body.data.default_paper_size, 'F4');

    // 2g. Verify grades_portal_settings synced
    const portalRow = testDbEngine.system_settings.find((r) => r.setting_key === 'grades_portal_settings');
    const portalParsed = JSON.parse(portalRow.setting_value);
    assert.strictEqual(portalParsed.principal_name, 'K.H. M. Iqnaul Badril Falah, S.Ag., M.Pd.');

    console.log('2. PASS: API auth, RBAC (403 GURU / 200 ADMIN), validation, clamping, persistence, & portal sync verified.');
    console.log('\nALL PRINT SETTINGS TESTS PASSED.');
  } finally {
    await new Promise((r) => server.close(r));
  }
}

runPrintSettingsTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
