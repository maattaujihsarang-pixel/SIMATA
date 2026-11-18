const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/simata_db',
  PGHOST: process.env.PGHOST || 'localhost',
  PGPORT: parseInt(process.env.PGPORT, 10) || 5432,
  PGDATABASE: process.env.PGDATABASE || 'simata_db',
  PGUSER: process.env.PGUSER || 'postgres',
  PGPASSWORD: process.env.PGPASSWORD || 'postgres',
  SESSION_EXPIRY_HOURS: parseInt(process.env.SESSION_EXPIRY_HOURS, 10) || 8,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || 'local',
  STORAGE_PATH: path.resolve(__dirname, '../../', process.env.STORAGE_PATH || './uploads/evidences'),
  PROFILE_PHOTO_STORAGE_PATH: path.resolve(__dirname, '../../', process.env.PROFILE_PHOTO_STORAGE_PATH || './uploads/profile_photos'),
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@SIMATA2026',
};

module.exports = env;

