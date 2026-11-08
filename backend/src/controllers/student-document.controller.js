const studentDocumentService = require('../services/student-document.service');
const { BadRequestError } = require('../errors');

class StudentDocumentController {
  async getStudentKartuPelajar(req, res, next) {
    try {
      const studentId = req.params.id;
      const isDownload = req.query.download === '1' || req.query.download === 'true';

      const { document: doc, filePath, student } = await studentDocumentService.getStudentDocument(studentId, 'KARTU_PELAJAR');

      let ext = 'pdf';
      if (doc.mime_type === 'image/jpeg') ext = 'jpg';
      else if (doc.mime_type === 'image/png') ext = 'png';
      else if (doc.mime_type === 'application/pdf') ext = 'pdf';

      const safeName = (student.name || 'siswa').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const identifier = student.nis || student.student_id;
      const filename = `Kartu_Pelajar_${identifier}_${safeName}.${ext}`;

      res.setHeader('Content-Type', doc.mime_type);
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

  async getStudentKartuPelajarMeta(req, res, next) {
    try {
      const meta = await studentDocumentService.getStudentDocumentMeta(req.params.id, 'KARTU_PELAJAR');
      return res.status(200).json({
        status: 'success',
        data: meta
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadStudentKartuPelajar(req, res, next) {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        throw new BadRequestError('File Kartu Pelajar tidak ditemukan dalam permintaan (field: document)');
      }

      const result = await studentDocumentService.uploadStudentDocument(req.params.id, {
        buffer: file.buffer,
        originalName: file.originalname,
        userId: req.user ? req.user.user_id : null,
        documentType: 'KARTU_PELAJAR'
      });

      return res.status(200).json({
        status: 'success',
        message: 'Kartu Pelajar berhasil disimpan',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteStudentKartuPelajar(req, res, next) {
    try {
      await studentDocumentService.deleteStudentDocument(req.params.id, 'KARTU_PELAJAR');
      return res.status(200).json({
        status: 'success',
        message: 'Kartu Pelajar berhasil dihapus'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StudentDocumentController();
