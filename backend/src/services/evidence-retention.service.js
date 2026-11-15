const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const storageProvider = require('../config/storage');
const { withTransaction } = require('../config/database');
const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const { BadRequestError } = require('../errors');
const logger = require('../utils/logger.util');

const SETTING_RETENTION_DAYS = 'evidence_retention_days';
const SETTING_LAST_CLEANUP_AT = 'evidence_last_cleanup_at';
const SETTING_LAST_CLEANUP_SUMMARY = 'evidence_last_cleanup_summary';

const DEFAULT_RETENTION_DAYS = 30;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours
const AUTO_CLEANUP_COOLDOWN_MS = 23 * 60 * 60 * 1000; // Run at most once per ~24h window
const ORPHAN_GRACE_PERIOD_MS = 60 * 60 * 1000; // 60 minutes

function parseSummaryJson(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  try {
    return JSON.parse(rawValue);
  } catch (_) {
    return null;
  }
}

/**
 * Manages evidence photo retention policy, storage overview, manual cleanup, and background auto-cleanup.
 */
class EvidenceRetentionService {
  constructor() {
    this._startupTimer = null;
    this._intervalTimer = null;
    this._cleanupInFlight = false;
  }

  /**
   * Resolve validated cutoff timestamp from manual cleanup options.
   */
  resolveCleanupCutoff({ mode = 'older_than_days', older_than_days, olderThanDays, before_date, beforeDate } = {}) {
    const normalizedMode = String(mode || 'older_than_days').trim().toLowerCase();

    if (normalizedMode === 'all') {
      return { mode: 'all', cutoffIso: null, label: 'Semua bukti foto saat ini' };
    }

    if (normalizedMode === 'before_date') {
      const dateStr = String(before_date || beforeDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new BadRequestError('Format tanggal batas pembersihan tidak valid (gunakan YYYY-MM-DD).');
      }
      const parsed = new Date(`${dateStr}T00:00:00+07:00`);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestError('Tanggal batas pembersihan tidak valid.');
      }
      return {
        mode: 'before_date',
        cutoffIso: parsed.toISOString(),
        label: `Sebelum tanggal ${dateStr}`
      };
    }

    if (normalizedMode === 'older_than_days') {
      const rawDays = older_than_days !== undefined ? older_than_days : olderThanDays;
      const days = Number(rawDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new BadRequestError('Jumlah hari retensi pembersihan harus bilangan bulat antara 1 sampai 3650.');
      }
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return {
        mode: 'older_than_days',
        days,
        cutoffIso: cutoffDate.toISOString(),
        label: `Lebih dari ${days} hari`
      };
    }

