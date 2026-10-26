const evidenceService = require('../services/evidence.service');
const storageProvider = require('../config/storage');
const { NotFoundError } = require('../errors');

class EvidenceController {
  async getBySession(req, res, next) {
    try {
      const evidences = await evidenceService.getEvidencesBySession(req.params.session_id);
      return res.status(200).json({
        status: 'success',
        data: evidences
      });
    } catch (error) {
      next(error);
    }
  }

  async getByAttendance(req, res, next) {
    try {
      const evidence = await evidenceService.getEvidenceByAttendance(req.params.attendance_id);
      return res.status(200).json({
        status: 'success',
        data: evidence
      });
    } catch (error) {
      next(error);
    }
  }

  async viewFile(req, res, next) {
    try {
      const filePath = await storageProvider.getFilePath(req.params.file_id);
      if (!filePath) {
        throw new NotFoundError('Berkas foto bukti tidak ditemukan di media storage');
      }
      return res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new EvidenceController();

