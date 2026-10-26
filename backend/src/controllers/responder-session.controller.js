const responderSessionService = require('../services/responder-session.service');

class ResponderSessionController {
  async start(req, res, next) {
    try {
      const session = await responderSessionService.startSession(req.user.user_id);
      return res.status(201).json({
        status: 'success',
        message: 'Sesi scanner berhasil dibuka',
        data: {
          ...session,
          operator_user_id: req.user.user_id,
          operator_id: req.user.username,
          username: req.user.username,
          operator_name: req.user.full_name
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const session = await responderSessionService.getSession(
        req.params.id,
        req.user.user_id,
        req.user.role
      );
      return res.status(200).json({
        status: 'success',
        data: session
      });
    } catch (error) {
      next(error);
    }
  }

  async finish(req, res, next) {
    try {
      const session = await responderSessionService.finishSession(
        req.params.id,
        req.user.user_id,
        req.user.role
      );
      return res.status(200).json({
        status: 'success',
        message: 'Sesi scanner berhasil ditutup',
        data: session
      });
    } catch (error) {
      next(error);
    }
  }

  async cancel(req, res, next) {
    try {
      const session = await responderSessionService.cancelSession(
        req.params.id,
        req.user.user_id,
        req.user.role
      );
      return res.status(200).json({
        status: 'success',
        message: 'Sesi scanner telah dibatalkan',
        data: session
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ResponderSessionController();

