const notificationsService = require('../services/notifications.service');

class NotificationsController {
  async getFeed(req, res, next) {
    try {
      const { date, time_wib, day_of_week } = req.query || {};
      const data = await notificationsService.getNotificationsFeed({
        user: req.user || null,
        date,
        time_wib,
        day_of_week
      });
      res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async getSettings(req, res, next) {
    try {
      const data = await notificationsService.getRulesConfig();
      res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSettings(req, res, next) {
    try {
      const data = await notificationsService.updateRulesConfig(
        req.body || {},
        req.user ? req.user.user_id : null
      );
      res.status(200).json({
        status: 'success',
        message: 'Pengaturan pusat notifikasi berhasil diperbarui',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async createBroadcast(req, res, next) {
    try {
      const item = await notificationsService.createBroadcast(req.body || {}, req.user || null);
      res.status(201).json({
        status: 'success',
        message: 'Pengumuman notifikasi berhasil dikirim',
        data: item
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteBroadcast(req, res, next) {
    try {
      const result = await notificationsService.deleteBroadcast(req.params.id, req.user || null);
      res.status(200).json({
        status: 'success',
        message: 'Pengumuman notifikasi berhasil dihapus',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async logEvent(req, res, next) {
    try {
      const evt = await notificationsService.logEvent(req.body || {}, req.user || null);
      res.status(201).json({
        status: 'success',
        data: evt
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationsController();
