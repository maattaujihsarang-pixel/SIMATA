const teacherAttendanceRepository = require('../repositories/teacher-attendance.repository');
const teacherRepository = require('../repositories/teacher.repository');
const classRepository = require('../repositories/class.repository');
const academicYearRepository = require('../repositories/academic-year.repository');
const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const evidenceService = require('./evidence.service');
const schedulesService = require('./schedules.service');
const { withTransaction } = require('../config/database');
const { generateUUID } = require('../utils/id-generator.util');
const { getTodayISODate, getCurrentISOTime } = require('../utils/date.util');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../errors');
const logger = require('../utils/logger.util');

const VALID_STATUSES = ['Hadir', 'Izin', 'Sakit', 'Alpa', 'TugasLuar'];
const KEY_NOTIFICATION_RULES = 'notification_rules_config';
const KEY_AUTO_ALPHA_CONFIG = 'teacher_auto_alpa_config';
const DEFAULT_AUTO_ALPHA_CUTOFF = '23:30';
const AUTO_ALPHA_INTERVAL_MS = 15 * 60 * 1000;

function getCurrentWibHHMM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const hh = (parts.find((p) => p.type === 'hour') || { value: '07' }).value;
  const mm = (parts.find((p) => p.type === 'minute') || { value: '00' }).value;
  return `${hh}:${mm}`;
}

