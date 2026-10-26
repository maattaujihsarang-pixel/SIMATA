const profilePhotoRepository = require('../repositories/profile-photo.repository');
const studentRepository = require('../repositories/student.repository');
const teacherRepository = require('../repositories/teacher.repository');
const profilePhotoStorage = require('../storage/profile-photo-storage.provider');
const { NotFoundError, BadRequestError } = require('../errors');
const { generateUUID } = require('../utils/id-generator.util');
const logger = require('../utils/logger.util');

class ProfilePhotoService {
  async getStudentPhoto(studentId) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByStudentId(studentId);
    if (!photo) {
      throw new NotFoundError(`Foto profil untuk siswa '${studentId}' belum tersedia`);
    }

    const filePath = profilePhotoStorage.getPhotoPath(photo.file_name);
    if (!filePath) {
      throw new NotFoundError(`File foto fisik untuk siswa '${studentId}' tidak ditemukan di storage`);
    }

    return { photo, filePath, student };
  }

  async getTeacherPhoto(teacherId) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new NotFoundError(`Data guru dengan ID '${teacherId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByTeacherId(teacherId);
    if (!photo) {
      throw new NotFoundError(`Foto profil untuk guru '${teacherId}' belum tersedia`);
    }

    const filePath = profilePhotoStorage.getPhotoPath(photo.file_name);
    if (!filePath) {
      throw new NotFoundError(`File foto fisik untuk guru '${teacherId}' tidak ditemukan di storage`);
    }

    return { photo, filePath, teacher };
  }

  async getStudentPhotoMetadata(studentId) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByStudentId(studentId);
    if (!photo) return null;

    return {
      photo_id: photo.photo_id,
      student_id: photo.student_id,
      file_name: photo.file_name,
      mime_type: photo.mime_type,
      file_size: photo.file_size,
      width: photo.width,
      height: photo.height,
      crop_scale: parseFloat(photo.crop_scale ?? 1),
      crop_position_x: parseFloat(photo.crop_position_x ?? 0),
      crop_position_y: parseFloat(photo.crop_position_y ?? 0),
      updated_at: photo.updated_at
    };
  }

  async getTeacherPhotoMetadata(teacherId) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new NotFoundError(`Data guru dengan ID '${teacherId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByTeacherId(teacherId);
    if (!photo) return null;

    return {
      photo_id: photo.photo_id,
      teacher_id: photo.teacher_id,
      file_name: photo.file_name,
      mime_type: photo.mime_type,
      file_size: photo.file_size,
      width: photo.width,
      height: photo.height,
      crop_scale: parseFloat(photo.crop_scale ?? 1),
      crop_position_x: parseFloat(photo.crop_position_x ?? 0),
      crop_position_y: parseFloat(photo.crop_position_y ?? 0),
      updated_at: photo.updated_at
    };
  }

  async uploadStudentPhoto(studentId, {
    buffer,
    originalName = 'photo.jpg',
    userId = null,
    cropScale = 1.00,
    cropPositionX = 0.00,
    cropPositionY = 0.00
  }) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const oldPhoto = await profilePhotoRepository.findByStudentId(studentId);

    // Save to disk first
    const savedFile = await profilePhotoStorage.savePhoto({ buffer, originalName });
    const photoId = oldPhoto ? oldPhoto.photo_id : generateUUID();

    try {
      const record = await profilePhotoRepository.upsertStudentPhoto({
        photoId,
        studentId,
        fileName: savedFile.fileName,
        storagePath: savedFile.storagePath,
        mimeType: savedFile.mimeType,
        fileSize: savedFile.fileSize,
        width: savedFile.width,
        height: savedFile.height,
        uploadedByUserId: userId,
        cropScale: parseFloat(cropScale) || 1.00,
        cropPositionX: parseFloat(cropPositionX) || 0.00,
        cropPositionY: parseFloat(cropPositionY) || 0.00
      });

      // Cleanup old file from disk if replaced successfully
      if (oldPhoto && oldPhoto.file_name && oldPhoto.file_name !== savedFile.fileName) {
        await profilePhotoStorage.deletePhoto(oldPhoto.file_name);
      }

      return {
        photo_id: record.photo_id,
        student_id: record.student_id,
        file_name: record.file_name,
        mime_type: record.mime_type,
        file_size: record.file_size,
        width: record.width,
        height: record.height,
        crop_scale: parseFloat(record.crop_scale ?? 1),
        crop_position_x: parseFloat(record.crop_position_x ?? 0),
        crop_position_y: parseFloat(record.crop_position_y ?? 0),
        updated_at: record.updated_at
      };
    } catch (dbError) {
      // Compensating action: remove newly uploaded file if database upsert fails
      logger.error('DB upsert failed, executing compensating cleanup on new photo:', dbError.message);
      await profilePhotoStorage.deletePhoto(savedFile.fileName);
      throw dbError;
    }
  }

  async uploadTeacherPhoto(teacherId, {
    buffer,
    originalName = 'photo.jpg',
    userId = null,
    cropScale = 1.00,
    cropPositionX = 0.00,
    cropPositionY = 0.00
  }) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new NotFoundError(`Data guru dengan ID '${teacherId}' tidak ditemukan`);
    }

    const oldPhoto = await profilePhotoRepository.findByTeacherId(teacherId);

    // Save to disk first
    const savedFile = await profilePhotoStorage.savePhoto({ buffer, originalName });
    const photoId = oldPhoto ? oldPhoto.photo_id : generateUUID();

    try {
      const record = await profilePhotoRepository.upsertTeacherPhoto({
        photoId,
        teacherId,
        fileName: savedFile.fileName,
        storagePath: savedFile.storagePath,
        mimeType: savedFile.mimeType,
        fileSize: savedFile.fileSize,
        width: savedFile.width,
        height: savedFile.height,
        uploadedByUserId: userId,
        cropScale: parseFloat(cropScale) || 1.00,
        cropPositionX: parseFloat(cropPositionX) || 0.00,
        cropPositionY: parseFloat(cropPositionY) || 0.00
      });

      // Cleanup old file from disk if replaced successfully
      if (oldPhoto && oldPhoto.file_name && oldPhoto.file_name !== savedFile.fileName) {
        await profilePhotoStorage.deletePhoto(oldPhoto.file_name);
      }

      return {
        photo_id: record.photo_id,
        teacher_id: record.teacher_id,
        file_name: record.file_name,
        mime_type: record.mime_type,
        file_size: record.file_size,
        width: record.width,
        height: record.height,
        crop_scale: parseFloat(record.crop_scale ?? 1),
        crop_position_x: parseFloat(record.crop_position_x ?? 0),
        crop_position_y: parseFloat(record.crop_position_y ?? 0),
        updated_at: record.updated_at
      };
    } catch (dbError) {
      // Compensating action: remove newly uploaded file if database upsert fails
      logger.error('DB upsert failed, executing compensating cleanup on new photo:', dbError.message);
      await profilePhotoStorage.deletePhoto(savedFile.fileName);
      throw dbError;
    }
  }

  async updateStudentFraming(studentId, { crop_scale, crop_position_x, crop_position_y }) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByStudentId(studentId);
    if (!photo) {
      throw new NotFoundError(`Foto profil untuk siswa '${studentId}' belum tersedia`);
    }

    const scale = parseFloat(crop_scale);
    const posX = parseFloat(crop_position_x);
    const posY = parseFloat(crop_position_y);

    if (isNaN(scale) || scale < 1.0 || scale > 5.0) {
      throw new BadRequestError('crop_scale harus berupa angka antara 1.0 dan 5.0');
    }
    if (isNaN(posX) || isNaN(posY)) {
      throw new BadRequestError('crop_position_x dan crop_position_y harus berupa angka valid');
    }

    const updated = await profilePhotoRepository.updateStudentFraming(studentId, {
      cropScale: scale,
      cropPositionX: posX,
      cropPositionY: posY
    });

    return {
      photo_id: updated.photo_id,
      student_id: updated.student_id,
      crop_scale: parseFloat(updated.crop_scale),
      crop_position_x: parseFloat(updated.crop_position_x),
      crop_position_y: parseFloat(updated.crop_position_y),
      updated_at: updated.updated_at
    };
  }

  async updateTeacherFraming(teacherId, { crop_scale, crop_position_x, crop_position_y }) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new NotFoundError(`Data guru dengan ID '${teacherId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByTeacherId(teacherId);
    if (!photo) {
      throw new NotFoundError(`Foto profil untuk guru '${teacherId}' belum tersedia`);
    }

    const scale = parseFloat(crop_scale);
    const posX = parseFloat(crop_position_x);
    const posY = parseFloat(crop_position_y);

    if (isNaN(scale) || scale < 1.0 || scale > 5.0) {
      throw new BadRequestError('crop_scale harus berupa angka antara 1.0 dan 5.0');
    }
    if (isNaN(posX) || isNaN(posY)) {
      throw new BadRequestError('crop_position_x dan crop_position_y harus berupa angka valid');
    }

    const updated = await profilePhotoRepository.updateTeacherFraming(teacherId, {
      cropScale: scale,
      cropPositionX: posX,
      cropPositionY: posY
    });

    return {
      photo_id: updated.photo_id,
      teacher_id: updated.teacher_id,
      crop_scale: parseFloat(updated.crop_scale),
      crop_position_x: parseFloat(updated.crop_position_x),
      crop_position_y: parseFloat(updated.crop_position_y),
      updated_at: updated.updated_at
    };
  }

  async deleteStudentPhoto(studentId) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByStudentId(studentId);
    if (!photo) {
      return false;
    }

    await profilePhotoRepository.deleteByStudentId(studentId);
    await profilePhotoStorage.deletePhoto(photo.file_name);
    return true;
  }

  async deleteTeacherPhoto(teacherId) {
    const teacher = await teacherRepository.findById(teacherId);
    if (!teacher) {
      throw new NotFoundError(`Data guru dengan ID '${teacherId}' tidak ditemukan`);
    }

    const photo = await profilePhotoRepository.findByTeacherId(teacherId);
    if (!photo) {
      return false;
    }

    await profilePhotoRepository.deleteByTeacherId(teacherId);
    await profilePhotoStorage.deletePhoto(photo.file_name);
    return true;
  }
}

module.exports = new ProfilePhotoService();
