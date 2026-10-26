const express = require('express');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

// Public login endpoint
router.post('/login', (req, res, next) => authController.login(req, res, next));

// Protected session endpoints
router.get('/me', authMiddleware, (req, res, next) => authController.me(req, res, next));
router.post('/logout', authMiddleware, (req, res, next) => authController.logout(req, res, next));
router.post('/change-password', authMiddleware, (req, res, next) => authController.changePassword(req, res, next));

module.exports = router;

