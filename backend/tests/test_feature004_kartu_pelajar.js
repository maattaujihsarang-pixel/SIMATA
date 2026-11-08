const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');
const studentDocumentStorage = require('../src/storage/student-document-storage.provider');

// Minimal valid file buffers with authentic magic bytes
const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF');
const fakePdfBuffer = Buffer.from('<html><body>Fake PDF Script Content</body></html>');
const oversizedBuffer = Buffer.alloc(5.5 * 1024 * 1024, 0x41); // 5.5 MB

function makeMultipartRequest(server, { method, path: reqPath, token, filename, fileBuffer, fieldName = 'document' }) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const port = server.address().port;

    let preData = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    let postData = `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(preData, 'utf8'),
      fileBuffer,
      Buffer.from(postData, 'utf8')
    ]);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': bodyBuffer.length
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function makeJsonRequest(server, { method, path: reqPath, token, body = null }) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runFeature004Tests() {
  console.log('\n===============================================================');
  console.log('FEATURE 004: KARTU PELAJAR SISWA AUTOMATED TEST SUITE');
  console.log('===============================================================');

  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));

  const testResults = [];
  function assertTest(condition, name) {
    if (condition) {
      testResults.push({ name, status: 'PASS' });
      console.log(`   PASS: ${name}`);
    } else {
      testResults.push({ name, status: 'FAIL' });
      console.error(`   FAIL: ${name}`);
    }
  }

  try {
    // Authenticate Admin and Guru test accounts
    const adminSession = await authService.login({ username: 'Admin1', password: '12345' });
    const adminToken = adminSession.token;

    const guruSession = await authService.login({ username: 'Guru_001', password: 'Guru001' });
    const guruToken = guruSession.token;

    const targetStudentId = 'STD-K10001';

    console.log('\n--- Category A: Upload Validation Tests ---');

    // Test 1: Upload JPG (valid)
    let res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'kartu_siswa_10001.jpg',
      fileBuffer: validJpgBuffer
    });
    assertTest(res.status === 200 && res.body.status === 'success' && res.body.data.mime_type === 'image/jpeg', 'Test 1: Upload JPG with valid magic bytes returns 200');

    // Test 2: Upload JPEG (valid)
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'kartu_siswa_10001.jpeg',
      fileBuffer: validJpgBuffer
    });
    assertTest(res.status === 200 && res.body.status === 'success', 'Test 2: Upload JPEG returns 200');

    // Test 3: Upload PNG (valid)
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'kartu_siswa_10001.png',
      fileBuffer: validPngBuffer
    });
    assertTest(res.status === 200 && res.body.status === 'success' && res.body.data.mime_type === 'image/png', 'Test 3: Upload PNG with valid magic bytes returns 200');

    // Test 4: Upload PDF (valid)
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'kartu_pelajar_resmi.pdf',
      fileBuffer: validPdfBuffer
    });
    assertTest(res.status === 200 && res.body.status === 'success' && res.body.data.mime_type === 'application/pdf', 'Test 4: Upload PDF with valid %PDF magic bytes returns 200');

    // Test 5: Upload oversized file (> 5 MB)
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'huge_document.pdf',
      fileBuffer: oversizedBuffer
    });
    assertTest(res.status === 400 || res.status === 413, 'Test 5: Upload over 5 MB correctly rejected (HTTP 400/413)');

    // Test 6: Upload fake PDF (disguised HTML/script)
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'malicious.pdf',
      fileBuffer: fakePdfBuffer
    });
    assertTest(res.status === 400, 'Test 6: Disguised PDF with invalid magic bytes rejected (HTTP 400)');

    // Test 7: Upload without file
    res = await makeJsonRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      body: {}
    });
    assertTest(res.status === 400, 'Test 7: Upload without multipart file rejected with 400 Bad Request');

    console.log('\n--- Category B: Document Replacement & Integrity Tests ---');

    // Test 8: Get active document before replacement
    const preMeta = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar/meta`,
      token: adminToken
    });
    const oldFileName = preMeta.body.data.file_name;

    // Test 9: Replace with new valid PDF
    const newPdfBuffer = Buffer.from('%PDF-1.5\nNew Replacement Card Content\n%%EOF');
    res = await makeMultipartRequest(server, {
      method: 'PUT',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'kartu_pelajar_v2.pdf',
      fileBuffer: newPdfBuffer
    });
    assertTest(res.status === 200 && res.body.status === 'success', 'Test 9: Replace document via PUT/POST returns 200');

    // Test 10: Verify new document is active
    const postMeta = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar/meta`,
      token: adminToken
    });
    assertTest(postMeta.body.data.file_name === 'kartu_pelajar_v2.pdf', 'Test 10: New document filename is now active in metadata');

    // Test 11: Attempt invalid replace (corrupt) preserves old document
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'corrupt_doc.pdf',
      fileBuffer: fakePdfBuffer
    });
    assertTest(res.status === 400, 'Test 11: Invalid replace attempt rejected with 400');
    const checkMetaAfterFailedReplace = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar/meta`,
      token: adminToken
    });
    assertTest(checkMetaAfterFailedReplace.body.data.file_name === 'kartu_pelajar_v2.pdf', 'Test 11b: Old document preserved after failed replace attempt');

    console.log('\n--- Category C: Preview and Download Tests ---');

    // Test 12: Preview document (inline header)
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken
    });
    assertTest(res.status === 200 && res.headers['content-disposition'] && res.headers['content-disposition'].startsWith('inline'), 'Test 12: Preview request returns 200 with Content-Disposition: inline');
    assertTest(res.headers['content-type'] === 'application/pdf', 'Test 12b: Preview request returns accurate Content-Type');

    // Test 13: Download document (attachment header)
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar?download=1`,
      token: adminToken
    });
    assertTest(res.status === 200 && res.headers['content-disposition'] && res.headers['content-disposition'].startsWith('attachment'), 'Test 13: Download request returns 200 with Content-Disposition: attachment');
    assertTest(res.headers['content-disposition'].includes('Kartu_Pelajar_'), 'Test 13b: Attachment filename contains sanitized student identifier');

    console.log('\n--- Category D: Delete & Non-Existent Document Tests ---');

    // Test 14: Admin delete document
    res = await makeJsonRequest(server, {
      method: 'DELETE',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken
    });
    assertTest(res.status === 200 && res.body.status === 'success', 'Test 14: Admin delete document returns 200');

    // Test 15: Check metadata after deletion
    const metaAfterDel = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar/meta`,
      token: adminToken
    });
    assertTest(metaAfterDel.status === 200 && metaAfterDel.body.data.available === false, 'Test 15: Metadata reflects available=false after deletion');

    // Test 16: Fetch file after deletion returns 404
    const getAfterDel = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken
    });
    assertTest(getAfterDel.status === 404, 'Test 16: Fetching deleted document returns 404 Not Found');

    // Test 17: Deletion does not delete student record
    const studentCheck = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}`,
      token: adminToken
    });
    assertTest(studentCheck.status === 200 && studentCheck.body.data.student_id === targetStudentId, 'Test 17: Student record is preserved after document deletion');

    // Test 18: Upload again after deletion succeeds
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken,
      filename: 'kartu_pelajar_baru.png',
      fileBuffer: validPngBuffer
    });
    assertTest(res.status === 200 && res.body.status === 'success', 'Test 18: Uploading new document after deletion succeeds');

    console.log('\n--- Category E: Security & RBAC Guard Tests ---');

    // Test 19: Guru can view metadata
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar/meta`,
      token: guruToken
    });
    assertTest(res.status === 200 && res.body.data.available === true, 'Test 19: Guru can read document metadata');

    // Test 20: Guru can preview document
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: guruToken
    });
    assertTest(res.status === 200, 'Test 20: Guru can preview document');

    // Test 21: Guru can download document
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar?download=1`,
      token: guruToken
    });
    assertTest(res.status === 200, 'Test 21: Guru can download document');

    // Test 22: Guru upload attempt rejected with 403 Forbidden
    res = await makeMultipartRequest(server, {
      method: 'POST',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: guruToken,
      filename: 'guru_upload.pdf',
      fileBuffer: validPdfBuffer
    });
    assertTest(res.status === 403, 'Test 22: Guru upload attempt rejected with 403 Forbidden');

    // Test 23: Guru delete attempt rejected with 403 Forbidden
    res = await makeJsonRequest(server, {
      method: 'DELETE',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: guruToken
    });
    assertTest(res.status === 403, 'Test 23: Guru delete attempt rejected with 403 Forbidden');

    // Test 24: Unauthenticated request rejected with 401 Unauthorized
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: null
    });
    assertTest(res.status === 401, 'Test 24: Unauthenticated request rejected with 401 Unauthorized');

    // Test 25: Non-existent student ID returns 404
    res = await makeJsonRequest(server, {
      method: 'GET',
      path: `/api/v1/students/NON_EXISTENT_STUDENT/documents/kartu-pelajar/meta`,
      token: adminToken
    });
    assertTest(res.status === 404, 'Test 25: Non-existent student ID returns 404 Not Found');

    // Final Test Cleanup: Delete document uploaded in Test 18 to prevent storage leakage
    await makeJsonRequest(server, {
      method: 'DELETE',
      path: `/api/v1/students/${targetStudentId}/documents/kartu-pelajar`,
      token: adminToken
    });

    console.log('\n===============================================================');
    const totalPassed = testResults.filter(t => t.status === 'PASS').length;
    const totalFailed = testResults.filter(t => t.status === 'FAIL').length;
    console.log(`FEATURE 004 TEST RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED (TOTAL ${testResults.length})`);
    console.log('===============================================================');

    server.close();
    return totalFailed === 0;
  } catch (err) {
    console.error('Fatal error in Feature 004 test suite:', err);
    server.close();
    return false;
  }
}

if (require.main === module) {
  runFeature004Tests()
    .then(pass => process.exit(pass ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = runFeature004Tests;
