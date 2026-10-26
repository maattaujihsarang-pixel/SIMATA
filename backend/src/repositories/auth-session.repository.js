const db = require('../config/database');

class AuthSessionRepository {
  async create({ sessionId, userId, expiresAt, ipAddress = null, userAgent = null }) {
    const res = await db.query(
      `INSERT INTO authentication_sessions (session_id, user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING session_id, user_id, issued_at, expires_at`,
      [sessionId, userId, expiresAt, ipAddress, userAgent]
    );
    return res.rows[0];
  }

  async findValidSession(sessionId) {
    const res = await db.query(
      `SELECT s.session_id, s.user_id, s.issued_at, s.expires_at, s.revoked_at,
              u.username, u.full_name, u.role, u.status, u.teacher_id, u.must_change_password
       FROM authentication_sessions s
       JOIN users u ON s.user_id = u.user_id
       WHERE s.session_id = $1 
         AND s.revoked_at IS NULL 
         AND s.expires_at > CURRENT_TIMESTAMP`,
      [sessionId]
    );
    return res.rows[0] || null;
  }

  async revoke(sessionId) {
    const res = await db.query(
      `UPDATE authentication_sessions 
       SET revoked_at = CURRENT_TIMESTAMP 
       WHERE session_id = $1 AND revoked_at IS NULL
       RETURNING session_id`,
      [sessionId]
    );
    return res.rowCount > 0;
  }

  async revokeAllUserSessions(userId) {
    const res = await db.query(
      `UPDATE authentication_sessions 
       SET revoked_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    return res.rowCount;
  }

  async pruneExpired() {
    const res = await db.query(
      `DELETE FROM authentication_sessions 
       WHERE expires_at < CURRENT_TIMESTAMP OR revoked_at IS NOT NULL`
    );
    return res.rowCount;
  }
}

module.exports = new AuthSessionRepository();

