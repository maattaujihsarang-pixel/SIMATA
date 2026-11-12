const financeSettingsService = require('../services/finance-settings.service');

class FinanceSettingsController {
  async getSettings(req, res, next) {
    try {
      const data = await financeSettingsService.getAllSettings();
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSettings(req, res, next) {
    try {
      const userId = req.user ? req.user.user_id : null;
      const data = await financeSettingsService.updateSettings(req.body, userId);
      return res.status(200).json({
        status: 'success',
        message: 'Pengaturan keuangan berhasil disimpan',
        data
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new FinanceSettingsController();
