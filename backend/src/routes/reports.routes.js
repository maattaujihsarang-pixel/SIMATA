const express = require('express');
const reportsController = require('../controllers/reports.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);
router.use(requireGuruOrAdmin);

router.get('/academic', (req, res, next) => reportsController.getAcademicOverview(req, res, next));

module.exports = router;
