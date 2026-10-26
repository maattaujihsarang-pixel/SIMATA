const db = require('../config/database');

class ResponderSessionRepository {
  async create({ sessionId, operatorUserId, startedAt = new Date().toISOString() }) {
    const res = await db.query(
      `INSERT INTO responder_sessions (session_id, operator_user_id, started_at, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       RETURNING session_id, operator_user_id, started_at, status, created_at`,
      [sessionId, operatorUserId, startedAt]
    );
    return res.rows[0];
  }

  async findById(sessionId) {
    const res = await db.query(
      `SELECT rs.session_id, rs.operator_user_id, rs.started_at, rs.finished_at, rs.status, rs.created_at,
              u.username, u.full_name as operator_name
       FROM responder_sessions rs
       JOIN users u ON rs.operator_user_id = u.user_id
       WHERE rs.session_id = $1`,
      [sessionId]
    );
    return res.rows[0] || null;
  }

  async updateStatus(sessionId, status, finishedAt = new Date().toISOString()) {
    const res = await db.query(
      `UPDATE responder_sessions
       SET status = $2, finished_at = $3
       WHERE session_id = $1
       RETURNING session_id, operator_user_id, started_at, finished_at, status`,
      [sessionId, status, finishedAt]
    );
    return res.rows[0] || null;
  }

  async findActiveByOperator(operatorUserId) {
    const res = await db.query(
      `SELECT session_id, operator_user_id, started_at, status
       FROM responder_sessions
       WHERE operator_user_id = $1 AND status = 'ACTIVE'
       ORDER BY started_at DESC LIMIT 1`,
      [operatorUserId]
    );
    return res.rows[0] || null;
  }
}

module.exports = new ResponderSessionRepository();

