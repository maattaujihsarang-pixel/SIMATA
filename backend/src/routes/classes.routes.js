const express = require('express');
const classesController = require('../controllers/classes.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Read endpoints (including roster query BUG 29)
router.get('/', requireGuruOrAdmin, (req, res, next) => classesController.list(req, res, next));
router.get('/:id', requireGuruOrAdmin, (req, res, next) => classesController.get(req, res, next));
router.get('/:id/roster', requireGuruOrAdmin, (req, res, next) => classesController.getRoster(req, res, next));

// Modification endpoints restricted to ADMIN
router.post('/', requireAdmin, (req, res, next) => classesController.create(req, res, next));
router.put('/:id', requireAdmin, (req, res, next) => classesController.update(req, res, next));
router.patch('/:id/status', requireAdmin, (req, res, next) => classesController.updateStatus(req, res, next));

module.exports = router;

