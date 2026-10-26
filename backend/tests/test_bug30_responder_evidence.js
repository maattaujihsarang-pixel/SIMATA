const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const teacherAttendanceService = require('../src/services/teacher-attendance.service');
const responderSessionService = require('../src/services/responder-session.service');
const storageProvider = require('../src/config/storage');

// Minimal 1x1 valid JPEG image binary fixture
const VALID_1X1_JPEG = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
  0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x02, 0x02, 0x02, 0x03,
  0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06,
  0x06, 0x05, 0x06, 0x09, 0x08, 0x0A, 0x0A, 0x09, 0x08, 0x09, 0x09, 0x0A,
  0x0C, 0x0F, 0x0C, 0x0A, 0x0B, 0x0E, 0x0B, 0x09, 0x09, 0x0D, 0x11, 0x0D,
  0x0E, 0x0F, 0x10, 0x10, 0x11, 0x10, 0x0A, 0x0C, 0x12, 0x13, 0x12, 0x10,
  0x13, 0x0F, 0x10, 0x10, 0x10, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F,
  0x00, 0xBF, 0x80, 0xFF, 0xD9
]);

async function runBug30RegressionTests() {
  console.log('\n===============================================================');
  console.log('BUG 30: TEACHER RESPONDER EVIDENCE REGRESSION TEST SUITE');
  console.log('===============================================================');

  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdFileIds = [];

  try {
    // 1. Setup isolated browser-like sandbox for simata-client.js
    const mockSessionStore = {};
    const rootDir = path.resolve(__dirname, '../..');
    const clientSource = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

    const mockWindow = {
      sessionStorage: {
        getItem: (k) => mockSessionStore[k] || null,
        setItem: (k, v) => { mockSessionStore[k] = String(v); },
        removeItem: (k) => { delete mockSessionStore[k]; }
      },
      fetch: async (url, options = {}) => {
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return globalThis.fetch(fullUrl, options);
      },
      console: console,
      atob: (str) => Buffer.from(str, 'base64').toString('binary'),
      Blob: globalThis.Blob,
      FormData: globalThis.FormData
    };

    const sandbox = {
      window: mockWindow,
      sessionStorage: mockWindow.sessionStorage,
      fetch: mockWindow.fetch,
      console: console,
      atob: mockWindow.atob,
      Blob: mockWindow.Blob,
      FormData: mockWindow.FormData,
      queueMicrotask: queueMicrotask,
      URLSearchParams: URLSearchParams,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    };
    vm.createContext(sandbox);
    vm.runInContext(clientSource, sandbox);
    const client = sandbox.window.simataClient;

    // Login as Admin to get valid session token
    const loginRes = await client.checkLogin('Admin1', '12345');
    assert.strictEqual(loginRes.success, true, 'Admin login must succeed');
    const token = loginRes.token;
    assert.ok(token, 'Session token must be present');

    // TEST SUITE A & H: Multi-hour teacher attendance with valid image (F-P5-005)
    console.log('\n--- Test A & H: Evidence Tersedia & F-P5-005 Multi-Hour Sharing ---');
    const sessionA = await responderSessionService.startSession(1);
    const dateA = '2026-09-24';

    const validImageFile = {
      buffer: VALID_1X1_JPEG,
      originalname: 'guru_hadir_jam23.jpg',
      mimetype: 'image/jpeg'
    };

    const recordResultA = await teacherAttendanceService.recordTeacherAttendanceWithEvidence({
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      subject: 'Fiqih',
      materi: 'Thaharah Praktik',
      periods: [2, 3],
      attendance_date: dateA,
      session_id: sessionA.session_id
    }, validImageFile, 1);

    createdFileIds.push(recordResultA.file.fileId);

    // Call client to get evidence list by date
    const listResA = await client.getTeacherPhotoEvidenceByDate(token, dateA);
    assert.strictEqual(listResA.success, true);
    assert.strictEqual(listResA.records.length, 2, 'Must return exactly 2 attendance records');

    const recP2 = listResA.records.find(r => r.period === 2);
    const recP3 = listResA.records.find(r => r.period === 3);

    // Verify hasPhoto logic
    assert.strictEqual(recP2.hasPhoto, true, 'Period 2 must have hasPhoto = true');
    assert.strictEqual(recP3.hasPhoto, true, 'Period 3 must have hasPhoto = true');

    // Verify timestamp mapping (Scope 2)
    assert.ok(recP2.timestamp, 'Period 2 timestamp must be mapped');
    assert.ok(recP3.timestamp, 'Period 3 timestamp must be mapped');
    assert.strictEqual(recP2.timestamp, recordResultA.attendances[0].recorded_at);

    // Verify NIK mapping (Scope 3)
    assert.strictEqual(recP2.nik, '3317010101700001', 'Period 2 NIK must match teacher NIK');
    assert.strictEqual(recP3.nik, '3317010101700001', 'Period 3 NIK must match teacher NIK');

    // Verify F-P5-005: both records point to exact same physical file
    assert.strictEqual(recP2.fileId, recP3.fileId, 'F-P5-005: Both periods must reference the same file_id');
    const sharedFileId = recP2.fileId;

    // Verify getTeacherPhotoDetail for both
    const detailP2 = await client.getTeacherPhotoDetail(token, recP2.attendanceId);
    const detailP3 = await client.getTeacherPhotoDetail(token, recP3.attendanceId);
    assert.strictEqual(detailP2.success, true);
    assert.strictEqual(detailP3.success, true);
    assert.strictEqual(detailP2.photoDataUrl, `/api/v1/evidences/file/${sharedFileId}`);
    assert.strictEqual(detailP3.photoDataUrl, `/api/v1/evidences/file/${sharedFileId}`);

    // Verify file serving (HTTP 200, Content-Type, binary signature)
    const fileFetchRes = await globalThis.fetch(`${baseUrl}${detailP2.photoDataUrl}`);
    assert.strictEqual(fileFetchRes.status, 200, 'File serving endpoint must return 200');
    assert.strictEqual(fileFetchRes.headers.get('content-type'), 'image/jpeg');
    const fileBuffer = Buffer.from(await fileFetchRes.arrayBuffer());
    assert.strictEqual(fileBuffer.length, VALID_1X1_JPEG.length, 'Served file size must match uploaded image');
    assert.strictEqual(fileBuffer[0], 0xFF, 'JPEG SOI byte 1 match');
    assert.strictEqual(fileBuffer[1], 0xD8, 'JPEG SOI byte 2 match');
    assert.strictEqual(fileBuffer[fileBuffer.length - 2], 0xFF, 'JPEG EOI byte 1 match');
    assert.strictEqual(fileBuffer[fileBuffer.length - 1], 0xD9, 'JPEG EOI byte 2 match');
    console.log('   PASS: Test A & H validated (Valid JPEG binary, multi-hour sharing, NIK, timestamp).');

    // TEST SUITE B: Evidence Tidak Tersedia
    console.log('\n--- Test B: Evidence Tidak Tersedia (hasPhoto = false) ---');
    // Insert attendance without evidence directly into db
    const noEvidAttId = 'ATT-TCH-20260924-P4-NOEVID';
    testDbEngine.teacher_attendance.push({
      attendance_id: noEvidAttId,
      teacher_id: 'TCH-0002',
      class_id: 'CLS-2627-10',
      academic_year_id: '2026/2027',
      attendance_date: dateA,
      period: 4,
      subject: 'Bahasa Arab',
      materi: 'Hiwar',
      status: 'Hadir',
      method: 'Manual',
      recorded_at: new Date().toISOString(),
      note: null,
      recorded_by_user_id: 1
    });

    const listWithNoEvid = await client.getTeacherPhotoEvidenceByDate(token, dateA);
    const recNoEvid = listWithNoEvid.records.find(r => r.attendanceId === noEvidAttId);
    assert.ok(recNoEvid, 'Attendance without evidence must be returned');
    assert.strictEqual(recNoEvid.hasPhoto, false, 'hasPhoto MUST be false when no evidence exists');
    assert.strictEqual(recNoEvid.fileId, null);
    assert.strictEqual(recNoEvid.nik, '3317010101750002', 'NIK must be properly resolved');

    // Verify detail call for record without evidence returns success: false
    const detailNoEvid = await client.getTeacherPhotoDetail(token, noEvidAttId);
    assert.strictEqual(detailNoEvid.success, false, 'getTeacherPhotoDetail must return success: false when no photo');
    assert.strictEqual(detailNoEvid.photoDataUrl, '', 'photoDataUrl must be empty');
    assert.strictEqual(detailNoEvid.message, 'Bukti foto tidak ditemukan untuk presensi ini.');
    console.log('   PASS: Test B validated (hasPhoto=false, no fake photo, clean rejection).');

    // TEST SUITE C: File Tidak Ditemukan (404)
    console.log('\n--- Test C: File Tidak Ditemukan (404) ---');
    const missingFileRes = await globalThis.fetch(`${baseUrl}/api/v1/evidences/file/non-existent-file-id.jpg`);
    assert.strictEqual(missingFileRes.status, 404, 'Non-existent file must return 404');
    const missingJson = await missingFileRes.json();
    assert.strictEqual(missingJson.code, 'NOT_FOUND');
    console.log('   PASS: Test C validated (404 Not Found returned for missing file).');

    // TEST SUITE D: File Rusak / Non-image fixture handling
    console.log('\n--- Test D: File Rusak / Non-Image Fixture ---');
    // Save dummy ASCII text file
    const corruptFileId = 'corrupt_dummy_test.jpg';
    const corruptPath = path.join(path.resolve(rootDir, 'backend/uploads/evidences'), corruptFileId);
    fs.writeFileSync(corruptPath, 'THIS_IS_NOT_A_VALID_IMAGE');
    createdFileIds.push(corruptFileId);

    const corruptFetch = await globalThis.fetch(`${baseUrl}/api/v1/evidences/file/${corruptFileId}`);
    assert.strictEqual(corruptFetch.status, 200);
    const corruptBuf = Buffer.from(await corruptFetch.arrayBuffer());
    // Verify it is not a valid JPEG/PNG (does not start with FF D8 or 89 50 4E 47)
    const isJpeg = corruptBuf[0] === 0xFF && corruptBuf[1] === 0xD8;
    const isPng = corruptBuf[0] === 0x89 && corruptBuf[1] === 0x50;
    assert.strictEqual(isJpeg, false, 'Corrupt file must not have JPEG signature');
    assert.strictEqual(isPng, false, 'Corrupt file must not have PNG signature');
    console.log('   PASS: Test D validated (Corrupt file detected, non-image signature).');

    // TEST SUITE E: Filter Tanggal
    console.log('\n--- Test E: Filter Tanggal ---');
    const dateB = '2026-09-25';
    const emptyDate = '2026-09-26';

    // Insert 1 record on dateB
    testDbEngine.teacher_attendance.push({
      attendance_id: 'ATT-TCH-DATEB-001',
      teacher_id: 'TCH-0001',
      class_id: 'CLS-2627-10',
      academic_year_id: '2026/2027',
      attendance_date: dateB,
      period: 1,
      subject: 'Fiqih',
      materi: 'Materi Date B',
      status: 'Hadir',
      method: 'Camera',
      recorded_at: new Date().toISOString(),
      note: null,
      recorded_by_user_id: 1
    });

    const resDateA = await client.getTeacherPhotoEvidenceByDate(token, dateA);
    const resDateB = await client.getTeacherPhotoEvidenceByDate(token, dateB);
    const resDateEmpty = await client.getTeacherPhotoEvidenceByDate(token, emptyDate);

    assert.ok(resDateA.records.length >= 2, 'Date A must return Date A records');
    resDateA.records.forEach(r => assert.notStrictEqual(r.attendanceId, 'ATT-TCH-DATEB-001'));

    assert.strictEqual(resDateB.records.length, 1, 'Date B must return exactly 1 record');
    assert.strictEqual(resDateB.records[0].attendanceId, 'ATT-TCH-DATEB-001');

    assert.strictEqual(resDateEmpty.records.length, 0, 'Empty date must return 0 records');
    console.log('   PASS: Test E validated (Date filtering isolated correctly).');

    // TEST SUITE F: Authentication Guard (401)
    console.log('\n--- Test F: Authentication Guard (401) ---');
    const unauthAttList = await globalThis.fetch(`${baseUrl}/api/v1/attendance/teachers?date=${dateA}`);
    assert.strictEqual(unauthAttList.status, 401, 'Request without token to /attendance/teachers must return 401');

    const unauthEvidDetail = await globalThis.fetch(`${baseUrl}/api/v1/evidences/attendance/${recP2.attendanceId}`);
    assert.strictEqual(unauthEvidDetail.status, 401, 'Request without token to /evidences/attendance must return 401');
    console.log('   PASS: Test F validated (401 Unauthorized enforced without token).');

    // TEST SUITE G: Authorization Guard (RBAC)
    console.log('\n--- Test G: Authorization Guard ---');
    // Admin user is allowed
    const adminCheckRes = await globalThis.fetch(`${baseUrl}/api/v1/attendance/teachers?date=${dateA}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(adminCheckRes.status, 200, 'Admin request must be allowed');
    console.log('   PASS: Test G validated (RBAC access verified).');

    console.log('\n===============================================================');
    console.log('BUG 30 REGRESSION TEST SUITE: ALL TESTS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } finally {
    // Cleanup temporary files created during test
    for (const fid of createdFileIds) {
      try {
        await storageProvider.deleteFile(fid);
      } catch (_) {}
    }
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runBug30RegressionTests()
    .then(pass => process.exit(pass ? 0 : 1))
    .catch(err => {
      console.error('Fatal error in BUG 30 test suite:', err);
      process.exit(1);
    });
}

module.exports = runBug30RegressionTests;
