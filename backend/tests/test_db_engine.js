/**
 * In-Memory SQLite/Mock DB Engine for isolated unit & integration testing
 * Emulates PostgreSQL query execution for SIMATA master data and attendance tables.
 */
const { hashPassword } = require('../src/utils/password.util');

class TestDbEngine {
  constructor() {
    this.reset();
  }

  async reset() {
    this.academic_years = [
      { academic_year_id: '2026/2027', name: 'Tahun Ajaran 2026/2027', is_active: true }
    ];

    const adminHash = await hashPassword('12345');
    const guruHash = await hashPassword('Guru001');

    this.users = [
      { user_id: 1, username: 'Admin1', password_hash: adminHash, full_name: 'Imam Sa\'adi', role: 'ADMIN', status: 'Active', teacher_id: null, must_change_password: true },
      { user_id: 2, username: 'Guru_001', password_hash: guruHash, full_name: 'IQNAUL BADRIL FALAH, S.Ag', role: 'GURU', status: 'Active', teacher_id: 'TCH-0001', must_change_password: true }
    ];

    this.teachers = [
      { teacher_id: 'TCH-0001', name: 'IQNAUL BADRIL FALAH, S.Ag', position: 'Guru Mapel', status: 'Active', subject: 'Fiqih', phone: '08123456789', nik: '3317010101700001', nip: '197001012000031001', nuptk: '1234567890123456' },
      { teacher_id: 'TCH-0002', name: 'AHMAD ZAINUDDIN, S.Pd', position: 'Guru Mapel', status: 'Active', subject: 'Bahasa Arab', phone: '08123456780', nik: '3317010101750002', nip: '197501012000031002', nuptk: '1234567890123457' }
    ];

    this.classes = [
      { class_id: 'CLS-2627-10', class_name: 'Kelas 10', level: 10, academic_year_id: '2026/2027', homeroom_teacher_id: 'TCH-0001', status: 'Active' },
      { class_id: 'CLS-2627-11', class_name: 'Kelas 11', level: 11, academic_year_id: '2026/2027', homeroom_teacher_id: 'TCH-0002', status: 'Active' },
      { class_id: 'CLS-2627-12', class_name: 'Kelas 12', level: 12, academic_year_id: '2026/2027', homeroom_teacher_id: null, status: 'Active' }
    ];

    this.students = [
      { student_id: 'STD-K10001', class_id: 'CLS-2627-10', name: 'AHMAD FAIZ', gender: 'L', nis: '1001', nisn: '0012345671', qr_code_id: 'SQR-10001', status: 'Active' },
      { student_id: 'STD-K10002', class_id: 'CLS-2627-10', name: 'SITI AISYAH', gender: 'P', nis: '1002', nisn: '0012345672', qr_code_id: 'SQR-10002', status: 'Active' }
    ];

    this.authentication_sessions = [];
    this.student_attendance = [];
    this.teacher_attendance = [];
    this.responder_sessions = [];
    this.attendance_evidences = [];
    this.student_documents = [];
    this.parent_student_mappings = [];
    this.finance_settings = [
      { setting_key: 'bank_account_holder', setting_value: 'MA At-Taujih Keuangan', description: 'Nama pemilik rekening bank resmi', updated_by_user_id: null, updated_at: new Date().toISOString() },
      { setting_key: 'bank_account_number', setting_value: '1234567890', description: 'Nomor rekening bank penerima tagihan', updated_by_user_id: null, updated_at: new Date().toISOString() },
      { setting_key: 'bank_name', setting_value: 'BSI (Bank Syariah Indonesia)', description: 'Nama bank penampung resmi pembayaran', updated_by_user_id: null, updated_at: new Date().toISOString() },
      { setting_key: 'receipt_footer_note', setting_value: 'Bukti pembayaran sah diterbitkan oleh Sistem Informasi MA At-Taujih (SIMATA).', description: 'Catatan kaki cetak bukti kuitansi', updated_by_user_id: null, updated_at: new Date().toISOString() },
      { setting_key: 'school_name', setting_value: 'MA At-Taujih', description: 'Nama resmi lembaga/madrasah', updated_by_user_id: null, updated_at: new Date().toISOString() },
      { setting_key: 'treasurer_name', setting_value: 'Bendahara Madrasah', description: 'Nama pejabat bendahara madrasah', updated_by_user_id: null, updated_at: new Date().toISOString() }
    ];

    this.fee_categories = [
      { fee_category_id: 'FEE-SPP', name: 'SPP Bulanan', description: 'Biaya SPP bulanan madrasah', default_amount: 150000.00, billing_cycle: 'MONTHLY', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { fee_category_id: 'FEE-GEDUNG', name: 'Uang Gedung', description: 'Infaq pembangunan gedung madrasah', default_amount: 1500000.00, billing_cycle: 'ONCE', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { fee_category_id: 'FEE-SERAGAM', name: 'Seragam & Atribut', description: 'Biaya seragam dan atribut madrasah', default_amount: 500000.00, billing_cycle: 'ONCE', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { fee_category_id: 'FEE-PTS', name: 'Ujian Tengah Semester (PTS)', description: 'Biaya pelaksanaan PTS', default_amount: 100000.00, billing_cycle: 'SEMESTER', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { fee_category_id: 'FEE-PAS-PAT', name: 'Ujian Semester (PAS/PAT)', description: 'Biaya pelaksanaan PAS / PAT', default_amount: 125000.00, billing_cycle: 'SEMESTER', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { fee_category_id: 'FEE-KEGIATAN', name: 'Iuran Kegiatan Tahunan', description: 'Biaya kegiatan kesiswaan tahunan', default_amount: 250000.00, billing_cycle: 'ANNUAL', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    ];
    this.student_invoices = [];
  }

  get tables() {
    return {
      academic_years: this.academic_years,
      users: this.users,
      teachers: this.teachers,
      classes: this.classes,
      students: this.students,
      authentication_sessions: this.authentication_sessions,
      student_attendance: this.student_attendance,
      teacher_attendance: this.teacher_attendance,
      responder_sessions: this.responder_sessions,
      attendance_evidences: this.attendance_evidences
    };
  }

  async handleQuery(text, params = []) {
    const q = text.trim();

    // 1. Users queries
    if (q.includes('FROM users') && q.includes('LOWER(username) = LOWER($1)')) {
      const u = this.users.find(u => u.username.toLowerCase() === params[0].toLowerCase());
      return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
    }
    if (q.includes('FROM users') && q.includes('user_id = $1')) {
      const u = this.users.find(u => u.user_id === parseInt(params[0], 10));
      return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
    }
    if (q.includes('FROM users') && q.includes('ORDER BY user_id ASC')) {
      return { rows: [...this.users], rowCount: this.users.length };
    }
    if (q.startsWith('INSERT INTO users')) {
      const newId = this.users.length + 1;
      const u = {
        user_id: newId,
        username: params[0],
        password_hash: params[1],
        full_name: params[2],
        role: params[3],
        status: params[4] || 'Active',
        teacher_id: params[5] || null,
        must_change_password: params[6] || false
      };
      this.users.push(u);
      return { rows: [u], rowCount: 1 };
    }
    if (q.startsWith('UPDATE users') && q.includes('password_hash = $2')) {
      const u = this.users.find(u => u.user_id === parseInt(params[0], 10));
      if (u) {
        u.password_hash = params[1];
        u.must_change_password = false;
      }
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (q.startsWith('UPDATE users') && q.includes('username = COALESCE($2, username)')) {
      const u = this.users.find(u => u.user_id === parseInt(params[0], 10));
      if (u) {
        if (params[1] !== null && params[1] !== undefined) u.username = params[1];
        if (params[2] !== null && params[2] !== undefined) u.password_hash = params[2];
        if (params[3] !== null && params[3] !== undefined) u.full_name = params[3];
        if (params[4] !== null && params[4] !== undefined) u.role = params[4];
        if (params[5] !== null && params[5] !== undefined) u.status = params[5];
        u.teacher_id = params[6] !== undefined ? params[6] : null;
        if (params[7] !== null && params[7] !== undefined) u.must_change_password = params[7];
        u.updated_at = new Date().toISOString();
      }
      return {
        rows: u ? [{
          user_id: u.user_id,
          username: u.username,
          full_name: u.full_name,
          role: u.role,
          status: u.status,
          teacher_id: u.teacher_id,
          must_change_password: u.must_change_password,
          updated_at: u.updated_at
        }] : [],
        rowCount: u ? 1 : 0
      };
    }
    if (q.startsWith('DELETE FROM users')) {
      const idx = this.users.findIndex(u => u.user_id === parseInt(params[0], 10));
      if (idx !== -1) {
        this.users.splice(idx, 1);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    // 2. Authentication Sessions queries
    if (q.startsWith('INSERT INTO authentication_sessions')) {
      const sess = {
        session_id: params[0],
        user_id: params[1],
        expires_at: params[2],
        ip_address: params[3],
        user_agent: params[4],
        issued_at: new Date().toISOString(),
        revoked_at: null
      };
      this.authentication_sessions.push(sess);
      return { rows: [sess], rowCount: 1 };
    }
    if (q.includes('FROM authentication_sessions') && q.includes('s.session_id = $1')) {
      const s = this.authentication_sessions.find(s => s.session_id === params[0]);
      if (s && !s.revoked_at && new Date(s.expires_at) > new Date()) {
        const u = this.users.find(u => u.user_id === s.user_id);
        if (u) {
          return {
            rows: [{
              session_id: s.session_id,
              user_id: s.user_id,
              issued_at: s.issued_at,
              expires_at: s.expires_at,
              revoked_at: s.revoked_at,
              username: u.username,
              full_name: u.full_name,
              role: u.role,
              status: u.status,
              teacher_id: u.teacher_id,
              must_change_password: u.must_change_password
            }],
            rowCount: 1
          };
        }
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith('UPDATE authentication_sessions') && q.includes('revoked_at = CURRENT_TIMESTAMP')) {
      if (q.includes('session_id = $1')) {
        const s = this.authentication_sessions.find(s => s.session_id === params[0]);
        if (s) {
          s.revoked_at = new Date().toISOString();
          return { rowCount: 1 };
        }
      } else if (q.includes('user_id = $1')) {
        let count = 0;
        this.authentication_sessions.forEach(s => {
          if (s.user_id === parseInt(params[0], 10) && !s.revoked_at) {
            s.revoked_at = new Date().toISOString();
            count++;
          }
        });
        return { rowCount: count };
      }
      return { rowCount: 0 };
    }

    // 3. Teachers queries
    if (q.includes('FROM teachers') && q.includes('teacher_id = $1')) {
      const t = this.teachers.find(t => t.teacher_id === params[0]);
      return { rows: t ? [{ ...t }] : [], rowCount: t ? 1 : 0 };
    }
    if (q.includes('FROM teachers')) {
      return { rows: [...this.teachers], rowCount: this.teachers.length };
    }
    if (q.startsWith('INSERT INTO teachers')) {
      const t = {
        teacher_id: params[0],
        name: params[1],
        position: params[2] || 'Guru Mapel',
        status: params[3] || 'Active',
        subject: params[4],
        gender: params[5] || null,
        nip: params[6] || null,
        nuptk: params[7] || null,
        nik: params[8] || null,
        qr_code_id: params[9] || null,
        birth_place: params[10] || null,
        birth_date: params[11] || null,
        village: params[12] || null,
        district: params[13] || null,
        regency: params[14] || null,
        phone: params[15] || null,
        email: params[16] || null,
        education: params[17] || null,
        major: params[18] || null,
        graduation_year: params[19] || null,
        teaching_hours: params[20] !== undefined ? params[20] : null
      };
      this.teachers.push(t);
      return { rows: [{ ...t }], rowCount: 1 };
    }
    if (q.startsWith('UPDATE teachers') && q.includes('status = $2')) {
      const t = this.teachers.find(t => t.teacher_id === params[0]);
      if (t) t.status = params[1];
      return { rows: t ? [{ ...t }] : [], rowCount: t ? 1 : 0 };
    }
    if (q.startsWith('UPDATE teachers')) {
      const t = this.teachers.find(t => t.teacher_id === params[0]);
      if (t) {
        if (params[1]) t.name = params[1];
        if (params[2]) t.position = params[2];
        if (params[3]) t.status = params[3];
        if (params[4]) t.subject = params[4];
        t.gender = params[5];
        t.nip = params[6];
        t.nuptk = params[7];
        t.nik = params[8];
        t.qr_code_id = params[9];
        t.birth_place = params[10];
        t.birth_date = params[11];
        t.village = params[12];
        t.district = params[13];
        t.regency = params[14];
        t.phone = params[15];
        t.email = params[16];
        t.education = params[17];
        t.major = params[18];
        t.graduation_year = params[19];
        t.teaching_hours = params[20];
      }
      return { rows: t ? [{ ...t }] : [], rowCount: t ? 1 : 0 };
    }

    // 4. Classes queries
    if (q.startsWith('INSERT INTO classes')) {
      const cls = { class_id: params[0], class_name: params[1], level: params[2], academic_year_id: params[3], homeroom_teacher_id: params[4], status: params[5] || 'Active' };
      this.classes.push(cls);
      return { rows: [cls], rowCount: 1 };
    }
    if (q.startsWith('UPDATE classes') && q.includes('status = $2')) {
      const c = this.classes.find(c => c.class_id === params[0]);
      if (c) c.status = params[1];
      return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
    }
    if (q.includes('FROM classes') && q.includes('class_id = $1')) {
      const c = this.classes.find(c => c.class_id === params[0]);
      return { rows: c ? [{ ...c }] : [], rowCount: c ? 1 : 0 };
    }
    if (q.includes('FROM classes')) {
      return { rows: [...this.classes], rowCount: this.classes.length };
    }
    if (q.includes('FROM students s') && q.includes('LEFT JOIN student_attendance sa') && q.includes('s.class_id = $1')) {
      // Dynamic roster query (BUG 29)
      const classId = params[0];
      const date = params[1];
      const roster = this.students.filter(s => s.class_id === classId).map(s => {
        const att = this.student_attendance.find(a => a.student_id === s.student_id && a.attendance_date === date);
        return {
          student_id: s.student_id,
          name: s.name,
          gender: s.gender,
          nis: s.nis,
          nisn: s.nisn,
          qr_code_id: s.qr_code_id,
          student_status: s.status,
          attendance_id: att ? att.attendance_id : null,
          period: att ? att.period : null,
          attendance_status: att ? att.status : null,
          method: att ? att.method : null,
          note: att ? att.note : null,
          recorded_at: att ? att.recorded_at : null
        };
      });
      return { rows: roster, rowCount: roster.length };
    }

    // 5. Students queries
    if (q.includes('FROM students') && q.includes('qr_code_id = $1')) {
      const s = this.students.find(s => s.qr_code_id === params[0]);
      return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
    }
    if (q.includes('FROM students') && q.includes('student_id = $1')) {
      const s = this.students.find(s => s.student_id === params[0]);
      return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
    }
    if (q.includes('FROM students')) {
      return { rows: [...this.students], rowCount: this.students.length };
    }
    if (q.startsWith('INSERT INTO students')) {
      const s = { student_id: params[0], class_id: params[1], name: params[2], qr_code_id: params[7], status: params[8] || 'Active' };
      this.students.push(s);
      return { rows: [s], rowCount: 1 };
    }

    // 6. Student Attendance queries
    if (q.includes('FROM student_attendance') && q.includes('student_id = $1 AND attendance_date = $2 AND period = $3')) {
      const att = this.student_attendance.find(a =>
        a.student_id === params[0] && a.attendance_date === params[1] && a.period === parseInt(params[2], 10)
      );
      return { rows: att ? [{ ...att }] : [], rowCount: att ? 1 : 0 };
    }
    if (q.includes('FROM student_attendance sa') && q.includes('sa.student_id = ANY')) {
      const studentIds = params[0];
      const date = params[1];
      const periods = params[2];
      const dups = this.student_attendance.filter(a =>
        studentIds.includes(a.student_id) && a.attendance_date === date && periods.includes(a.period)
      ).map(a => {
        const s = this.students.find(st => st.student_id === a.student_id);
        return {
          student_id: a.student_id,
          attendance_date: a.attendance_date,
          period: a.period,
          status: a.status,
          student_name: s ? s.name : a.student_id
        };
      });
      return { rows: dups, rowCount: dups.length };
    }
    if (q.startsWith('INSERT INTO student_attendance')) {
      const att = {
        attendance_id: params[0],
        student_id: params[1],
        class_id: params[2],
        academic_year_id: params[3],
        attendance_date: params[4],
        period: parseInt(params[5], 10),
        status: params[6],
        method: params[7],
        note: params[8],
        recorded_at: params[9],
        recorded_by_user_id: params[10]
      };
      this.student_attendance.push(att);
      return { rows: [att], rowCount: 1 };
    }
    if (q.startsWith('UPDATE student_attendance')) {
      const attId = params[5];
      const att = this.student_attendance.find(a => a.attendance_id === attId);
      if (att) {
        if (params[0]) att.status = params[0];
        att.note = params[1];
        if (params[2]) att.period = parseInt(params[2], 10);
        if (params[3]) att.attendance_date = params[3];
        if (params[4]) att.recorded_by_user_id = params[4];
      }
      return { rows: att ? [{ ...att }] : [], rowCount: att ? 1 : 0 };
    }
    if (q.includes('FROM student_attendance sa') && q.includes('sa.attendance_id = $1')) {
      const att = this.student_attendance.find(a => a.attendance_id === params[0]);
      if (!att) return { rows: [], rowCount: 0 };
      const s = this.students.find(st => st.student_id === att.student_id);
      const c = this.classes.find(cl => cl.class_id === att.class_id);
      return {
        rows: [{
          ...att,
          student_name: s ? s.name : att.student_id,
          class_name: c ? c.class_name : att.class_id
        }],
        rowCount: 1
      };
    }
    if (q.includes('FROM student_attendance')) {
      return { rows: [...this.student_attendance], rowCount: this.student_attendance.length };
    }

    // 7. Teacher Attendance queries
    if (q.includes('FROM teacher_attendance') && q.includes('teacher_id = $1 AND attendance_date = $2 AND period = $3')) {
      const att = this.teacher_attendance.find(a =>
        a.teacher_id === params[0] && a.attendance_date === params[1] && a.period === parseInt(params[2], 10)
      );
      return { rows: att ? [{ ...att }] : [], rowCount: att ? 1 : 0 };
    }
    if (q.includes('FROM teacher_attendance ta') && q.includes('ta.teacher_id = $1') && q.includes('ta.period = ANY')) {
      const teacherId = params[0];
      const date = params[1];
      const periods = params[2];
      const dups = this.teacher_attendance.filter(a =>
        a.teacher_id === teacherId && a.attendance_date === date && periods.includes(a.period)
      ).map(a => {
        const t = this.teachers.find(th => th.teacher_id === a.teacher_id);
        return {
          attendance_id: a.attendance_id,
          teacher_id: a.teacher_id,
          attendance_date: a.attendance_date,
          period: a.period,
          subject: a.subject,
          teacher_name: t ? t.name : a.teacher_id
        };
      });
      return { rows: dups, rowCount: dups.length };
    }
    if (q.startsWith('INSERT INTO teacher_attendance')) {
      const att = {
        attendance_id: params[0],
        teacher_id: params[1],
        class_id: params[2],
        academic_year_id: params[3],
        attendance_date: params[4],
        period: parseInt(params[5], 10),
        subject: params[6],
        materi: params[7],
        status: params[8],
        method: params[9],
        recorded_at: params[10],
        note: params[11],
        recorded_by_user_id: params[12]
      };
      this.teacher_attendance.push(att);
      return { rows: [att], rowCount: 1 };
    }
    if (q.includes('FROM teacher_attendance ta') && q.includes('JOIN teachers t')) {
      let results = this.teacher_attendance.map(ta => {
        const t = this.teachers.find(th => th.teacher_id === ta.teacher_id) || {};
        const c = this.classes.find(cl => cl.class_id === ta.class_id) || {};
        const ae = this.attendance_evidences.find(ev => ev.attendance_id === ta.attendance_id) || {};
        return {
          ...ta,
          teacher_name: t.name || ta.teacher_id,
          nik: t.nik || '-',
          nip: t.nip || '-',
          nuptk: t.nuptk || '-',
          class_name: c.class_name || ta.class_id,
          evidence_id: ae.evidence_id || null,
          file_id: ae.file_id || null,
          file_url: ae.file_url || null
        };
      });

      if (q.includes('ta.attendance_id = $1')) {
        results = results.filter(r => r.attendance_id === params[0]);
      }
      if (q.includes('ta.attendance_date =')) {
        const dateParam = params.find(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
        if (dateParam) {
          results = results.filter(r => r.attendance_date === dateParam);
        }
      }
      if (q.includes('ta.teacher_id =')) {
        const tIdParam = params.find(p => typeof p === 'string' && p.startsWith('TCH-'));
        if (tIdParam) {
          results = results.filter(r => r.teacher_id === tIdParam);
        }
      }
      return { rows: results, rowCount: results.length };
    }
    if (q.startsWith('UPDATE teacher_attendance')) {
      const attId = params[8];
      const att = this.teacher_attendance.find(a => a.attendance_id === attId);
      if (att) {
        if (params[0]) att.status = params[0];
        if (params[1]) att.subject = params[1];
        if (params[2]) att.materi = params[2];
        att.note = params[3];
        if (params[4]) att.period = parseInt(params[4], 10);
        if (params[5]) att.class_id = params[5];
        if (params[6]) att.attendance_date = params[6];
        if (params[7]) att.recorded_by_user_id = params[7];
      }
      return { rows: att ? [{ ...att }] : [], rowCount: att ? 1 : 0 };
    }
    if (q.includes('FROM teacher_attendance')) {
      return { rows: [...this.teacher_attendance], rowCount: this.teacher_attendance.length };
    }

    // 8. Responder Sessions
    if (q.startsWith('INSERT INTO responder_sessions')) {
      const s = {
        session_id: params[0],
        operator_user_id: params[1],
        started_at: params[2],
        status: 'ACTIVE'
      };
      this.responder_sessions.push(s);
      return { rows: [s], rowCount: 1 };
    }
    if (q.includes('FROM responder_sessions') && q.includes('session_id = $1')) {
      const s = this.responder_sessions.find(s => s.session_id === params[0]);
      return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
    }
    if (q.startsWith('UPDATE responder_sessions')) {
      const s = this.responder_sessions.find(s => s.session_id === params[0]);
      if (s) {
        s.status = params[1];
        s.finished_at = params[2];
      }
      return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
    }

    // 9. Attendance Evidences
    if (q.startsWith('INSERT INTO attendance_evidences')) {
      const ev = {
        evidence_id: params[0],
        session_id: params[1],
        operator_user_id: params[2],
        captured_at: params[3],
        file_id: params[4],
        file_url: params[5],
        attendance_id: params[6],
        storage_provider: params[7],
        mime_type: params[8]
      };
      this.attendance_evidences.push(ev);
      return { rows: [ev], rowCount: 1 };
    }
    if (q.includes('FROM attendance_evidences') && q.includes('attendance_id = $1')) {
      const ev = this.attendance_evidences.find(e => e.attendance_id === params[0]);
      return { rows: ev ? [{ ...ev }] : [], rowCount: ev ? 1 : 0 };
    }
    if (q.includes('FROM attendance_evidences') && q.includes('session_id = $1')) {
      const evs = this.attendance_evidences.filter(e => e.session_id === params[0]);
      return { rows: evs, rowCount: evs.length };
    }
    if (q.includes('DISTINCT file_id FROM attendance_evidences')) {
      const ids = [...new Set(this.attendance_evidences.map(e => e.file_id))];
      return { rows: ids.map(id => ({ file_id: id })), rowCount: ids.length };
    }

    // 10. Academic Years
    if (q.includes('FROM academic_years') && q.includes('is_active = TRUE')) {
      return { rows: [this.academic_years[0]], rowCount: 1 };
    }

    // 11. Student Documents (FEATURE 004 - Kartu Pelajar)
    if (q.startsWith('INSERT INTO student_documents')) {
      const doc = {
        document_id: params[0],
        student_id: params[1],
        document_type: params[2],
        file_name: params[3],
        original_name: params[4],
        storage_path: params[5],
        mime_type: params[6],
        file_size: params[7],
        uploaded_by_user_id: params[8],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const existingIdx = this.student_documents.findIndex(d => d.student_id === params[1] && d.document_type === params[2]);
      if (existingIdx >= 0) {
        this.student_documents[existingIdx] = { ...this.student_documents[existingIdx], ...doc };
        return { rows: [this.student_documents[existingIdx]], rowCount: 1 };
      }
      this.student_documents.push(doc);
      return { rows: [doc], rowCount: 1 };
    }
    if (q.includes('DELETE FROM student_documents') && q.includes('student_id = $1') && q.includes('document_type = $2')) {
      const idx = this.student_documents.findIndex(d => d.student_id === params[0] && d.document_type === params[1]);
      if (idx >= 0) {
        const deleted = this.student_documents.splice(idx, 1)[0];
        return { rows: [deleted], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.includes('SELECT') && q.includes('FROM student_documents') && q.includes('student_id = $1') && q.includes('document_type = $2')) {
      const doc = this.student_documents.find(d => d.student_id === params[0] && d.document_type === params[1]);
      return { rows: doc ? [{ ...doc }] : [], rowCount: doc ? 1 : 0 };
    }
    if (q.includes('SELECT') && q.includes('FROM student_documents') && q.includes('document_id = $1')) {
      const doc = this.student_documents.find(d => d.document_id === params[0]);
      return { rows: doc ? [{ ...doc }] : [], rowCount: doc ? 1 : 0 };
    }

    // 12. Finance Settings (FEATURE 005-A)
    if (q.includes('FROM finance_settings') && q.includes('ORDER BY setting_key')) {
      const sorted = [...this.finance_settings].sort((a, b) => a.setting_key.localeCompare(b.setting_key));
      return { rows: sorted, rowCount: sorted.length };
    }
    if (q.includes('FROM finance_settings') && q.includes('setting_key = $1')) {
      const found = this.finance_settings.find(s => s.setting_key === params[0]);
      return { rows: found ? [{ ...found }] : [], rowCount: found ? 1 : 0 };
    }
    if (q.startsWith('INSERT INTO finance_settings') && q.includes('ON CONFLICT (setting_key)')) {
      const key = params[0];
      const val = params[1];
      const userId = params[2];
      const existing = this.finance_settings.find(s => s.setting_key === key);
      if (existing) {
        existing.setting_value = val;
        existing.updated_by_user_id = userId;
        existing.updated_at = new Date().toISOString();
      } else {
        this.finance_settings.push({
          setting_key: key,
          setting_value: val,
          description: null,
          updated_by_user_id: userId,
          updated_at: new Date().toISOString()
        });
      }
      return { rows: [{ setting_key: key, setting_value: val }], rowCount: 1 };
    }

    // 13. Parent Student Mappings (FEATURE 005-A)
    if (q.includes('FROM users u') && q.includes('parent_student_mappings') && q.includes("u.role = 'ORANG_TUA'")) {
      const parents = this.users.filter(u => u.role === 'ORANG_TUA');
      const rows = [];
      for (const p of parents) {
        const mappings = this.parent_student_mappings.filter(m => m.parent_user_id === p.user_id);
        if (mappings.length === 0) {
          rows.push({
            user_id: p.user_id,
            username: p.username,
            parent_name: p.full_name,
            status: p.status,
            created_at: new Date().toISOString(),
            student_id: null,
            relationship_type: null,
            linked_at: null,
            nisn: null,
            student_name: null,
            student_status: null,
            class_name: null
          });
        } else {
          for (const m of mappings) {
            const student = this.students.find(s => s.student_id === m.student_id) || {};
            const cls = this.classes.find(c => c.class_id === student.class_id) || {};
            rows.push({
              user_id: p.user_id,
              username: p.username,
              parent_name: p.full_name,
              status: p.status,
              created_at: new Date().toISOString(),
              student_id: m.student_id,
              relationship_type: m.relationship_type,
              linked_at: m.created_at,
              nisn: student.nisn || null,
              student_name: student.name || student.full_name || null,
              student_status: student.status || 'Active',
              class_name: cls.class_name || null
            });
          }
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (q.includes('FROM parent_student_mappings psm') && q.includes('psm.parent_user_id = $1')) {
      const parentId = parseInt(params[0], 10);
      const mappings = this.parent_student_mappings.filter(m => m.parent_user_id === parentId);
      const rows = mappings.map(m => {
        const student = this.students.find(s => s.student_id === m.student_id) || {};
        const cls = this.classes.find(c => c.class_id === student.class_id) || {};
        return {
          student_id: m.student_id,
          nisn: student.nisn,
          full_name: student.name || student.full_name,
          gender: student.gender,
          status: student.status,
          class_id: cls.class_id,
          class_name: cls.class_name,
          relationship_type: m.relationship_type,
          linked_at: m.created_at
        };
      });
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith('INSERT INTO parent_student_mappings') && q.includes('ON CONFLICT (parent_user_id, student_id)')) {
      const pId = parseInt(params[0], 10);
      const sId = params[1];
      const rel = params[2] || 'ORANG_TUA';
      const now = new Date().toISOString();
      const existing = this.parent_student_mappings.find(m => m.parent_user_id === pId && m.student_id === sId);
      if (existing) {
        existing.relationship_type = rel;
        return { rows: [{ ...existing }], rowCount: 1 };
      }
      const entry = {
        parent_user_id: pId,
        student_id: sId,
        relationship_type: rel,
        created_at: now
      };
      this.parent_student_mappings.push(entry);
      return { rows: [entry], rowCount: 1 };
    }
    if (q.includes('DELETE FROM parent_student_mappings') && q.includes('parent_user_id = $1 AND student_id = $2')) {
      const pId = parseInt(params[0], 10);
      const sId = params[1];
      const idx = this.parent_student_mappings.findIndex(m => m.parent_user_id === pId && m.student_id === sId);
      if (idx !== -1) {
        const deleted = this.parent_student_mappings.splice(idx, 1)[0];
        return { rows: [deleted], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.includes('SELECT student_id, full_name FROM students WHERE student_id = $1') || q.includes('SELECT student_id, name FROM students WHERE student_id = $1')) {
      const st = this.students.find(s => s.student_id === params[0]);
      return { rows: st ? [{ student_id: st.student_id, name: st.name, full_name: st.name }] : [], rowCount: st ? 1 : 0 };
    }

    // 14. Fee Categories (FEATURE 005-B)
    if (q.includes('FROM fee_categories') && q.includes('WHERE fee_category_id = $1')) {
      const cat = this.fee_categories.find(c => c.fee_category_id === params[0]);
      return { rows: cat ? [{ ...cat }] : [], rowCount: cat ? 1 : 0 };
    }
    if (q.includes('FROM fee_categories') && q.includes('WHERE is_active = TRUE')) {
      const active = this.fee_categories.filter(c => c.is_active);
      return { rows: active, rowCount: active.length };
    }
    if (q.includes('FROM fee_categories') && q.includes('ORDER BY name ASC')) {
      return { rows: [...this.fee_categories], rowCount: this.fee_categories.length };
    }
    if (q.includes('FROM fee_categories') && q.includes('fee_category_id = $1 OR LOWER(name) = LOWER($2)')) {
      const match = this.fee_categories.filter(c => c.fee_category_id === params[0] || c.name.toLowerCase() === params[1].toLowerCase());
      return { rows: match, rowCount: match.length };
    }
    if (q.includes('FROM fee_categories') && q.includes('LOWER(name) = LOWER($1) AND fee_category_id <> $2')) {
      const match = this.fee_categories.filter(c => c.name.toLowerCase() === params[0].toLowerCase() && c.fee_category_id !== params[1]);
      return { rows: match, rowCount: match.length };
    }
    if (q.startsWith('INSERT INTO fee_categories')) {
      const cat = {
        fee_category_id: params[0],
        name: params[1],
        description: params[2],
        default_amount: params[3],
        billing_cycle: params[4],
        is_active: params[5] !== undefined ? params[5] : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.fee_categories.push(cat);
      return { rows: [cat], rowCount: 1 };
    }
    if (q.startsWith('UPDATE fee_categories') && q.includes('SET name = $1')) {
      const cat = this.fee_categories.find(c => c.fee_category_id === params[5]);
      if (cat) {
        cat.name = params[0];
        cat.description = params[1];
        cat.default_amount = params[2];
        cat.billing_cycle = params[3];
        cat.is_active = params[4];
        cat.updated_at = new Date().toISOString();
        return { rows: [cat], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith('UPDATE fee_categories') && q.includes('SET is_active = $1')) {
      const cat = this.fee_categories.find(c => c.fee_category_id === params[1]);
      if (cat) {
        cat.is_active = params[0];
        cat.updated_at = new Date().toISOString();
        return { rows: [cat], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 15. Student Invoices (FEATURE 005-B)
    if (q.includes('FROM student_invoices') && q.includes("status <> 'CANCELLED'") && q.includes('fee_category_id = $1')) {
      const catId = params[0];
      const ayId = params[1];
      const periodKey = params[2];
      const found = this.student_invoices.filter(i => 
        i.fee_category_id === catId && 
        i.academic_year_id === ayId && 
        i.period_key === periodKey && 
        i.status !== 'CANCELLED'
      );
      return { rows: found.map(f => ({ ...f })), rowCount: found.length };
    }
    if (q.includes('FROM student_invoices') && q.includes('FOR UPDATE') && q.includes('invoice_id = $1')) {
      const inv = this.student_invoices.find(i => i.invoice_id === params[0]);
      return { rows: inv ? [{ ...inv }] : [], rowCount: inv ? 1 : 0 };
    }
    if (q.startsWith('UPDATE student_invoices') && q.includes("SET status = 'CANCELLED'")) {
      const inv = this.student_invoices.find(i => i.invoice_id === params[1]);
      if (inv) {
        inv.status = 'CANCELLED';
        inv.cancellation_reason = params[0];
        inv.cancelled_at = new Date().toISOString();
        inv.updated_at = new Date().toISOString();
        return { rows: [inv], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith('INSERT INTO student_invoices')) {
      const inv = {
        invoice_id: params[0],
        student_id: params[1],
        academic_year_id: params[2],
        fee_category_id: params[3],
        period_key: params[4],
        title: params[5],
        total_amount: params[6],
        amount_paid: 0.00,
        status: 'UNPAID',
        due_date: params[7] || null,
        notes: params[8] || null,
        cancellation_reason: null,
        cancelled_at: null,
        created_by_user_id: params[9],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      // Check partial unique index constraint
      const dup = this.student_invoices.find(i => 
        i.student_id === inv.student_id && 
        i.academic_year_id === inv.academic_year_id && 
        i.fee_category_id === inv.fee_category_id && 
        i.period_key === inv.period_key && 
        i.status !== 'CANCELLED'
      );
      if (dup) {
        if (q.includes('DO NOTHING')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error('duplicate key value violates unique constraint "uq_invoices_student_category_period"');
      }
      this.student_invoices.push(inv);
      return { rows: [inv], rowCount: 1 };
    }
    if (q.includes('FROM student_invoices i') && q.includes('WHERE i.invoice_id = $1')) {
      const inv = this.student_invoices.find(i => i.invoice_id === params[0]);
      if (!inv) return { rows: [], rowCount: 0 };
      const st = this.students.find(s => s.student_id === inv.student_id) || {};
      const cls = this.classes.find(c => c.class_id === st.class_id) || {};
      const cat = this.fee_categories.find(c => c.fee_category_id === inv.fee_category_id) || {};
      return {
        rows: [{
          ...inv,
          student_name: st.name || st.full_name,
          nisn: st.nisn,
          class_id: cls.class_id,
          class_name: cls.class_name,
          fee_category_name: cat.name,
          remaining_amount: Number(inv.total_amount) - Number(inv.amount_paid)
        }],
        rowCount: 1
      };
    }
    if (q.includes('FROM student_invoices i') && q.includes('JOIN students s')) {
      let filtered = [...this.student_invoices];
      // Basic simulation of filters if needed
      const rows = filtered.map(inv => {
        const st = this.students.find(s => s.student_id === inv.student_id) || {};
        const cls = this.classes.find(c => c.class_id === st.class_id) || {};
        const cat = this.fee_categories.find(c => c.fee_category_id === inv.fee_category_id) || {};
        return {
          ...inv,
          student_name: st.name || st.full_name,
          nisn: st.nisn,
          class_id: cls.class_id,
          class_name: cls.class_name,
          fee_category_name: cat.name,
          remaining_amount: Number(inv.total_amount) - Number(inv.amount_paid)
        };
      });
      return { rows, rowCount: rows.length };
    }

    // Default empty result
    return { rows: [], rowCount: 0 };
  }

  async handleTransaction(callback) {
    const mockClient = {
      query: (text, params) => this.handleQuery(text, params)
    };
    return callback(mockClient);
  }
}

module.exports = new TestDbEngine();

