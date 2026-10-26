const fs = require('fs');
const path = require('path');
const StorageProvider = require('./storage.interface');
const { generateUUID } = require('../utils/id-generator.util');
const env = require('../config/env');
const { BadRequestError } = require('../errors');
const logger = require('../utils/logger.util');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

class LocalStorageProvider extends StorageProvider {
  constructor(baseDir = env.STORAGE_PATH) {
    super();
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async saveFile({ buffer, originalName = 'photo.jpg', mimeType = 'image/jpeg' }) {
    if (!buffer || !(buffer instanceof Buffer)) {
      throw new BadRequestError('File buffer tidak valid');
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestError(`Ukuran file melebihi batas maksimal 5 MB (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
      throw new BadRequestError(`Tipe file '${mimeType}' tidak didukung. Gunakan JPEG atau PNG.`);
    }

    let ext = '.jpg';
    if (mimeType.toLowerCase().includes('png')) ext = '.png';
    else if (mimeType.toLowerCase().includes('webp')) ext = '.webp';

    const fileId = `${generateUUID()}${ext}`;
    const targetPath = path.join(this.baseDir, fileId);

    await fs.promises.writeFile(targetPath, buffer);
    logger.debug(`File saved to local storage: ${fileId} (${buffer.length} bytes)`);

    return {
      fileId,
      fileUrl: `/uploads/evidences/${fileId}`,
      storageProvider: 'LOCAL'
    };
  }

  async deleteFile(fileId) {
    if (!fileId) return false;
    const safeFileId = path.basename(fileId);
    const targetPath = path.join(this.baseDir, safeFileId);

    try {
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
        logger.info(`Compensating cleanup: deleted file from storage: ${safeFileId}`);
        return true;
      }
    } catch (err) {
      logger.error(`Failed to delete file from storage: ${safeFileId}`, err.message);
    }
    return false;
  }

  async getFilePath(fileId) {
    const safeFileId = path.basename(fileId);
    const targetPath = path.join(this.baseDir, safeFileId);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return targetPath;
  }
}

module.exports = new LocalStorageProvider();

