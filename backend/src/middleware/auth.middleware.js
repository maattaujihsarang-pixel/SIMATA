const authService = require('../services/auth.service');
const { UnauthorizedError } = require('../errors');

async function authMiddleware(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-session-token']) {
      token = req.headers['x-session-token'].trim();
    } else if (req.cookies && req.cookies.simata_session) {
      token = req.cookies.simata_session;
    }

    if (!token) {
      throw new UnauthorizedError('Autentikasi diperlukan. Header Authorization Bearer token tidak ditemukan.');
    }

    const sessionData = await authService.validateSession(token);

    req.token = token;
    req.user = {
      user_id: sessionData.user_id,
      username: sessionData.username,
      full_name: sessionData.full_name,
      role: sessionData.role,
      teacher_id: sessionData.teacher_id,
      must_change_password: sessionData.must_change_password
    };
    req.session = {
      session_id: sessionData.session_id,
      issued_at: sessionData.issued_at,
      expires_at: sessionData.expires_at
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authMiddleware;

