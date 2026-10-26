const db = require('../config/database');

class TeacherAttendanceRepository {
  async findByBusinessKey(teacherId, attendanceDate, period, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `SELECT attendance_id, teacher_id, class_id, academic_year_id,
              attendance_date, period, subject, materi, status, method,
              recorded_at, note, recorded_by_user_id
       FROM teacher_attendance
       WHERE teacher_id = $1 AND attendance_date = $2 AND period = $3`,
      [teacherId, attendanceDate, period]
    );
    return res.rows[0] || null;
  }

  async findExistingDuplicates(teacherId, attendanceDate, periods, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `SELECT ta.attendance_id, ta.teacher_id, ta.attendance_date, ta.period, ta.subject, t.name as teacher_name
       FROM teacher_attendance ta
       JOIN teachers t ON ta.teacher_id = t.teacher_id
       WHERE ta.teacher_id = $1 
         AND ta.attendance_date = $2 
         AND ta.period = ANY($3::smallint[])`,
      [teacherId, attendanceDate, periods]
    );
    return res.rows;
  }

  async insertSingle(data, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `INSERT INTO teacher_attendance (
        attendance_id, teacher_id, class_id, academic_year_id,
        attendance_date, period, subject, materi, status, method,
        recorded_at, note, recorded_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        data.attendance_id, data.teacher_id, data.class_id, data.academic_year_id,
        data.attendance_date, data.period, data.subject, data.materi,
        data.status || 'Hadir', data.method || 'Camera',
        data.recorded_at || new Date().toISOString(), data.note || null, data.recorded_by_user_id || null
      ]
    );
    return res.rows[0];
  }

  async findByFilters({ date = null, teacherId = null, classId = null, period = null } = {}) {
    let sql = `SELECT ta.attendance_id, ta.teacher_id, ta.class_id, ta.academic_year_id,
                      ta.attendance_date, ta.period, ta.subject, ta.materi, ta.status,
                      ta.method, ta.recorded_at, ta.note, ta.recorded_by_user_id,
                      t.name as teacher_name, t.nik, t.nip, t.nuptk, c.class_name,
                      ae.evidence_id, ae.file_id, ae.file_url
               FROM teacher_attendance ta
               JOIN teachers t ON ta.teacher_id = t.teacher_id
               JOIN classes c ON ta.class_id = c.class_id
               LEFT JOIN attendance_evidences ae ON ta.attendance_id = ae.attendance_id
               WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (date) {
      sql += ` AND ta.attendance_date = $${idx++}`;
      params.push(date);
    }
    if (teacherId) {
      sql += ` AND ta.teacher_id = $${idx++}`;
      params.push(teacherId);
    }
    if (classId) {
      sql += ` AND ta.class_id = $${idx++}`;
      params.push(classId);
    }
    if (period) {
      sql += ` AND ta.period = $${idx++}`;
      params.push(period);
    }

    sql += ` ORDER BY ta.attendance_date DESC, ta.period ASC, t.name ASC`;
    const res = await db.query(sql, params);
    return res.rows;
  }

  async findById(attendanceId) {
    const res = await db.query(
      `SELECT ta.attendance_id, ta.teacher_id, ta.class_id, ta.academic_year_id,
              ta.attendance_date, ta.period, ta.subject, ta.materi, ta.status,
              ta.method, ta.recorded_at, ta.note, ta.recorded_by_user_id,
              t.name as teacher_name, t.nik, t.nip, t.nuptk, c.class_name,
              ae.evidence_id, ae.file_id, ae.file_url
       FROM teacher_attendance ta
       JOIN teachers t ON ta.teacher_id = t.teacher_id
       JOIN classes c ON ta.class_id = c.class_id
       LEFT JOIN attendance_evidences ae ON ta.attendance_id = ae.attendance_id
       WHERE ta.attendance_id = $1`,
      [attendanceId]
    );
    return res.rows[0] || null;
  }

  async update(attendanceId, { status, subject, materi, note, period, class_id, attendance_date, recorded_by_user_id } = {}) {
    const res = await db.query(
      `UPDATE teacher_attendance
       SET status = COALESCE($1, status),
           subject = COALESCE($2, subject),
           materi = COALESCE($3, materi),
           note = $4,
           period = COALESCE($5, period),
           class_id = COALESCE($6, class_id),
           attendance_date = COALESCE($7, attendance_date),
           recorded_by_user_id = COALESCE($8, recorded_by_user_id)
       WHERE attendance_id = $9
       RETURNING *`,
      [status, subject, materi, note, period, class_id, attendance_date, recorded_by_user_id, attendanceId]
    );
    return res.rows[0] || null;
  }
}

module.exports = new TeacherAttendanceRepository();

