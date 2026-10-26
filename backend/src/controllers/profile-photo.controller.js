const profilePhotoService = require('../services/profile-photo.service');
const { BadRequestError } = require('../errors');

class ProfilePhotoController {
  async getStudentPhoto(req, res, next) {
    try {
      const studentId = req.params.id;
      const isDownload = req.query.download === '1' || req.query.download === 'true';

      const { photo, filePath, student } = await profilePhotoService.getStudentPhoto(studentId);

      const ext = photo.mime_type === 'image/png' ? 'png' : photo.mime_type === 'image/webp' ? 'webp' : 'jpg';
      const safeName = (student.name || 'siswa').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filename = `pasfoto_${student.student_id}_${safeName}.${ext}`;

      res.setHeader('Content-Type', photo.mime_type);
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

      if (isDownload) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      }

      return res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  async getTeacherPhoto(req, res, next) {
    try {
      const teacherId = req.params.id;
      const isDownload = req.query.download === '1' || req.query.download === 'true';

      const { photo, filePath, teacher } = await profilePhotoService.getTeacherPhoto(teacherId);

      const ext = photo.mime_type === 'image/png' ? 'png' : photo.mime_type === 'image/webp' ? 'webp' : 'jpg';
      const safeName = (teacher.name || 'guru').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filename = `pasfoto_${teacher.teacher_id}_${safeName}.${ext}`;

      res.setHeader('Content-Type', photo.mime_type);
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

      if (isDownload) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      }

      return res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  async getStudentMetadata(req, res, next) {
    try {
      const metadata = await profilePhotoService.getStudentPhotoMetadata(req.params.id);
      return res.json({
        status: 'success',
        data: metadata
      });
    } catch (error) {
      next(error);
    }
  }

  async getTeacherMetadata(req, res, next) {
    try {
      const metadata = await profilePhotoService.getTeacherPhotoMetadata(req.params.id);
      return res.json({
        status: 'success',
        data: metadata
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadStudentPhoto(req, res, next) {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        throw new BadRequestError('File foto tidak ditemukan dalam permintaan (field: photo)');
      }

      const { crop_scale, crop_position_x, crop_position_y } = req.body;
      const result = await profilePhotoService.uploadStudentPhoto(req.params.id, {
        buffer: file.buffer,
        originalName: file.originalname,
        userId: req.user ? req.user.user_id : null,
        cropScale: crop_scale !== undefined ? crop_scale : 1.00,
        cropPositionX: crop_position_x !== undefined ? crop_position_x : 0.00,
        cropPositionY: crop_position_y !== undefined ? crop_position_y : 0.00
      });

      return res.status(200).json({
        status: 'success',
        message: 'Pasfoto siswa berhasil disimpan',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadTeacherPhoto(req, res, next) {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        throw new BadRequestError('File foto tidak ditemukan dalam permintaan (field: photo)');
      }

      const { crop_scale, crop_position_x, crop_position_y } = req.body;
      const result = await profilePhotoService.uploadTeacherPhoto(req.params.id, {
        buffer: file.buffer,
        originalName: file.originalname,
        userId: req.user ? req.user.user_id : null,
        cropScale: crop_scale !== undefined ? crop_scale : 1.00,
        cropPositionX: crop_position_x !== undefined ? crop_position_x : 0.00,
        cropPositionY: crop_position_y !== undefined ? crop_position_y : 0.00
      });

      return res.status(200).json({
        status: 'success',
        message: 'Pasfoto guru berhasil disimpan',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStudentFraming(req, res, next) {
    try {
      const studentId = req.params.id;
      const { crop_scale, crop_position_x, crop_position_y } = req.body;
      if (crop_scale === undefined || crop_position_x === undefined || crop_position_y === undefined) {
        throw new BadRequestError('Field crop_scale, crop_position_x, dan crop_position_y wajib disertakan');
      }

      const result = await profilePhotoService.updateStudentFraming(studentId, {
        crop_scale,
        crop_position_x,
        crop_position_y
      });

      return res.status(200).json({
        status: 'success',
        message: 'Framing pasfoto siswa berhasil diperbarui',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async updateTeacherFraming(req, res, next) {
    try {
      const teacherId = req.params.id;
      const { crop_scale, crop_position_x, crop_position_y } = req.body;
      if (crop_scale === undefined || crop_position_x === undefined || crop_position_y === undefined) {
        throw new BadRequestError('Field crop_scale, crop_position_x, dan crop_position_y wajib disertakan');
      }

      const result = await profilePhotoService.updateTeacherFraming(teacherId, {
        crop_scale,
        crop_position_x,
        crop_position_y
      });

      return res.status(200).json({
        status: 'success',
        message: 'Framing pasfoto guru berhasil diperbarui',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteStudentPhoto(req, res, next) {
    try {
      await profilePhotoService.deleteStudentPhoto(req.params.id);
      return res.status(200).json({
        status: 'success',
        message: 'Pasfoto siswa berhasil dihapus'
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteTeacherPhoto(req, res, next) {
    try {
      await profilePhotoService.deleteTeacherPhoto(req.params.id);
      return res.status(200).json({
        status: 'success',
        message: 'Pasfoto guru berhasil dihapus'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProfilePhotoController();
