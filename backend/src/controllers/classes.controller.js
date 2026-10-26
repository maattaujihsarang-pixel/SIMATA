const masterService = require('../services/master.service');

class ClassesController {
  async list(req, res, next) {
    try {
      const { status } = req.query;
      const classes = await masterService.getAllClasses(status);
      return res.status(200).json({
        status: 'success',
        data: classes
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const cls = await masterService.getClassById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data: cls
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * BUG 29 Resolution: Roster endpoint
   */
  async getRoster(req, res, next) {
    try {
      const { date } = req.query;
      const roster = await masterService.getClassRoster(req.params.id, date);
      return res.status(200).json({
        status: 'success',
        data: roster
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const newClass = await masterService.createClass(req.body);
      return res.status(201).json({
        status: 'success',
        message: 'Data kelas berhasil ditambahkan',
        data: newClass
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const updated = await masterService.updateClass(req.params.id, req.body);
      return res.status(200).json({
        status: 'success',
        message: 'Data kelas berhasil diperbarui',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const updated = await masterService.setClassStatus(req.params.id, status);
      return res.status(200).json({
        status: 'success',
        message: `Status kelas berhasil diubah menjadi ${status}`,
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ClassesController();

