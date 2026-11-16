const express = require('express');
const schedulesController = require('../controllers/schedules.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Read-only timetable & live Responder slot endpoints (Admin + Guru)
router.get('/overview', requireGuruOrAdmin, (req, res, next) => schedulesController.getOverview(req, res, next));
router.get('/now', requireGuruOrAdmin, (req, res, next) => schedulesController.getActiveNow(req, res, next));

// Administrative timetable & master mutations (Admin only)
router.post('/slots/upsert', requireAdmin, (req, res, next) => schedulesController.upsertSlot(req, res, next));
router.post('/slots/clear', requireAdmin, (req, res, next) => schedulesController.clearCell(req, res, next));
router.delete('/slots/:scheduleId', requireAdmin, (req, res, next) => schedulesController.deleteSlot(req, res, next));
router.post('/subjects', requireAdmin, (req, res, next) => schedulesController.upsertSubject(req, res, next));
router.delete('/subjects/:subjectId', requireAdmin, (req, res, next) => schedulesController.deleteSubject(req, res, next));
router.put('/periods', requireAdmin, (req, res, next) => schedulesController.updatePeriods(req, res, next));
router.put('/teacher-codes', requireAdmin, (req, res, next) => schedulesController.updateTeacherCode(req, res, next));
router.post('/copy', requireAdmin, (req, res, next) => schedulesController.copySchedule(req, res, next));
router.post('/import', requireAdmin, (req, res, next) => schedulesController.importRows(req, res, next));
router.post('/seed-default', requireAdmin, (req, res, next) => schedulesController.seedDefault(req, res, next));

module.exports = router;
