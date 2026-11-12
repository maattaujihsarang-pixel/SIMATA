const express = require('express');
const financeDashboardController = require('../controllers/finance-dashboard.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireRole, requireFinanceStaff } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Overview statistics (terbuka untuk Admin, Bendahara, dan Orang Tua - Orang tua discoped otomatis)
router.get(
  '/overview',
  requireRole('ADMIN', 'BENDAHARA', 'ORANG_TUA'),
  (req, res, next) => financeDashboardController.getOverview(req, res, next)
);

// Audit logs (khusus staff keuangan: Admin & Bendahara)
router.get(
  '/audit-logs',
  requireFinanceStaff,
  (req, res, next) => financeDashboardController.getAuditLogs(req, res, next)
);

module.exports = router;
