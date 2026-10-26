const db = require('../config/database');

class AttendanceEvidenceRepository {
  async insertSingle(data, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `INSERT INTO attendance_evidences (
        evidence_id, session_id, operator_user_id, captured_at,
        file_id, file_url, attendance_id, storage_provider, mime_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.evidence_id, data.session_id, data.operator_user_id,
        data.captured_at || new Date().toISOString(),
        data.file_id, data.file_url, data.attendance_id || null,
        data.storage_provider || 'LOCAL', data.mime_type || 'image/jpeg'
      ]
    );
    return res.rows[0];
  }

  async findBySessionId(sessionId) {
    const res = await db.query(
      `SELECT evidence_id, session_id, operator_user_id, captured_at,
              file_id, file_url, attendance_id, storage_provider, mime_type, created_at
       FROM attendance_evidences
       WHERE session_id = $1
       ORDER BY captured_at ASC`,
      [sessionId]
    );
    return res.rows;
  }

  async findByAttendanceId(attendanceId) {
    const res = await db.query(
      `SELECT evidence_id, session_id, operator_user_id, captured_at,
              file_id, file_url, attendance_id, storage_provider, mime_type, created_at
       FROM attendance_evidences
       WHERE attendance_id = $1`,
      [attendanceId]
    );
    return res.rows[0] || null;
  }

  async findAllFileIds() {
    const res = await db.query(
      `SELECT DISTINCT file_id FROM attendance_evidences`
    );
    return res.rows.map(r => r.file_id);
  }
}

module.exports = new AttendanceEvidenceRepository();

