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
      const t = { teacher_id: params[0], name: params[1], position: params[2], status: params[3], subject: params[4] };
      this.teachers.push(t);
      return { rows: [t], rowCount: 1 };
    }
    if (q.startsWith('UPDATE teachers') && q.includes('status = $2')) {
      const t = this.teachers.find(t => t.teacher_id === params[0]);
      if (t) t.status = params[1];
      return { rows: t ? [t] : [], rowCount: t ? 1 : 0 };
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

