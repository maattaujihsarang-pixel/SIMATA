const db = require('../config/database');

class AcademicYearRepository {
  async getActiveYear() {
    const res = await db.query(
      `SELECT academic_year_id, name, is_active, start_date, end_date
       FROM academic_years
       WHERE is_active = TRUE
       LIMIT 1`
    );
    return res.rows[0] || null;
  }

  async findAll() {
    const res = await db.query(
      `SELECT academic_year_id, name, is_active, start_date, end_date
       FROM academic_years
       ORDER BY academic_year_id DESC`
    );
    return res.rows;
  }

  async findById(academicYearId) {
    const res = await db.query(
      `SELECT academic_year_id, name, is_active, start_date, end_date
       FROM academic_years
       WHERE academic_year_id = $1`,
      [academicYearId]
    );
    return res.rows[0] || null;
  }

  async create({ academic_year_id, name, is_active = true, start_date = null, end_date = null }) {
    const res = await db.query(
      `INSERT INTO academic_years (academic_year_id, name, is_active, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING academic_year_id, name, is_active, start_date, end_date`,
      [academic_year_id, name, is_active, start_date, end_date]
    );
    return res.rows[0];
  }
}

module.exports = new AcademicYearRepository();

