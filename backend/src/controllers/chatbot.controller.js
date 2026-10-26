const chatbotService = require('../services/chatbot.service');

class ChatbotController {
  async handleMessage(req, res, next) {
    try {
      const { message } = req.body;
      const result = await chatbotService.processMessage(message);
      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ChatbotController();

