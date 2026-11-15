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
}

module.exports = new ReportsController();
