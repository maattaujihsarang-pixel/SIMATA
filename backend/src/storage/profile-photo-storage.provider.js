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

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mimeType: 'image/png', ext: 'png' };
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }

  throw new BadRequestError(
    'Format file tidak didukung atau magic bytes tidak valid. Harap unggah foto berekstensi JPEG, PNG, atau WebP.'
  );
}

function extractImageDimensions(buffer, mimeType) {
  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }

    if (mimeType === 'image/webp' && buffer.length >= 30) {
      if (buffer.subarray(12, 16).toString('ascii') === 'VP8 ') {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width, height };
      }
      if (buffer.subarray(12, 16).toString('ascii') === 'VP8L') {
        const b1 = buffer[21];
        const b2 = buffer[22];
        const b3 = buffer[23];
        const b4 = buffer[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        return { width, height };
      }
      if (buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return { width, height };
      }
    }
  } catch (err) {
    logger.debug('Dimensi foto tidak dapat diekstrak:', err.message);
  }

  return { width: null, height: null };
}

class ProfilePhotoStorageProvider {
  constructor(baseDir = env.PROFILE_PHOTO_STORAGE_PATH) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async savePhoto({ buffer, originalName = 'photo.jpg' }) {
    const { mimeType, ext } = detectMimeAndValidate(buffer);
    const { width, height } = extractImageDimensions(buffer, mimeType);

    const fileName = `${generateUUID()}.${ext}`;
    const targetPath = path.join(this.baseDir, fileName);

    await fs.promises.writeFile(targetPath, buffer);
    logger.info(`Profile photo saved to disk: ${fileName} (${buffer.length} bytes, ${mimeType})`);

    const relativeStoragePath = `uploads/profile_photos/${fileName}`;

    return {
      fileName,
      storagePath: relativeStoragePath,
      mimeType,
      fileSize: buffer.length,
      width,
      height
    };
  }

  async deletePhoto(fileName) {
    if (!fileName) return false;
    const safeFileName = path.basename(fileName);
    const targetPath = path.join(this.baseDir, safeFileName);

    try {
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
        logger.info(`Profile photo deleted from disk: ${safeFileName}`);
        return true;
      }
    } catch (err) {
      logger.error(`Gagal menghapus file profile photo: ${safeFileName}`, err.message);
    }
    return false;
  }

  getPhotoPath(fileName) {
    if (!fileName) return null;
    const safeFileName = path.basename(fileName);
    const targetPath = path.join(this.baseDir, safeFileName);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return targetPath;
  }
}

module.exports = new ProfilePhotoStorageProvider();
