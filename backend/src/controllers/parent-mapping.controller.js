const parentMappingService = require('../services/parent-mapping.service');

class ParentMappingController {
  async listParents(req, res, next) {
    try {
      const data = await parentMappingService.getAllParentsWithStudents();
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async linkStudent(req, res, next) {
    try {
      const { parent_user_id, student_id, relationship_type } = req.body;
      const data = await parentMappingService.linkStudent(parent_user_id, student_id, relationship_type);
      return res.status(201).json({
        status: 'success',
        message: 'Siswa berhasil dihubungkan ke akun orang tua',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async unlinkStudent(req, res, next) {
    try {
      const { userId, studentId } = req.params;
      const data = await parentMappingService.unlinkStudent(Number(userId), studentId);
      return res.status(200).json({
        status: 'success',
        message: data.message,
        data: data.unlinked
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyStudents(req, res, next) {
    try {
      const parentUserId = req.user.user_id;
      const data = await parentMappingService.getMyStudents(parentUserId);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ParentMappingController();
