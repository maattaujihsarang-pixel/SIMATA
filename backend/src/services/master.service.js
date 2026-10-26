const teacherRepository = require('../repositories/teacher.repository');
const classRepository = require('../repositories/class.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const academicYearRepository = require('../repositories/academic-year.repository');
const authSessionRepository = require('../repositories/auth-session.repository');
const { hashPassword } = require('../utils/password.util');
const { generateTeacherId, generateStudentId } = require('../utils/id-generator.util');
const { getTodayISODate } = require('../utils/date.util');
const { NotFoundError, BadRequestError, ConflictError } = require('../errors');

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
    const name = data.name || data.full_name;
    const subject = data.subject || data.subject_specialty;
    if (!name || !subject) {
      throw new BadRequestError('Nama guru dan mata pelajaran wajib diisi');
    }

    let teacherId = data.teacher_id;
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
    return classRepository.getRosterWithTodayAttendance(classId, attendanceDate);
  }

  async createClass(data) {
    if (!data.class_id || !data.class_name || !data.level || !data.academic_year_id) {
      throw new BadRequestError('ID Kelas, Nama Kelas, Tingkat (10/11/12), dan Tahun Ajaran wajib diisi');
    }

    const existing = await classRepository.findById(data.class_id);
    if (existing) {
      throw new ConflictError(`Kelas dengan ID '${data.class_id}' sudah ada`);
    }

    return classRepository.create(data);
  }

  async updateClass(classId, data) {
    await this.getClassById(classId);
    return classRepository.update(classId, data);
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
      student_id: studentId
    });
  }

  async updateStudent(studentId, data) {
    await this.getStudentById(studentId);

    if (data.class_id) {
      await this.getClassById(data.class_id);
    }

    if (data.qr_code_id) {
      const existingQr = await studentRepository.findByQrCodeId(data.qr_code_id);
      if (existingQr && existingQr.student_id !== studentId) {
        throw new ConflictError(`QR Code '${data.qr_code_id}' sudah digunakan oleh siswa lain`);
      }
    }

    return studentRepository.update(studentId, data);
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

    const normalizedRole = data.role.toUpperCase();
    if (!['ADMIN', 'GURU'].includes(normalizedRole)) {
      throw new BadRequestError("Peran harus bernilai 'ADMIN' atau 'GURU'");
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

  async updateUser(userId, data) {
    const user = await this.getUserById(userId);

    if (data.role) {
      const normalizedRole = data.role.toUpperCase();
      if (!['ADMIN', 'GURU'].includes(normalizedRole)) {
        throw new BadRequestError("Peran harus bernilai 'ADMIN' atau 'GURU'");
      }
      data.role = normalizedRole;
    }

    if (data.teacher_id) {
      await this.getTeacherById(data.teacher_id);
    }

    return userRepository.update(user.user_id, data);
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

