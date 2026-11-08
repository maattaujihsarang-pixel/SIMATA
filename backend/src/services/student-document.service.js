const studentDocumentRepository = require('../repositories/student-document.repository');
const studentRepository = require('../repositories/student.repository');
const studentDocumentStorage = require('../storage/student-document-storage.provider');
const { NotFoundError, BadRequestError } = require('../errors');
const { generateUUID } = require('../utils/id-generator.util');
const logger = require('../utils/logger.util');

class StudentDocumentService {
  async getStudentDocument(studentId, documentType = 'KARTU_PELAJAR') {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const document = await studentDocumentRepository.findByStudentAndType(studentId, documentType);
    if (!document) {
      throw new NotFoundError(`Dokumen ${documentType} untuk siswa '${studentId}' belum tersedia`);
    }

    const filePath = studentDocumentStorage.getDocumentPath(document.file_name);
    if (!filePath) {
      throw new NotFoundError(`Berkas fisik untuk dokumen '${documentType}' tidak ditemukan di storage`);
    }

    return { document, filePath, student };
  }

  async getStudentDocumentMeta(studentId, documentType = 'KARTU_PELAJAR') {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const document = await studentDocumentRepository.findByStudentAndType(studentId, documentType);
    if (!document) {
      return {
        available: false,
        student_id: studentId,
        document_type: documentType
      };
    }

    return {
      available: true,
      document_id: document.document_id,
      student_id: document.student_id,
      document_type: document.document_type,
      file_name: document.original_name,
      mime_type: document.mime_type,
      file_size: document.file_size,
      created_at: document.created_at,
      updated_at: document.updated_at
    };
  }

  async uploadStudentDocument(studentId, {
    buffer,
    originalName = 'kartu_pelajar.pdf',
    userId = null,
    documentType = 'KARTU_PELAJAR'
  }) {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const oldDoc = await studentDocumentRepository.findByStudentAndType(studentId, documentType);

    // 1. Save new file to storage first
    const savedFile = await studentDocumentStorage.saveDocument({ buffer, originalName });
    const documentId = oldDoc ? oldDoc.document_id : generateUUID();

    try {
      // 2. Persist / update metadata in database
      const record = await studentDocumentRepository.upsertDocument({
        documentId,
        studentId,
        documentType,
        fileName: savedFile.fileName,
        originalName: savedFile.originalName,
        storagePath: savedFile.storagePath,
        mimeType: savedFile.mimeType,
        fileSize: savedFile.fileSize,
        uploadedByUserId: userId
      });

      // 3. If previous file existed and physical filename changed, remove previous file from disk
      if (oldDoc && oldDoc.file_name && oldDoc.file_name !== savedFile.fileName) {
        try {
          await studentDocumentStorage.deleteDocument(oldDoc.file_name);
        } catch (cleanupErr) {
          logger.warn(`[StudentDocumentService] Failed to cleanup replaced file ${oldDoc.file_name}:`, cleanupErr.message);
        }
      }

      logger.info(`[StudentDocumentService] Successfully saved ${documentType} for student ${studentId}`);

      return {
        document_id: record.document_id,
        student_id: record.student_id,
        document_type: record.document_type,
        file_name: record.original_name,
        mime_type: record.mime_type,
        file_size: record.file_size,
        updated_at: record.updated_at
      };
    } catch (dbError) {
      // Compensating action: remove newly saved file on DB failure
      try {
        await studentDocumentStorage.deleteDocument(savedFile.fileName);
      } catch (cleanupErr) {
        logger.error(`[StudentDocumentService] Failed compensating cleanup for ${savedFile.fileName}:`, cleanupErr.message);
      }
      throw dbError;
    }
  }

  async deleteStudentDocument(studentId, documentType = 'KARTU_PELAJAR') {
    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    const existingDoc = await studentDocumentRepository.findByStudentAndType(studentId, documentType);
    if (!existingDoc) {
      throw new NotFoundError(`Dokumen ${documentType} untuk siswa '${studentId}' tidak ditemukan`);
    }

    // 1. Remove record from database
    await studentDocumentRepository.deleteByStudentAndType(studentId, documentType);

    // 2. Remove file from storage
    if (existingDoc.file_name) {
      try {
        await studentDocumentStorage.deleteDocument(existingDoc.file_name);
      } catch (err) {
        logger.warn(`[StudentDocumentService] Failed to remove physical file ${existingDoc.file_name}:`, err.message);
      }
    }

    logger.info(`[StudentDocumentService] Deleted ${documentType} for student ${studentId}`);
    return true;
  }
}

module.exports = new StudentDocumentService();
