const { query } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../errors');
const logger = require('../utils/logger.util');

class FeeCategoriesService {
  /**
   * Mengambil semua jenis kategori biaya
   */
  async getAll(includeInactive = false) {
    const sql = includeInactive
      ? `SELECT fee_category_id, name, description, default_amount, billing_cycle, is_active, created_at, updated_at 
         FROM fee_categories 
         ORDER BY name ASC`
      : `SELECT fee_category_id, name, description, default_amount, billing_cycle, is_active, created_at, updated_at 
         FROM fee_categories 
         WHERE is_active = TRUE 
         ORDER BY name ASC`;

    const result = await query(sql);
    return result.rows;
  }

  /**
   * Mengambil satu jenis biaya berdasarkan ID
   */
  async getById(id) {
    const result = await query(
      `SELECT fee_category_id, name, description, default_amount, billing_cycle, is_active, created_at, updated_at 
       FROM fee_categories 
       WHERE fee_category_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Jenis biaya dengan ID '${id}' tidak ditemukan`);
    }

    return result.rows[0];
  }

  /**
   * Membuat jenis biaya baru
   */
  async create(data) {
    const { fee_category_id, name, description, default_amount, billing_cycle, is_active } = data;

    if (!fee_category_id || !name) {
      throw new BadRequestError('ID Kategori Biaya (fee_category_id) dan Nama Biaya wajib diisi.');
    }

    const cleanId = String(fee_category_id).trim().toUpperCase();
    const cleanName = String(name).trim();
    const amount = Number(default_amount) || 0;
    const cycle = (billing_cycle || 'MONTHLY').toUpperCase();
    const active = is_active !== undefined ? Boolean(is_active) : true;

    const validCycles = ['MONTHLY', 'SEMESTER', 'ANNUAL', 'ONCE', 'CUSTOM'];
    if (!validCycles.includes(cycle)) {
      throw new BadRequestError(`Siklus tagihan (billing_cycle) harus salah satu dari: ${validCycles.join(', ')}`);
    }

    if (amount < 0) {
      throw new BadRequestError('Nominal default biaya tidak boleh negatif.');
    }

    // Cek duplikasi ID atau Nama
    const existing = await query(
      `SELECT fee_category_id, name FROM fee_categories 
       WHERE fee_category_id = $1 OR LOWER(name) = LOWER($2)`,
      [cleanId, cleanName]
    );

    if (existing.rows.length > 0) {
      const match = existing.rows[0];
      if (match.fee_category_id === cleanId) {
        throw new ConflictError(`ID Kategori Biaya '${cleanId}' sudah digunakan.`);
      }
      throw new ConflictError(`Nama Kategori Biaya '${cleanName}' sudah digunakan.`);
    }

    const insertRes = await query(
      `INSERT INTO fee_categories (fee_category_id, name, description, default_amount, billing_cycle, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [cleanId, cleanName, description || null, amount, cycle, active]
    );

    logger.info(`Fee category created: ${cleanId} - ${cleanName}`);
    return insertRes.rows[0];
  }

  /**
   * Memperbarui jenis biaya
   */
  async update(id, data) {
    const current = await this.getById(id);
    const { name, description, default_amount, billing_cycle, is_active } = data;

    const cleanName = name ? String(name).trim() : current.name;
    const amount = default_amount !== undefined ? Number(default_amount) : Number(current.default_amount);
    const cycle = billing_cycle ? String(billing_cycle).toUpperCase() : current.billing_cycle;
    const desc = description !== undefined ? description : current.description;
    const active = is_active !== undefined ? Boolean(is_active) : current.is_active;

    const validCycles = ['MONTHLY', 'SEMESTER', 'ANNUAL', 'ONCE', 'CUSTOM'];
    if (!validCycles.includes(cycle)) {
      throw new BadRequestError(`Siklus tagihan harus salah satu dari: ${validCycles.join(', ')}`);
    }

    if (amount < 0) {
      throw new BadRequestError('Nominal default biaya tidak boleh negatif.');
    }

    // Cek keunikan nama jika berubah
    if (cleanName.toLowerCase() !== current.name.toLowerCase()) {
      const dup = await query(
        `SELECT fee_category_id FROM fee_categories WHERE LOWER(name) = LOWER($1) AND fee_category_id <> $2`,
        [cleanName, id]
      );
      if (dup.rows.length > 0) {
        throw new ConflictError(`Nama Kategori Biaya '${cleanName}' sudah digunakan.`);
      }
    }

    const updateRes = await query(
      `UPDATE fee_categories 
       SET name = $1, description = $2, default_amount = $3, billing_cycle = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
       WHERE fee_category_id = $6
       RETURNING *`,
      [cleanName, desc, amount, cycle, active, id]
    );

    logger.info(`Fee category updated: ${id}`);
    return updateRes.rows[0];
  }

  /**
   * Mengubah status aktif/non-aktif jenis biaya
   */
  async toggleStatus(id, isActive) {
    await this.getById(id);
    const status = Boolean(isActive);

    const res = await query(
      `UPDATE fee_categories 
       SET is_active = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE fee_category_id = $2
       RETURNING *`,
      [status, id]
    );

    logger.info(`Fee category status toggled: ${id} -> ${status}`);
    return res.rows[0];
  }
}

module.exports = new FeeCategoriesService();
