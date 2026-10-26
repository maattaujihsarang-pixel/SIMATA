const env = require('./env');
const localStorageProvider = require('../storage/local-storage.provider');

function getStorageProvider() {
  switch (env.STORAGE_PROVIDER.toLowerCase()) {
    case 'local':
    default:
      return localStorageProvider;
  }
}

module.exports = getStorageProvider();

