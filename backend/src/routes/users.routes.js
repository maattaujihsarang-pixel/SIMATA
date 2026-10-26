const express = require('express');
const usersController = require('../controllers/users.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/role.middleware');

const router = express.Router();

// Entire users endpoint tree is protected and restricted to ADMIN
router.use(authMiddleware);
router.use(requireAdmin);

router.get('/', (req, res, next) => usersController.list(req, res, next));
router.get('/:id', (req, res, next) => usersController.get(req, res, next));
router.post('/', (req, res, next) => usersController.create(req, res, next));
router.put('/:id', (req, res, next) => usersController.update(req, res, next));
router.delete('/:id', (req, res, next) => usersController.delete(req, res, next));

module.exports = router;

