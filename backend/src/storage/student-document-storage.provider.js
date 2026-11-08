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
      `Ukuran file melebihi batas maksimal 5 MB (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`
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
  if (!rawName || typeof rawName !== 'string') return 'dokumen.bin';
  // Remove directory traversal, null bytes, backslashes
  const basename = path.basename(rawName).replace(/[\0\r\n]/g, '').trim();
  // Replace unsafe characters
  const clean = basename.replace(/[^\w\s.\-()]/gi, '_');
  return clean || 'kartu_pelajar';
}

class StudentDocumentStorageProvider {
  constructor(baseDir = env.STUDENT_DOCUMENT_STORAGE_PATH) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async saveDocument({ buffer, originalName = 'kartu_pelajar.pdf' }) {
    const { mimeType, ext } = detectMimeAndValidate(buffer);
    const cleanOriginalName = sanitizeOriginalName(originalName);

    const fileId = generateUUID();
    const fileName = `doc_${fileId}.${ext}`;
    const destinationPath = path.join(this.baseDir, fileName);

    await fs.promises.writeFile(destinationPath, buffer);

    logger.debug(`[StudentDocumentStorage] Saved document ${fileName} (${buffer.length} bytes, ${mimeType})`);

    return {
      fileName,
      storagePath: destinationPath,
      mimeType,
      fileSize: buffer.length,
      originalName: cleanOriginalName
    };
  }

  getDocumentPath(fileName) {
    if (!fileName || typeof fileName !== 'string') return null;
    // Prevent directory traversal
    const safeBaseName = path.basename(fileName);
    const resolvedPath = path.resolve(this.baseDir, safeBaseName);
    if (!resolvedPath.startsWith(this.baseDir)) {
      return null;
    }
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
    return null;
  }

  async deleteDocument(fileName) {
    if (!fileName || typeof fileName !== 'string') return;
    const filePath = this.getDocumentPath(fileName);
    if (filePath && fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
        logger.debug(`[StudentDocumentStorage] Deleted document ${fileName}`);
      } catch (err) {
        logger.warn(`[StudentDocumentStorage] Failed to delete file ${fileName}:`, err.message);
      }
    }
  }
}

module.exports = new StudentDocumentStorageProvider();
