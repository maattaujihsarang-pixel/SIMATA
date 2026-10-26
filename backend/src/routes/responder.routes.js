const express = require('express');
const responderSessionController = require('../controllers/responder-session.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);
router.use(requireGuruOrAdmin);

router.post('/sessions', (req, res, next) => responderSessionController.start(req, res, next));
router.get('/sessions/:id', (req, res, next) => responderSessionController.get(req, res, next));
router.post('/sessions/:id/finish', (req, res, next) => responderSessionController.finish(req, res, next));
router.post('/sessions/:id/cancel', (req, res, next) => responderSessionController.cancel(req, res, next));

module.exports = router;

