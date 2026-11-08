const fs = require('fs');
const path = require('path');
const env = require('../src/config/env');
const { query, closePool } = require('../src/config/database');
const logger = require('../src/utils/logger.util');

const GRACE_PERIOD_MS = 60 * 60 * 1000; // 60 minutes grace period

async function reconcileStudentDocuments(options = false) {
  let dryRun = false;
  let gracePeriodMs = GRACE_PERIOD_MS;
  if (typeof options === 'boolean') {
    dryRun = options;
  } else if (typeof options === 'object' && options !== null) {
    dryRun = !!options.dryRun;
    if (options.gracePeriodMinutes !== undefined) {
      gracePeriodMs = options.gracePeriodMinutes * 60 * 1000;
    }
  }

  logger.info(`Starting student documents storage reconciliation (Dry Run: ${dryRun}, Grace Period: ${Math.round(gracePeriodMs / 60000)}m)...`);

  const storageDir = path.resolve(env.STUDENT_DOCUMENT_STORAGE_PATH);
  if (!fs.existsSync(storageDir)) {
    logger.info(`Storage directory ${storageDir} does not exist. Nothing to prune.`);
    return { scanned: 0, orphans_detected: 0, pruned: 0 };
  }

  // 1. Get all known file_names from database
  let dbFileNames = new Set();
  try {
    const res = await query(`SELECT DISTINCT file_name FROM student_documents WHERE file_name IS NOT NULL`);
    dbFileNames = new Set(res.rows.map(r => r.file_name));
    logger.info(`Found ${dbFileNames.size} referenced files in student_documents table.`);
  } catch (err) {
    logger.warn(`Could not query student_documents (${err.message}). Storage reconciliation skipped.`);
    return { status: 'PENDING', error: err.message };
  }

  // 2. Scan physical files in storage directory
  const filesOnDisk = fs.readdirSync(storageDir);
  const now = Date.now();

  const report = {
    scanned: filesOnDisk.length,
    valid_references: 0,
    in_grace_period: 0,
    orphans_detected: 0,
    pruned: 0,
    pruned_files: []
  };

  for (const filename of filesOnDisk) {
    if (filename.startsWith('.')) continue;
    const filePath = path.join(storageDir, filename);
    const stats = fs.statSync(filePath);

    if (!stats.isFile()) continue;

    if (dbFileNames.has(filename)) {
      report.valid_references++;
    } else {
      const fileAgeMs = now - stats.mtimeMs;
      if (fileAgeMs < gracePeriodMs) {
        report.in_grace_period++;
      } else {
        report.orphans_detected++;
        if (!dryRun) {
          try {
            fs.unlinkSync(filePath);
            report.pruned++;
            report.pruned_files.push(filename);
            logger.info(`Pruned orphan student document: ${filename} (Age: ${Math.round(fileAgeMs / 60000)} mins)`);
          } catch (delErr) {
            logger.error(`Failed to delete orphan file ${filename}:`, delErr.message);
          }
        } else {
          report.pruned_files.push(filename);
        }
      }
    }
  }

  logger.info('Student documents storage reconciliation complete:', report);
  return report;
}

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const graceMinutes = force ? 0 : 60;

  reconcileStudentDocuments({ dryRun: isDryRun, gracePeriodMinutes: graceMinutes })
    .then(() => closePool())
    .catch((err) => {
      logger.error('Storage reconciliation error:', err);
      closePool();
      process.exit(1);
    });
}

module.exports = reconcileStudentDocuments;
