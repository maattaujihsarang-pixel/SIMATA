/**
 * Storage Provider Interface
 * Standard abstraction for file storage (Local disk, Google Drive, AWS S3, etc.)
 */
class StorageProvider {
  /**
   * Save a file buffer to storage
   * @param {Object} options
   * @param {Buffer} options.buffer
   * @param {string} options.originalName
   * @param {string} options.mimeType
   * @returns {Promise<{ fileId: string, fileUrl: string, storageProvider: string }>}
   */
  async saveFile(options) {
    throw new Error('saveFile method not implemented');
  }

  /**
   * Delete a file from storage by fileId
   * @param {string} fileId
   * @returns {Promise<boolean>}
   */
  async deleteFile(fileId) {
    throw new Error('deleteFile method not implemented');
  }

  /**
   * Get stream or path to file
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async getFilePath(fileId) {
    throw new Error('getFilePath method not implemented');
  }
}

module.exports = StorageProvider;

