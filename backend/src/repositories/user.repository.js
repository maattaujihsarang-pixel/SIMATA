const db = require('../config/database');

class UserRepository {
  async findByUsername(username) {
    const res = await db.query(
      `SELECT user_id, username, password_hash, full_name, role, status, teacher_id, must_change_password, created_at, updated_at
       FROM users 
       WHERE LOWER(username) = LOWER($1)`,
      [username]
    );
    return res.rows[0] || null;
  }

  async findById(userId) {
    const res = await db.query(
      `SELECT user_id, username, full_name, role, status, teacher_id, must_change_password, created_at, updated_at
       FROM users 
       WHERE user_id = $1`,
      [userId]
    );
    return res.rows[0] || null;
  }

  async findAll() {
    const res = await db.query(
      `SELECT user_id, username, full_name, role, status, teacher_id, must_change_password, created_at, updated_at
       FROM users 
       ORDER BY user_id ASC`
    );
    return res.rows;
  }

  async create({ username, password_hash, full_name, role, status = 'Active', teacher_id = null, must_change_password = false }) {
    const res = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, status, teacher_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING user_id, username, full_name, role, status, teacher_id, must_change_password, created_at`,
      [username, password_hash, full_name, role, status, teacher_id, must_change_password]
    );
    return res.rows[0];
  }

  async update(userId, { full_name, role, status, teacher_id, must_change_password }) {
    const res = await db.query(
      `UPDATE users 
       SET full_name = COALESCE($2, full_name),
           role = COALESCE($3, role),
           status = COALESCE($4, status),
           teacher_id = $5,
           must_change_password = COALESCE($6, must_change_password),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING user_id, username, full_name, role, status, teacher_id, must_change_password, updated_at`,
      [userId, full_name, role, status, teacher_id, must_change_password]
    );
    return res.rows[0] || null;
  }

  async updatePassword(userId, password_hash) {
    const res = await db.query(
      `UPDATE users 
       SET password_hash = $2,
           must_change_password = FALSE,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING user_id, username`,
      [userId, password_hash]
    );
    return res.rows[0] || null;
  }

  async delete(userId) {
    const res = await db.query(
      `DELETE FROM users WHERE user_id = $1 RETURNING user_id`,
      [userId]
    );
    return res.rowCount > 0;
  }
}

module.exports = new UserRepository();

