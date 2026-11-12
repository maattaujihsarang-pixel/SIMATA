const express = require('express');
const feeCategoriesController = require('../controllers/fee-categories.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireFinanceStaff } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Read all / single (accessible by all authenticated users for transparency)
router.get('/', (req, res, next) => feeCategoriesController.list(req, res, next));
router.get('/:id', (req, res, next) => feeCategoriesController.get(req, res, next));

// Modification restricted to Finance Staff (ADMIN, BENDAHARA)
router.post('/', requireFinanceStaff, (req, res, next) => feeCategoriesController.create(req, res, next));
router.put('/:id', requireFinanceStaff, (req, res, next) => feeCategoriesController.update(req, res, next));
router.patch('/:id/status', requireFinanceStaff, (req, res, next) => feeCategoriesController.toggleStatus(req, res, next));

module.exports = router;
