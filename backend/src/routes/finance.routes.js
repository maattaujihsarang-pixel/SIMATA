const express = require('express');
const financeSettingsRoutes = require('./finance-settings.routes');
const parentMappingRoutes = require('./parent-mapping.routes');
const feeCategoriesRoutes = require('./fee-categories.routes');
const invoicesRoutes = require('./invoices.routes');
const paymentsRoutes = require('./payments.routes');
const financeDashboardRoutes = require('./finance-dashboard.routes');

const router = express.Router();

// Mount sub-domain router Feature 005
router.use('/dashboard', financeDashboardRoutes);
router.use('/settings', financeSettingsRoutes);
router.use('/parents', parentMappingRoutes);
router.use('/fee-categories', feeCategoriesRoutes);
router.use('/invoices', invoicesRoutes);
router.use('/payments', paymentsRoutes);

module.exports = router;
