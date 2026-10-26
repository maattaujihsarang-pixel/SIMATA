const studentAttendanceService = require('../services/student-attendance.service');

class StudentAttendanceController {
  async recordSingle(req, res, next) {
    try {
      const result = await studentAttendanceService.recordSingleAttendance(req.body, req.user.user_id);
      return res.status(201).json({
        status: 'success',
        message: 'Presensi siswa berhasil dicatat',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async recordBatch(req, res, next) {
    try {
      const result = await studentAttendanceService.recordBatchAttendance(req.body, req.user.user_id);
      return res.status(201).json({
        status: 'success',
        message: `Presensi batch berhasil dicatat (${result.total_inserted} rekaman tersimpan)`,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async recordQr(req, res, next) {
    try {
      const result = await studentAttendanceService.recordQrAttendance(req.body, req.user.user_id);
      return res.status(201).json({
        status: 'success',
        message: 'Presensi via QR berhasil dicatat',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req, res, next) {
    try {
      const { date, class_id, student_id, period } = req.query;
      const attendances = await studentAttendanceService.getAttendanceList({
        date,
        classId: class_id,
        studentId: student_id,
        period: period ? parseInt(period, 10) : null
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
      const attendance = await studentAttendanceService.getAttendanceById(req.params.id);
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
      const result = await studentAttendanceService.updateAttendance(req.params.id, req.body, req.user.user_id);
      return res.status(200).json({
        status: 'success',
        message: 'Presensi siswa berhasil diperbarui',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StudentAttendanceController();

