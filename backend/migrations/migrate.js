const fs = require('fs');
const path = require('path');
const { query, closePool } = require('../src/config/database');
const logger = require('../src/utils/logger.util');

async function runMigrations() {
  logger.info('Starting PostgreSQL schema migrations...');

  try {
    // Create migrations tracker table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version VARCHAR(50) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationFiles = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const version = file.replace(/\.sql$/, '');
      const check = await query('SELECT version FROM _schema_migrations WHERE version = $1', [version]);
      if (check.rows.length > 0) {
        logger.info(`Migration ${version} already applied. Skipping.`);
        continue;
      }

      logger.info(`Applying ${file}...`);
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      await query(sql);
      await query('INSERT INTO _schema_migrations (version) VALUES ($1)', [version]);
      logger.info(`Migration ${version} successfully applied.`);
    }

    return true;
  } catch (error) {
    logger.error('Failed to execute migration:', error.message);
    throw error;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migrations finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      logger.warn('Migration could not connect to PostgreSQL runtime:', err.message);
      process.exit(1);
    });
}

module.exports = runMigrations;

