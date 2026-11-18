const teacherRepository = require('../repositories/teacher.repository');
const classRepository = require('../repositories/class.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const academicYearRepository = require('../repositories/academic-year.repository');
const authSessionRepository = require('../repositories/auth-session.repository');
const { hashPassword } = require('../utils/password.util');
const { generateTeacherId, generateStudentId } = require('../utils/id-generator.util');
const { getTodayISODate } = require('../utils/date.util');
const xlsxUtil = require('../utils/xlsx.util');
const { NotFoundError, BadRequestError, ConflictError } = require('../errors');

const DEFAULT_KTS_SETTINGS = {
  header_arabic: 'بسم الله الرحمن الرحيم',
  school_name: 'MA AT-TAUJIH SARANG',
  school_address: 'Sarang, Rembang - Jawa Tengah',
  validity_text: 'Berlaku selama menjadi Siswa MA At-Taujih Sarang',
  line5_mode: 'dormitory',
  back_title: 'KETENTUAN KARTU TANDA SISWA',
  back_rules: [
    '1. Kartu ini adalah identitas resmi siswa aktif MA At-Taujih Sarang.',
    '2. Wajib dibawa setiap hari untuk presensi QR Code SIMATA.',
    '3. Dilarang meminjamkan atau memindahtangankan kartu ini kepada orang lain.',
    '4. Jika menemukan kartu ini, mohon kembalikan ke Kantor MA At-Taujih Sarang.'
  ].join('\n'),
  sign_city_date: 'Sarang, 18 November 2026',
  headmaster_name: 'Kepala Madrasah MA At-Taujih',
  headmaster_nip: 'NIP. -',
  custom_front_bg: '',
  custom_back_bg: '',
  signature_img: ''
};

function formatStudentDateOnlyISO(val) {
  if (!val) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(val);
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function formatIsoToIndoSlash(val) {
  const iso = formatStudentDateOnlyISO(val);
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function normalizeBirthDateInput(raw) {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slashMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashMatch) {
    const dd = slashMatch[1].padStart(2, '0');
    const mm = slashMatch[2].padStart(2, '0');
    const yyyy = slashMatch[3];
    const mo = parseInt(mm, 10);
    const dy = parseInt(dd, 10);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 10000 && serial < 80000) {
      const utcMs = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      return new Date(utcMs).toISOString().slice(0, 10);
    }
  }
  return undefined;
}

class MasterService {
  // ==========================================
  // ACADEMIC YEARS
  // ==========================================
  async getActiveAcademicYear() {
    const year = await academicYearRepository.getActiveYear();
    if (!year) {
      throw new NotFoundError('Tahun ajaran aktif belum dikonfigurasi');
    }
    return year;
  }

  async getAllAcademicYears() {
    return academicYearRepository.findAll();
  }

  // ==========================================
  // TEACHERS
  // ==========================================
  async getAllTeachers(status = null) {
    return teacherRepository.findAll({ status });
  }

  async getTeacherById(teacherId) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new NotFoundError(`Guru dengan ID '${teacherId}' tidak ditemukan`);
    }
    return teacher;
  }

  async createTeacher(data) {
    const name = data.name || data.full_name || data.fullName;
    const subject = data.subject || data.subject_specialty || data.subjectSpecialty;
    if (!name || !subject) {
      throw new BadRequestError('Nama guru dan mata pelajaran wajib diisi');
    }

    let teacherId = data.teacher_id || data.teacherId;
    if (!teacherId) {
      const seq = await teacherRepository.getNextSequence();
      teacherId = generateTeacherId(seq);
    }

    const existing = await teacherRepository.findById(teacherId);
    if (existing) {
      throw new ConflictError(`Guru dengan ID '${teacherId}' sudah terdaftar`);
    }

    return teacherRepository.create({
      ...data,
      name,
      subject,
      teacher_id: teacherId
    });
  }

  async updateTeacher(teacherId, data) {
    await this.getTeacherById(teacherId);
    return teacherRepository.update(teacherId, data);
  }

  async setTeacherStatus(teacherId, status) {
    if (!['Active', 'Inactive'].includes(status)) {
      throw new BadRequestError("Status harus bernilai 'Active' atau 'Inactive'");
    }
    await this.getTeacherById(teacherId);
    return teacherRepository.updateStatus(teacherId, status);
  }

  async deleteTeacher(teacherId) {
    await this.getTeacherById(teacherId);
    return teacherRepository.delete(teacherId);
  }

  // ==========================================
  // CLASSES
  // ==========================================
  async getAllClasses(status = null) {
    return classRepository.findAll({ status });
  }

  async getClassById(classId) {
    const cls = await classRepository.findById(classId);
    if (!cls) {
      throw new NotFoundError(`Kelas dengan ID '${classId}' tidak ditemukan`);
    }
    return cls;
  }

  /**
   * BUG 29 Resolution: Roster query with today's attendance status
   */
  async getClassRoster(classId, date = null) {
    await this.getClassById(classId);
    const attendanceDate = date || getTodayISODate();
    const rows = await classRepository.getRosterWithTodayAttendance(classId, attendanceDate);
    const seenStudentIds = new Set();
    return rows.filter(row => {
      if (!row || !row.student_id || seenStudentIds.has(row.student_id)) return false;
      seenStudentIds.add(row.student_id);
      return true;
    });
  }

  async ensureAcademicYear(academicYearId) {
    if (!academicYearId || !/^\d{4}\/\d{4}$/.test(String(academicYearId).trim())) {
      throw new BadRequestError('Format Tahun Ajaran harus YYYY/YYYY (contoh: 2026/2027)');
    }
    const cleanId = String(academicYearId).trim();
    const existing = await academicYearRepository.findById(cleanId);
    if (!existing) {
      await academicYearRepository.create({
        academic_year_id: cleanId,
        name: `Tahun Ajaran ${cleanId}`,
        is_active: false
      });
    }
    return cleanId;
  }

  async generateUniqueClassId(academicYearId, className, level) {
    const [y1, y2] = academicYearId.split('/');
    const yearCode = y1.slice(-2) + y2.slice(-2);
    const cleanedName = String(className || '')
      .replace(/^\s*kelas\s+/i, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .toUpperCase();
    const rawSlug = cleanedName || String(level);
    const prefix = `CLS-${yearCode}-`; // 9 chars, total max 20 chars
    const maxSlugLen = 20 - prefix.length;

    const baseCandidate = `${prefix}${rawSlug.slice(0, maxSlugLen)}`;
    if (!(await classRepository.findById(baseCandidate))) {
      return baseCandidate;
    }

    for (let i = 2; i <= 99; i++) {
      const suffix = `-${i}`;
      const candidate = `${prefix}${rawSlug.slice(0, maxSlugLen - suffix.length)}${suffix}`;
      if (!(await classRepository.findById(candidate))) {
        return candidate;
      }
    }

    const randomTail = Date.now().toString(36).toUpperCase().slice(-4);
    return `${prefix}${rawSlug.slice(0, maxSlugLen - 5)}-${randomTail}`;
  }

  async createClass(data) {
    const className = String(data.class_name || data.className || '').trim();
    const rawLevel = data.level !== undefined && data.level !== null ? String(data.level).trim() : '';
    const rawYear = String(data.academic_year_id || data.academicYear || '').trim();
    const parsedLevel = parseInt(rawLevel, 10);

    if (!className || !rawLevel || !rawYear) {
      throw new BadRequestError('Nama Kelas, Tingkat (10/11/12), dan Tahun Ajaran wajib diisi');
    }
    if (![10, 11, 12].includes(parsedLevel)) {
      throw new BadRequestError('Tingkat kelas harus bernilai 10, 11, atau 12');
    }

    const academicYearId = await this.ensureAcademicYear(rawYear);
    let classId = String(data.class_id || data.classId || '').trim();

    if (classId) {
      const existing = await classRepository.findById(classId);
      if (existing) {
        throw new ConflictError(`Kelas dengan ID '${classId}' sudah ada`);
      }
    } else {
      classId = await this.generateUniqueClassId(academicYearId, className, parsedLevel);
    }

    return classRepository.create({
      class_id: classId,
      class_name: className,
      level: parsedLevel,
      academic_year_id: academicYearId,
      homeroom_teacher_id: data.homeroom_teacher_id || data.homeroomTeacherId || null,
      status: data.status || 'Active'
    });
  }

  async updateClass(classId, data) {
    await this.getClassById(classId);

    const payload = { ...data };
    if (payload.level !== undefined && payload.level !== null && payload.level !== '') {
      const parsedLevel = parseInt(String(payload.level).trim(), 10);
      if (![10, 11, 12].includes(parsedLevel)) {
        throw new BadRequestError('Tingkat kelas harus bernilai 10, 11, atau 12');
      }
      payload.level = parsedLevel;
    }
    if (payload.academic_year_id || payload.academicYear) {
      payload.academic_year_id = await this.ensureAcademicYear(payload.academic_year_id || payload.academicYear);
    }
    if ('homeroom_teacher_id' in payload || 'homeroomTeacherId' in payload) {
      payload.homeroom_teacher_id = payload.homeroom_teacher_id || payload.homeroomTeacherId || null;
    }

    return classRepository.update(classId, payload);
  }

  async setClassStatus(classId, status) {
    if (!['Active', 'Inactive'].includes(status)) {
      throw new BadRequestError("Status harus bernilai 'Active' atau 'Inactive'");
    }
    await this.getClassById(classId);
    return classRepository.updateStatus(classId, status);
  }

  // ==========================================
  // STUDENTS
  // ==========================================
  async getAllStudents({ classId = null, status = null, search = null } = {}) {
    return studentRepository.findAll({ classId, status, search });
  }

  async getStudentById(studentId) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Siswa dengan ID '${studentId}' tidak ditemukan`);
    }
    return student;
  }

  async getStudentByQr(qrCodeId) {
    if (!qrCodeId) {
      throw new BadRequestError('QR Code ID wajib diisi');
    }
    const student = await studentRepository.findByQrCodeId(qrCodeId);
    if (!student) {
      throw new NotFoundError(`Siswa dengan QR Code '${qrCodeId}' tidak ditemukan`);
    }
    return student;
  }

  async createStudent(data) {
    if (!data.name || !data.class_id || !data.qr_code_id) {
      throw new BadRequestError('Nama siswa, Kelas, dan QR Code ID wajib diisi');
    }

    // Check class exists
    await this.getClassById(data.class_id);

    // Check QR uniqueness
    const existingQr = await studentRepository.findByQrCodeId(data.qr_code_id);
    if (existingQr) {
      throw new ConflictError(`QR Code '${data.qr_code_id}' sudah digunakan oleh siswa ${existingQr.name}`);
    }

    let studentId = data.student_id;
    if (!studentId) {
      const cls = await classRepository.findById(data.class_id);
      const seq = await studentRepository.getNextSequence(cls.level || 10);
      studentId = generateStudentId(seq, cls.level || 10);
    }

    const existing = await studentRepository.findById(studentId);
    if (existing) {
      throw new ConflictError(`Siswa dengan ID '${studentId}' sudah terdaftar`);
    }

    return studentRepository.create({
      ...data,
      student_id: studentId,
      birth_place: data.birth_place !== undefined ? (data.birth_place || null) : (data.birthPlace || null),
      address: data.address !== undefined ? (data.address || null) : null,
      dormitory: data.dormitory !== undefined ? (data.dormitory || null) : null
    });
  }

  async updateStudent(studentId, data) {
    const existing = await this.getStudentById(studentId);

    const nextClassId = data.class_id || data.classId || existing.class_id;
    if (nextClassId && nextClassId !== existing.class_id) {
      await this.getClassById(nextClassId);
    }

    const nextQr = data.qr_code_id || data.qrCodeId || existing.qr_code_id;
    if (nextQr && nextQr !== existing.qr_code_id) {
      const existingQr = await studentRepository.findByQrCodeId(nextQr);
      if (existingQr && existingQr.student_id !== studentId) {
        throw new ConflictError(`QR Code '${nextQr}' sudah digunakan oleh siswa lain`);
      }
    }

    const resolveField = (val, fallback) => (val === undefined ? fallback : (val === '' ? null : val));
    const rawBirthDate = data.birth_date !== undefined ? data.birth_date : data.birthDate;
    const rawBirthPlace = data.birth_place !== undefined ? data.birth_place : data.birthPlace;

    return studentRepository.update(studentId, {
      class_id: nextClassId,
      name: data.name ? String(data.name).trim() : existing.name,
      gender: resolveField(data.gender, existing.gender),
      nis: resolveField(data.nis, existing.nis),
      nisn: resolveField(data.nisn, existing.nisn),
      birth_date: resolveField(rawBirthDate, existing.birth_date),
      birth_place: resolveField(rawBirthPlace, existing.birth_place),
      address: resolveField(data.address, existing.address),
      dormitory: resolveField(data.dormitory, existing.dormitory),
      qr_code_id: nextQr,
      status: data.status || existing.status || 'Active'
    });
  }

  async setStudentStatus(studentId, status) {
    if (!['Active', 'Inactive'].includes(status)) {
      throw new BadRequestError("Status harus bernilai 'Active' atau 'Inactive'");
    }
    await this.getStudentById(studentId);
    return studentRepository.updateStatus(studentId, status);
  }

  async deleteStudent(studentId) {
    await this.getStudentById(studentId);
    return studentRepository.delete(studentId);
  }

  async generateKtsTemplateBuffer({ classId = null, status = 'Active' } = {}) {
    const resolvedStatus = status === 'all' ? null : (status || 'Active');
    const students = await studentRepository.findAll({
      classId: classId || null,
      status: resolvedStatus
    });

    const headers = [
      'ID Siswa',
      'NIS',
      'NISN',
      'Nama Lengkap',
      'Kelas',
      'Tanggal Lahir (DD/MM/YYYY)',
      'Tempat Lahir',
      'Alamat Lengkap',
      'Pondok / Asrama'
    ];

    const sorted = [...students].sort((a, b) => {
      const clsCmp = String(a.class_name || a.class_id || '').localeCompare(String(b.class_name || b.class_id || ''));
      if (clsCmp !== 0) return clsCmp;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    const rows = sorted.map(s => [
      s.student_id || '',
      s.nis || '',
      s.nisn || '',
      s.name || '',
      s.class_name || s.class_id || '',
      formatIsoToIndoSlash(s.birth_date),
      s.birth_place || '',
      s.address || '',
      s.dormitory || ''
    ]);

    return xlsxUtil.buildXlsxBuffer(headers, rows, 'Data KTS Siswa');
  }

  async importKtsData({ buffer = null, filename = '', rows = null } = {}) {
    let parsedRows = Array.isArray(rows) ? rows : null;
    if (!parsedRows) {
      if (!buffer) {
        throw new BadRequestError('File Excel (.xlsx / .csv) wajib diunggah.');
      }
      const parsed = xlsxUtil.parseXlsxOrCsvBuffer(buffer, filename);
      parsedRows = parsed.rows || [];
    }

    if (!parsedRows.length) {
      throw new BadRequestError('Tidak ada baris data siswa di dalam berkas yang diunggah.');
    }

    const allStudents = await studentRepository.findAll({});
    const byId = new Map();
    const byNis = new Map();
    const byNisn = new Map();
    for (const s of allStudents) {
      if (s.student_id) byId.set(String(s.student_id).trim(), s);
      if (s.nis) byNis.set(String(s.nis).trim(), s);
      if (s.nisn) byNisn.set(String(s.nisn).trim(), s);
    }

    const pickVal = (obj, keys) => {
      for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
          return String(obj[k]).trim();
        }
      }
      return '';
    };

    const updatedIds = [];
    let skippedCount = 0;

    for (const row of parsedRows) {
      if (!row || typeof row !== 'object') {
        skippedCount++;
        continue;
      }

      const sid = pickVal(row, ['id_siswa', 'student_id', 'ID Siswa', 'id']);
      const rowNis = pickVal(row, ['nis', 'NIS']);
      const rowNisn = pickVal(row, ['nisn', 'NISN']);

      const matched =
        (sid && byId.get(sid)) ||
        (rowNis && byNis.get(rowNis)) ||
        (rowNisn && byNisn.get(rowNisn)) ||
        null;

      if (!matched) {
        skippedCount++;
        continue;
      }

      const birthPlace = pickVal(row, ['tempat_lahir', 'birth_place', 'Tempat Lahir']);
      const address = pickVal(row, ['alamat_lengkap', 'alamat', 'address', 'Alamat Lengkap', 'Alamat']);
      const dormitory = pickVal(row, ['pondok_asrama', 'pondok', 'asrama', 'dormitory', 'Pondok / Asrama', 'Pondok']);
      const rawBirthDate = pickVal(row, ['tanggal_lahir', 'tgl_lahir', 'birth_date', 'Tanggal Lahir (DD/MM/YYYY)', 'Tanggal Lahir']);
      const normalizedBirthDate = rawBirthDate ? normalizeBirthDateInput(rawBirthDate) : undefined;

      const updatePayload = {};
      if (birthPlace) updatePayload.birth_place = birthPlace;
      if (address) updatePayload.address = address;
      if (dormitory) updatePayload.dormitory = dormitory;
      if (normalizedBirthDate) updatePayload.birth_date = normalizedBirthDate;
      if (rowNis) updatePayload.nis = rowNis;
      if (rowNisn) updatePayload.nisn = rowNisn;

      if (Object.keys(updatePayload).length === 0) {
        skippedCount++;
        continue;
      }

      await this.updateStudent(matched.student_id, updatePayload);
      updatedIds.push(matched.student_id);
    }

    return {
      total_rows: parsedRows.length,
      updated_count: updatedIds.length,
      skipped_count: skippedCount,
      updated_ids: updatedIds
    };
  }

  async getKtsSettings() {
    const stored = await studentRepository.getKtsSettings();
    return {
      ...DEFAULT_KTS_SETTINGS,
      ...stored
    };
  }

  async updateKtsSettings(payload = {}) {
    const allowedKeys = Object.keys(DEFAULT_KTS_SETTINGS);
    for (const key of allowedKeys) {
      if (key in payload && payload[key] !== undefined) {
        const val = payload[key] === null ? '' : String(payload[key]);
        if (['custom_front_bg', 'custom_back_bg', 'signature_img'].includes(key) && val && !val.startsWith('data:image/')) {
          throw new BadRequestError(`Format gambar tidak valid untuk ${key}`);
        }
        await studentRepository.upsertKtsSetting(key, val);
      }
    }
    return this.getKtsSettings();
  }

  // ==========================================
  // USERS (OPERATOR / ADMIN ACCOUNTS)
  // ==========================================
  async getAllUsers() {
    return userRepository.findAll();
  }

  async getUserById(userId) {
    let user = null;
    if (/^\d+$/.test(String(userId).trim())) {
      user = await userRepository.findById(parseInt(userId, 10));
    }
    if (!user) {
      user = await userRepository.findByUsername(String(userId).trim());
    }
    if (!user) {
      throw new NotFoundError(`Pengguna dengan ID '${userId}' tidak ditemukan`);
    }
    return user;
  }

  async createUser(data) {
    if (!data.username || !data.password || !data.full_name || !data.role) {
      throw new BadRequestError('Username, password, nama lengkap, dan peran wajib diisi');
    }

    const normalizedRole = data.role.trim().toUpperCase().replace(/\s+/g, '_');
    const allowedRoles = ['ADMIN', 'GURU', 'BENDAHARA', 'ORANG_TUA'];
    if (!allowedRoles.includes(normalizedRole)) {
      throw new BadRequestError(`Peran harus bernilai salah satu dari: ${allowedRoles.join(', ')}`);
    }

    const existing = await userRepository.findByUsername(data.username);
    if (existing) {
      throw new ConflictError(`Username '${data.username}' sudah digunakan`);
    }

    if (data.teacher_id) {
      await this.getTeacherById(data.teacher_id);
    }

    const passwordHash = await hashPassword(data.password);

    return userRepository.create({
      username: data.username,
      password_hash: passwordHash,
      full_name: data.full_name,
      role: normalizedRole,
      status: data.status || 'Active',
      teacher_id: data.teacher_id || null,
      must_change_password: data.must_change_password || false
    });
  }

  async updateUser(userId, data = {}, currentUserId = null) {
    const user = await this.getUserById(userId);
    const updateFields = {
      teacher_id: user.teacher_id ?? null
    };

    if (data.username !== undefined && data.username !== null) {
      const trimmedUsername = String(data.username).trim();
      if (!trimmedUsername) {
        throw new BadRequestError('Username tidak boleh kosong');
      }
      if (trimmedUsername !== user.username) {
        const existing = await userRepository.findByUsername(trimmedUsername);
        if (existing && Number(existing.user_id) !== Number(user.user_id)) {
          throw new ConflictError(`Username '${trimmedUsername}' sudah digunakan`);
        }
      }
      updateFields.username = trimmedUsername;
    }

    if (data.full_name !== undefined && data.full_name !== null) {
      const trimmedFullName = String(data.full_name).trim();
      if (!trimmedFullName) {
        throw new BadRequestError('Nama lengkap tidak boleh kosong');
      }
      updateFields.full_name = trimmedFullName;
    }

    if (data.role) {
      const normalizedRole = data.role.trim().toUpperCase().replace(/\s+/g, '_');
      const allowedRoles = ['ADMIN', 'GURU', 'BENDAHARA', 'ORANG_TUA'];
      if (!allowedRoles.includes(normalizedRole)) {
        throw new BadRequestError(`Peran harus bernilai salah satu dari: ${allowedRoles.join(', ')}`);
      }
      updateFields.role = normalizedRole;
    }

    if (data.status !== undefined && data.status !== null && String(data.status).trim() !== '') {
      const rawStatus = String(data.status).trim().toLowerCase();
      if (rawStatus !== 'active' && rawStatus !== 'inactive') {
        throw new BadRequestError('Status pengguna harus bernilai Active atau Inactive');
      }
      updateFields.status = rawStatus === 'active' ? 'Active' : 'Inactive';
    }

    if (data.teacher_id !== undefined) {
      if (data.teacher_id) {
        await this.getTeacherById(data.teacher_id);
        updateFields.teacher_id = data.teacher_id;
      } else {
        updateFields.teacher_id = null;
      }
    }

    if (data.password !== undefined && data.password !== null && String(data.password) !== '') {
      const trimmedPassword = String(data.password).trim();
      if (!trimmedPassword) {
        throw new BadRequestError('Password baru tidak boleh hanya berisi spasi');
      }
      updateFields.password_hash = await hashPassword(trimmedPassword);
    }

    if (data.must_change_password !== undefined) {
      updateFields.must_change_password = Boolean(data.must_change_password);
    } else if (updateFields.password_hash) {
      updateFields.must_change_password = false;
    }

    const updated = await userRepository.update(user.user_id, updateFields);

    const usernameChanged = Boolean(updateFields.username && updateFields.username !== user.username);
    const passwordChanged = Boolean(updateFields.password_hash);
    const deactivated = Boolean(updateFields.status && updateFields.status !== 'Active' && user.status === 'Active');
    const isSelf = Boolean(
      currentUserId !== null &&
      currentUserId !== undefined &&
      Number(user.user_id) === Number(currentUserId)
    );
    const requiresRelogin = Boolean(isSelf && (usernameChanged || passwordChanged || deactivated));

    if (passwordChanged || deactivated || requiresRelogin) {
      await authSessionRepository.revokeAllUserSessions(user.user_id);
    }

    if (updated) {
      Object.defineProperty(updated, '_requiresRelogin', {
        value: requiresRelogin,
        enumerable: false
      });
    }

    return updated;
  }

  async deleteUser(userId, currentUserId) {
    const user = await this.getUserById(userId);

    if (parseInt(user.user_id, 10) === parseInt(currentUserId, 10)) {
      throw new BadRequestError('Anda tidak dapat menghapus akun Anda sendiri (Self-Delete Guard)');
    }

    // Revoke all sessions for this user first
    await authSessionRepository.revokeAllUserSessions(user.user_id);
    return userRepository.delete(user.user_id);
  }
}

module.exports = new MasterService();

