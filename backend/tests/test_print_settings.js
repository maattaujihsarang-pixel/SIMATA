const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const authService = require('../src/services/auth.service');
const testDbEngine = require('./test_db_engine');
const xlsxUtil = require('../src/utils/xlsx.util');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

function reqRaw(server, method, reqPath, body, headers = {}) {
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
          resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) });
        });
      }
    );
    req.on('error', reject);
    if (raw) req.write(raw);
    req.end();
  });
}

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
  const styleCss = fs.readFileSync(path.join(rootDir, 'public/css/style.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  // 1. Visual Assets & Static Contracts
  assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/logo.png')), 'Missing MA At-Taujih /assets/logo.png');
  assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/kts_signature.png')), 'Missing /assets/kts_signature.png');
  assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/kts_stamp.png')), 'Missing /assets/kts_stamp.png');

  assert.ok(!gradesJs.includes('Tampil di cetakan A4'), 'Hint text "Tampil di cetakan A4 & Portal Wali" must be removed from grades-module.js');
  assert.ok(!gradesCss.includes('.grd-khs-note-hint'), '.grd-khs-note-hint must be removed from grades.css');
  assert.ok(gradesCss.includes('padding: 26px 8px 26px 58px;') && gradesCss.includes('.grd-vchart-plot > .grd-vchart-kkm-line'), 'KKM bar chart must reserve left gutter to avoid overlapping bars');
  assert.ok(styleCss.includes('.toast-spinner') && styleCss.includes('.toast.is-loading'), 'style.css must define SIMATA loading toast spinner');
  assert.ok(gradesJs.includes('NILAI RATA-RATA SATU KELAS / MAPEL') && gradesJs.includes('MADRASAH ALIYAH AT-TAUJIH'), 'Official Leger print markers must stay intact');
  assert.ok(gradesJs.includes('window.SimataPrint') && gradesJs.includes('renderPrincipalSigHtml') && gradesJs.includes('renderKopHtml'), 'grades-module.js must integrate SimataPrint');

  assert.ok(!printHelperJs.includes('DEFAULT_PRINT_SETTINGS'), 'print-helper.js must reference DEFAULTS, not undefined DEFAULT_PRINT_SETTINGS');
  assert.ok(printHelperJs.includes('window.SimataPrint') && printHelperJs.includes('buildQrSignatureDataUrl') && printHelperJs.includes('/assets/logo.png'), 'Missing core helpers in print-helper.js');
  assert.ok(printHelperJs.includes('buildTrimmedCanvas') && printHelperJs.includes('createQrMatrixSource') && printHelperJs.includes('DEFAULT_KOP_ELEMENTS'), 'Missing trimmed large logo, multi-level QR fallback, or per-element Kop defaults');
  assert.ok(printHelperJs.includes('logo_size_px') && printHelperJs.includes('header_line_top_gap_px') && printHelperJs.includes('renderKopDividerHtml'), 'Missing flexible Kop sizing/spacing controls in print-helper.js');

  assert.ok(clientJs.includes('getPrintSettings') && clientJs.includes('updatePrintSettings'), 'Missing print-settings REST methods in simata-client.js');

  assert.ok(html.includes('/js/print-helper.js'), 'dashboard.html must load /js/print-helper.js');
  assert.ok(html.includes('id="settingsTab_cetak"') && html.includes('id="settingsPanel_cetak"'), 'dashboard.html missing Pengaturan Cetak tab/panel');
  assert.ok(html.includes('id="prtCfgLivePreview"') && html.includes('focusgroup="tablist nomemory"') && html.includes('id="printLayoutStudioDialog"'), 'dashboard.html missing redesigned print tabs or dedicated KTS-style layout studio dialog');
  assert.ok(html.includes('openPrintLayoutStudio') && html.includes('nudgePrintStudioElement') && html.includes("showToast('loading'") && html.includes('savePrintSettingsFromForm'), 'dashboard.html missing studio controls or SIMATA loading toast hook');
  assert.ok(!html.includes('Butuh Atur Ukuran Logo') && !html.includes('prt-studio-callout'), 'Redundant studio callout box must be removed from dashboard.html');
  assert.ok(html.includes('id="schedPrintOrientation"') && html.includes('id="prtCfg_orientation"'), 'dashboard.html must provide flexible print orientation selectors for Schedule and Print Settings');
  assert.ok(html.includes('Export Excel (.xlsx)') && html.includes('exportFormattedExcel') && gradesJs.includes('exportFormattedExcel') && clientJs.includes('exportFormattedExcel'), 'All SIMATA menus must route Excel exports to formatted .xlsx');
  assert.ok(html.includes("'cetak'") && html.includes('loadPrintSettingsForm()'), 'switchSettingsCategory must handle cetak tab');

  const simataPrintRefsInDashboard = (html.match(/window\.SimataPrint/g) || []).length;
  assert.ok(simataPrintRefsInDashboard >= 12, `Expected >= 12 SimataPrint hooks across dashboard.html printouts + settings, found ${simataPrintRefsInDashboard}`);
  console.log(`1. PASS: Static & print layout contracts verified (${simataPrintRefsInDashboard} SimataPrint hooks in dashboard.html).`);

  // 1b. Runtime DOM/HTML attribute rendering regression test for Studio & Default Kop
  const sandbox = {
    location: { origin: 'https://simata-attaujih.my.id' },
    console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(printHelperJs, sandbox);

  const customKopHtml = sandbox.SimataPrint.renderKopHtml({
    interactive: true,
    selectedEl: 'school',
    cfg: {
      kop_elements: {
        school: {
          font_family: 'Plus Jakarta Sans',
          font_size_pt: 19,
          font_weight: 800,
          italic: true,
          uppercase: true,
          letter_spacing_px: 1.6,
          color: '#166534',
          offset_x: 10,
          offset_y: -4
        }
      }
    }
  });
  assert.ok(!customKopHtml.includes('style="font-family:"'), 'Inline style must never contain unescaped double quotes closing style attribute');
  assert.ok(!/style="[^"]*font-family:[^"]*"[A-Za-z]/.test(customKopHtml), 'style="..." attribute must remain intact across font-family declarations');
  assert.ok(customKopHtml.includes("font-family:'Plus Jakarta Sans'"), 'Custom Kop style must use single quotes around font family names');
  assert.ok(customKopHtml.includes('font-size:19.00pt'), 'Custom Studio font size 19pt must be rendered in style');
  assert.ok(customKopHtml.includes('font-weight:800'), 'Custom Studio font weight 800 must be rendered in style');
  assert.ok(customKopHtml.includes('font-style:italic'), 'Custom Studio italic style must be rendered');
  assert.ok(customKopHtml.includes('text-transform:uppercase'), 'Custom Studio uppercase style must be rendered');
  assert.ok(customKopHtml.includes('letter-spacing:1.6px'), 'Custom Studio letter-spacing must be rendered');
  assert.ok(customKopHtml.includes('color:#166534'), 'Custom Studio text color must be rendered');
  assert.ok(customKopHtml.includes('transform:translate(10px,-4px)'), 'Custom Studio X/Y nudge transform must be rendered');
  assert.ok(customKopHtml.includes('data-kop-el="school"'), 'Interactive Studio preview must tag selected element');

  const compactDefaultHtml = sandbox.SimataPrint.renderKopHtml({ compact: true });
  const schoolMatch = compactDefaultHtml.match(/<div class="simata-kop-school" style="([^"]+)">/);
  assert.ok(schoolMatch, 'Default compact Kop must emit intact simata-kop-school style attribute');
  assert.ok(schoolMatch[1].includes('font-size:11.88pt'), `Expected compact school font-size:11.88pt (13.5*0.88), got: ${schoolMatch[1]}`);
  assert.ok(schoolMatch[1].includes('font-weight:800'), `Expected compact school font-weight:800, got: ${schoolMatch[1]}`);
  assert.ok(compactDefaultHtml.includes('NSM: 131233170020'), 'Default Kop must include NSM: 131233170020');

  assert.ok(sandbox.SimataPrint.getPageCss('landscape').includes('A4 landscape'), 'Auto orientation must preserve landscape when requested');
  assert.ok(sandbox.SimataPrint.getPageCss('portrait').includes('A4 portrait'), 'Auto orientation must preserve portrait when requested');
  assert.strictEqual(sandbox.SimataPrint.getPageCss('landscape', { default_orientation: 'browser', margin_mm: 8 }), '@page { margin: 8mm; }', 'Browser orientation mode must omit forced portrait/landscape size lock');
  assert.ok(sandbox.SimataPrint.getPageCss('portrait', { default_orientation: 'browser' }, 'landscape').includes('A4 landscape'), 'Explicit orientation override must take precedence');
  console.log('1b. PASS: Runtime SimataPrint.renderKopHtml & getPageCss flexible orientation verified.');

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
    assert.strictEqual(guruGet.body.data.kop_elements.school.font_weight, 800);
    assert.strictEqual(guruGet.body.data.kop_elements.divider.thickness_px, 3);
    assert.strictEqual(guruGet.body.data.default_orientation, 'auto');
    assert.ok(guruGet.body.data.school_contact.includes('NSM: 131233170020'), 'Default backend school_contact must include NSM: 131233170020');

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

    const badOri = await reqJson(server, 'PUT', '/api/v1/print-settings', { default_orientation: 'diagonal' }, adminAuth);
    assert.strictEqual(badOri.status, 400, 'Expected 400 for invalid default_orientation');

    // 2e. ADMIN PUT persists settings, normalizes fields & syncs grades_portal_settings
    const putRes = await reqJson(
      server,
      'PUT',
      '/api/v1/print-settings',
      {
        show_logo: false,
        school_name: 'MADRASAH ALIYAH AT-TAUJIH SARANG (CUSTOM)',
        kop_align: 'center_remain',
        logo_size_px: 190,
        logo_text_gap_px: 26,
        header_font_scale_pct: 120,
        header_line_style: 'thick_thin',
        header_line_top_gap_px: 14,
        kop_elements: {
          foundation: { font_family: 'Times New Roman', font_size_pt: 10.5, font_weight: 400, italic: true, letter_spacing_px: 1.4, color: '#1e293b', offset_x: 6, offset_y: -2 },
          school: { font_family: 'Times New Roman', font_size_pt: 15, font_weight: 900, letter_spacing_px: 0.8 },
          divider: { color: '#166534', thickness_px: 4 }
        },
        principal_name: 'K.H. M. Iqnaul Badril Falah, S.Ag., M.Pd.',
        signature_mode: 'qr_stamp',
        qr_style: 'qr_only_crest',
        qr_verify_url: 'simata-attaujih.my.id/tte',
        default_paper_size: 'f4',
        default_orientation: 'browser',
        margin_mm: 28,
        show_print_timestamp: false,
        footer_note: 'Dokumen Sahih SIMATA Uji'
      },
      adminAuth
    );
    assert.strictEqual(putRes.status, 200, `Expected 200 on ADMIN PUT, got ${putRes.status}: ${putRes.text}`);
    assert.strictEqual(putRes.body.data.show_logo, false);
    assert.strictEqual(putRes.body.data.kop_align, 'center_remain');
    assert.strictEqual(putRes.body.data.logo_size_px, 130); // clamped to 130
    assert.strictEqual(putRes.body.data.header_line_style, 'thick_thin');
    assert.strictEqual(putRes.body.data.header_line_top_gap_px, 14);
    assert.strictEqual(putRes.body.data.kop_elements.foundation.font_weight, 400);
    assert.strictEqual(putRes.body.data.kop_elements.foundation.italic, true);
    assert.strictEqual(putRes.body.data.kop_elements.foundation.letter_spacing_px, 1.4);
    assert.strictEqual(putRes.body.data.kop_elements.school.font_weight, 900);
    assert.strictEqual(putRes.body.data.kop_elements.divider.thickness_px, 4);
    assert.strictEqual(putRes.body.data.signature_mode, 'qr_stamp');
    assert.strictEqual(putRes.body.data.qr_style, 'qr_only_crest');
    assert.strictEqual(putRes.body.data.qr_verify_url, 'https://simata-attaujih.my.id/tte');
    assert.strictEqual(putRes.body.data.default_paper_size, 'F4');
    assert.strictEqual(putRes.body.data.default_orientation, 'browser');
    assert.strictEqual(putRes.body.data.margin_mm, 20); // clamped to 20
    assert.strictEqual(putRes.body.data.show_print_timestamp, false);

    // 2f. Verify GET returns persisted values
    const getAfter = await reqJson(server, 'GET', '/api/v1/print-settings', null, guruAuth);
    assert.strictEqual(getAfter.status, 200);
    assert.strictEqual(getAfter.body.data.school_name, 'MADRASAH ALIYAH AT-TAUJIH SARANG (CUSTOM)');
    assert.strictEqual(getAfter.body.data.logo_size_px, 130);
    assert.strictEqual(getAfter.body.data.kop_elements.foundation.font_family, 'Times New Roman');
    assert.strictEqual(getAfter.body.data.signature_mode, 'qr_stamp');
    assert.strictEqual(getAfter.body.data.default_paper_size, 'F4');

    // 2g. Verify grades_portal_settings synced
    const portalRow = testDbEngine.system_settings.find((r) => r.setting_key === 'grades_portal_settings');
    const portalParsed = JSON.parse(portalRow.setting_value);
    assert.strictEqual(portalParsed.principal_name, 'K.H. M. Iqnaul Badril Falah, S.Ag., M.Pd.');

    // 3. Formatted .xlsx Excel export tests (unauth 401, validation 400, OOXML workbook + Logo & QR PNG)
    const unauthXlsx = await reqRaw(server, 'POST', '/api/v1/print-settings/export-xlsx', { headers: ['No'], rows: [[1]] });
    assert.strictEqual(unauthXlsx.status, 401, 'Unauthenticated XLSX export must return 401');

    const badXlsx = await reqJson(server, 'POST', '/api/v1/print-settings/export-xlsx', { headers: [], rows: [] }, guruAuth);
    assert.strictEqual(badXlsx.status, 400, 'Empty headers XLSX export must return 400');

    // Re-enable logo + auto orientation so generated XLSX tests embedded logo & orientation cleanly
    await reqJson(server, 'PUT', '/api/v1/print-settings', { show_logo: true, default_orientation: 'auto', signature_mode: 'qr' }, adminAuth);
    const samplePngB64 = fs.readFileSync(path.join(rootDir, 'public/assets/logo.png')).toString('base64');
    const xlsxRes = await reqRaw(
      server,
      'POST',
      '/api/v1/print-settings/export-xlsx',
      {
        filename: 'Leger_XII_ASTS_GANJIL.xlsx',
        sheet_name: 'Leger XII',
        title: 'HASIL NILAI ASTS GANJIL',
        subtitle: 'MADRASAH ALIYAH AT-TAUJIH • Tahun Ajaran 2026 - 2027',
        orientation: 'landscape',
        meta_rows: [['Kelas : XII', 'Wali Kelas : Imam Maulana']],
        headers: ['No', 'NIS', 'Nama Siswa', 'QH', 'Jumlah', 'Rata-Rata'],
        columns: [
          { align: 'center', type: 'int', width: 5.5 },
          { align: 'center', type: 'text', width: 20 },
          { align: 'left', type: 'text', width: 28 },
          { align: 'center', type: 'decimal', width: 8 },
          { align: 'center', type: 'decimal', width: 10 },
          { align: 'center', type: 'decimal2', width: 10 }
        ],
        rows: [
          [1, '131233170020240001', 'Ahmad Najibul Fahri', 85.5, 85.5, 85.5]
        ],
        summary_row: {
          label: 'NILAI RATA-RATA SATU KELAS / MAPEL',
          colspan: 3,
          values: [85.5, 85.5, 85.5]
        },
        left_signer: { top: 'Mengetahui,', role: 'Wali Kelas', name: 'Imam Maulana' },
        include_principal_sig: true,
        qr_png_data_url: `data:image/png;base64,${samplePngB64}`
      },
      guruAuth
    );
    assert.strictEqual(xlsxRes.status, 200, `Expected 200 for formatted XLSX export, got ${xlsxRes.status}`);
    assert.ok(String(xlsxRes.headers['content-type'] || '').includes('spreadsheetml.sheet'), 'Missing XLSX content-type');
    assert.ok(xlsxRes.buffer.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Response must be a valid ZIP/XLSX binary');

    const zipEntries = xlsxUtil.extractZipEntries(xlsxRes.buffer);
    assert.ok(zipEntries['[Content_Types].xml'], 'Missing [Content_Types].xml');
    assert.ok(zipEntries['xl/styles.xml'], 'Missing xl/styles.xml');
    assert.ok(zipEntries['xl/worksheets/sheet1.xml'], 'Missing xl/worksheets/sheet1.xml');
    assert.ok(zipEntries['xl/drawings/drawing1.xml'], 'Missing xl/drawings/drawing1.xml');
    assert.ok(zipEntries['xl/media/image1.png'], 'Missing embedded Madrasah Logo PNG');
    assert.ok(zipEntries['xl/media/image2.png'], 'Missing embedded QR TTE PNG');

    const sheetXml = zipEntries['xl/worksheets/sheet1.xml'].toString('utf8');
    const tagPositions = [
      sheetXml.indexOf('<sheetPr>'),
      sheetXml.indexOf('<dimension '),
      sheetXml.indexOf('<sheetViews>'),
      sheetXml.indexOf('<sheetFormatPr '),
      sheetXml.indexOf('<cols>'),
      sheetXml.indexOf('<sheetData>'),
      sheetXml.indexOf('<mergeCells '),
      sheetXml.indexOf('<pageMargins '),
      sheetXml.indexOf('<pageSetup '),
      sheetXml.indexOf('<drawing ')
    ];
    for (let i = 0; i < tagPositions.length; i++) {
      assert.ok(tagPositions[i] > 0, `Missing OOXML element at index ${i}`);
      if (i > 0) assert.ok(tagPositions[i] > tagPositions[i - 1], `Invalid OOXML tag order at index ${i}`);
    }
    assert.ok(sheetXml.includes('MADRASAH ALIYAH AT-TAUJIH'), 'XLSX must include official Kop header');
    assert.ok(sheetXml.includes('NSM: 131233170020'), 'XLSX Kop must include NSM: 131233170020');
    assert.ok(sheetXml.includes('NILAI RATA-RATA SATU KELAS / MAPEL'), 'XLSX must include Leger summary row');
    assert.ok(sheetXml.includes('<t xml:space="preserve">131233170020240001</t>'), 'Long NIS must remain preserved as inlineStr text');
    assert.ok(sheetXml.includes('<v>85.5</v>'), 'Numeric scores must be written as numeric values');
    assert.ok(sheetXml.includes('orientation="landscape"'), 'XLSX pageSetup must enforce landscape orientation');

    console.log('2. PASS: API auth, RBAC (403 GURU / 200 ADMIN), validation, clamping, persistence, & portal sync verified.');
    console.log('3. PASS: Formatted .xlsx OpenXML workbook (Kop + Logo + Borders + Typed Cells + QR TTE PNG) verified.');
    console.log('\nALL PRINT SETTINGS TESTS PASSED.');
  } finally {
    await new Promise((r) => server.close(r));
  }
}

runPrintSettingsTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
