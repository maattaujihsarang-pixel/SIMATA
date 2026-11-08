const db = require('../config/database');

class StudentDocumentRepository {
  async findByStudentAndType(studentId, documentType = 'KARTU_PELAJAR') {
    const res = await db.query(
      `SELECT document_id, student_id, document_type, file_name, original_name,
              storage_path, mime_type, file_size, uploaded_by_user_id,
              created_at, updated_at
       FROM student_documents
       WHERE student_id = $1 AND document_type = $2`,
      [studentId, documentType]
    );
    return res.rows[0] || null;
  }

  async findById(documentId) {
    const res = await db.query(
      `SELECT document_id, student_id, document_type, file_name, original_name,
              storage_path, mime_type, file_size, uploaded_by_user_id,
              created_at, updated_at
       FROM student_documents
       WHERE document_id = $1`,
      [documentId]
    );
    return res.rows[0] || null;
  }

  async upsertDocument({
    documentId,
    studentId,
    documentType = 'KARTU_PELAJAR',
    fileName,
    originalName,
    storagePath,
    mimeType,
    fileSize,
    uploadedByUserId = null
  }) {
    const sql = `
      INSERT INTO student_documents (
        document_id, student_id, document_type, file_name, original_name,
        storage_path, mime_type, file_size, uploaded_by_user_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (student_id, document_type) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        original_name = EXCLUDED.original_name,
        storage_path = EXCLUDED.storage_path,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await db.query(sql, [
      documentId,
      studentId,
      documentType,
      fileName,
      originalName,
      storagePath,
      mimeType,
      fileSize,
      uploadedByUserId
    ]);
    return res.rows[0];
  }

  async deleteByStudentAndType(studentId, documentType = 'KARTU_PELAJAR') {
    const res = await db.query(
      `DELETE FROM student_documents
       WHERE student_id = $1 AND document_type = $2
       RETURNING *;`,
      [studentId, documentType]
    );
    return res.rows[0] || null;
  }
}

module.exports = new StudentDocumentRepository();
