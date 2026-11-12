const financeDashboardService = require('../services/finance-dashboard.service');

class FinanceDashboardController {
  /**
   * GET /api/v1/finance/dashboard/overview
   * Mengambil statistik KPI, grafik, dan aktivitas keuangan
   */
  async getOverview(req, res, next) {
    try {
      const stats = await financeDashboardService.getOverviewStats(req.user);
      res.status(200).json({
        status: 'success',
        data: stats
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/finance/dashboard/audit-logs
   * Mengambil log audit transaksi keuangan lengkap
   */
  async getAuditLogs(req, res, next) {
    try {
      const logs = await financeDashboardService.getAuditLogs(req.query);
      res.status(200).json({
        status: 'success',
        data: logs.data,
        pagination: logs.pagination
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new FinanceDashboardController();
