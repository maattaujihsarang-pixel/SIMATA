const db = require('../config/database');

class TeacherRepository {
  async findAll({ status = null } = {}) {
    let sql = `SELECT teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
                      qr_code_id, birth_place, birth_date, village, district, regency,
                      phone, email, education, major, graduation_year, teaching_hours,
                      created_at, updated_at
               FROM teachers`;
    const params = [];

    if (status) {
      sql += ` WHERE status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY name ASC`;
    const res = await db.query(sql, params);
    return res.rows;
  }

  async findById(teacherId) {
    const res = await db.query(
      `SELECT teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
              qr_code_id, birth_place, birth_date, village, district, regency,
              phone, email, education, major, graduation_year, teaching_hours,
              created_at, updated_at
       FROM teachers
       WHERE teacher_id = $1`,
      [teacherId]
    );
    return res.rows[0] || null;
  }

  async getNextSequence() {
    const res = await db.query(
      `SELECT teacher_id FROM teachers 
       WHERE teacher_id LIKE 'TCH-%' 
       ORDER BY teacher_id DESC LIMIT 1`
    );
    if (res.rows.length === 0) return 1;
    const match = res.rows[0].teacher_id.match(/TCH-(\d+)/);
    return match ? parseInt(match[1], 10) + 1 : 1;
  }

  async create(data) {
    const res = await db.query(
      `INSERT INTO teachers (
        teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
        qr_code_id, birth_place, birth_date, village, district, regency,
        phone, email, education, major, graduation_year, teaching_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        data.teacher_id, data.name, data.position || 'Guru Mapel', data.status || 'Active',
        data.subject, data.gender || null, data.nip || null, data.nuptk || null, data.nik || null,
        data.qr_code_id || null, data.birth_place || null, data.birth_date || null,
        data.village || null, data.district || null, data.regency || null,
        data.phone || null, data.email || null, data.education || null,
        data.major || null, data.graduation_year || null, data.teaching_hours || null
      ]
    );
    return res.rows[0];
  }

  async update(teacherId, data) {
    const res = await db.query(
      `UPDATE teachers SET
        name = COALESCE($2, name),
        position = COALESCE($3, position),
        status = COALESCE($4, status),
        subject = COALESCE($5, subject),
        gender = $6,
        nip = $7,
        nuptk = $8,
        nik = $9,
        qr_code_id = $10,
        birth_place = $11,
        birth_date = $12,
        village = $13,
        district = $14,
        regency = $15,
        phone = $16,
        email = $17,
        education = $18,
        major = $19,
        graduation_year = $20,
        teaching_hours = $21,
        updated_at = CURRENT_TIMESTAMP
      WHERE teacher_id = $1
      RETURNING *`,
      [
        teacherId, data.name, data.position, data.status, data.subject,
        data.gender, data.nip, data.nuptk, data.nik, data.qr_code_id,
        data.birth_place, data.birth_date, data.village, data.district,
        data.regency, data.phone, data.email, data.education,
        data.major, data.graduation_year, data.teaching_hours
      ]
    );
    return res.rows[0] || null;
  }

  async updateStatus(teacherId, status) {
    const res = await db.query(
      `UPDATE teachers 
       SET status = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE teacher_id = $1 
       RETURNING teacher_id, name, status, updated_at`,
      [teacherId, status]
    );
    return res.rows[0] || null;
  }

  async delete(teacherId) {
    const res = await db.query(
      `DELETE FROM teachers WHERE teacher_id = $1 RETURNING teacher_id`,
      [teacherId]
    );
    return res.rowCount > 0;
  }
}

module.exports = new TeacherRepository();

