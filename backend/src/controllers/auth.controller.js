const authService = require('../services/auth.service');

class AuthController {
  async login(req, res, next) {
    try {
      const { username, password } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await authService.login({
        username,
        password,
        ipAddress,
        userAgent
      });

      return res.status(200).json({
        status: 'success',
        message: 'Login berhasil',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async me(req, res, next) {
    try {
      return res.status(200).json({
        status: 'success',
        data: {
          user: req.user,
          session: req.session
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      await authService.logout(req.token);
      return res.status(200).json({
        status: 'success',
        message: 'Logout berhasil. Sesi telah dicabut.'
      });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { old_password, new_password } = req.body;
      const result = await authService.changePassword(req.user.user_id, old_password, new_password);
      return res.status(200).json({
        status: 'success',
        message: result.message
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();

