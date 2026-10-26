const teacherAttendanceService = require('../services/teacher-attendance.service');

class TeacherAttendanceController {
  async recordWithEvidence(req, res, next) {
    try {
      const result = await teacherAttendanceService.recordTeacherAttendanceWithEvidence(
        req.body,
        req.file,
        req.user.user_id
      );
      return res.status(201).json({
        status: 'success',
        message: `Presensi guru untuk ${result.total_periods} jam berhasil dicatat dengan bukti foto`,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req, res, next) {
    try {
      const { date, teacher_id, class_id, period } = req.query;
      const attendances = await teacherAttendanceService.getAttendanceList({
        date,
        teacherId: teacher_id,
        classId: class_id,
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
      const result = await teacherAttendanceService.updateAttendance(req.params.id, req.body, req.user.user_id);
      return res.status(200).json({
        status: 'success',
        message: 'Presensi guru berhasil diperbarui',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TeacherAttendanceController();

