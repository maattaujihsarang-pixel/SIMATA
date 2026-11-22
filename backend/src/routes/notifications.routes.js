const express = require('express');
const notificationsController = require('../controllers/notifications.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/', requireGuruOrAdmin, (req, res, next) => notificationsController.getFeed(req, res, next));
router.get('/settings', requireGuruOrAdmin, (req, res, next) => notificationsController.getSettings(req, res, next));
router.put('/settings', requireAdmin, (req, res, next) => notificationsController.updateSettings(req, res, next));
router.post('/broadcasts', requireAdmin, (req, res, next) => notificationsController.createBroadcast(req, res, next));
router.delete('/broadcasts/:id', requireAdmin, (req, res, next) => notificationsController.deleteBroadcast(req, res, next));
router.post('/events', requireGuruOrAdmin, (req, res, next) => notificationsController.logEvent(req, res, next));

module.exports = router;
