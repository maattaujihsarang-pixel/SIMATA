const { query } = require('../config/database');
const { BadRequestError } = require('../errors');
const logger = require('../utils/logger.util');

class FinanceSettingsService {
  /**
   * Mengambil semua entri konfigurasi keuangan sistem
   */
  async getAllSettings() {
    const result = await query(
      `SELECT setting_key, setting_value, description, updated_by_user_id, updated_at 
       FROM finance_settings 
       ORDER BY setting_key ASC`
    );

    const settingsMap = {};
    for (const row of result.rows) {
      settingsMap[row.setting_key] = row.setting_value;
    }

    return {
      settings: settingsMap,
      list: result.rows
    };
  }

  /**
   * Mengambil satu entri nilai konfigurasi berdasarkan setting_key
   */
  async getSetting(key) {
    const result = await query(
      `SELECT setting_key, setting_value, description, updated_at 
       FROM finance_settings 
       WHERE setting_key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  /**
   * Memperbarui beberapa nilai pengaturan keuangan secara atomik
   * @param {Object} payload Key-value pairs pengaturan yang akan diperbarui
   * @param {number} userId ID pengguna yang melakukan perubahan
   */
  async updateSettings(payload, userId) {
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      throw new BadRequestError('Payload pengaturan tidak boleh kosong.');
    }

    const entries = Object.entries(payload);
    for (const [key, val] of entries) {
      if (typeof val !== 'string' && typeof val !== 'number') {
        throw new BadRequestError(`Nilai untuk '${key}' harus berupa teks atau angka.`);
      }

      await query(
        `INSERT INTO finance_settings (setting_key, setting_value, updated_by_user_id, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (setting_key) 
         DO UPDATE SET 
           setting_value = EXCLUDED.setting_value,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = CURRENT_TIMESTAMP`,
        [key, String(val), userId || null]
      );
    }

    logger.info(`Finance settings updated by user_id: ${userId}`);
    return this.getAllSettings();
  }
}

module.exports = new FinanceSettingsService();
