const teacherAttendanceRepository = require('../repositories/teacher-attendance.repository');
const teacherRepository = require('../repositories/teacher.repository');
const classRepository = require('../repositories/class.repository');
const academicYearRepository = require('../repositories/academic-year.repository');
const evidenceService = require('./evidence.service');
const { withTransaction } = require('../config/database');
const { generateUUID } = require('../utils/id-generator.util');
const { getTodayISODate } = require('../utils/date.util');
const { BadRequestError, NotFoundError, ConflictError } = require('../errors');
const logger = require('../utils/logger.util');

const VALID_STATUSES = ['Hadir', 'Izin', 'Sakit', 'TugasLuar'];

function generateTeacherAttendanceId(attendanceDate, period) {
  const dateCompact = attendanceDate.replace(/-/g, '');
  const timeCompact = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
  const shortHash = generateUUID().substring(0, 8);
  return `ATT-TCH-${dateCompact}-${timeCompact}-P${period}-${shortHash}`;
}

class TeacherAttendanceService {
  /**
   * Multi-Hour Teacher Attendance with Single Photo Evidence (F-P5-005)
   */
  async recordTeacherAttendanceWithEvidence(payload, file, operatorUserId) {
    const {
      teacher_id, class_id, subject, materi, periods,
      attendance_date, session_id, status = 'Hadir', note
    } = payload;

    if (!teacher_id || !class_id || !subject || !materi || !session_id) {
      throw new BadRequestError('teacher_id, class_id, subject, materi, dan session_id wajib diisi');
    }

    if (!file || !file.buffer) {
      throw new BadRequestError('Foto bukti verifikasi presensi guru wajib diunggah');
    }

    const targetDate = attendance_date || getTodayISODate();

    // Parse periods
    let parsedPeriods = [];
    if (Array.isArray(periods)) {
      parsedPeriods = periods.map(p => parseInt(p, 10));
    } else if (typeof periods === 'string') {
      try {
        const parsed = JSON.parse(periods);
        parsedPeriods = Array.isArray(parsed) ? parsed.map(p => parseInt(p, 10)) : [parseInt(periods, 10)];
      } catch (_) {
        parsedPeriods = periods.split(',').map(p => parseInt(p.trim(), 10));
      }
    } else if (typeof periods === 'number') {
      parsedPeriods = [periods];
    }

    if (parsedPeriods.length === 0 || parsedPeriods.some(p => isNaN(p) || p < 1 || p > 10)) {
      throw new BadRequestError('Jam pelajaran (periods) harus berupa array angka 1 sampai 10');
    }

    // Deduplicate periods array if duplicates passed
    parsedPeriods = [...new Set(parsedPeriods)].sort((a, b) => a - b);

    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status tidak valid. Nilai yang diperbolehkan: ${VALID_STATUSES.join(', ')}`);
    }

    // Validate master entities
    const teacher = await teacherRepository.findById(teacher_id);
    if (!teacher) {
      throw new NotFoundError(`Guru dengan ID '${teacher_id}' tidak ditemukan`);
    }

    const cls = await classRepository.findById(class_id);
    if (!cls) {
      throw new NotFoundError(`Kelas dengan ID '${class_id}' tidak ditemukan`);
    }

    const activeYear = await academicYearRepository.getActiveYear();
    if (!activeYear) {
      throw new BadRequestError('Tahun ajaran aktif belum dikonfigurasi');
    }

    // 1. Pre-check Duplicate before doing any storage write
    const existingDuplicates = await teacherAttendanceRepository.findExistingDuplicates(
      teacher_id,
      targetDate,
      parsedPeriods
    );

    if (existingDuplicates.length > 0) {
      const dupPeriods = existingDuplicates.map(d => `Jam ke-${d.period}${d.class_name ? ` (${d.class_name})` : ''}`).join(', ');
      throw new ConflictError(
        `Presensi guru ${teacher.name} untuk tanggal ${targetDate} pada ${dupPeriods} sudah tercatat. Tidak ada perubahan yang disimpan.`,
        'DUPLICATE_TEACHER_ATTENDANCE',
        { duplicate_periods: existingDuplicates.map(d => d.period) }
      );
    }

    // Check if target class + date + period slot is already occupied by another teacher
    const classDuplicates = await teacherAttendanceRepository.findClassPeriodDuplicates(
      class_id,
      targetDate,
      parsedPeriods
    );

    if (classDuplicates.length > 0) {
      const conflictDetails = classDuplicates
        .map(d => `Jam ke-${d.period} (${d.teacher_name}${d.subject ? ` - ${d.subject}` : ''})`)
        .join(', ');
      throw new ConflictError(
        `Presensi pada kelas ${cls.class_name} tanggal ${targetDate} untuk [${conflictDetails}] sudah terisi. Tidak dapat menyimpan data presensi ganda pada jam pelajaran yang sama.`,
        'DUPLICATE_TEACHER_ATTENDANCE',
        {
          duplicate_periods: classDuplicates.map(d => d.period),
          conflicts: classDuplicates.map(d => ({
            period: d.period,
            teacher_id: d.teacher_id,
            teacher_name: d.teacher_name,
            subject: d.subject
          }))
        }
      );
    }

    // 2. Storage Write (1 physical file for all requested periods)
    const savedFile = await evidenceService.uploadFile({
      buffer: file.buffer,
      originalName: file.originalname || 'teacher_attendance.jpg',
      mimeType: file.mimetype || 'image/jpeg'
    });

    // 3. Database Transaction with Compensating Cleanup Guard
    try {
      const result = await withTransaction(async (client) => {
        // Double-check teacher & class-period duplicates inside transaction lock
        const txDuplicates = await teacherAttendanceRepository.findExistingDuplicates(
          teacher_id,
          targetDate,
          parsedPeriods,
          client
        );

        if (txDuplicates.length > 0) {
          const dupPeriods = txDuplicates.map(d => `Jam ke-${d.period}${d.class_name ? ` (${d.class_name})` : ''}`).join(', ');
          throw new ConflictError(
            `Presensi guru ${teacher.name} untuk tanggal ${targetDate} pada ${dupPeriods} sudah tercatat.`,
            'DUPLICATE_TEACHER_ATTENDANCE',
            { duplicate_periods: txDuplicates.map(d => d.period) }
          );
        }

        const txClassDuplicates = await teacherAttendanceRepository.findClassPeriodDuplicates(
          class_id,
          targetDate,
          parsedPeriods,
          null,
          client
        );

        if (txClassDuplicates.length > 0) {
          const conflictDetails = txClassDuplicates
            .map(d => `Jam ke-${d.period} (${d.teacher_name}${d.subject ? ` - ${d.subject}` : ''})`)
            .join(', ');
          throw new ConflictError(
            `Presensi pada kelas ${cls.class_name} tanggal ${targetDate} untuk [${conflictDetails}] sudah terisi. Tidak dapat menyimpan data presensi ganda pada jam pelajaran yang sama.`,
            'DUPLICATE_TEACHER_ATTENDANCE',
            { duplicate_periods: txClassDuplicates.map(d => d.period) }
          );
        }

        const attendanceRecords = [];
        const evidenceRecords = [];

        for (const p of parsedPeriods) {
          const attendanceId = generateTeacherAttendanceId(targetDate, p);

          // Insert teacher attendance record
          const att = await teacherAttendanceRepository.insertSingle({
            attendance_id: attendanceId,
            teacher_id,
            class_id,
            academic_year_id: activeYear.academic_year_id,
            attendance_date: targetDate,
            period: p,
            subject,
            materi,
            status,
            method: 'Camera',
            recorded_at: new Date().toISOString(),
            note: note || null,
            recorded_by_user_id: operatorUserId
          }, client);
          attendanceRecords.push(att);

          // Insert evidence metadata pointing to the same file_id
          const evid = await evidenceService.createEvidenceRecord({
            sessionId: session_id,
            operatorUserId,
            fileId: savedFile.fileId,
            fileUrl: savedFile.fileUrl,
            attendanceId: att.attendance_id,
            storageProvider: savedFile.storageProvider,
            mimeType: file.mimetype || 'image/jpeg',
            capturedAt: new Date().toISOString()
          }, client);
          evidenceRecords.push(evid);
        }

        return {
          total_periods: parsedPeriods.length,
          teacher_id,
          class_id,
          attendance_date: targetDate,
          periods: parsedPeriods,
          file: savedFile,
          attendances: attendanceRecords,
          evidences: evidenceRecords
        };
      });

      return result;
    } catch (dbError) {
      // 4. Compensating Cleanup: Delete physical file if database transaction fails
      logger.warn(`Compensating cleanup triggered for file ${savedFile.fileId} due to DB error: ${dbError.message}`);
      await evidenceService.deleteFile(savedFile.fileId);
      throw dbError;
    }
  }

  async getAttendanceList(filters) {
    return teacherAttendanceRepository.findByFilters(filters);
  }

  async getAttendanceById(attendanceId) {
    const att = await teacherAttendanceRepository.findById(attendanceId);
    if (!att) {
      throw new NotFoundError(`Presensi guru dengan ID '${attendanceId}' tidak ditemukan`);
    }
    return att;
  }

  async updateAttendance(attendanceId, data, updatedByUserId) {
    const { status, subject, materi, note, period, class_id, attendance_date } = data;

    const existing = await teacherAttendanceRepository.findById(attendanceId);
    if (!existing) {
      throw new NotFoundError(`Presensi guru dengan ID '${attendanceId}' tidak ditemukan`);
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

    if (subject !== undefined && !String(subject).trim()) {
      throw new BadRequestError('Mata pelajaran tidak boleh kosong');
    }

    if (materi !== undefined && !String(materi).trim()) {
      throw new BadRequestError('Materi pelajaran tidak boleh kosong');
    }

    const targetDate = attendance_date || existing.attendance_date;
    const targetClassId = class_id || existing.class_id;

    let targetClass = null;
    if (targetClassId !== existing.class_id) {
      targetClass = await classRepository.findById(targetClassId);
      if (!targetClass) {
        throw new NotFoundError(`Kelas dengan ID '${targetClassId}' tidak ditemukan`);
      }
    }

    // Check teacher-slot conflict (same teacher + date + period, excluding current record)
    const duplicate = await teacherAttendanceRepository.findByBusinessKey(
      existing.teacher_id,
      targetDate,
      parsedPeriod
    );
    if (duplicate && duplicate.attendance_id !== attendanceId) {
      throw new ConflictError(
        `Presensi guru ${existing.teacher_name} untuk tanggal ${targetDate} pada Jam ke-${parsedPeriod} sudah tercatat.`,
        'DUPLICATE_TEACHER_ATTENDANCE'
      );
    }

    // Check class-slot conflict (same class + date + period occupied by another record)
    const classSlotRows = await teacherAttendanceRepository.findByClassDatePeriod(
      targetClassId,
      targetDate,
      parsedPeriod
    );
    const classConflict = classSlotRows.find(r => r.attendance_id !== attendanceId);
    if (classConflict) {
      const className = (targetClass && targetClass.class_name) || classConflict.class_name || existing.class_name || targetClassId;
      throw new ConflictError(
        `Presensi pada kelas ${className} tanggal ${targetDate} untuk Jam ke-${parsedPeriod} sudah terisi oleh ${classConflict.teacher_name}${classConflict.subject ? ` (${classConflict.subject})` : ''}. Tidak dapat menyimpan data presensi ganda pada jam pelajaran yang sama.`,
        'DUPLICATE_TEACHER_ATTENDANCE'
      );
    }

    return teacherAttendanceRepository.update(attendanceId, {
      status: status || existing.status,
      subject: subject !== undefined ? String(subject).trim() : existing.subject,
      materi: materi !== undefined ? String(materi).trim() : existing.materi,
      note: note !== undefined ? (note ? String(note).trim() : null) : existing.note,
      period: parsedPeriod,
      class_id: targetClassId,
      attendance_date: targetDate,
      recorded_by_user_id: updatedByUserId
    });
  }
}

module.exports = new TeacherAttendanceService();

