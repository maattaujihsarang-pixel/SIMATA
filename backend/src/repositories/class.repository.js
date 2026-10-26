const db = require('../config/database');

class ClassRepository {
  async findAll({ status = null } = {}) {
    let sql = `SELECT c.class_id, c.class_name, c.level, c.academic_year_id,
                      c.homeroom_teacher_id, c.status, c.created_at, c.updated_at,
                      t.name AS homeroom_teacher_name
               FROM classes c
               LEFT JOIN teachers t ON c.homeroom_teacher_id = t.teacher_id`;
    const params = [];

    if (status) {
      sql += ` WHERE c.status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY c.level ASC, c.class_name ASC`;
    const res = await db.query(sql, params);
    return res.rows;
  }

  async findById(classId) {
    const res = await db.query(
      `SELECT c.class_id, c.class_name, c.level, c.academic_year_id,
              c.homeroom_teacher_id, c.status, c.created_at, c.updated_at,
              t.name AS homeroom_teacher_name
       FROM classes c
       LEFT JOIN teachers t ON c.homeroom_teacher_id = t.teacher_id
       WHERE c.class_id = $1`,
      [classId]
    );
    return res.rows[0] || null;
  }

  /**
   * BUG 29 Resolution: Dynamic join query for classroom roster with attendance status.
   * Not a separate physical table, but a clean service-level query.
   */
  async getRosterWithTodayAttendance(classId, attendanceDate) {
    const res = await db.query(
      `SELECT s.student_id, s.name, s.gender, s.nis, s.nisn, s.qr_code_id, s.status AS student_status,
              sa.attendance_id, sa.period, sa.status AS attendance_status, sa.method, sa.note, sa.recorded_at
       FROM students s
       LEFT JOIN student_attendance sa 
         ON s.student_id = sa.student_id 
        AND sa.attendance_date = $2
       WHERE s.class_id = $1 AND s.status = 'Active'
       ORDER BY s.name ASC`,
      [classId, attendanceDate]
    );
    return res.rows;
  }

  async create(data) {
    const res = await db.query(
      `INSERT INTO classes (class_id, class_name, level, academic_year_id, homeroom_teacher_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.class_id, data.class_name, data.level, data.academic_year_id, data.homeroom_teacher_id || null, data.status || 'Active']
    );
    return res.rows[0];
  }

  async update(classId, data) {
    const res = await db.query(
      `UPDATE classes SET
        class_name = COALESCE($2, class_name),
        level = COALESCE($3, level),
        academic_year_id = COALESCE($4, academic_year_id),
        homeroom_teacher_id = $5,
        status = COALESCE($6, status),
        updated_at = CURRENT_TIMESTAMP
       WHERE class_id = $1
       RETURNING *`,
      [classId, data.class_name, data.level, data.academic_year_id, data.homeroom_teacher_id, data.status]
    );
    return res.rows[0] || null;
  }

  async updateStatus(classId, status) {
    const res = await db.query(
      `UPDATE classes 
       SET status = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE class_id = $1 
       RETURNING class_id, class_name, status, updated_at`,
      [classId, status]
    );
    return res.rows[0] || null;
  }
}

module.exports = new ClassRepository();

