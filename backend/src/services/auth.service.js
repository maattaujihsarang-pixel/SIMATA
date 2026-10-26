const userRepository = require('../repositories/user.repository');
const authSessionRepository = require('../repositories/auth-session.repository');
const { hashPassword, comparePassword } = require('../utils/password.util');
const { generateToken } = require('../utils/id-generator.util');
const { addHours } = require('../utils/date.util');
const env = require('../config/env');
const { UnauthorizedError, BadRequestError } = require('../errors');

class AuthService {
  async login({ username, password, ipAddress = null, userAgent = null }) {
    if (!username || !password) {
      throw new BadRequestError('Username dan password wajib diisi');
    }

    const user = await userRepository.findByUsername(username);
    if (!user) {
      throw new UnauthorizedError('Username atau password tidak valid');
    }

    if (user.status !== 'Active') {
      throw new UnauthorizedError('Akun pengguna dinonaktifkan. Silakan hubungi Administrator');
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Username atau password tidak valid');
    }

    // Generate 64-character hex session token
    const sessionId = generateToken(32);
    const expiresAt = addHours(new Date(), env.SESSION_EXPIRY_HOURS);

    await authSessionRepository.create({
      sessionId,
      userId: user.user_id,
      expiresAt,
      ipAddress,
      userAgent
    });

    return {
      token: sessionId,
      user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        teacher_id: user.teacher_id,
        must_change_password: user.must_change_password
      },
      expires_at: expiresAt.toISOString()
    };
  }

  async validateSession(sessionId) {
    if (!sessionId) {
      throw new UnauthorizedError('Token sesi tidak ditemukan');
    }

    const session = await authSessionRepository.findValidSession(sessionId);
    if (!session) {
      throw new UnauthorizedError('Sesi tidak valid atau telah kadaluwarsa');
    }

    if (session.status !== 'Active') {
      throw new UnauthorizedError('Akun pengguna telah dinonaktifkan');
    }

    return session;
  }

  async logout(sessionId) {
    if (!sessionId) return false;
    return authSessionRepository.revoke(sessionId);
  }

  async changePassword(userId, oldPassword, newPassword) {
    if (!oldPassword || !newPassword) {
      throw new BadRequestError('Password lama dan password baru wajib diisi');
    }

    if (newPassword.length < 6) {
      throw new BadRequestError('Password baru harus minimal 6 karakter');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError('Pengguna tidak ditemukan');
    }

    const fullUser = await userRepository.findByUsername(user.username);
    const isMatch = await comparePassword(oldPassword, fullUser.password_hash);
    if (!isMatch) {
      throw new BadRequestError('Password lama tidak cocok');
    }

    const newHash = await hashPassword(newPassword);
    await userRepository.updatePassword(userId, newHash);

    return {
      success: true,
      message: 'Password berhasil diperbarui'
    };
  }
}

module.exports = new AuthService();

