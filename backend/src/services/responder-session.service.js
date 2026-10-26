const responderSessionRepository = require('../repositories/responder-session.repository');
const { generateUUID } = require('../utils/id-generator.util');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../errors');

class ResponderSessionService {
  async startSession(operatorUserId) {
    const rawUuid = generateUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
    const sessionId = `SESSION-${rawUuid}`;

    return responderSessionRepository.create({
      sessionId,
      operatorUserId
    });
  }

  async getSession(sessionId, userId, userRole) {
    const session = await responderSessionRepository.findById(sessionId);
    if (!session) {
      throw new NotFoundError(`Sesi scanner '${sessionId}' tidak ditemukan`);
    }

    if (userRole !== 'ADMIN' && session.operator_user_id !== userId) {
      throw new ForbiddenError('Anda tidak memiliki izin untuk mengakses sesi scanner milik operator lain');
    }

    return session;
  }

  async finishSession(sessionId, userId, userRole) {
    const session = await this.getSession(sessionId, userId, userRole);
    if (session.status !== 'ACTIVE') {
      throw new BadRequestError(`Sesi sudah berstatus '${session.status}', tidak dapat diselesaikan lagi`);
    }

    return responderSessionRepository.updateStatus(sessionId, 'FINISHED');
  }

  async cancelSession(sessionId, userId, userRole) {
    const session = await this.getSession(sessionId, userId, userRole);
    if (session.status !== 'ACTIVE') {
      throw new BadRequestError(`Sesi sudah berstatus '${session.status}', tidak dapat dibatalkan`);
    }

    return responderSessionRepository.updateStatus(sessionId, 'CANCELLED');
  }
}

module.exports = new ResponderSessionService();

