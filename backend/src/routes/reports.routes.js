const express = require('express');
const reportsController = require('../controllers/reports.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/academic', requireGuruOrAdmin, (req, res, next) => reportsController.getAcademicOverview(req, res, next));
router.get('/tazir/:studentId', requireGuruOrAdmin, (req, res, next) => reportsController.getStudentTazirHistory(req, res, next));
router.post('/tazir', requireGuruOrAdmin, (req, res, next) => reportsController.recordStudentTazir(req, res, next));
router.delete('/tazir/:tazirId', requireAdmin, (req, res, next) => reportsController.deleteStudentTazir(req, res, next));

module.exports = router;
