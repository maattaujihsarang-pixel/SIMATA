const db = require('../config/database');

class StudentAttendanceRepository {
  async findByBusinessKey(studentId, attendanceDate, period, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `SELECT attendance_id, student_id, class_id, academic_year_id,
              attendance_date, period, status, method, note, recorded_at, recorded_by_user_id
       FROM student_attendance
       WHERE student_id = $1 AND attendance_date = $2 AND period = $3`,
      [studentId, attendanceDate, period]
    );
    return res.rows[0] || null;
  }

  async findExistingDuplicates(studentIds, attendanceDate, periods, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `SELECT sa.student_id, sa.attendance_date, sa.period, sa.status, s.name as student_name
       FROM student_attendance sa
       JOIN students s ON sa.student_id = s.student_id
       WHERE sa.student_id = ANY($1::varchar[])
         AND sa.attendance_date = $2
         AND sa.period = ANY($3::smallint[])`,
      [studentIds, attendanceDate, periods]
    );
    return res.rows;
  }

  async insertSingle(data, client = null) {
    const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
    const res = await queryFn(
      `INSERT INTO student_attendance (
        attendance_id, student_id, class_id, academic_year_id,
        attendance_date, period, status, method, note, recorded_at, recorded_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        data.attendance_id, data.student_id, data.class_id, data.academic_year_id,
        data.attendance_date, data.period, data.status, data.method || 'QR_BATCH',
        data.note || null, data.recorded_at || new Date().toISOString(), data.recorded_by_user_id || null
      ]
    );
    return res.rows[0];
  }

  async findByFilters({ date = null, classId = null, studentId = null, period = null } = {}) {
    let sql = `SELECT sa.attendance_id, sa.student_id, sa.class_id, sa.academic_year_id,
                      sa.attendance_date, sa.period, sa.status, sa.method, sa.note,
                      sa.recorded_at, sa.recorded_by_user_id,
                      s.name as student_name, c.class_name
               FROM student_attendance sa
               JOIN students s ON sa.student_id = s.student_id
               JOIN classes c ON sa.class_id = c.class_id
               WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (date) {
      sql += ` AND sa.attendance_date = $${idx++}`;
      params.push(date);
    }
    if (classId) {
      sql += ` AND sa.class_id = $${idx++}`;
      params.push(classId);
    }
    if (studentId) {
      sql += ` AND sa.student_id = $${idx++}`;
      params.push(studentId);
    }
    if (period) {
      sql += ` AND sa.period = $${idx++}`;
      params.push(period);
    }

    sql += ` ORDER BY sa.attendance_date DESC, sa.period ASC, s.name ASC`;
    const res = await db.query(sql, params);
    return res.rows;
  }

  async findById(attendanceId) {
    const res = await db.query(
      `SELECT sa.attendance_id, sa.student_id, sa.class_id, sa.academic_year_id,
              sa.attendance_date, sa.period, sa.status, sa.method, sa.note,
              sa.recorded_at, sa.recorded_by_user_id,
              s.name as student_name, c.class_name
       FROM student_attendance sa
       JOIN students s ON sa.student_id = s.student_id
       JOIN classes c ON sa.class_id = c.class_id
       WHERE sa.attendance_id = $1`,
      [attendanceId]
    );
    return res.rows[0] || null;
  }

  async update(attendanceId, { status, note, period, attendance_date, recorded_by_user_id } = {}) {
    const res = await db.query(
      `UPDATE student_attendance
       SET status = COALESCE($1, status),
           note = $2,
           period = COALESCE($3, period),
           attendance_date = COALESCE($4, attendance_date),
           recorded_by_user_id = COALESCE($5, recorded_by_user_id)
       WHERE attendance_id = $6
       RETURNING *`,
      [status, note, period, attendance_date, recorded_by_user_id, attendanceId]
    );
    return res.rows[0] || null;
  }
}

module.exports = new StudentAttendanceRepository();

