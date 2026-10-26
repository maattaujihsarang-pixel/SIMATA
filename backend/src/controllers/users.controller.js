const masterService = require('../services/master.service');

class UsersController {
  async list(req, res, next) {
    try {
      const users = await masterService.getAllUsers();
      return res.status(200).json({
        status: 'success',
        data: users
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const user = await masterService.getUserById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data: user
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const newUser = await masterService.createUser(req.body);
      return res.status(201).json({
        status: 'success',
        message: 'Pengguna baru berhasil dibuat',
        data: newUser
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const updated = await masterService.updateUser(req.params.id, req.body);
      return res.status(200).json({
        status: 'success',
        message: 'Data pengguna berhasil diperbarui',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      await masterService.deleteUser(req.params.id, req.user.user_id);
      return res.status(200).json({
        status: 'success',
        message: 'Pengguna berhasil dihapus'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UsersController();

