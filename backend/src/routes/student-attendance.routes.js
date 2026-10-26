const express = require('express');
const studentAttendanceController = require('../controllers/student-attendance.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);
router.use(requireGuruOrAdmin);

router.post('/', (req, res, next) => studentAttendanceController.recordSingle(req, res, next));
router.post('/batch', (req, res, next) => studentAttendanceController.recordBatch(req, res, next));
router.post('/qr', (req, res, next) => studentAttendanceController.recordQr(req, res, next));
router.get('/', (req, res, next) => studentAttendanceController.list(req, res, next));
router.get('/:id', (req, res, next) => studentAttendanceController.get(req, res, next));
router.put('/:id', (req, res, next) => studentAttendanceController.update(req, res, next));

module.exports = router;

