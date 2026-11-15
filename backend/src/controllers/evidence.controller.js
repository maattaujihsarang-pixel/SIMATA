const evidenceService = require('../services/evidence.service');
const evidenceRetentionService = require('../services/evidence-retention.service');
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

  async getStorageOverview(req, res, next) {
    try {
      const data = await evidenceRetentionService.getStorageOverview();
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async updateRetentionPolicy(req, res, next) {
    try {
      const adminUserId = req.user ? req.user.user_id : null;
      const retentionDays = req.body ? req.body.retention_days : undefined;
      const data = await evidenceRetentionService.updateRetentionPolicy(retentionDays, adminUserId);
      return res.status(200).json({
        status: 'success',
        message: Number(retentionDays) === 0
          ? 'Pembersihan otomatis bukti foto dinonaktifkan.'
          : `Masa simpan otomatis bukti foto diatur menjadi ${retentionDays} hari.`,
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async previewCleanup(req, res, next) {
    try {
      const data = await evidenceRetentionService.previewCleanup(req.body || {});
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async executeCleanup(req, res, next) {
    try {
      const adminUserId = req.user ? req.user.user_id : null;
      const data = await evidenceRetentionService.executeCleanup({
        ...(req.body || {}),
        triggeredByUserId: adminUserId,
        source: 'MANUAL'
      });
      return res.status(200).json({
        status: 'success',
        message: data.deletedFiles > 0 || data.orphansPruned > 0
          ? `Berhasil membersihkan ${data.deletedFiles + data.orphansPruned} berkas foto.`
          : 'Tidak ada berkas foto yang perlu dibersihkan pada kriteria tersebut.',
        data
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new EvidenceController();

