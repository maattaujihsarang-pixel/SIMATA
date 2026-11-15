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

  async findSummaryStats() {
    const res = await db.query(
      `SELECT COUNT(*)::int AS total_records,
              COUNT(DISTINCT file_id)::int AS distinct_files,
              MIN(captured_at) AS oldest_captured_at
       FROM attendance_evidences`
    );
    return res.rows[0] || { total_records: 0, distinct_files: 0, oldest_captured_at: null };
  }

  async getSystemSettings(keys) {
    const res = await db.query(
      `SELECT setting_key, setting_value, description, updated_at
       FROM system_settings
       WHERE setting_key = ANY($1)`,
      [keys]
    );
    const map = {};
    for (const row of res.rows) {
      map[row.setting_key] = row;
    }
    return map;
  }

  async upsertSystemSetting(key, value, description = null, userId = null, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `INSERT INTO system_settings (setting_key, setting_value, description, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           description = COALESCE(EXCLUDED.description, system_settings.description),
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [key, String(value ?? ''), description, userId]
    );
    return res.rows[0];
  }

  async findExpiredEvidences(cutoffIso = null, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    if (!cutoffIso) {
      const res = await queryFn(
        `SELECT evidence_id, file_id, attendance_id, captured_at
         FROM attendance_evidences
         ORDER BY captured_at ASC`,
        []
      );
      return res.rows;
    }
    const res = await queryFn(
      `SELECT evidence_id, file_id, attendance_id, captured_at
       FROM attendance_evidences
       WHERE captured_at < $1
       ORDER BY captured_at ASC`,
      [cutoffIso]
    );
    return res.rows;
  }

  async findStillReferencedFileIds(fileIds, excludingEvidenceIds = [], client = null) {
    if (!fileIds || fileIds.length === 0) return [];
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `SELECT DISTINCT file_id
       FROM attendance_evidences
       WHERE file_id = ANY($1)
         AND NOT (evidence_id = ANY($2))`,
      [fileIds, excludingEvidenceIds]
    );
    return res.rows.map(r => r.file_id);
  }

  async deleteByIds(evidenceIds, client = null) {
    if (!evidenceIds || evidenceIds.length === 0) return 0;
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `DELETE FROM attendance_evidences WHERE evidence_id = ANY($1)`,
      [evidenceIds]
    );
    return res.rowCount || 0;
  }

  async markTeacherAttendanceEvidencePurged(attendanceIds, client = null) {
    if (!attendanceIds || attendanceIds.length === 0) return 0;
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `UPDATE teacher_attendance
       SET evidence_purged_at = CURRENT_TIMESTAMP
       WHERE attendance_id = ANY($1)
         AND evidence_purged_at IS NULL`,
      [attendanceIds]
    );
    return res.rowCount || 0;
  }
}

module.exports = new AttendanceEvidenceRepository();

