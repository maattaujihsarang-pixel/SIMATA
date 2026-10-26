const express = require('express');
const evidenceController = require('../controllers/evidence.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

// File viewing endpoint (can be accessed with auth or session token)
router.get('/files/:file_id', (req, res, next) => evidenceController.viewFile(req, res, next));
router.get('/file/:file_id', (req, res, next) => evidenceController.viewFile(req, res, next));

// Metadata endpoints
router.use(authMiddleware);
router.use(requireGuruOrAdmin);

router.get('/session/:session_id', (req, res, next) => evidenceController.getBySession(req, res, next));
router.get('/attendance/:attendance_id', (req, res, next) => evidenceController.getByAttendance(req, res, next));

module.exports = router;

