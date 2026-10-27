const fs = require('fs');
const path = require('path');
const env = require('../src/config/env');
const { query, closePool } = require('../src/config/database');
const logger = require('../src/utils/logger.util');

const GRACE_PERIOD_MS = 60 * 60 * 1000; // 60 minutes grace period

async function reconcileEvidenceStorage(options = false) {
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

  logger.info(`Starting evidence storage reconciliation (Dry Run: ${dryRun}, Grace Period: ${Math.round(gracePeriodMs / 60000)}m)...`);

  const storageDir = path.resolve(env.STORAGE_PATH);
  if (!fs.existsSync(storageDir)) {
    logger.info(`Storage directory ${storageDir} does not exist. Nothing to prune.`);
    return { scanned: 0, orphans_detected: 0, pruned: 0 };
  }

  // 1. Get all known file_ids from database
  let dbFileIds = new Set();
  try {
    const res = await query(`SELECT DISTINCT file_id FROM attendance_evidences WHERE file_id IS NOT NULL`);
    dbFileIds = new Set(res.rows.map(r => r.file_id));
    logger.info(`Found ${dbFileIds.size} referenced files in attendance_evidences table.`);
  } catch (err) {
    logger.warn(`Could not query attendance_evidences (${err.message}). Storage reconciliation skipped.`);
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

    if (dbFileIds.has(filename)) {
      report.valid_references++;
    } else {
      // It's not in the DB! Check grace period
      const fileAgeMs = now - stats.mtimeMs;
      if (fileAgeMs < gracePeriodMs) {
        report.in_grace_period++;
        logger.debug(`File ${filename} is unreferenced but within grace period (${Math.round(fileAgeMs / 1000)}s old).`);
      } else {
        report.orphans_detected++;
        if (!dryRun) {
          try {
            fs.unlinkSync(filePath);
            report.pruned++;
            report.pruned_files.push(filename);
            logger.info(`Pruned orphan file: ${filename} (Age: ${Math.round(fileAgeMs / 60000)} mins)`);
          } catch (e) {
            logger.error(`Failed to prune file ${filename}:`, e.message);
          }
        } else {
          report.pruned_files.push(`[DRY-RUN] ${filename}`);
        }
      }
    }
  }

  logger.info('Storage reconciliation complete:', report);
  return report;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  reconcileEvidenceStorage(dryRun)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      closePool().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(err);
      closePool().then(() => process.exit(1));
    });
}

module.exports = reconcileEvidenceStorage;
module.exports.reconcileStorage = reconcileEvidenceStorage;
module.exports.reconcileEvidenceStorage = reconcileEvidenceStorage;

