const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger.util');
const { closePool } = require('./config/database');

const server = app.listen(env.PORT, () => {
  logger.info(`=======================================================`);
  logger.info(`SIMATA Backend Server running on port ${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(`Storage Provider: ${env.STORAGE_PROVIDER} (${env.STORAGE_PATH})`);
  logger.info(`REST Base URL: http://localhost:${env.PORT}/api/v1`);
  logger.info(`=======================================================`);
});

// Graceful shutdown handlers
async function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    await closePool();
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = server;

