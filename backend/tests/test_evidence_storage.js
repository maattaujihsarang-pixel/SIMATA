const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storageProvider = require('../src/config/storage');
const reconcileEvidenceStorage = require('../scripts/reconcile_evidence_storage');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

async function runEvidenceStorageTests() {
  console.log('\n--- Running Evidence Storage & Pruning Tests ---');
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  // Clean uploads/evidences of leftover test files to ensure deterministic test isolation
  const uploadDir = path.resolve(__dirname, '../uploads/evidences');
  if (fs.existsSync(uploadDir)) {
    const files = fs.readdirSync(uploadDir);
    for (const f of files) {
      if (f !== '42e49c28-cfb0-4cd2-beec-cc4f8f4abc7d.jpg' && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'))) {
        try { fs.unlinkSync(path.join(uploadDir, f)); } catch (_) {}
      }
    }
  }

  // 1. File size limit rejection (> 5MB)
  console.log('1. Testing file size limit (> 5MB)...');
  const oversizedBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
  let oversizedRejected = false;
  try {
    await storageProvider.saveFile({ buffer: oversizedBuffer, originalName: 'large.jpg', mimeType: 'image/jpeg' });
  } catch (err) {
    oversizedRejected = true;
    assert.strictEqual(err.statusCode, 400);
    assert.ok(err.message.includes('5 MB'));
  }
  assert.ok(oversizedRejected, 'Oversized file must be rejected');
  console.log('   PASS: Files over 5MB correctly rejected.');

  // 2. Unsupported MIME type rejection
  console.log('2. Testing invalid MIME type rejection...');
  let mimeRejected = false;
  try {
    await storageProvider.saveFile({ buffer: Buffer.from('abc'), originalName: 'doc.txt', mimeType: 'text/plain' });
  } catch (err) {
    mimeRejected = true;
    assert.strictEqual(err.statusCode, 400);
  }
  assert.ok(mimeRejected, 'Invalid MIME must be rejected');
  console.log('   PASS: Invalid MIME type correctly rejected.');

  // 3. Storage Reconciliation Pruner
  console.log('3. Testing orphan file pruning via reconcile_evidence_storage.js...');
  const validFile = await storageProvider.saveFile({
    buffer: Buffer.from('valid-image-content'),
    originalName: 'valid.jpg',
    mimeType: 'image/jpeg'
  });

  // Record validFile in mock DB evidences
  testDbEngine.attendance_evidences.push({
    evidence_id: 'EVID-TEST-001',
    file_id: validFile.fileId,
    file_url: validFile.fileUrl
  });

  // Create an orphan file on disk (simulate a file whose DB commit crashed)
  const orphanFile = await storageProvider.saveFile({
    buffer: Buffer.from('orphan-image-content'),
    originalName: 'orphan.jpg',
    mimeType: 'image/jpeg'
  });

  // Manually backdate orphan file mtime to 2 hours ago (> 60 mins grace period)
  const orphanPath = await storageProvider.getFilePath(orphanFile.fileId);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(orphanPath, twoHoursAgo, twoHoursAgo);

  // Run pruner
  const pruneReport = await reconcileEvidenceStorage(false);
  assert.strictEqual(pruneReport.orphans_detected, 1, 'Should detect exactly 1 orphan file');
  assert.strictEqual(pruneReport.pruned, 1, 'Should prune 1 orphan file');
  assert.ok(!fs.existsSync(orphanPath), 'Orphan file must be deleted from disk');

  // Verify valid file still exists on disk
  const validPath = await storageProvider.getFilePath(validFile.fileId);
  assert.ok(fs.existsSync(validPath), 'Valid referenced file must be preserved');

  // Cleanup
  await storageProvider.deleteFile(validFile.fileId);

  console.log('Evidence Storage & Pruning Tests: ALL PASS');
  return true;
}

if (require.main === module) {
  runEvidenceStorageTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runEvidenceStorageTests;

