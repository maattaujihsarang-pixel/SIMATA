const studentAttendanceRepository = require('../repositories/student-attendance.repository');
const studentRepository = require('../repositories/student.repository');
const classRepository = require('../repositories/class.repository');
const academicYearRepository = require('../repositories/academic-year.repository');
const { withTransaction } = require('../config/database');
const { generateUUID } = require('../utils/id-generator.util');
const { getTodayISODate } = require('../utils/date.util');
const { BadRequestError, NotFoundError, ConflictError } = require('../errors');

const VALID_STATUSES = ['Hadir', 'Izin', 'Sakit', 'Alpa'];

function generateStudentAttendanceId(attendanceDate, period) {
  const dateCompact = attendanceDate.replace(/-/g, '');
  const timeCompact = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
  const shortHash = generateUUID().substring(0, 8);
  return `ATT-STD-${dateCompact}-${timeCompact}-P${period}-${shortHash}`;
}

class StudentAttendanceService {
  async recordSingleAttendance(data, recordedByUserId) {
    const { student_id, attendance_date, period, status, method, note } = data;

    if (!student_id || !attendance_date || period === undefined || !status) {
      throw new BadRequestError('student_id, attendance_date, period, dan status wajib diisi');
    }

    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status tidak valid. Nilai yang diperbolehkan: ${VALID_STATUSES.join(', ')}`);
    }

    const periodNum = parseInt(period, 10);
    if (isNaN(periodNum) || periodNum < 1 || periodNum > 10) {
      throw new BadRequestError('Period (jam pelajaran) harus berupa angka 1 sampai 10');
    }

    const student = await studentRepository.findById(student_id);
    if (!student) {
      throw new NotFoundError(`Siswa dengan ID '${student_id}' tidak ditemukan`);
    }

    const activeYear = await academicYearRepository.getActiveYear();
    if (!activeYear) {
      throw new BadRequestError('Tahun ajaran aktif belum dikonfigurasi');
    }

    // DUPLICATE CHECK: Disallow silent overwrite, enforce 409 Conflict
    const existing = await studentAttendanceRepository.findByBusinessKey(student_id, attendance_date, periodNum);
    if (existing) {
      throw new ConflictError(
        `Presensi siswa '${student.name}' pada tanggal ${attendance_date} untuk Jam ke-${periodNum} sudah tercatat. Tidak ada perubahan yang disimpan.`,
        'DUPLICATE_STUDENT_ATTENDANCE',
        { duplicate_periods: [periodNum], student_id, student_name: student.name }
      );
    }

    const attendanceId = generateStudentAttendanceId(attendance_date, periodNum);

    return studentAttendanceRepository.insertSingle({
      attendance_id: attendanceId,
      student_id,
      class_id: student.class_id,
      academic_year_id: activeYear.academic_year_id,
      attendance_date,
      period: periodNum,
      status,
      method: method || 'Manual',
      note: note || null,
      recorded_by_user_id: recordedByUserId
    });
  }

  async recordBatchAttendance(payload, recordedByUserId) {
    const { class_id, attendance_date, periods, attendances, method } = payload;

    if (!class_id || !attendance_date || !Array.isArray(periods) || periods.length === 0 || !Array.isArray(attendances)) {
      throw new BadRequestError('class_id, attendance_date, periods (array), dan attendances (array) wajib diisi');
    }

    const cls = await classRepository.findById(class_id);
    if (!cls) {
      throw new NotFoundError(`Kelas dengan ID '${class_id}' tidak ditemukan`);
    }

    const activeYear = await academicYearRepository.getActiveYear();
    if (!activeYear) {
      throw new BadRequestError('Tahun ajaran aktif belum dikonfigurasi');
    }

    const parsedPeriods = periods.map(p => {
      const num = parseInt(p, 10);
      if (isNaN(num) || num < 1 || num > 10) {
        throw new BadRequestError(`Period '${p}' tidak valid. Harus angka 1-10.`);
      }
      return num;
    });

    const studentIds = attendances.map(a => a.student_id);

    // Atomic All-or-Nothing Transaction
    return withTransaction(async (client) => {
      // 1. Atomic pre-check duplicate across all requested students and periods
      const duplicates = await studentAttendanceRepository.findExistingDuplicates(
        studentIds,
        attendance_date,
        parsedPeriods,
        client
      );

      if (duplicates.length > 0) {
        const dupDescriptions = duplicates.map(d => `${d.student_name} (Jam ke-${d.period})`).join(', ');
        throw new ConflictError(
          `Presensi siswa sudah tercatat untuk: ${dupDescriptions}. Tidak ada perubahan yang disimpan.`,
          'DUPLICATE_STUDENT_ATTENDANCE',
          { duplicates }
        );
      }

      // 2. Insert records atomically
      const inserted = [];
      for (const item of attendances) {
        if (!VALID_STATUSES.includes(item.status)) {
          throw new BadRequestError(`Status '${item.status}' untuk siswa ${item.student_id} tidak valid.`);
        }

        for (const periodNum of parsedPeriods) {
          const attendanceId = generateStudentAttendanceId(attendance_date, periodNum);
          const record = await studentAttendanceRepository.insertSingle({
            attendance_id: attendanceId,
            student_id: item.student_id,
            class_id,
            academic_year_id: activeYear.academic_year_id,
            attendance_date,
            period: periodNum,
            status: item.status,
            method: method || 'QR_BATCH',
            note: item.note || null,
            recorded_by_user_id: recordedByUserId
          }, client);
          inserted.push(record);
        }
      }

      return {
        total_inserted: inserted.length,
        class_id,
        attendance_date,
        periods: parsedPeriods,
        records: inserted
      };
    });
  }

  async recordQrAttendance(payload, recordedByUserId) {
    const { qr_code_id, period, status = 'Hadir', note } = payload;

    if (!qr_code_id || period === undefined) {
      throw new BadRequestError('qr_code_id dan period wajib diisi');
    }

    const student = await studentRepository.findByQrCodeId(qr_code_id);
    if (!student) {
      throw new NotFoundError(`Siswa dengan QR Code '${qr_code_id}' tidak ditemukan`);
    }

    const today = getTodayISODate();

    return this.recordSingleAttendance({
      student_id: student.student_id,
      attendance_date: today,
      period,
      status,
      method: 'QR',
      note
    }, recordedByUserId);
  }

  async getAttendanceList(filters) {
    return studentAttendanceRepository.findByFilters(filters);
  }

  async getAttendanceById(attendanceId) {
    const att = await studentAttendanceRepository.findById(attendanceId);
    if (!att) {
      throw new NotFoundError(`Presensi siswa dengan ID '${attendanceId}' tidak ditemukan`);
    }
    return att;
  }

  async updateAttendance(attendanceId, data, updatedByUserId) {
    const { status, note, period, attendance_date } = data;

    const existing = await studentAttendanceRepository.findById(attendanceId);
    if (!existing) {
      throw new NotFoundError(`Presensi siswa dengan ID '${attendanceId}' tidak ditemukan`);
    }

    if (status && !VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status tidak valid. Nilai yang diperbolehkan: ${VALID_STATUSES.join(', ')}`);
    }

    let parsedPeriod = existing.period;
    if (period !== undefined && period !== null && period !== '') {
      parsedPeriod = parseInt(period, 10);
      if (isNaN(parsedPeriod) || parsedPeriod < 1 || parsedPeriod > 10) {
        throw new BadRequestError('Period (jam pelajaran) harus berupa angka 1 sampai 10');
      }
    }

    const targetDate = attendance_date || existing.attendance_date;

    // Check conflict if period or date changed
    if (parsedPeriod !== existing.period || targetDate !== existing.attendance_date) {
      const duplicate = await studentAttendanceRepository.findByBusinessKey(
        existing.student_id,
        targetDate,
        parsedPeriod
      );
      if (duplicate && duplicate.attendance_id !== attendanceId) {
        throw new ConflictError(
          `Presensi siswa '${existing.student_name}' pada tanggal ${targetDate} untuk Jam ke-${parsedPeriod} sudah tercatat.`,
          'DUPLICATE_STUDENT_ATTENDANCE'
        );
      }
    }

    return studentAttendanceRepository.update(attendanceId, {
      status: status || existing.status,
      note: note !== undefined ? (note ? String(note).trim() : null) : existing.note,
      period: parsedPeriod,
      attendance_date: targetDate,
      recorded_by_user_id: updatedByUserId
    });
  }
}

module.exports = new StudentAttendanceService();

