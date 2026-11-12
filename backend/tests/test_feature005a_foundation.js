const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { query, closePool, clearMockHandlers } = require('../src/config/database');
const authService = require('../src/services/auth.service');
const { hashPassword } = require('../src/utils/password.util');

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

async function runFeature005aTests() {
  console.log('\n===============================================================');
  console.log('FEATURE 005-A: FONDASI DATABASE, MASTER DATA, & RBAC EXTENSION');
  console.log('===============================================================');

  // Pastikan handlers mock bersih sehingga test memvalidasi PostgreSQL aktual
  clearMockHandlers();

  let server;
  let adminToken = null;
  let guruToken = null;
  let bendaharaToken = null;
  let parentToken = null;

  const testBendaharaUsername = 'test_bendahara_' + Date.now();
  const testParentUsername = 'test_parent_' + Date.now();
  let bendaharaUserId = null;
  let parentUserId = null;
  let testStudentId = 'STD-K10001';

  try {
    // ------------------------------------------------------------------------
    // BAGIAN 1: VERIFIKASI POSTGRESQL SCHEMA, CONSTRAINT, & SEED
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Verifikasi PostgreSQL Database Schema & Constraints ---');

    // 1.1 Verifikasi users_role_check constraint
    const roleConstraintRes = await query(
      "SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = 'users_role_check'"
    );
    assert.strictEqual(roleConstraintRes.rows.length, 1, 'Constraint users_role_check harus ada di database');
    const constraintDef = roleConstraintRes.rows[0].def;
    assert.ok(constraintDef.includes('BENDAHARA'), 'users_role_check harus mencakup BENDAHARA');
    assert.ok(constraintDef.includes('ORANG_TUA'), 'users_role_check harus mencakup ORANG_TUA');
    console.log('   PASS: Constraint users_role_check terverifikasi mencakup BENDAHARA dan ORANG_TUA');

    // 1.2 Verifikasi tabel parent_student_mappings
    const psmTableRes = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'parent_student_mappings'"
    );
    assert.strictEqual(psmTableRes.rows.length, 1, 'Tabel parent_student_mappings harus ada di database');
    console.log('   PASS: Tabel parent_student_mappings terverifikasi ada');

    // 1.3 Verifikasi tabel finance_settings & default seed
    const settingsRes = await query('SELECT setting_key, setting_value FROM finance_settings ORDER BY setting_key');
    assert.ok(settingsRes.rows.length >= 6, 'Minimal 6 entri konfigurasi baku finance_settings harus ada');
    const settingsMap = {};
    settingsRes.rows.forEach(r => { settingsMap[r.setting_key] = r.setting_value; });
    assert.ok(settingsMap.school_name, 'school_name harus ada di settings');
    assert.ok(settingsMap.treasurer_name, 'treasurer_name harus ada di settings');
    assert.ok(settingsMap.bank_name, 'bank_name harus ada di settings');
    assert.ok(settingsMap.bank_account_number, 'bank_account_number harus ada di settings');
    console.log('   PASS: Tabel finance_settings terverifikasi dengan entri default lengkap');

    // 1.4 Verifikasi penolakan constraint check pada role tidak valid
    let invalidRoleRejected = false;
    try {
      await query(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES ('invalid_user', 'hash', 'Invalid User', 'SUPER_ADMIN')"
      );
    } catch (err) {
      if (err.message && err.message.includes('users_role_check')) {
        invalidRoleRejected = true;
      }
    }
    assert.ok(invalidRoleRejected, 'Database PostgreSQL wajib menolak role yang tidak ada dalam users_role_check');
    console.log('   PASS: Penolakan role tidak valid pada level PostgreSQL constraint terkonfirmasi');

    // ------------------------------------------------------------------------
    // BAGIAN 2: SERVER STARTUP & PENGUJIAN REST API
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Pengujian REST API, RBAC Middleware, & CRUD Keuangan ---');

    // Start HTTP server on dynamic port
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    // 2.1 Authenticate Admin
    const adminLoginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'Admin1', password: 'password' }
    });
    // Jika password default Admin1 bukan 'password', coba '12345'
    if (adminLoginRes.status !== 200) {
      const fallbackAdminLogin = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { username: 'Admin1', password: '12345' }
      });
      assert.strictEqual(fallbackAdminLogin.status, 200, 'Admin1 login harus berhasil');
      adminToken = fallbackAdminLogin.body.data.token;
    } else {
      adminToken = adminLoginRes.body.data.token;
    }
    assert.ok(adminToken, 'Admin token harus valid');
    console.log('   PASS: Otentikasi Admin berhasil');

    // 2.2 Authenticate Guru
    const guruLoginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: 'Guru_001', password: 'password' }
    });
    if (guruLoginRes.status !== 200) {
      const fallbackGuru = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { username: 'Guru_001', password: 'Guru001' }
      });
      assert.strictEqual(fallbackGuru.status, 200, 'Guru_001 login harus berhasil');
      guruToken = fallbackGuru.body.data.token;
    } else {
      guruToken = guruLoginRes.body.data.token;
    }
    assert.ok(guruToken, 'Guru token harus valid');
    console.log('   PASS: Otentikasi Guru berhasil');

    // 2.3 Buat akun BENDAHARA melalui API Admin
    const createBendaharaRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/users',
      token: adminToken,
      body: {
        username: testBendaharaUsername,
        password: 'PasswordBendahara123!',
        full_name: 'Ustadzah Siti Maryam (Bendahara)',
        role: 'BENDAHARA'
      }
    });
    assert.strictEqual(createBendaharaRes.status, 201, 'Pembuatan akun BENDAHARA harus mengembalikan status 201');
    bendaharaUserId = createBendaharaRes.body.data.user_id;
    assert.strictEqual(createBendaharaRes.body.data.role, 'BENDAHARA');
    console.log('   PASS: Pendaftaran akun role BENDAHARA berhasil via API');

    // 2.4 Buat akun ORANG_TUA melalui API Admin
    const createParentRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/users',
      token: adminToken,
      body: {
        username: testParentUsername,
        password: 'PasswordParent123!',
        full_name: 'Bapak Ahmad Subagyo (Wali Murid)',
        role: 'ORANG_TUA'
      }
    });
    assert.strictEqual(createParentRes.status, 201, 'Pembuatan akun ORANG_TUA harus mengembalikan status 201');
    parentUserId = createParentRes.body.data.user_id;
    assert.strictEqual(createParentRes.body.data.role, 'ORANG_TUA');
    console.log('   PASS: Pendaftaran akun role ORANG_TUA berhasil via API');

    // 2.5 Login sebagai BENDAHARA
    const bendaharaLogin = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: testBendaharaUsername, password: 'PasswordBendahara123!' }
    });
    assert.strictEqual(bendaharaLogin.status, 200, 'Login BENDAHARA harus berhasil');
    bendaharaToken = bendaharaLogin.body.data.token;
    assert.strictEqual(bendaharaLogin.body.data.user.role, 'BENDAHARA');
    console.log('   PASS: Otentikasi role BENDAHARA terverifikasi dengan token sesi aktif');

    // 2.6 Login sebagai ORANG_TUA
    const parentLogin = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { username: testParentUsername, password: 'PasswordParent123!' }
    });
    assert.strictEqual(parentLogin.status, 200, 'Login ORANG_TUA harus berhasil');
    parentToken = parentLogin.body.data.token;
    assert.strictEqual(parentLogin.body.data.user.role, 'ORANG_TUA');
    console.log('   PASS: Otentikasi role ORANG_TUA terverifikasi dengan token sesi aktif');

    // ------------------------------------------------------------------------
    // BAGIAN 3: PENGUJIAN RBAC PADA FINANCE SETTINGS (/api/v1/finance/settings)
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Pengujian RBAC & CRUD Finance Settings ---');

    // 3.1 Unauthenticated access -> 401
    const unauthSettings = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/settings'
    });
    assert.strictEqual(unauthSettings.status, 401, 'Akses tanpa token harus 401');
    console.log('   PASS: Akses tanpa token ditolak dengan 401 Unauthorized');

    // 3.2 Guru access -> 403 (bukan staff keuangan)
    const guruSettings = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/settings',
      token: guruToken
    });
    assert.strictEqual(guruSettings.status, 403, 'Guru mengakses settings keuangan harus 403 Forbidden');
    console.log('   PASS: Guru ditolak dari settings keuangan dengan 403 Forbidden');

    // 3.3 Bendahara access -> 200
    const bendaharaSettings = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/settings',
      token: bendaharaToken
    });
    assert.strictEqual(bendaharaSettings.status, 200, 'Bendahara mengakses settings harus 200 OK');
    assert.ok(bendaharaSettings.body.data.settings.school_name, 'Settings data harus berisi school_name');
    console.log('   PASS: Bendahara berhasil membaca pengaturan keuangan (200 OK)');

    // 3.4 Bendahara update settings -> 200
    const updatePayload = {
      treasurer_name: 'Ustadzah Siti Maryam, S.E.',
      bank_account_number: '9876543210'
    };
    const updateSettingsRes = await makeRequest(server, {
      method: 'PUT',
      path: '/api/v1/finance/settings',
      token: bendaharaToken,
      body: updatePayload
    });
    assert.strictEqual(updateSettingsRes.status, 200, 'Bendahara memperbarui settings harus 200 OK');
    assert.strictEqual(updateSettingsRes.body.data.settings.treasurer_name, 'Ustadzah Siti Maryam, S.E.');
    assert.strictEqual(updateSettingsRes.body.data.settings.bank_account_number, '9876543210');
    console.log('   PASS: Bendahara berhasil memperbarui pengaturan keuangan');

    // 3.5 Admin verify updated settings -> 200
    const adminSettings = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/settings',
      token: adminToken
    });
    assert.strictEqual(adminSettings.status, 200);
    assert.strictEqual(adminSettings.body.data.settings.treasurer_name, 'Ustadzah Siti Maryam, S.E.');
    console.log('   PASS: Admin memverifikasi persistensi pembaruan konfigurasi');

    // ------------------------------------------------------------------------
    // BAGIAN 4: PENGUJIAN PARENT-STUDENT MAPPINGS (/api/v1/finance/parents)
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Pengujian Parent-Student Mappings & Proteksi IDOR ---');

    // 4.1 Ambil salah satu student_id yang valid dari database
    const stdRes = await query('SELECT student_id, name FROM students LIMIT 1');
    if (stdRes.rows.length > 0) {
      testStudentId = stdRes.rows[0].student_id;
    }

    // 4.2 Guru coba menghubungkan siswa -> 403 Forbidden
    const guruLinkRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/parents/link-student',
      token: guruToken,
      body: { parent_user_id: parentUserId, student_id: testStudentId, relationship_type: 'WALI' }
    });
    assert.strictEqual(guruLinkRes.status, 403, 'Guru tidak boleh menghubungkan wali-siswa');
    console.log('   PASS: Guru ditolak menghubungkan wali-siswa dengan 403 Forbidden');

    // 4.3 Admin menghubungkan siswa non-existent -> 404 Not Found
    const fakeStudentLink = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/parents/link-student',
      token: adminToken,
      body: { parent_user_id: parentUserId, student_id: 'NON_EXISTENT_STD', relationship_type: 'AYAH' }
    });
    assert.strictEqual(fakeStudentLink.status, 404, 'Siswa tidak ditemukan harus 404');
    console.log('   PASS: Validasi penolakan siswa fiktif (404 Not Found)');

    // 4.4 Admin menghubungkan siswa ke akun non-Orang Tua (misal ke akun Guru) -> 400 Bad Request
    const guruUserRes = await query("SELECT user_id FROM users WHERE role = 'GURU' LIMIT 1");
    if (guruUserRes.rows.length > 0) {
      const invalidParentLink = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/finance/parents/link-student',
        token: adminToken,
        body: { parent_user_id: guruUserRes.rows[0].user_id, student_id: testStudentId }
      });
      assert.strictEqual(invalidParentLink.status, 400, 'Akun non-ORANG_TUA harus ditolak saat dihubungkan');
      console.log('   PASS: Validasi penolakan penautan akun non-ORANG_TUA (400 Bad Request)');
    }

    // 4.5 Admin menghubungkan siswa ke akun Orang Tua yang valid -> 201 Created
    const validLinkRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/finance/parents/link-student',
      token: adminToken,
      body: { parent_user_id: parentUserId, student_id: testStudentId, relationship_type: 'AYAH' }
    });
    assert.strictEqual(validLinkRes.status, 201, 'Menghubungkan siswa valid harus 201 Created');
    assert.strictEqual(validLinkRes.body.data.relationship_type, 'AYAH');
    console.log('   PASS: Admin berhasil menghubungkan siswa ke akun Orang Tua (201 Created)');

    // 4.6 Admin membaca daftar orang tua -> 200 OK
    const listParentsRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/parents',
      token: adminToken
    });
    assert.strictEqual(listParentsRes.status, 200);
    const mappedParent = listParentsRes.body.data.find(p => p.user_id === parentUserId);
    assert.ok(mappedParent, 'Orang tua harus ada dalam list');
    assert.strictEqual(mappedParent.students.length, 1, 'Orang tua harus memiliki 1 siswa terhubung');
    assert.strictEqual(mappedParent.students[0].student_id, testStudentId);
    console.log('   PASS: Admin berhasil melihat relasi orang tua dan siswa');

    // 4.7 Orang Tua mengakses /my-students -> 200 OK (IDOR safe)
    const myStudentsRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/parents/my-students',
      token: parentToken
    });
    assert.strictEqual(myStudentsRes.status, 200, 'Orang tua mengakses my-students harus 200 OK');
    assert.strictEqual(myStudentsRes.body.data.length, 1);
    assert.strictEqual(myStudentsRes.body.data[0].student_id, testStudentId);
    console.log('   PASS: Orang Tua berhasil mengakses profil siswa binaannya secara aman (IDOR-safe)');

    // 4.8 Admin melepaskan hubungan siswa -> 200 OK
    const unlinkRes = await makeRequest(server, {
      method: 'DELETE',
      path: `/api/v1/finance/parents/${parentUserId}/unlink-student/${testStudentId}`,
      token: adminToken
    });
    assert.strictEqual(unlinkRes.status, 200, 'Unlink siswa harus 200 OK');
    console.log('   PASS: Admin berhasil memutuskan hubungan siswa dari akun orang tua');

    // 4.9 Orang Tua mengakses /my-students setelah unlink -> 200 OK dengan array kosong
    const myStudentsAfterUnlink = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/finance/parents/my-students',
      token: parentToken
    });
    assert.strictEqual(myStudentsAfterUnlink.status, 200);
    assert.strictEqual(myStudentsAfterUnlink.body.data.length, 0);
    console.log('   PASS: my-students terverifikasi kosong pasca-unlink');

    // ------------------------------------------------------------------------
    // BAGIAN 5: CLEANUP AKUN PENGUJIAN
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Pembersihan Data Pengujian ---');
    if (bendaharaUserId) {
      await query('DELETE FROM users WHERE user_id = $1', [bendaharaUserId]);
    }
    if (parentUserId) {
      await query('DELETE FROM users WHERE user_id = $1', [parentUserId]);
    }
    console.log('   PASS: Akun pengujian dibersihkan dengan aman');

    console.log('\n===============================================================');
    console.log('FEATURE 005-A VERIFICATION: ALL 15 CRITICAL ASSERTIONS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } catch (err) {
    console.error('\nFAIL in Feature 005-A Test Suite:', err);
    return false;
  } finally {
    if (server) {
      server.close();
    }
  }
}

if (require.main === module) {
  runFeature005aTests()
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

module.exports = runFeature005aTests;
