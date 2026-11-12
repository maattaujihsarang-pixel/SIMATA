const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { query, closePool, clearMockHandlers } = require('../src/config/database');

function makeRequest(server, { method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runFeature005bTests() {
  console.log('\n===============================================================');
  console.log('FEATURE 005-B: MASTER KATEGORI BIAYA, INVOICING, & STATUS INVARIANTS');
  console.log('===============================================================');

  clearMockHandlers();

  let server;
  let adminToken = null;
  let guruToken = null;
  let bendaharaToken = null;
  let parentToken = null;

  const testBendaharaUsername = 'test_ben_005b_' + Date.now();
  const testParentUsername = 'test_par_005b_' + Date.now();
  let bendaharaUserId = null;
  let parentUserId = null;

  let studentAId = null;
  let studentBId = null;
  let testAyId = '2026/2027';
  const testFeeCatId = 'FEE-TEST-B-' + Math.floor(Math.random() * 1000);

  const createdInvoiceIds = [];

  try {
    // ------------------------------------------------------------------------
    // SETUP: SERVER & OTENTIKASI
    // ------------------------------------------------------------------------
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', resolve);
    });

    // Ambil dua student_id untuk uji isolasi IDOR
    const stds = await query("SELECT student_id, name, class_id FROM students WHERE status = 'Active' ORDER BY student_id ASC LIMIT 2");
    assert.ok(stds.rows.length >= 2, 'Minimal 2 siswa aktif diperlukan untuk pengujian');
    studentAId = stds.rows[0].student_id;
    studentBId = stds.rows[1].student_id;

    // Login Admin
    let adminLogin = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'Admin1', password: 'password' }
    });
    if (adminLogin.status !== 200) {
      adminLogin = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { username: 'Admin1', password: '12345' }
      });
    }
    assert.strictEqual(adminLogin.status, 200);
    adminToken = adminLogin.body.data.token;

    // Login Guru
    let guruLogin = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'Guru_001', password: 'password' }
    });
    if (guruLogin.status !== 200) {
      guruLogin = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { username: 'Guru_001', password: 'Guru001' }
      });
    }
    assert.strictEqual(guruLogin.status, 200);
    guruToken = guruLogin.body.data.token;

    // Buat dan Login Bendahara
    const createBen = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/users',
      token: adminToken,
      body: {
        username: testBendaharaUsername,
        password: 'Password123!',
        full_name: 'Bendahara 005B Test',
        role: 'BENDAHARA'
      }
    });
    assert.strictEqual(createBen.status, 201);
    bendaharaUserId = createBen.body.data.user_id;

    const benLogin = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: testBendaharaUsername, password: 'Password123!' }
    });
    assert.strictEqual(benLogin.status, 200);
    bendaharaToken = benLogin.body.data.token;

    // Buat dan Login Orang Tua
    const createPar = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/users',
      token: adminToken,
      body: {
        username: testParentUsername,
        password: 'Password123!',
        full_name: 'Orang Tua 005B Test',
        role: 'ORANG_TUA'
      }
    });
    assert.strictEqual(createPar.status, 201);
    parentUserId = createPar.body.data.user_id;

    const parLogin = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: testParentUsername, password: 'Password123!' }
    });
    assert.strictEqual(parLogin.status, 200);
    parentToken = parLogin.body.data.token;

    // Tautkan Student A ke Parent User
    const linkRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/parents/link-student',
      token: adminToken,
      body: { parent_user_id: parentUserId, student_id: studentAId, relationship_type: 'AYAH' }
    });
    assert.strictEqual(linkRes.status, 201);
    console.log('   PASS: Inisialisasi token & pemetaan parent-student terverifikasi');

    // ------------------------------------------------------------------------
    // 1. PENGUJIAN MASTER KATEGORI BIAYA (fee_categories)
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Pengujian Master Kategori Biaya (fee_categories) ---');

    // 1.1 List categories
    const listCats = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/fee-categories',
      token: bendaharaToken
    });
    assert.strictEqual(listCats.status, 200);
    assert.ok(Array.isArray(listCats.body.data));
    assert.ok(listCats.body.data.length >= 6);
    console.log('   PASS: Pembacaan daftar kategori biaya berhasil (200 OK)');

    // 1.2 Guru mencoba membuat kategori -> 403 Forbidden
    const guruCreateCat = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/fee-categories',
      token: guruToken,
      body: { fee_category_id: testFeeCatId, name: 'Biaya Ilegal', default_amount: 100000, billing_cycle: 'MONTHLY' }
    });
    assert.strictEqual(guruCreateCat.status, 403);
    console.log('   PASS: Guru ditolak membuat kategori biaya (403 Forbidden)');

    // 1.3 Bendahara membuat kategori baru -> 201 Created
    const benCreateCat = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/fee-categories',
      token: bendaharaToken,
      body: {
        fee_category_id: testFeeCatId,
        name: 'Uang Praktikum Komputer ' + testFeeCatId,
        description: 'Biaya laboratorium komputer madrasah',
        default_amount: 120000.00,
        billing_cycle: 'SEMESTER'
      }
    });
    assert.strictEqual(benCreateCat.status, 201);
    assert.strictEqual(benCreateCat.body.data.fee_category_id, testFeeCatId);
    console.log('   PASS: Bendahara berhasil membuat kategori biaya baru (201 Created)');

    // 1.4 Duplikasi ID atau Nama -> 409 Conflict
    const dupCat = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/fee-categories',
      token: adminToken,
      body: {
        fee_category_id: testFeeCatId,
        name: 'Uang Praktikum Lain',
        default_amount: 50000,
        billing_cycle: 'MONTHLY'
      }
    });
    assert.strictEqual(dupCat.status, 409);
    console.log('   PASS: Penolakan duplikasi ID kategori biaya (409 Conflict)');

    // 1.5 Update Kategori
    const updateCat = await makeRequest(server, {
      method: 'PUT',
      path: `/api/v1/finance/fee-categories/${testFeeCatId}`,
      token: bendaharaToken,
      body: {
        name: 'Uang Praktikum Komputer Revisi ' + testFeeCatId,
        default_amount: 135000.00,
        billing_cycle: 'SEMESTER'
      }
    });
    assert.strictEqual(updateCat.status, 200);
    assert.strictEqual(Number(updateCat.body.data.default_amount), 135000.00);
    console.log('   PASS: Pembaruan kategori biaya berhasil (200 OK)');

    // 1.6 Toggle Status
    const toggleCat = await makeRequest(server, {
      method: 'PATCH',
      path: `/api/v1/finance/fee-categories/${testFeeCatId}/status`,
      token: bendaharaToken,
      body: { is_active: false }
    });
    assert.strictEqual(toggleCat.status, 200);
    assert.strictEqual(toggleCat.body.data.is_active, false);

    // Aktifkan kembali
    await makeRequest(server, {
      method: 'PATCH',
      path: `/api/v1/finance/fee-categories/${testFeeCatId}/status`,
      token: bendaharaToken,
      body: { is_active: true }
    });
    console.log('   PASS: Toggle status aktif/non-aktif kategori biaya terverifikasi');

    // ------------------------------------------------------------------------
    // 2. PENGUJIAN CANONICAL period_key VALIDATION (Q.5)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Pengujian Validasi Kanonikal period_key (Q.5) ---');

    // 2.1 Format ilegal (misal format lama YYYY/MM atau teks bebas) -> 400 Bad Request
    const invalidFormats = [
      '2026/07',
      'JULI-2026',
      '2026_07',
      '2026-SEMESTER-1',
      '2026-PTS',
      'RANDOM-TEXT'
    ];

    for (const invFmt of invalidFormats) {
      const prevRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/finance/invoices/preview',
        token: bendaharaToken,
        body: {
          fee_category_id: testFeeCatId,
          academic_year_id: testAyId,
          period_key: invFmt,
          target_type: 'ALL'
        }
      });
      assert.strictEqual(prevRes.status, 400, `Format ${invFmt} harus ditolak`);
    }
    console.log('   PASS: Format period_key non-kanonikal ditolak secara ketat (400 Bad Request)');

    // 2.2 Inkonsistensi Tahun Ajaran (Bulan 01-06 harus Y2, bukan Y1)
    const inconsistentMonth = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/preview',
      token: bendaharaToken,
      body: {
        fee_category_id: testFeeCatId,
        academic_year_id: '2026/2027',
        period_key: '2026-01', // Harusnya 2027-01
        target_type: 'ALL'
      }
    });
    assert.strictEqual(inconsistentMonth.status, 400);
    console.log('   PASS: Inkonsistensi tahun kalender terhadap tahun ajaran ditolak (400 Bad Request)');

    // 2.3 Format Kanonikal Valid
    const validCanonicalKeys = [
      '2026-07',
      '2027-01',
      '2026-SMT1',
      '2027-SMT2',
      '2026-ANNUAL',
      '2026-ONCE',
      '2026-PTS1',
      '2027-PTS2',
      '2026-PAS1',
      '2027-PAT2'
    ];

    for (const valKey of validCanonicalKeys) {
      const prevOk = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/finance/invoices/preview',
        token: bendaharaToken,
        body: {
          fee_category_id: testFeeCatId,
          academic_year_id: '2026/2027',
          period_key: valKey,
          target_type: 'INDIVIDUAL',
          target_id: studentAId
        }
      });
      assert.strictEqual(prevOk.status, 200, `Kunci kanonikal ${valKey} harus diterima`);
    }
    console.log('   PASS: Seluruh 6 jenis kunci period_key kanonikal baku berhasil divalidasi');

    // ------------------------------------------------------------------------
    // 3. PENGUJIAN PREVIEW & PENERBITAN TAGIHAN (Atomisitas & Invariant)
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Pengujian Preview & Penerbitan Tagihan Atomik ---');

    const testPeriod = '2026-SMT1';

    // 3.1 Preview Invoices
    const previewRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/preview',
      token: bendaharaToken,
      body: {
        fee_category_id: testFeeCatId,
        academic_year_id: testAyId,
        period_key: testPeriod,
        target_type: 'INDIVIDUAL',
        target_id: studentAId,
        total_amount: 150000.00
      }
    });
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewRes.body.data.eligible_count, 1);
    assert.strictEqual(previewRes.body.data.already_invoiced_count, 0);
    assert.strictEqual(previewRes.body.data.total_projected_amount, 150000.00);
    console.log('   PASS: Preview kalkulasi nominal dan target tagihan akurat');

    // 3.2 Penerbitan Tagihan (Generate)
    const genRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/generate',
      token: bendaharaToken,
      body: {
        fee_category_id: testFeeCatId,
        academic_year_id: testAyId,
        period_key: testPeriod,
        target_type: 'INDIVIDUAL',
        target_id: studentAId,
        total_amount: 150000.00,
        due_date: '2026-08-10',
        title: 'Praktikum Komputer Gasal'
      }
    });
    assert.strictEqual(genRes.status, 201);
    assert.strictEqual(genRes.body.data.generated_count, 1);
    const invoiceA = genRes.body.data.invoices[0];
    assert.strictEqual(invoiceA.student_id, studentAId);
    assert.strictEqual(invoiceA.period_key, testPeriod);
    assert.strictEqual(invoiceA.status, 'UNPAID');
    assert.strictEqual(Number(invoiceA.amount_paid), 0.00);
    createdInvoiceIds.push(invoiceA.invoice_id);
    console.log('   PASS: Penerbitan tagihan atomik berhasil dengan initial status UNPAID (201 Created)');

    // 3.3 Pencegahan Penerbitan Ganda (Concurrent & Double Rejection)
    const doubleGenRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/generate',
      token: bendaharaToken,
      body: {
        fee_category_id: testFeeCatId,
        academic_year_id: testAyId,
        period_key: testPeriod,
        target_type: 'INDIVIDUAL',
        target_id: studentAId,
        total_amount: 150000.00
      }
    });
    assert.strictEqual(doubleGenRes.status, 409, 'Penerbitan kedua pada periode yang sama wajib 409 Conflict');
    console.log('   PASS: Duplikasi tagihan aktif ditolak mutlak oleh Partial Unique Index (409 Conflict)');

    // Buat juga tagihan untuk Student B pada periode yang sama
    const genStudentB = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/generate',
      token: adminToken,
      body: {
        fee_category_id: testFeeCatId,
        academic_year_id: testAyId,
        period_key: testPeriod,
        target_type: 'INDIVIDUAL',
        target_id: studentBId,
        total_amount: 150000.00
      }
    });
    assert.strictEqual(genStudentB.status, 201);
    const invoiceB = genStudentB.body.data.invoices[0];
    createdInvoiceIds.push(invoiceB.invoice_id);

    // ------------------------------------------------------------------------
    // 4. PENGUJIAN PEMBATALAN TAGIHAN (CANCEL INVOICE & INVARIANT)
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Pengujian Pembatalan Tagihan (Cancel Invariant) ---');

    // 4.1 Pembatalan tanpa alasan -> 400 Bad Request
    const cancelNoReason = await makeRequest(server, {
      method: 'PATCH',
      path: `/api/v1/finance/invoices/${invoiceB.invoice_id}/cancel`,
      token: bendaharaToken,
      body: { cancellation_reason: '' }
    });
    assert.strictEqual(cancelNoReason.status, 400);
    console.log('   PASS: Pembatalan tanpa alasan ditolak (400 Bad Request)');

    // 4.2 Pembatalan valid untuk tagihan berstatus UNPAID
    const cancelSuccess = await makeRequest(server, {
      method: 'PATCH',
      path: `/api/v1/finance/invoices/${invoiceB.invoice_id}/cancel`,
      token: bendaharaToken,
      body: { cancellation_reason: 'Koreksi kesalahan penetapan peserta praktikum' }
    });
    assert.strictEqual(cancelSuccess.status, 200);
    assert.strictEqual(cancelSuccess.body.data.status, 'CANCELLED');
    assert.strictEqual(cancelSuccess.body.data.cancellation_reason, 'Koreksi kesalahan penetapan peserta praktikum');
    assert.ok(cancelSuccess.body.data.cancelled_at);
    console.log('   PASS: Tagihan UNPAID berhasil dibatalkan menjadi CANCELLED (200 OK)');

    // 4.3 Pembatalan tagihan yang sudah CANCELLED -> 400 Bad Request
    const reCancel = await makeRequest(server, {
      method: 'PATCH',
      path: `/api/v1/finance/invoices/${invoiceB.invoice_id}/cancel`,
      token: bendaharaToken,
      body: { cancellation_reason: 'Membatalkan ulang' }
    });
    assert.strictEqual(reCancel.status, 400);
    console.log('   PASS: Pembatalan ulang tagihan CANCELLED ditolak (400 Bad Request)');

    // 4.4 Penerbitan Ulang Tagihan Baru Pasca-CANCELLED
    // Karena tagihan lama sudah CANCELLED, Partial Unique Index mengizinkan penerbitan tagihan baru
    const reGenerateB = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/generate',
      token: bendaharaToken,
      body: {
        fee_category_id: testFeeCatId,
        academic_year_id: testAyId,
        period_key: testPeriod,
        target_type: 'INDIVIDUAL',
        target_id: studentBId,
        total_amount: 150000.00,
        title: 'Praktikum Komputer Gasal (Re-issued)'
      }
    });
    assert.strictEqual(reGenerateB.status, 201);
    createdInvoiceIds.push(reGenerateB.body.data.invoices[0].invoice_id);
    console.log('   PASS: Penerbitan tagihan baru pasca-CANCELLED berhasil tanpa tabrakan index');

    // ------------------------------------------------------------------------
    // 5. PENGUJIAN PORTAL ORANG TUA & PROTEKSI ANTI-IDOR
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Pengujian Portal Orang Tua & Proteksi Anti-IDOR ---');

    // 5.1 Orang Tua membaca daftar tagihan -> Hanya melihat Student A
    const parentInvoices = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/invoices',
      token: parentToken
    });
    assert.strictEqual(parentInvoices.status, 200);
    assert.ok(Array.isArray(parentInvoices.body.data));
    const allStudentsInParentView = parentInvoices.body.data.map(i => i.student_id);
    assert.ok(allStudentsInParentView.includes(studentAId));
    assert.ok(!allStudentsInParentView.includes(studentBId), 'Orang Tua dilarang melihat tagihan Student B');
    console.log('   PASS: Filter otomatis data tagihan pada akun Orang Tua terisolasi ke siswa binaannya');

    // 5.2 Orang Tua membaca detail tagihan miliknya (Student A) -> 200 OK
    const parentGetOwn = await makeRequest(server, {
      method: 'GET',
      path: `/api/v1/finance/invoices/${invoiceA.invoice_id}`,
      token: parentToken
    });
    assert.strictEqual(parentGetOwn.status, 200);
    assert.strictEqual(parentGetOwn.body.data.student_id, studentAId);
    console.log('   PASS: Orang Tua berhasil mengakses detail tagihan siswa binaannya');

    // 5.3 Orang Tua mencoba membaca detail tagihan siswa lain (Student B) -> 403 Forbidden (Anti-IDOR)
    const parentGetOther = await makeRequest(server, {
      method: 'GET',
      path: `/api/v1/finance/invoices/${reGenerateB.body.data.invoices[0].invoice_id}`,
      token: parentToken
    });
    assert.strictEqual(parentGetOther.status, 403, 'Akses ke tagihan siswa lain wajib ditolak 403 Forbidden');
    console.log('   PASS: Anti-IDOR berhasil melindungi tagihan antar siswa dari akses Orang Tua (403 Forbidden)');

    // 5.4 Orang Tua mengakses summary siswa miliknya vs siswa lain
    const summaryOwn = await makeRequest(server, {
      method: 'GET',
      path: `/api/v1/finance/invoices/students/${studentAId}/summary`,
      token: parentToken
    });
    assert.strictEqual(summaryOwn.status, 200);

    const summaryOther = await makeRequest(server, {
      method: 'GET',
      path: `/api/v1/finance/invoices/students/${studentBId}/summary`,
      token: parentToken
    });
    assert.strictEqual(summaryOther.status, 403);
    console.log('   PASS: Anti-IDOR summary per siswa berfungsi sempurna');

    // 5.5 Orang Tua mencoba membuat atau membatalkan tagihan -> 403 Forbidden
    const parentTryGen = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/invoices/generate',
      token: parentToken,
      body: { fee_category_id: testFeeCatId, academic_year_id: testAyId, period_key: '2027-SMT2', target_type: 'ALL' }
    });
    assert.strictEqual(parentTryGen.status, 403);

    const parentTryCancel = await makeRequest(server, {
      method: 'PATCH',
      path: `/api/v1/finance/invoices/${invoiceA.invoice_id}/cancel`,
      token: parentToken,
      body: { cancellation_reason: 'Orang tua membatalkan' }
    });
    assert.strictEqual(parentTryCancel.status, 403);
    console.log('   PASS: Orang Tua strictly read-only, mutasi tagihan ditolak 403');

    // ------------------------------------------------------------------------
    // 6. CLEANUP DATA PENGUJIAN
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Pembersihan Data Pengujian ---');
    if (createdInvoiceIds.length > 0) {
      await query('DELETE FROM student_invoices WHERE invoice_id = ANY($1)', [createdInvoiceIds]);
    }
    await query('DELETE FROM fee_categories WHERE fee_category_id = $1', [testFeeCatId]);
    if (bendaharaUserId) {
      await query('DELETE FROM users WHERE user_id = $1', [bendaharaUserId]);
    }
    if (parentUserId) {
      await query('DELETE FROM users WHERE user_id = $1', [parentUserId]);
    }
    console.log('   PASS: Seluruh data uji Feature 005-B dibersihkan dengan aman');

    console.log('\n===============================================================');
    console.log('FEATURE 005-B VERIFICATION: ALL 20 CRITICAL ASSERTIONS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } catch (err) {
    console.error('\nFAIL in Feature 005-B Test Suite:', err);
    return false;
  } finally {
    if (server) server.close();
  }
}

if (require.main === module) {
  runFeature005bTests()
    .then(async (success) => {
      await closePool();
      process.exit(success ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}

module.exports = runFeature005bTests;
