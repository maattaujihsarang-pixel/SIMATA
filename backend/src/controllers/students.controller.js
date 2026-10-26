const masterService = require('../services/master.service');

class StudentsController {
  async list(req, res, next) {
    try {
      const { class_id, status, search } = req.query;
      const students = await masterService.getAllStudents({ classId: class_id, status, search });
      return res.status(200).json({
        status: 'success',
        data: students
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const student = await masterService.getStudentById(req.params.id);
      return res.status(200).json({
        status: 'success',
        data: student
      });
    } catch (error) {
      next(error);
    }
  }

  async getByQr(req, res, next) {
    try {
      const student = await masterService.getStudentByQr(req.params.qr_code_id);
      return res.status(200).json({
        status: 'success',
        data: student
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const newStudent = await masterService.createStudent(req.body);
      return res.status(201).json({
        status: 'success',
        message: 'Data siswa berhasil ditambahkan',
        data: newStudent
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const updated = await masterService.updateStudent(req.params.id, req.body);
      return res.status(200).json({
        status: 'success',
        message: 'Data siswa berhasil diperbarui',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const updated = await masterService.setStudentStatus(req.params.id, status);
      return res.status(200).json({
        status: 'success',
        message: `Status siswa berhasil diubah menjadi ${status}`,
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      await masterService.deleteStudent(req.params.id);
      return res.status(200).json({
        status: 'success',
        message: 'Data siswa berhasil dihapus'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StudentsController();