    throw new BadRequestError(`Mode pembersihan '${normalizedMode}' tidak dikenali.`);
  }

  /**
   * Fetch current retention settings safely (falls back to defaults if system_settings unavailable).
   */
  async getRetentionSettings() {
    try {
      const settingsMap = await attendanceEvidenceRepository.getSystemSettings([
        SETTING_RETENTION_DAYS,
        SETTING_LAST_CLEANUP_AT,
        SETTING_LAST_CLEANUP_SUMMARY
      ]);

      const rawDays = settingsMap[SETTING_RETENTION_DAYS]?.setting_value;
      const parsedDays = rawDays !== undefined && rawDays !== '' ? parseInt(rawDays, 10) : DEFAULT_RETENTION_DAYS;
      const retentionDays = Number.isInteger(parsedDays) && parsedDays >= 0 ? parsedDays : DEFAULT_RETENTION_DAYS;
      const lastCleanupAt = settingsMap[SETTING_LAST_CLEANUP_AT]?.setting_value || null;
      const lastCleanupSummary = parseSummaryJson(settingsMap[SETTING_LAST_CLEANUP_SUMMARY]?.setting_value);

      return { retentionDays, lastCleanupAt, lastCleanupSummary };
    } catch (err) {
      logger.warn(`Failed to load retention settings (${err.message}); using default ${DEFAULT_RETENTION_DAYS} days.`);
      return {
        retentionDays: DEFAULT_RETENTION_DAYS,
        lastCleanupAt: null,
        lastCleanupSummary: null
      };
    }
  }

  /**
   * Persist Admin's retention policy configuration.
   */
  async updateRetentionPolicy(retentionDays, adminUserId = null) {
    const parsed = Number(retentionDays);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
      throw new BadRequestError('Masa retensi otomatis harus berupa angka hari antara 0 (nonaktif) hingga 365 hari.');
    }

    await attendanceEvidenceRepository.upsertSystemSetting(
      SETTING_RETENTION_DAYS,
      String(parsed),
      'Masa simpan otomatis bukti foto Responder Guru dalam hari (0 = nonaktif)',
      adminUserId
    );

    const overview = await this.getStorageOverview();
    return overview;
  }

  /**
   * Gather disk storage stats, database metadata counts, and retention configuration.
   */
  async getStorageOverview() {
    const [diskStats, dbStats, retention] = await Promise.all([
      typeof storageProvider.getStorageStats === 'function'
        ? storageProvider.getStorageStats()
        : Promise.resolve({ fileCount: 0, totalBytes: 0 }),
      attendanceEvidenceRepository.findSummaryStats(),
      this.getRetentionSettings()
    ]);

    return {
      storage: {
        fileCount: diskStats.fileCount || 0,
        totalBytes: diskStats.totalBytes || 0
      },
      database: {
        totalRecords: dbStats.total_records || 0,
        distinctFiles: dbStats.distinct_files || 0,
        oldestCapturedAt: dbStats.oldest_captured_at || null
      },
      retention
    };
  }

  /**
   * Compute unreferenced file IDs & physical bytes for a set of expired evidence rows.
   */
  async _resolveUnreferencedFiles(expiredRows, client = null) {
    if (!expiredRows || expiredRows.length === 0) return [];
    const candidateFileIds = [...new Set(expiredRows.map(r => r.file_id).filter(Boolean))];
    if (candidateFileIds.length === 0) return [];

    const evidenceIds = expiredRows.map(r => r.evidence_id);
    const stillReferenced = await attendanceEvidenceRepository.findStillReferencedFileIds(
      candidateFileIds,
      evidenceIds,
      client
    );
    const stillReferencedSet = new Set(stillReferenced);
    return candidateFileIds.filter(fid => !stillReferencedSet.has(fid));
  }

  /**
   * Read-only preview of how many records, physical files, and bytes a cleanup would remove.
   */
  async previewCleanup(options = {}) {
    const cutoff = this.resolveCleanupCutoff(options);
    const expiredRows = await attendanceEvidenceRepository.findExpiredEvidences(cutoff.cutoffIso);
    const filesToDelete = await this._resolveUnreferencedFiles(expiredRows);

    let totalBytes = 0;
    let existingFilesCount = 0;
    for (const fileId of filesToDelete) {
      if (typeof storageProvider.getFileStats === 'function') {
        const st = await storageProvider.getFileStats(fileId);
        if (st.exists) {
          existingFilesCount++;
          totalBytes += st.sizeBytes;
        }
      } else {
        existingFilesCount++;
      }
    }

    return {
      mode: cutoff.mode,
      label: cutoff.label,
      cutoffIso: cutoff.cutoffIso,
      recordCount: expiredRows.length,
      fileCount: existingFilesCount,
      unreferencedFileIdsCount: filesToDelete.length,
      totalBytes
    };
  }

  /**
   * Sweep unreferenced physical orphan files older than ORPHAN_GRACE_PERIOD_MS.
   */
  async _pruneOrphanFiles(gracePeriodMs = ORPHAN_GRACE_PERIOD_MS) {
    const storageDir = path.resolve(env.STORAGE_PATH);
    if (!fs.existsSync(storageDir)) {
      return { orphansPruned: 0, orphanBytes: 0 };
    }

    const activeFileIds = new Set(await attendanceEvidenceRepository.findAllFileIds());
    const entries = await fs.promises.readdir(storageDir, { withFileTypes: true });
    const now = Date.now();
    let orphansPruned = 0;
    let orphanBytes = 0;

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      if (activeFileIds.has(entry.name)) continue;

      const filePath = path.join(storageDir, entry.name);
      try {
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile()) continue;
        if (now - stats.mtimeMs >= gracePeriodMs) {
          const deleted = await storageProvider.deleteFile(entry.name);
          if (deleted) {
            orphansPruned++;
            orphanBytes += stats.size;
          }
        }
      } catch (_) {
        // Ignore transient fs issues
      }
    }

    return { orphansPruned, orphanBytes };
  }

  /**
   * Atomically purge expired evidence metadata + mark teacher_attendance + remove unreferenced disk files.
   */
  async executeCleanup(options = {}) {
    if (this._cleanupInFlight) {
      throw new BadRequestError('Proses pembersihan foto sedang berjalan. Mohon tunggu beberapa saat.');
    }

    this._cleanupInFlight = true;
    try {
      const { triggeredByUserId = null, source = 'MANUAL' } = options;
      const cutoff = this.resolveCleanupCutoff(options);

      const dbResult = await withTransaction(async (client) => {
        const expiredRows = await attendanceEvidenceRepository.findExpiredEvidences(cutoff.cutoffIso, client);
        if (expiredRows.length === 0) {
          return { deletedRecords: 0, markedAttendance: 0, filesToDelete: [] };
        }

        const filesToDelete = await this._resolveUnreferencedFiles(expiredRows, client);
        const evidenceIds = expiredRows.map(r => r.evidence_id);
        const attendanceIds = [...new Set(expiredRows.map(r => r.attendance_id).filter(Boolean))];

        const deletedRecords = await attendanceEvidenceRepository.deleteByIds(evidenceIds, client);
        const markedAttendance = await attendanceEvidenceRepository.markTeacherAttendanceEvidencePurged(attendanceIds, client);

        return { deletedRecords, markedAttendance, filesToDelete };
      });

      let deletedFiles = 0;
      let freedBytes = 0;
      for (const fileId of dbResult.filesToDelete) {
        let sizeBytes = 0;
        if (typeof storageProvider.getFileStats === 'function') {
          const st = await storageProvider.getFileStats(fileId);
          sizeBytes = st.sizeBytes || 0;
        }
        const removed = await storageProvider.deleteFile(fileId);
        if (removed) {
          deletedFiles++;
          freedBytes += sizeBytes;
        }
      }

      const orphanResult = await this._pruneOrphanFiles();
      const totalFreedBytes = freedBytes + orphanResult.orphanBytes;

      const summary = {
        source,
        mode: cutoff.mode,
        label: cutoff.label,
        cutoffIso: cutoff.cutoffIso,
        deletedRecords: dbResult.deletedRecords,
        markedAttendance: dbResult.markedAttendance,
        deletedFiles,
        orphansPruned: orphanResult.orphansPruned,
        freedBytes: totalFreedBytes,
        executedAt: new Date().toISOString()
      };

      try {
        await attendanceEvidenceRepository.upsertSystemSetting(
          SETTING_LAST_CLEANUP_AT,
          summary.executedAt,
          'Timestamp ISO pembersihan bukti foto terakhir',
          triggeredByUserId
        );
        await attendanceEvidenceRepository.upsertSystemSetting(
          SETTING_LAST_CLEANUP_SUMMARY,
          JSON.stringify(summary),
          'Ringkasan JSON hasil pembersihan bukti foto terakhir',
          triggeredByUserId
        );
      } catch (telemetryErr) {
        logger.warn(`Failed to save cleanup telemetry: ${telemetryErr.message}`);
      }

      logger.info(`[EvidenceRetention] ${source} cleanup finished`, summary);
      return summary;
    } finally {
      this._cleanupInFlight = false;
    }
  }

  /**
   * Check whether scheduled auto-cleanup is due and execute it silently.
   */
  async runScheduledCleanupIfDue() {
    try {
      const { retentionDays, lastCleanupAt } = await this.getRetentionSettings();
      if (!retentionDays || retentionDays <= 0) {
        return { skipped: true, reason: 'RETENTION_DISABLED' };
      }

      if (lastCleanupAt) {
        const lastMs = new Date(lastCleanupAt).getTime();
        if (!Number.isNaN(lastMs) && Date.now() - lastMs < AUTO_CLEANUP_COOLDOWN_MS) {
          return { skipped: true, reason: 'COOLDOWN_ACTIVE' };
        }
      }

      const summary = await this.executeCleanup({
        mode: 'older_than_days',
        olderThanDays: retentionDays,
        source: 'AUTO_SCHEDULE'
      });
      return { skipped: false, summary };
    } catch (err) {
      logger.error(`[EvidenceRetention] Scheduled cleanup failed: ${err.message}`);
      return { skipped: true, error: err.message };
    }
  }

  startScheduler() {
    if (env.NODE_ENV === 'test') return;
    this.stopScheduler();

    this._startupTimer = setTimeout(() => {
      this.runScheduledCleanupIfDue();
    }, 15 * 1000);
    if (typeof this._startupTimer.unref === 'function') {
      this._startupTimer.unref();
    }

    this._intervalTimer = setInterval(() => {
      this.runScheduledCleanupIfDue();
    }, AUTO_CHECK_INTERVAL_MS);
    if (typeof this._intervalTimer.unref === 'function') {
      this._intervalTimer.unref();
    }

    logger.info('[EvidenceRetention] Background auto-cleanup scheduler initialized.');
  }

  stopScheduler() {
    if (this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    if (this._intervalTimer) {
      clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }
  }
}

module.exports = new EvidenceRetentionService();
