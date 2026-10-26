const db = require('../config/database');

class StudentRepository {
  async findAll({ classId = null, status = null, search = null } = {}) {
    let sql = `SELECT s.student_id, s.class_id, s.name, s.gender, s.nis, s.nisn,
                      s.birth_date, s.qr_code_id, s.status, s.created_at, s.updated_at,
                      c.class_name
               FROM students s
               LEFT JOIN classes c ON s.class_id = c.class_id
               WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (classId) {
      sql += ` AND s.class_id = $${idx++}`;
      params.push(classId);
    }

    if (status) {
      sql += ` AND s.status = $${idx++}`;
      params.push(status);
    }

    if (search) {
      sql += ` AND (s.name ILIKE $${idx} OR s.nis ILIKE $${idx} OR s.nisn ILIKE $${idx} OR s.qr_code_id ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY s.name ASC`;
    const res = await db.query(sql, params);
    return res.rows;
  }

  async findById(studentId) {
    const res = await db.query(
      `SELECT s.student_id, s.class_id, s.name, s.gender, s.nis, s.nisn,
              s.birth_date, s.qr_code_id, s.status, s.created_at, s.updated_at,
              c.class_name
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.class_id
       WHERE s.student_id = $1`,
      [studentId]
    );
    return res.rows[0] || null;
  }

  async findByQrCodeId(qrCodeId) {
    const res = await db.query(
      `SELECT s.student_id, s.class_id, s.name, s.gender, s.nis, s.nisn,
              s.birth_date, s.qr_code_id, s.status, s.created_at, s.updated_at,
              c.class_name
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.class_id
       WHERE s.qr_code_id = $1`,
      [qrCodeId]
    );
    return res.rows[0] || null;
  }

  async getNextSequence(classLevel = 10) {
    const pattern = `STD-K${classLevel}%`;
    const res = await db.query(
      `SELECT student_id FROM students 
       WHERE student_id LIKE $1 
       ORDER BY student_id DESC LIMIT 1`,
      [pattern]
    );
    if (res.rows.length === 0) return 1;
    const match = res.rows[0].student_id.match(/STD-K\d+(\d+)/);
    return match ? parseInt(match[1], 10) + 1 : 1;
  }

  async create(data) {
    const res = await db.query(
      `INSERT INTO students (
        student_id, class_id, name, gender, nis, nisn, birth_date, qr_code_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.student_id, data.class_id, data.name, data.gender || null,
        data.nis || null, data.nisn || null, data.birth_date || null,
        data.qr_code_id, data.status || 'Active'
      ]
    );
    return res.rows[0];
  }

  async update(studentId, data) {
    const res = await db.query(
      `UPDATE students SET
        class_id = COALESCE($2, class_id),
        name = COALESCE($3, name),
        gender = $4,
        nis = $5,
        nisn = $6,
        birth_date = $7,
        qr_code_id = COALESCE($8, qr_code_id),
        status = COALESCE($9, status),
        updated_at = CURRENT_TIMESTAMP
       WHERE student_id = $1
       RETURNING *`,
      [
        studentId, data.class_id, data.name, data.gender,
        data.nis, data.nisn, data.birth_date, data.qr_code_id, data.status
      ]
    );
    return res.rows[0] || null;
  }

  async updateStatus(studentId, status) {
    const res = await db.query(
      `UPDATE students 
       SET status = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE student_id = $1 
       RETURNING student_id, name, status, updated_at`,
      [studentId, status]
    );
    return res.rows[0] || null;
  }

  async delete(studentId) {
    const res = await db.query(
      `DELETE FROM students WHERE student_id = $1 RETURNING student_id`,
      [studentId]
    );
    return res.rowCount > 0;
  }
}

module.exports = new StudentRepository();

