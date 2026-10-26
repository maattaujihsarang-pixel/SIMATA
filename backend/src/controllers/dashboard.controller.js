const dashboardService = require('../services/dashboard.service');

class DashboardController {
  async getSummary(req, res, next) {
    try {
      const { date } = req.query;
      const data = await dashboardService.getDashboardSummary(date);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DashboardController();

