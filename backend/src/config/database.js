const { Pool, types } = require('pg');
const env = require('./env');
const logger = require('../utils/logger.util');

// Force PostgreSQL DATE (OID 1082) to be returned as raw string 'YYYY-MM-DD'
// Prevents local timezone conversion and UTC offset shift when serializing to JSON
types.setTypeParser(1082, (val) => val);

let pool = null;
let mockQueryHandler = null;
let mockTransactionHandler = null;

function getPool() {
  if (mockQueryHandler) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      host: env.PGHOST,
      port: env.PGPORT,
      database: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client', err);
    });
  }
  return pool;
}

/**
 * Execute a SQL query using connection pool (or test mock handler if active)
 * @param {string} text 
 * @param {Array} params 
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  if (mockQueryHandler) {
    return mockQueryHandler(text, params);
  }

  const start = Date.now();
  const client = getPool();
  try {
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Database query error', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
}

/**
 * Acquire a dedicated client for transaction execution
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  const p = getPool();
  return p.connect();
}

/**
 * Execute callback within an isolated transaction (BEGIN ... COMMIT/ROLLBACK)
 * @param {Function} callback (client) => Promise<any>
 * @returns {Promise<any>}
 */
async function withTransaction(callback) {
  if (mockTransactionHandler) {
    return mockTransactionHandler(callback);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Set mock query handler for unit/isolated integration tests
 */
function setMockQueryHandler(handler) {
  mockQueryHandler = handler;
}

/**
 * Set mock transaction handler for unit/isolated integration tests
 */
function setMockTransactionHandler(handler) {
  mockTransactionHandler = handler;
}

function clearMockHandlers() {
  mockQueryHandler = null;
  mockTransactionHandler = null;
}

/**
 * Close pool during graceful shutdown
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL connection pool closed');
  }
}

module.exports = {
  getPool,
  query,
  getClient,
  withTransaction,
  setMockQueryHandler,
  setMockTransactionHandler,
  clearMockHandlers,
  closePool
};

