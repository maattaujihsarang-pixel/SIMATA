const storageProvider = require('../config/storage');
const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const { generateUUID } = require('../utils/id-generator.util');
const logger = require('../utils/logger.util');

function generateEvidenceId(attendanceDate) {
  const dateCompact = (attendanceDate || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const timeCompact = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
  const shortHash = generateUUID().substring(0, 8);
  return `EVID-TCH-${dateCompact}_${timeCompact}-${shortHash}`;
}

class EvidenceService {
  /**
   * Upload file to storage provider
   */
  async uploadFile({ buffer, originalName, mimeType }) {
    return storageProvider.saveFile({ buffer, originalName, mimeType });
  }

  /**
   * Compensating cleanup: delete file from storage if DB transaction fails
   */
  async deleteFile(fileId) {
    return storageProvider.deleteFile(fileId);
  }

  /**
   * Link evidence metadata in database
   */
  async createEvidenceRecord({ sessionId, operatorUserId, fileId, fileUrl, attendanceId, storageProvider: provider, mimeType, capturedAt }, client = null) {
    const evidenceId = generateEvidenceId();
    return attendanceEvidenceRepository.insertSingle({
      evidence_id: evidenceId,
      session_id: sessionId,
      operator_user_id: operatorUserId,
      captured_at: capturedAt || new Date().toISOString(),
      file_id: fileId,
      file_url: fileUrl,
      attendance_id: attendanceId,
      storage_provider: provider || 'LOCAL',
      mime_type: mimeType || 'image/jpeg'
    }, client);
  }

  async getEvidencesBySession(sessionId) {
    return attendanceEvidenceRepository.findBySessionId(sessionId);
  }

  async getEvidenceByAttendance(attendanceId) {
    return attendanceEvidenceRepository.findByAttendanceId(attendanceId);
  }
}

module.exports = new EvidenceService();

