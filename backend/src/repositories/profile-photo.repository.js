const db = require('../config/database');

class ProfilePhotoRepository {
  async findByStudentId(studentId) {
    const res = await db.query(
      `SELECT photo_id, student_id, teacher_id, file_name, storage_path,
              mime_type, file_size, width, height, uploaded_by_user_id,
              crop_scale, crop_position_x, crop_position_y,
              created_at, updated_at
       FROM profile_photos
       WHERE student_id = $1`,
      [studentId]
    );
    return res.rows[0] || null;
  }

  async findByTeacherId(teacherId) {
    const res = await db.query(
      `SELECT photo_id, student_id, teacher_id, file_name, storage_path,
              mime_type, file_size, width, height, uploaded_by_user_id,
              crop_scale, crop_position_x, crop_position_y,
              created_at, updated_at
       FROM profile_photos
       WHERE teacher_id = $1`,
      [teacherId]
    );
    return res.rows[0] || null;
  }

  async findByPhotoId(photoId) {
    const res = await db.query(
      `SELECT photo_id, student_id, teacher_id, file_name, storage_path,
              mime_type, file_size, width, height, uploaded_by_user_id,
              crop_scale, crop_position_x, crop_position_y,
              created_at, updated_at
       FROM profile_photos
       WHERE photo_id = $1`,
      [photoId]
    );
    return res.rows[0] || null;
  }

  async upsertStudentPhoto({
    photoId,
    studentId,
    fileName,
    storagePath,
    mimeType,
    fileSize,
    width = null,
    height = null,
    uploadedByUserId = null,
    cropScale = 1.00,
    cropPositionX = 0.00,
    cropPositionY = 0.00
  }) {
    const sql = `
      INSERT INTO profile_photos (
        photo_id, student_id, teacher_id, file_name, storage_path,
        mime_type, file_size, width, height, uploaded_by_user_id,
        crop_scale, crop_position_x, crop_position_y,
        created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (student_id) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        storage_path = EXCLUDED.storage_path,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        crop_scale = EXCLUDED.crop_scale,
        crop_position_x = EXCLUDED.crop_position_x,
        crop_position_y = EXCLUDED.crop_position_y,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await db.query(sql, [
      photoId,
      studentId,
      fileName,
      storagePath,
      mimeType,
      fileSize,
      width,
      height,
      uploadedByUserId,
      cropScale,
      cropPositionX,
      cropPositionY
    ]);
    return res.rows[0];
  }

  async upsertTeacherPhoto({
    photoId,
    teacherId,
    fileName,
    storagePath,
    mimeType,
    fileSize,
    width = null,
    height = null,
    uploadedByUserId = null,
    cropScale = 1.00,
    cropPositionX = 0.00,
    cropPositionY = 0.00
  }) {
    const sql = `
      INSERT INTO profile_photos (
        photo_id, student_id, teacher_id, file_name, storage_path,
        mime_type, file_size, width, height, uploaded_by_user_id,
        crop_scale, crop_position_x, crop_position_y,
        created_at, updated_at
      ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (teacher_id) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        storage_path = EXCLUDED.storage_path,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        crop_scale = EXCLUDED.crop_scale,
        crop_position_x = EXCLUDED.crop_position_x,
        crop_position_y = EXCLUDED.crop_position_y,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await db.query(sql, [
      photoId,
      teacherId,
      fileName,
      storagePath,
      mimeType,
      fileSize,
      width,
      height,
      uploadedByUserId,
      cropScale,
      cropPositionX,
      cropPositionY
    ]);
    return res.rows[0];
  }

  async updateStudentFraming(studentId, { cropScale = 1.00, cropPositionX = 0.00, cropPositionY = 0.00 }) {
    const sql = `
      UPDATE profile_photos
      SET crop_scale = $1,
          crop_position_x = $2,
          crop_position_y = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE student_id = $4
      RETURNING *;
    `;
    const res = await db.query(sql, [cropScale, cropPositionX, cropPositionY, studentId]);
    return res.rows[0] || null;
  }

  async updateTeacherFraming(teacherId, { cropScale = 1.00, cropPositionX = 0.00, cropPositionY = 0.00 }) {
    const sql = `
      UPDATE profile_photos
      SET crop_scale = $1,
          crop_position_x = $2,
          crop_position_y = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE teacher_id = $4
      RETURNING *;
    `;
    const res = await db.query(sql, [cropScale, cropPositionX, cropPositionY, teacherId]);
    return res.rows[0] || null;
  }

  async deleteByStudentId(studentId) {
    const res = await db.query(
      `DELETE FROM profile_photos WHERE student_id = $1 RETURNING *;`,
      [studentId]
    );
    return res.rows[0] || null;
  }

  async deleteByTeacherId(teacherId) {
    const res = await db.query(
      `DELETE FROM profile_photos WHERE teacher_id = $1 RETURNING *;`,
      [teacherId]
    );
    return res.rows[0] || null;
  }
}

module.exports = new ProfilePhotoRepository();
