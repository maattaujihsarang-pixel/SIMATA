const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runBug63QrQuickScanTests() {
  console.log('\n===============================================================');
  console.log('BUG 63: QRIS-STYLE DIRECT SCAN QR & GALLERY UPLOAD REGRESSION');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const dashboardHtml = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const scannerHtml = fs.readFileSync(path.join(rootDir, 'public/scanner.html'), 'utf8');
  const teacherCamHtml = fs.readFileSync(path.join(rootDir, 'public/teacher-camera.html'), 'utf8');

  // 1. Validate inline JS syntax in both dashboard.html and scanner.html
  for (const [label, html] of [['public/dashboard.html', dashboardHtml], ['public/scanner.html', scannerHtml]]) {
    const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let count = 0;
    while ((m = scriptRegex.exec(html)) !== null) {
      if (!m[1].trim()) continue;
      new vm.Script(m[1], { filename: `${label}.inline.${++count}.js` });
    }
    assert.ok(count >= 1, `${label} must compile inline scripts`);
  }

  // 2. Verify bottom-center Scan QR & quick-scan flow bypasses Responder teacher view before scanning
  assert.ok(
    dashboardHtml.includes('startOrOpenResponder({ autoOpenQrScanner: true, deferResponderView: true })'),
    'triggerMobileQuickScan must open QR scanner directly while deferring Responder view until a student QR is scanned'
  );
  assert.ok(
    dashboardHtml.includes('const targetUrl = QR_SCANNER_URL + "?v=bug63b&simataOrigin="'),
    'openQrScanner must cache-bust /scanner.html with ?v=bug63b'
  );
  assert.ok(
    dashboardHtml.includes("document.getElementById('responderQrPanel')") &&
      dashboardHtml.includes('showResponderView()'),
    'processReceivedQrCode must reveal and scroll responderQrPanel when a student QR arrives'
  );

  // 3. Verify Student QR scanner (scanner.html) supports single clean image/gallery upload button
  assert.strictEqual(
    (scannerHtml.match(/onclick="triggerQrFileUpload\(\)"/g) || []).length,
    1,
    'scanner.html must render exactly ONE upload QR button (no duplicate inside error screen)'
  );
  assert.ok(
    scannerHtml.includes('id="qrFileInput"') && scannerHtml.includes('accept="image/*"'),
    'scanner.html must provide an image file/gallery input for student QR upload'
  );
  assert.ok(
    scannerHtml.includes('triggerQrFileUpload()') &&
      scannerHtml.includes('extractQrFromImage(') &&
      scannerHtml.includes('handleQrDetected('),
    'scanner.html must wire upload trigger and decode uploaded QR image through handleQrDetected'
  );

  // 4. Security check: Teacher camera verification MUST NOT permit gallery/file upload
  assert.strictEqual(
    /<input[^>]*type=["']file["']/i.test(teacherCamHtml),
    false,
    'teacher-camera.html must NOT contain any <input type="file"> gallery upload control'
  );
  assert.strictEqual(
    /triggerQrFileUpload|uploadQrBtn|galeri/i.test(teacherCamHtml),
    false,
    'teacher-camera.html must remain live-camera-only without gallery upload hooks'
  );

  console.log('1. PASS: Direct Scan QR quick launch, scanner.html gallery upload & teacher live-camera isolation verified.');
  console.log('===============================================================');
  console.log('BUG 63 QR QUICK SCAN & UPLOAD REGRESSION: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug63QrQuickScanTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 63 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug63QrQuickScanTests;