function parseMinutesHHMM(val) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(val || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function normalizeHHMMStrict(val) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(val || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function resolveAutoAlpaCutoffMode(cutoffTime) {
  if (cutoffTime === '23:30') return 'same_day_2330';
  if (cutoffTime === '00:15') return 'next_day_0015';
  return 'custom';
}

function addDaysISOUtc(isoDate, deltaDays) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function generateTeacherAttendanceId(attendanceDate, period) {
  const dateCompact = attendanceDate.replace(/-/g, '');
  const timeCompact = getCurrentISOTime().replace(/:/g, '');
  const shortHash = generateUUID().substring(0, 8);
  return `ATT-TCH-${dateCompact}-${timeCompact}-P${period}-${shortHash}`;
}

class TeacherAttendanceService {
  constructor() {
    this._autoAlpaTimer = null;
    this._autoAlpaStartupTimer = null;
    this._autoAlpaInFlight = false;
  }
  /**
   * Multi-Hour Teacher Attendance with Single Photo Evidence (F-P5-005 & BUG 68)
   * Photo is required for live 'Hadir' submissions, and optional for 'Izin'/'Sakit'/'Alpa' or Admin Manual/Susulan.
   */
  async recordTeacherAttendanceWithEvidence(payload, file, operatorUserId, operatorRole = 'ADMIN', operatorTeacherId = null) {
    const {
      teacher_id, class_id, subject, materi, periods,
      attendance_date, session_id, status = 'Hadir', note,
      method, is_admin_manual
    } = payload;

    const todayIso = getTodayISODate();
    const targetDate = attendance_date ? String(attendance_date).trim() : todayIso;
    const cleanRole = String(operatorRole || 'ADMIN').toUpperCase();
    const isGuru = cleanRole === 'GURU';
    const isAdminManual = (is_admin_manual === true || is_admin_manual === 'true') && !isGuru;

    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status tidak valid. Nilai yang diperbolehkan: ${VALID_STATUSES.join(', ')}`);
    }

    if (isGuru) {
      if (status === 'Alpa') {
        throw new ForbiddenError('Status Alpa hanya dapat diinput oleh Admin / Operator');
      }
      if (is_admin_manual === true || is_admin_manual === 'true') {
        throw new ForbiddenError('Input presensi manual/susulan tanpa kamera hanya dapat dilakukan oleh Admin');
      }
      if (targetDate < todayIso) {
        throw new ForbiddenError('Presensi guru susulan (tanggal lewat) hanya dapat diinput oleh Admin / Piket');
      }
    }

    if (!teacher_id || !class_id || !subject) {
      throw new BadRequestError('teacher_id, class_id, dan subject wajib diisi');
    }

    const hasPhoto = Boolean(file && file.buffer);
    const isNonTeachingStatus = ['Izin', 'Sakit', 'Alpa', 'TugasLuar'].includes(status);

    if (status === 'Hadir' && !hasPhoto && !isAdminManual) {
      throw new BadRequestError('Foto bukti verifikasi kamera wajib diambil untuk status Hadir');
    }

    if (hasPhoto && !session_id) {
      throw new BadRequestError('session_id wajib diisi bila mengunggah bukti foto presensi guru');
    }

    const cleanMateri = materi ? String(materi).trim() : '';
    const cleanNote = note ? String(note).trim() : '';
    const defaultMateriByStatus = {
      Izin: 'Izin (Tanpa Tatap Muka)',
      Sakit: 'Sakit (Tanpa Tatap Muka)',
      Alpa: 'Alpa (Tanpa Keterangan)',
      TugasLuar: 'Izin / Tugas Kedinasan'
    };
    const effectiveMateri = cleanMateri || (isNonTeachingStatus ? (cleanNote || defaultMateriByStatus[status] || status) : '');
    if (!effectiveMateri) {
      throw new BadRequestError('materi pembelajaran wajib diisi untuk status Hadir');
    }

    // Parse periods
    let parsedPeriods = [];
    if (Array.isArray(periods)) {
      parsedPeriods = periods.map(p => parseInt(p, 10));
    } else if (typeof periods === 'string') {
      try {
        const parsed = JSON.parse(periods);
        parsedPeriods = Array.isArray(parsed) ? parsed.map(p => parseInt(p, 10)) : [parseInt(periods, 10)];
      } catch (_) {
        parsedPeriods = periods.split(',').map(p => parseInt(p.trim(), 10));
      }
    } else if (typeof periods === 'number') {
      parsedPeriods = [periods];
    }

    if (parsedPeriods.length === 0 || parsedPeriods.some(p => isNaN(p) || p < 1 || p > 10)) {
      throw new BadRequestError('Jam pelajaran (periods) harus berupa array angka 1 sampai 10');
    }

    // Deduplicate periods array if duplicates passed
    parsedPeriods = [...new Set(parsedPeriods)].sort((a, b) => a - b);

    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status tidak valid. Nilai yang diperbolehkan: ${VALID_STATUSES.join(', ')}`);
    }

    // Validate master entities
    const teacher = await teacherRepository.findById(teacher_id);
    if (!teacher) {
      throw new NotFoundError(`Guru dengan ID '${teacher_id}' tidak ditemukan`);
    }

    const cls = await classRepository.findById(class_id);
    if (!cls) {
      throw new NotFoundError(`Kelas dengan ID '${class_id}' tidak ditemukan`);
    }

    const activeYear = await academicYearRepository.getActiveYear();
    if (!activeYear) {
      throw new BadRequestError('Tahun ajaran aktif belum dikonfigurasi');
    }

    // 1. Pre-check Duplicate before doing any storage write
    const existingDuplicates = await teacherAttendanceRepository.findExistingDuplicates(
      teacher_id,
      targetDate,
      parsedPeriods
    );

    if (existingDuplicates.length > 0) {
      const dupPeriods = existingDuplicates.map(d => `Jam ke-${d.period}${d.class_name ? ` (${d.class_name})` : ''}`).join(', ');
      throw new ConflictError(
        `Presensi guru ${teacher.name} untuk tanggal ${targetDate} pada ${dupPeriods} sudah tercatat. Tidak ada perubahan yang disimpan.`,
        'DUPLICATE_TEACHER_ATTENDANCE',
        { duplicate_periods: existingDuplicates.map(d => d.period) }
      );
    }

    // Check if target class + date + period slot is already occupied by another teacher
    const classDuplicates = await teacherAttendanceRepository.findClassPeriodDuplicates(
      class_id,
      targetDate,
      parsedPeriods
    );

    if (classDuplicates.length > 0) {
      const conflictDetails = classDuplicates
        .map(d => `Jam ke-${d.period} (${d.teacher_name}${d.subject ? ` - ${d.subject}` : ''})`)
        .join(', ');
      throw new ConflictError(
        `Presensi pada kelas ${cls.class_name} tanggal ${targetDate} untuk [${conflictDetails}] sudah terisi. Tidak dapat menyimpan data presensi ganda pada jam pelajaran yang sama.`,
        'DUPLICATE_TEACHER_ATTENDANCE',
        {
          duplicate_periods: classDuplicates.map(d => d.period),
          conflicts: classDuplicates.map(d => ({
            period: d.period,
            teacher_id: d.teacher_id,
            teacher_name: d.teacher_name,
            subject: d.subject
          }))
        }
      );
    }

    // 2. Storage Write (1 physical file for all requested periods when photo is provided)
    const savedFile = hasPhoto
      ? await evidenceService.uploadFile({
          buffer: file.buffer,
          originalName: file.originalname || 'teacher_attendance.jpg',
          mimeType: file.mimetype || 'image/jpeg'
        })
      : null;

    const effectiveMethod = method
      ? String(method).trim().slice(0, 30)
      : (hasPhoto ? 'Camera' : (isAdminManual ? (targetDate < todayIso ? 'Susulan (Admin)' : 'Manual (Admin)') : 'Manual'));

    // 3. Database Transaction with Compensating Cleanup Guard
    try {
      const result = await withTransaction(async (client) => {
        // Double-check teacher & class-period duplicates inside transaction lock
        const txDuplicates = await teacherAttendanceRepository.findExistingDuplicates(
          teacher_id,
          targetDate,
          parsedPeriods,
          client
        );

        if (txDuplicates.length > 0) {
          const dupPeriods = txDuplicates.map(d => `Jam ke-${d.period}${d.class_name ? ` (${d.class_name})` : ''}`).join(', ');
          throw new ConflictError(
            `Presensi guru ${teacher.name} untuk tanggal ${targetDate} pada ${dupPeriods} sudah tercatat.`,
            'DUPLICATE_TEACHER_ATTENDANCE',
            { duplicate_periods: txDuplicates.map(d => d.period) }
          );
        }

        const txClassDuplicates = await teacherAttendanceRepository.findClassPeriodDuplicates(
          class_id,
          targetDate,
          parsedPeriods,
          null,
          client
        );

        if (txClassDuplicates.length > 0) {
          const conflictDetails = txClassDuplicates
            .map(d => `Jam ke-${d.period} (${d.teacher_name}${d.subject ? ` - ${d.subject}` : ''})`)
            .join(', ');
          throw new ConflictError(
            `Presensi pada kelas ${cls.class_name} tanggal ${targetDate} untuk [${conflictDetails}] sudah terisi. Tidak dapat menyimpan data presensi ganda pada jam pelajaran yang sama.`,
            'DUPLICATE_TEACHER_ATTENDANCE',
            { duplicate_periods: txClassDuplicates.map(d => d.period) }
          );
        }

        const attendanceRecords = [];
        const evidenceRecords = [];

        for (const p of parsedPeriods) {
          const attendanceId = generateTeacherAttendanceId(targetDate, p);

          // Insert teacher attendance record
          const att = await teacherAttendanceRepository.insertSingle({
            attendance_id: attendanceId,
            teacher_id,
            class_id,
            academic_year_id: activeYear.academic_year_id,
            attendance_date: targetDate,
            period: p,
            subject,
            materi: effectiveMateri,
            status,
            method: effectiveMethod,
            recorded_at: new Date().toISOString(),
            note: cleanNote || null,
            recorded_by_user_id: operatorUserId
          }, client);
          attendanceRecords.push(att);

          // Insert evidence metadata pointing to the same file_id if photo provided
          if (hasPhoto && savedFile) {
            const evid = await evidenceService.createEvidenceRecord({
              sessionId: session_id,
              operatorUserId,
              fileId: savedFile.fileId,
              fileUrl: savedFile.fileUrl,
              attendanceId: att.attendance_id,
              storageProvider: savedFile.storageProvider,
              mimeType: file.mimetype || 'image/jpeg',
              capturedAt: new Date().toISOString()
            }, client);
            evidenceRecords.push(evid);
          }
        }

        return {
          total_periods: parsedPeriods.length,
          teacher_id,
          class_id,
          attendance_date: targetDate,
          periods: parsedPeriods,
          method: effectiveMethod,
          file: savedFile,
          attendances: attendanceRecords,
          evidences: evidenceRecords
        };
      });

      return result;
    } catch (dbError) {
      // 4. Compensating Cleanup: Delete physical file if database transaction fails
      if (savedFile && savedFile.fileId) {
        logger.warn(`Compensating cleanup triggered for file ${savedFile.fileId} due to DB error: ${dbError.message}`);
        await evidenceService.deleteFile(savedFile.fileId);
      }
      throw dbError;
    }
  }

  async getAttendanceList(filters) {
    return teacherAttendanceRepository.findByFilters(filters);
  }

  async getAttendanceById(attendanceId) {
    const att = await teacherAttendanceRepository.findById(attendanceId);
    if (!att) {
      throw new NotFoundError(`Presensi guru dengan ID '${attendanceId}' tidak ditemukan`);
    }
    return att;
  }

  async updateAttendance(attendanceId, data, updatedByUserId, updaterRole = 'ADMIN') {
    const { status, subject, materi, note, period, class_id, attendance_date } = data;

    const existing = await teacherAttendanceRepository.findById(attendanceId);
    if (!existing) {
      throw new NotFoundError(`Presensi guru dengan ID '${attendanceId}' tidak ditemukan`);
    }

    if (String(updaterRole || 'ADMIN').toUpperCase() === 'GURU' && status === 'Alpa') {
      throw new ForbiddenError('Status Alpa hanya dapat diatur oleh Admin / Operator');
    }

    if (status && !VALID_STATUSES.includes(status)) {
      throw new BadRequestError(`Status tidak valid. Nilai yang diperbolehkan: ${VALID_STATUSES.join(', ')}`);
    }

    const effectiveStatus = status || existing.status;

    let parsedPeriod = existing.period;
    if (period !== undefined && period !== null && period !== '') {
      parsedPeriod = parseInt(period, 10);
      if (isNaN(parsedPeriod) || parsedPeriod < 1 || parsedPeriod > 10) {
        throw new BadRequestError('Period (jam pelajaran) harus berupa angka 1 sampai 10');
      }
    }

    if (subject !== undefined && !String(subject).trim()) {
      throw new BadRequestError('Mata pelajaran tidak boleh kosong');
    }

    let nextMateri = materi !== undefined ? String(materi).trim() : existing.materi;
    if (materi !== undefined && !nextMateri) {
      throw new BadRequestError('Materi pelajaran tidak boleh kosong');
    }

    const targetDate = attendance_date || existing.attendance_date;
    const targetClassId = class_id || existing.class_id;

    let targetClass = null;
    if (targetClassId !== existing.class_id) {
      targetClass = await classRepository.findById(targetClassId);
      if (!targetClass) {
        throw new NotFoundError(`Kelas dengan ID '${targetClassId}' tidak ditemukan`);
      }
    }

    // Check teacher-slot conflict (same teacher + date + period, excluding current record)
    const duplicate = await teacherAttendanceRepository.findByBusinessKey(
      existing.teacher_id,
      targetDate,
      parsedPeriod
    );
    if (duplicate && duplicate.attendance_id !== attendanceId) {
      throw new ConflictError(
        `Presensi guru ${existing.teacher_name} untuk tanggal ${targetDate} pada Jam ke-${parsedPeriod} sudah tercatat.`,
        'DUPLICATE_TEACHER_ATTENDANCE'
      );
    }

    // Check class-slot conflict (same class + date + period occupied by another record)
    const classSlotRows = await teacherAttendanceRepository.findByClassDatePeriod(
      targetClassId,
      targetDate,
      parsedPeriod
    );
    const classConflict = classSlotRows.find(r => r.attendance_id !== attendanceId);
    if (classConflict) {
      const className = (targetClass && targetClass.class_name) || classConflict.class_name || existing.class_name || targetClassId;
      throw new ConflictError(
        `Presensi pada kelas ${className} tanggal ${targetDate} untuk Jam ke-${parsedPeriod} sudah terisi oleh ${classConflict.teacher_name}${classConflict.subject ? ` (${classConflict.subject})` : ''}. Tidak dapat menyimpan data presensi ganda pada jam pelajaran yang sama.`,
        'DUPLICATE_TEACHER_ATTENDANCE'
      );
    }

    const wasAutoAlpa = String(existing.method || '').toLowerCase().includes('auto-alpa');
    const nextMethod = (wasAutoAlpa && effectiveStatus !== 'Alpa')
      ? 'Koreksi Admin (Eks Auto-Alpa)'
      : (data.method ? String(data.method).trim().slice(0, 30) : existing.method);

    const updated = await teacherAttendanceRepository.update(attendanceId, {
      status: effectiveStatus,
      subject: subject !== undefined ? String(subject).trim() : existing.subject,
      materi: nextMateri,
      note: note !== undefined ? (note ? String(note).trim() : null) : existing.note,
      period: parsedPeriod,
      class_id: targetClassId,
      attendance_date: targetDate,
      recorded_by_user_id: updatedByUserId,
      method: nextMethod
    });

    const applySiblings = data.apply_to_same_day_auto_alpa === true || data.apply_to_same_day_auto_alpa === 'true';
    if (applySiblings && String(updaterRole || 'ADMIN').toUpperCase() === 'ADMIN') {
      const sameDayRows = await teacherAttendanceRepository.findByFilters({
        date: targetDate,
        teacherId: existing.teacher_id
      });
      const siblingAutoAlpa = sameDayRows.filter((r) =>
        r.attendance_id !== attendanceId &&
        r.status === 'Alpa' &&
        String(r.method || '').toLowerCase().includes('auto-alpa')
      );
      let siblingsUpdated = 0;
      for (const sib of siblingAutoAlpa) {
        await teacherAttendanceRepository.update(sib.attendance_id, {
          status: effectiveStatus,
          subject: sib.subject,
          materi: nextMateri,
          note: note !== undefined ? (note ? String(note).trim() : null) : sib.note,
          period: sib.period,
          class_id: sib.class_id,
          attendance_date: targetDate,
          recorded_by_user_id: updatedByUserId,
          method: nextMethod
        });
        siblingsUpdated += 1;
      }
      if (updated) {
        updated.updated_siblings_count = siblingsUpdated;
      }
    }

    return updated;
  }

  async getAutoAlpaRuntimeConfig() {
    const todayIso = getTodayISODate();
    const defaults = {
      enabled: true,
      cutoff_time: DEFAULT_AUTO_ALPHA_CUTOFF,
      cutoff_mode: 'same_day_2330',
      effective_from: todayIso,
      skip_friday: true
    };
    try {
      const settingsMap = await attendanceEvidenceRepository.getSystemSettings([
        KEY_AUTO_ALPHA_CONFIG,
        KEY_NOTIFICATION_RULES
      ]);
      const rawAuto = settingsMap[KEY_AUTO_ALPHA_CONFIG]?.setting_value;
      let parsedAuto = {};
      if (rawAuto) {
        try {
          parsedAuto = JSON.parse(rawAuto);
        } catch (_) {
          parsedAuto = {};
        }
      } else {
        // Initialize effective_from lazily to today so older historical dates aren't bulk-marked Alpa
        try {
          await attendanceEvidenceRepository.upsertSystemSetting(
            KEY_AUTO_ALPHA_CONFIG,
            JSON.stringify(defaults),
            'Konfigurasi Auto-Alpa Presensi Guru harian (BUG 68)',
            null
          );
        } catch (_) {}
      }

      let holidayDates = new Set();
      const rawNotif = settingsMap[KEY_NOTIFICATION_RULES]?.setting_value;
      if (rawNotif) {
        try {
          const parsedNotif = JSON.parse(rawNotif);
          const list = Array.isArray(parsedNotif?.custom_holidays) ? parsedNotif.custom_holidays : [];
          holidayDates = new Set(list.map((h) => String(h?.date || '').trim()).filter(Boolean));
        } catch (_) {}
      }

      const normalizedCutoff = normalizeHHMMStrict(parsedAuto.cutoff_time) || DEFAULT_AUTO_ALPHA_CUTOFF;
      const cutoffMode = ['same_day_2330', 'next_day_0015', 'custom'].includes(parsedAuto.cutoff_mode)
        ? parsedAuto.cutoff_mode
        : resolveAutoAlpaCutoffMode(normalizedCutoff);

      return {
        enabled: parsedAuto.enabled === undefined ? true : Boolean(parsedAuto.enabled),
        cutoff_time: normalizedCutoff,
        cutoff_mode: cutoffMode,
        effective_from: /^\d{4}-\d{2}-\d{2}$/.test(String(parsedAuto.effective_from || '')) ? String(parsedAuto.effective_from) : todayIso,
        skip_friday: parsedAuto.skip_friday === undefined ? true : Boolean(parsedAuto.skip_friday),
        holidayDates
      };
    } catch (_) {
      return { ...defaults, holidayDates: new Set() };
    }
  }

  async updateAutoAlpaConfig(data = {}, userId = null) {
    const current = await this.getAutoAlpaRuntimeConfig();
    const enabled = data.enabled !== undefined ? Boolean(data.enabled) : current.enabled;
    const skipFriday = data.skip_friday !== undefined ? Boolean(data.skip_friday) : current.skip_friday;

    let cutoffMode = ['same_day_2330', 'next_day_0015', 'custom'].includes(data.cutoff_mode)
      ? data.cutoff_mode
      : null;

    let cutoffTime = current.cutoff_time || DEFAULT_AUTO_ALPHA_CUTOFF;
    if (cutoffMode === 'same_day_2330') {
      cutoffTime = '23:30';
    } else if (cutoffMode === 'next_day_0015') {
      cutoffTime = '00:15';
    } else if (data.cutoff_time !== undefined) {
      const normalized = normalizeHHMMStrict(data.cutoff_time);
      if (!normalized) {
        throw new BadRequestError('Format jam batas cutoff harus HH:MM (00:00 - 23:59)');
      }
      cutoffTime = normalized;
      cutoffMode = resolveAutoAlpaCutoffMode(cutoffTime);
    } else {
      cutoffMode = resolveAutoAlpaCutoffMode(cutoffTime);
    }

    const effectiveFrom = data.effective_from !== undefined
      ? String(data.effective_from || '').trim()
      : current.effective_from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      throw new BadRequestError('Format tanggal efektif mulai berlaku harus YYYY-MM-DD');
    }

    const nextConfig = {
      enabled,
      cutoff_time: cutoffTime,
      cutoff_mode: cutoffMode,
      effective_from: effectiveFrom,
      skip_friday: skipFriday
    };

    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_AUTO_ALPHA_CONFIG,
      JSON.stringify(nextConfig),
      'Konfigurasi Auto-Alpa Presensi Guru harian (BUG 68)',
      userId || null
    );

    return nextConfig;
  }

  async runAutoAlpaForDate({ date = null, time_wib = null, force = false, operatorUserId = null } = {}) {
    const todayIso = getTodayISODate();
    const targetDate = date ? String(date).trim() : todayIso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new BadRequestError('Format tanggal harus YYYY-MM-DD');
    }

    if (targetDate > todayIso) {
      return { date: targetDate, skipped: true, reason: 'future_date', message: 'Tanggal masa depan dilewati.', created_count: 0, records: [] };
    }

    const cfg = await this.getAutoAlpaRuntimeConfig();
    if (!force && !cfg.enabled) {
      return { date: targetDate, skipped: true, reason: 'disabled', message: 'Auto-Alpa sedang dinonaktifkan.', created_count: 0, records: [] };
    }

    const [yy, mm, dd] = targetDate.split('-').map(Number);
    const utcDate = new Date(Date.UTC(yy, mm - 1, dd));
    const dayOfWeek = utcDate.getUTCDay();
    if (cfg.skip_friday && dayOfWeek === 5) {
      return { date: targetDate, skipped: true, reason: 'friday_holiday', message: 'Hari Jumat (libur rutin) dilewati.', created_count: 0, records: [] };
    }
    if (cfg.holidayDates.has(targetDate)) {
      return { date: targetDate, skipped: true, reason: 'custom_holiday', message: `Tanggal ${targetDate} tercatat hari libur / eksepsi.`, created_count: 0, records: [] };
    }

    const cutoffMin = parseMinutesHHMM(cfg.cutoff_time) ?? (23 * 60 + 30);
    const isNextDayCutoff = cutoffMin < 12 * 60;
    if (!force) {
      const effectiveTime = time_wib || getCurrentWibHHMM();
      const curMin = parseMinutesHHMM(effectiveTime) ?? 0;
      const yesterdayIso = addDaysISOUtc(todayIso, -1);

      if (targetDate === todayIso && (isNextDayCutoff || curMin < cutoffMin)) {
        return {
          date: targetDate,
          skipped: true,
          reason: 'before_cutoff',
          cutoff_time: cfg.cutoff_time,
          message: isNextDayCutoff
            ? `Cutoff harian diatur pada H+1 pukul ${cfg.cutoff_time} WIB.`
            : `Belum melewati batas cutoff harian (${cfg.cutoff_time} WIB).`,
          created_count: 0,
          records: []
        };
      }
      if (isNextDayCutoff && targetDate === yesterdayIso && curMin < cutoffMin) {
        return {
          date: targetDate,
          skipped: true,
          reason: 'before_cutoff',
          cutoff_time: cfg.cutoff_time,
          message: `Belum melewati batas cutoff H+1 (${cfg.cutoff_time} WIB).`,
          created_count: 0,
          records: []
        };
      }
    }

    const schedOverview = await schedulesService.getActiveNowForResponder({
      date: targetDate,
      time_wib: '12:00'
    });
    const kbmSlots = (Array.isArray(schedOverview?.day_slots) ? schedOverview.day_slots : []).filter(
      (s) => s && s.teacher_id && s.class_id && s.period_number && (!s.subject_category || s.subject_category === 'KBM')
    );

    if (kbmSlots.length === 0) {
      return { date: targetDate, skipped: true, reason: 'no_kbm_slots', message: `Tidak ada slot mengajar KBM terjadwal pada ${targetDate}.`, created_count: 0, records: [] };
    }

    const existingRows = await teacherAttendanceRepository.findByFilters({ date: targetDate });
    const teacherPeriodSet = new Set(existingRows.map((r) => `${r.teacher_id}|${Number(r.period)}`));
    const classPeriodSet = new Set(existingRows.map((r) => `${r.class_id}|${Number(r.period)}`));
    const activeYear = await academicYearRepository.getActiveYear();
    const fallbackYearId = activeYear?.academic_year_id || '2026/2027';

    const createdRecords = [];
    const nowIso = new Date().toISOString();

    for (const slot of kbmSlots) {
      const pNum = Number(slot.period_number);
      if (pNum < 1 || pNum > 10) continue;
      const teacherKey = `${slot.teacher_id}|${pNum}`;
      const classKey = `${slot.class_id}|${pNum}`;

      // Guard 4: Skip if teacher already has attendance OR another substitute teacher already filled the class slot
      if (teacherPeriodSet.has(teacherKey) || classPeriodSet.has(classKey)) {
        continue;
      }

      const attendanceId = generateTeacherAttendanceId(targetDate, pNum);
      try {
        const inserted = await teacherAttendanceRepository.insertSingle({
          attendance_id: attendanceId,
          teacher_id: slot.teacher_id,
          class_id: slot.class_id,
          academic_year_id: slot.academic_year_id || fallbackYearId,
          attendance_date: targetDate,
          period: pNum,
          subject: slot.subject_name || slot.subject_code || 'Mata Pelajaran',
          materi: 'Alpa otomatis (tidak ada presensi/laporan hingga batas waktu)',
          status: 'Alpa',
          method: 'Auto-Alpa (Sistem)',
          recorded_at: nowIso,
          note: `Ditandai Alpa otomatis oleh sistem (${targetDate}). Hubungi Admin untuk koreksi bila ada konfirmasi kehadiran/izin.`,
          recorded_by_user_id: operatorUserId || null
        });
        teacherPeriodSet.add(teacherKey);
        classPeriodSet.add(classKey);
        createdRecords.push(inserted);
      } catch (err) {
        if (err && err.code === '23505') {
          teacherPeriodSet.add(teacherKey);
          classPeriodSet.add(classKey);
        } else {
          throw err;
        }
      }
    }

    return {
      date: targetDate,
      skipped: false,
      reason: 'completed',
      total_kbm_slots: kbmSlots.length,
      created_count: createdRecords.length,
      records: createdRecords
    };
  }

  async runScheduledAutoAlpaSweep() {
    if (this._autoAlpaInFlight) return;
    this._autoAlpaInFlight = true;
    try {
      const cfg = await this.getAutoAlpaRuntimeConfig();
      if (!cfg.enabled) return;

      const todayIso = getTodayISODate();
      const yesterdayIso = addDaysISOUtc(todayIso, -1);

      if (yesterdayIso >= cfg.effective_from) {
        const resYesterday = await this.runAutoAlpaForDate({ date: yesterdayIso, force: false });
        if (resYesterday.created_count > 0) {
          logger.info(`[AUTO-ALPA] Marked ${resYesterday.created_count} teacher sessions as Alpa for ${yesterdayIso}.`);
        }
      }

      if (todayIso >= cfg.effective_from) {
        const resToday = await this.runAutoAlpaForDate({ date: todayIso, force: false });
        if (resToday.created_count > 0) {
          logger.info(`[AUTO-ALPA] Marked ${resToday.created_count} teacher sessions as Alpa for ${todayIso}.`);
        }
      }
    } catch (err) {
      logger.warn(`[AUTO-ALPA] Scheduler sweep error: ${err.message}`);
    } finally {
      this._autoAlpaInFlight = false;
    }
  }

  startAutoAlpaScheduler() {
    if (this._autoAlpaTimer || this._autoAlpaStartupTimer) return;
    this._autoAlpaStartupTimer = setTimeout(() => {
      this._autoAlpaStartupTimer = null;
      this.runScheduledAutoAlpaSweep();
    }, 30000);
    this._autoAlpaTimer = setInterval(() => {
      this.runScheduledAutoAlpaSweep();
    }, AUTO_ALPHA_INTERVAL_MS);
    logger.info('[AUTO-ALPA] Daily teacher Auto-Alpa scheduler started (15m interval).');
  }

  stopAutoAlpaScheduler() {
    if (this._autoAlpaStartupTimer) {
      clearTimeout(this._autoAlpaStartupTimer);
      this._autoAlpaStartupTimer = null;
    }
    if (this._autoAlpaTimer) {
      clearInterval(this._autoAlpaTimer);
      this._autoAlpaTimer = null;
    }
  }
}

module.exports = new TeacherAttendanceService();

