const masterService = require('../services/master.service');

class TeachersController {
  async list(req, res, next) {
    try {
      const { status } = req.query;
      const teachers = await masterService.getAllTeachers(status);
      return res.status(200).json({
        status: 'success',
        data: teachers
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const teacher = await masterService.getTeacherById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data: teacher
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const newTeacher = await masterService.createTeacher(req.body);
      return res.status(201).json({
        status: 'success',
        message: 'Data guru berhasil ditambahkan',
        data: newTeacher
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const updated = await masterService.updateTeacher(req.params.id, req.body);
      return res.status(200).json({
        status: 'success',
        message: 'Data guru berhasil diperbarui',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const updated = await masterService.setTeacherStatus(req.params.id, status);
      return res.status(200).json({
        status: 'success',
        message: `Status guru berhasil diubah menjadi ${status}`,
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      await masterService.deleteTeacher(req.params.id);
      return res.status(200).json({
        status: 'success',
        message: 'Data guru berhasil dihapus'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TeachersController();

