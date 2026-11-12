const feeCategoriesService = require('../services/fee-categories.service');

class FeeCategoriesController {
  async list(req, res, next) {
    try {
      const includeInactive = req.query.include_inactive === 'true' || req.query.all === 'true';
      const data = await feeCategoriesService.getAll(includeInactive);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const data = await feeCategoriesService.getById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const data = await feeCategoriesService.create(req.body);
      return res.status(201).json({
        status: 'success',
        message: 'Jenis biaya baru berhasil ditambahkan',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const data = await feeCategoriesService.update(req.params.id, req.body);
      return res.status(200).json({
        status: 'success',
        message: 'Jenis biaya berhasil diperbarui',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async toggleStatus(req, res, next) {
    try {
      const { is_active } = req.body;
      const data = await feeCategoriesService.toggleStatus(req.params.id, is_active);
      return res.status(200).json({
        status: 'success',
        message: `Status jenis biaya berhasil diubah menjadi ${data.is_active ? 'Aktif' : 'Non-aktif'}`,
        data
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new FeeCategoriesController();
