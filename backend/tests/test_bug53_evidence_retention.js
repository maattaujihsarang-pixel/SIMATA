const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const storageProvider = require('../src/config/storage');
const evidenceRetentionService = require('../src/services/evidence-retention.service');

async function requestJson(baseUrl, method, path, { token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function runBug53EvidenceRetentionTests() {
  console.log('\n===============================================================');
  console.log('BUG 53: EVIDENCE PHOTO RETENTION & STORAGE CLEANUP TEST SUITE');
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
    // 1. Login Admin and Guru
    const adminLogin = await requestJson(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'Admin1', password: '12345' }
    });
    assert.strictEqual(adminLogin.status, 200);
    const adminToken = adminLogin.json.data.token;

    const guruLogin = await requestJson(baseUrl, 'POST', '/api/v1/auth/login', {
      body: { username: 'Guru_001', password: 'Guru001' }
    });
    assert.strictEqual(guruLogin.status, 200);
    const guruToken = guruLogin.json.data.token;

    // 2. RBAC: Guru must be denied Admin storage endpoints
    console.log('1. Testing RBAC enforcement on evidence storage endpoints...');
    const guruOverview = await requestJson(baseUrl, 'GET', '/api/v1/evidences/storage/overview', { token: guruToken });
    assert.strictEqual(guruOverview.status, 403, 'Guru must be forbidden from viewing storage retention settings');

    // 3. Seed old (45 days ago) + shared multi-hour + recent (2 days ago) evidences
    console.log('2. Seeding old, recent, and shared evidence photos...');
    const oldFile = await storageProvider.saveFile({
      buffer: Buffer.from('old-evidence-photo-payload-bytes'),
      originalName: 'old.jpg',
      mimeType: 'image/jpeg'
    });
    createdFileIds.push(oldFile.fileId);

    const recentFile = await storageProvider.saveFile({
      buffer: Buffer.from('recent-evidence-photo-payload-bytes'),
      originalName: 'recent.jpg',
      mimeType: 'image/jpeg'
    });
    createdFileIds.push(recentFile.fileId);

    const oldIso = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const recentIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    testDbEngine.teacher_attendance.push(
      {
        attendance_id: 'TA-OLD-1',
        teacher_id: 'TCH-0001',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: '2026-09-30',
        period: 1,
        subject: 'Fiqih',
        materi: 'Bab 1',
        status: 'Hadir',
        method: 'Camera',
        recorded_at: oldIso,
        note: null,
        recorded_by_user_id: 1,
        evidence_purged_at: null
      },
      {
        attendance_id: 'TA-RECENT-1',
        teacher_id: 'TCH-0001',
        class_id: 'CLS-2627-10',
        academic_year_id: '2026/2027',
        attendance_date: '2026-11-13',
        period: 2,
        subject: 'Fiqih',
        materi: 'Bab 2',
        status: 'Hadir',
        method: 'Camera',
        recorded_at: recentIso,
        note: null,
        recorded_by_user_id: 1,
        evidence_purged_at: null
      }
    );

    // Insert 2 evidences pointing to oldFile (multi-hour session) and 1 to recentFile
    testDbEngine.attendance_evidences.push(
      {
        evidence_id: 'EVID-OLD-1',
        session_id: 'SESS-OLD',
        operator_user_id: 1,
        captured_at: oldIso,
        file_id: oldFile.fileId,
        file_url: oldFile.fileUrl,
        attendance_id: 'TA-OLD-1',
        storage_provider: 'LOCAL',
        mime_type: 'image/jpeg'
      },
      {
        evidence_id: 'EVID-OLD-2',
        session_id: 'SESS-OLD',
        operator_user_id: 1,
        captured_at: oldIso,
        file_id: oldFile.fileId,
        file_url: oldFile.fileUrl,
        attendance_id: null,
        storage_provider: 'LOCAL',
        mime_type: 'image/jpeg'
      },
      {
        evidence_id: 'EVID-RECENT-1',
        session_id: 'SESS-REC',
        operator_user_id: 1,
        captured_at: recentIso,
        file_id: recentFile.fileId,
        file_url: recentFile.fileUrl,
        attendance_id: 'TA-RECENT-1',
        storage_provider: 'LOCAL',
        mime_type: 'image/jpeg'
      }
    );

    // 4. Storage Overview & Retention Update
    console.log('3. Testing storage overview and retention policy update...');
    const overviewRes = await requestJson(baseUrl, 'GET', '/api/v1/evidences/storage/overview', { token: adminToken });
    assert.strictEqual(overviewRes.status, 200);
    assert.strictEqual(overviewRes.json.data.retention.retentionDays, 30);
    assert.strictEqual(overviewRes.json.data.database.totalRecords, 3);
    assert.strictEqual(overviewRes.json.data.database.distinctFiles, 2);

    const updateRes = await requestJson(baseUrl, 'PUT', '/api/v1/evidences/storage/retention', {
      token: adminToken,
      body: { retention_days: 90 }
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.json.data.retention.retentionDays, 90);

    // 5. Cleanup Preview > 30 days should target ONLY oldFile & its 2 records, NOT recentFile
    console.log('4. Testing cleanup preview accuracy...');
    const previewRes = await requestJson(baseUrl, 'POST', '/api/v1/evidences/storage/cleanup/preview', {
      token: adminToken,
      body: { mode: 'older_than_days', older_than_days: 30 }
    });
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewRes.json.data.recordCount, 2);
    assert.strictEqual(previewRes.json.data.fileCount, 1);
    assert.ok(previewRes.json.data.totalBytes > 0);
    assert.ok(await storageProvider.getFilePath(oldFile.fileId), 'Preview must NOT delete physical file');

    // 6. Execute Cleanup > 30 days
    console.log('5. Executing cleanup > 30 days and checking DB & disk safety...');
    const cleanupRes = await requestJson(baseUrl, 'POST', '/api/v1/evidences/storage/cleanup', {
      token: adminToken,
      body: { mode: 'older_than_days', older_than_days: 30 }
    });
    assert.strictEqual(cleanupRes.status, 200);
    assert.strictEqual(cleanupRes.json.data.deletedRecords, 2);
    assert.strictEqual(cleanupRes.json.data.deletedFiles, 1);
    assert.strictEqual(await storageProvider.getFilePath(oldFile.fileId), null, 'Expired file must be removed from disk');
    assert.ok(await storageProvider.getFilePath(recentFile.fileId), 'Recent file must remain on disk');

    // Attendance history must still exist and be stamped evidence_purged_at
    const oldAtt = testDbEngine.teacher_attendance.find(t => t.attendance_id === 'TA-OLD-1');
    const recAtt = testDbEngine.teacher_attendance.find(t => t.attendance_id === 'TA-RECENT-1');
    assert.ok(oldAtt, 'Teacher attendance record must remain intact after photo cleanup');
    assert.ok(oldAtt.evidence_purged_at, 'Purged attendance must be marked with evidence_purged_at');
    assert.strictEqual(recAtt.evidence_purged_at, null, 'Recent attendance must remain unpurged');

    // 7. Scheduled cleanup runner check (with cooldown respected)
    console.log('6. Testing scheduled cleanup cooldown behavior...');
    const schedRes = await evidenceRetentionService.runScheduledCleanupIfDue();
    assert.strictEqual(schedRes.skipped, true);
    assert.strictEqual(schedRes.reason, 'COOLDOWN_ACTIVE');

    console.log('PASS: All BUG 53 Evidence Retention & Storage Cleanup tests passed!');
    return true;
  } finally {
    // Cleanup leftover physical test files
    for (const fid of createdFileIds) {
      await storageProvider.deleteFile(fid).catch(() => {});
    }
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runBug53EvidenceRetentionTests()
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runBug53EvidenceRetentionTests;
