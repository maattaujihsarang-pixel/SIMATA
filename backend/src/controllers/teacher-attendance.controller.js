const teacherAttendanceService = require('../services/teacher-attendance.service');
const { ForbiddenError } = require('../errors');

class TeacherAttendanceController {
  async recordWithEvidence(req, res, next) {
    try {
      const result = await teacherAttendanceService.recordTeacherAttendanceWithEvidence(
        req.body,
        req.file,
        req.user.user_id,
        req.user?.role || 'ADMIN',
        req.user?.teacher_id || null
      );
      const statusLabel = req.body.status || 'Hadir';
      const msg = result.file
        ? `Presensi guru untuk ${result.total_periods} jam berhasil dicatat dengan bukti foto`
        : `Presensi guru (${statusLabel}) untuk ${result.total_periods} jam berhasil dicatat`;
      return res.status(201).json({
        status: 'success',
        message: msg,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req, res, next) {
    try {
      const { date, teacher_id, class_id, period, status, subject, academic_year_id, academicYear } = req.query;
      const attendances = await teacherAttendanceService.getAttendanceList({
        date,
        teacherId: teacher_id,
        classId: class_id,
        period: period ? parseInt(period, 10) : null,
        status: status || null,
        subject: subject || null,
        academicYearId: academic_year_id || academicYear || null
      });
      return res.status(200).json({
        status: 'success',
        data: attendances
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const attendance = await teacherAttendanceService.getAttendanceById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data: attendance
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const result = await teacherAttendanceService.updateAttendance(
        req.params.id,
        req.body,
        req.user.user_id,
        req.user?.role || 'ADMIN'
      );
      return res.status(200).json({
        status: 'success',
        message: 'Presensi guru berhasil diperbarui',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async runAutoAlpa(req, res, next) {
    try {
      if (String(req.user?.role || '').toUpperCase() !== 'ADMIN') {
        throw new ForbiddenError('Hanya Admin / Operator yang dapat menjalankan proses Auto-Alpa guru');
      }
      const date = req.body?.date || req.query?.date || null;
      const time_wib = req.body?.time_wib || null;
      const force = req.body?.force !== undefined ? Boolean(req.body.force) : true;
      const result = await teacherAttendanceService.runAutoAlpaForDate({
        date,
        time_wib,
        force,
        operatorUserId: req.user?.user_id || null
      });
      const msg = result.skipped
        ? (result.message || `Pemeriksaan Auto-Alpa dilewati (${result.reason}).`)
        : (result.created_count > 0
            ? `Auto-Alpa selesai: ${result.created_count} sesi guru pada ${result.date} ditandai Alpa.`
            : `Semua guru terjadwal KBM pada ${result.date} sudah memiliki catatan presensi.`);
      return res.status(200).json({
        status: 'success',
        message: msg,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async getAutoAlpaConfig(req, res, next) {
    try {
      if (String(req.user?.role || '').toUpperCase() !== 'ADMIN') {
        throw new ForbiddenError('Hanya Admin / Operator yang dapat mengakses pengaturan Auto-Alpa guru');
      }
      const cfg = await teacherAttendanceService.getAutoAlpaRuntimeConfig();
      return res.status(200).json({
        status: 'success',
        data: {
          enabled: cfg.enabled,
          cutoff_time: cfg.cutoff_time,
          cutoff_mode: cfg.cutoff_mode,
          effective_from: cfg.effective_from
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAutoAlpaConfig(req, res, next) {
    try {
      if (String(req.user?.role || '').toUpperCase() !== 'ADMIN') {
        throw new ForbiddenError('Hanya Admin / Operator yang dapat mengubah pengaturan Auto-Alpa guru');
      }
      const saved = await teacherAttendanceService.updateAutoAlpaConfig(
        req.body || {},
        req.user?.user_id || null
      );
      return res.status(200).json({
        status: 'success',
        message: 'Pengaturan Auto-Alpa Guru berhasil disimpan',
        data: saved
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TeacherAttendanceController();

