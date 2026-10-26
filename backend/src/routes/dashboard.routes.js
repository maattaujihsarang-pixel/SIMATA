const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);
router.use(requireGuruOrAdmin);

router.get('/', (req, res, next) => dashboardController.getSummary(req, res, next));

module.exports = router;

