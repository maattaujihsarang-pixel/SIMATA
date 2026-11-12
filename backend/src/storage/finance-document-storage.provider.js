const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { generateUUID } = require('../utils/id-generator.util');
const { BadRequestError } = require('../errors');
const logger = require('../utils/logger.util');

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function detectMimeAndValidate(buffer) {
  if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
    throw new BadRequestError('File buffer tidak valid atau kosong');
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new BadRequestError(
      `Ukuran file bukti melebihi batas maksimal 5 MB (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`
    );
  }

  // 1. JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // 2. PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mimeType: 'image/png', ext: 'png' };
  }

  // 3. PDF: %PDF (0x25 0x50 0x44 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return { mimeType: 'application/pdf', ext: 'pdf' };
  }

  throw new BadRequestError(
    'Format file tidak didukung atau magic bytes tidak valid. Harap unggah dokumen berekstensi JPG, JPEG, PNG, atau PDF.'
  );
}

function sanitizeOriginalName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'bukti_pembayaran.bin';
  const basename = path.basename(rawName).replace(/[\0\r\n]/g, '').trim();
  const clean = basename.replace(/[^\w\s.\-()]/gi, '_');
  return clean || 'bukti_keuangan';
}

class FinanceDocumentStorageProvider {
  constructor(baseDir = path.join(env.STORAGE_PATH, 'finance')) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async saveDocument({ buffer, originalName = 'bukti_transfer.jpg' }) {
    const { mimeType, ext } = detectMimeAndValidate(buffer);
    const sanitizedOriginalName = sanitizeOriginalName(originalName);

    const docUuid = generateUUID();
    const physicalFileName = `fin_${docUuid}.${ext}`;
    const targetPath = path.join(this.baseDir, physicalFileName);

    await fs.promises.writeFile(targetPath, buffer);
    logger.debug(`Finance document saved: ${physicalFileName} (${buffer.length} bytes)`);

    return {
      documentId: docUuid,
      fileName: physicalFileName,
      originalName: sanitizedOriginalName,
      storagePath: 'finance',
      mimeType,
      fileSize: buffer.length,
      absolutePath: targetPath
    };
  }

  async deleteDocument(fileName) {
    if (!fileName) return false;
    const safeName = path.basename(fileName);
    const targetPath = path.join(this.baseDir, safeName);

    try {
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
        logger.info(`Finance document deleted: ${safeName}`);
        return true;
      }
    } catch (err) {
      logger.error(`Failed to delete finance document: ${safeName}`, err.message);
    }
    return false;
  }

  getDocumentPath(fileName) {
    const safeName = path.basename(fileName);
    return path.join(this.baseDir, safeName);
  }
}

module.exports = new FinanceDocumentStorageProvider();
