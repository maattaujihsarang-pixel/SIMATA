const reportsService = require('../services/reports.service');

class ReportsController {
  /**
   * GET /api/v1/reports/academic
   * Query params: preset (7d|month|semester|custom), startDate, endDate, classId
   */
  async getAcademicOverview(req, res, next) {
    try {
      const { preset, startDate, endDate, classId } = req.query;
      const data = await reportsService.getAcademicReport({
        preset,
        startDate,
        endDate,
        classId,
        user: req.user
      });

      res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/reports/tazir/:studentId
   */
  async getStudentTazirHistory(req, res, next) {
    try {
      const data = await reportsService.getStudentTazirHistory(req.params.studentId);
      res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/reports/tazir
   */
  async recordStudentTazir(req, res, next) {
    try {
      const { student_id, tazir_type, action_date, trigger_summary, tazir_note } = req.body || {};
      const record = await reportsService.recordStudentTazirAction({
        studentId: student_id,
        tazirType: tazir_type,
        actionDate: action_date,
        triggerSummary: trigger_summary,
        note: tazir_note,
        operatorUserId: req.user ? req.user.user_id : null
      });

      res.status(201).json({
        status: 'success',
        message: 'Eksekusi Ta\'zir siswa berhasil dicatat',
        data: record
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/reports/tazir/:tazirId
   */
  async deleteStudentTazir(req, res, next) {
    try {
      const deleted = await reportsService.deleteStudentTazirAction(req.params.tazirId);
      res.status(200).json({
        status: 'success',
        message: 'Riwayat Ta\'zir berhasil dihapus',
        data: deleted
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReportsController();
