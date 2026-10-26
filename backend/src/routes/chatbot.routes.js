const express = require('express');
const chatbotController = require('../controllers/chatbot.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/message', (req, res, next) => chatbotController.handleMessage(req, res, next));

module.exports = router;

