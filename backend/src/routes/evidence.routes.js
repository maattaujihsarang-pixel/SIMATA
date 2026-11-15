const express = require('express');
const evidenceController = require('../controllers/evidence.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin, requireAdmin } = require('../middleware/role.middleware');

const router = express.Router();

// File viewing endpoint (can be accessed with auth or session token)
router.get('/files/:file_id', (req, res, next) => evidenceController.viewFile(req, res, next));
router.get('/file/:file_id', (req, res, next) => evidenceController.viewFile(req, res, next));

// Authenticated endpoints
router.use(authMiddleware);

// Admin-only evidence storage & retention management (BUG 53)
router.get('/storage/overview', requireAdmin, (req, res, next) => evidenceController.getStorageOverview(req, res, next));
router.put('/storage/retention', requireAdmin, (req, res, next) => evidenceController.updateRetentionPolicy(req, res, next));
router.post('/storage/cleanup/preview', requireAdmin, (req, res, next) => evidenceController.previewCleanup(req, res, next));
router.post('/storage/cleanup', requireAdmin, (req, res, next) => evidenceController.executeCleanup(req, res, next));

// Metadata endpoints (Guru or Admin)
router.use(requireGuruOrAdmin);

router.get('/session/:session_id', (req, res, next) => evidenceController.getBySession(req, res, next));
router.get('/attendance/:attendance_id', (req, res, next) => evidenceController.getByAttendance(req, res, next));

module.exports = router;

