const crypto = require('crypto');
const db = require('../config/database');
const schedulesRepo = require('../repositories/schedules.repository');
const {
  ACTIVE_DAYS,
  DEFAULT_PERIODS,
  normalizeSubjectCode,
  matchTeacherRow,
  ensureSubjectsSeeded,
  ensurePeriodsSeeded,
  seedDefaultSchedule2026Ganjil
} = require('./schedule-seed.service');
const { BadRequestError, ConflictError, NotFoundError } = require('../errors');

const VALID_DAYS = new Set([0, 1, 2, 3, 4, 6]);
const VALID_SEMESTERS = new Set(['GANJIL', 'GENAP']);
const DAY_LABELS = {
  0: 'Ahad',
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu'
};

function getWibClock(overrideDay = null, overrideTime = null) {
  let dayOfWeek;
  let timeStr;

  if (overrideDay !== null && overrideDay !== undefined && overrideDay !== '') {
    dayOfWeek = Number(overrideDay);
  } else {
    const weekdayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short'
    }).format(new Date());
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    dayOfWeek = map[weekdayName] ?? 0;
  }

  if (overrideTime && /^\d{2}:\d{2}$/.test(String(overrideTime).trim())) {
    timeStr = String(overrideTime).trim();
  } else {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const hh = (parts.find((p) => p.type === 'hour') || { value: '07' }).value;
    const mm = (parts.find((p) => p.type === 'minute') || { value: '00' }).value;
    timeStr = `${hh}:${mm}`;
  }

  const monthNum = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', month: 'numeric' }).format(new Date())
  );
  const autoSemester = monthNum >= 7 ? 'GANJIL' : 'GENAP';

  return {
    dayOfWeek,
    dayLabel: DAY_LABELS[dayOfWeek] || 'Hari Ini',
    isSchoolDay: VALID_DAYS.has(dayOfWeek),
    timeWib: timeStr,
    autoSemester
  };
}

function findCurrentPeriodFromTime(periods, timeWib) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const exact = periods.find((p) => timeWib >= p.start_time && timeWib < p.end_time);
  if (exact) {
    return { ...exact, match_state: exact.is_break ? 'BREAK' : 'ACTIVE' };
  }
  const upcoming = periods.find((p) => !p.is_break && timeWib < p.start_time);
  if (upcoming) {
    return { ...upcoming, match_state: 'UPCOMING' };
  }
  return null;
}

class SchedulesService {
  normalizeSemester(semester, fallback = 'GANJIL') {
    if (!semester) return fallback;
    const upper = String(semester).trim().toUpperCase();
    if (!VALID_SEMESTERS.has(upper)) {
      throw new BadRequestError('Semester harus GANJIL atau GENAP.');
    }
    return upper;
  }

  normalizeDay(dayOfWeek) {
    const n = Number(dayOfWeek);
    if (!Number.isInteger(n) || !VALID_DAYS.has(n)) {
      throw new BadRequestError('Hari sekolah aktif hanya Sabtu (6), Ahad (0), Senin (1), Selasa (2), Rabu (3), Kamis (4).');
    }
    return n;
  }

  async resolveContext(requestedYearId, requestedSemester) {
    const years = await schedulesRepo.getAcademicYears();
    const wib = getWibClock();
    const activeYear = years.find((y) => y.is_active) || years[0] || { academic_year_id: '2026/2027', name: 'Tahun Ajaran 2026/2027' };
    const cleanYearId = requestedYearId && years.some((y) => y.academic_year_id === requestedYearId)
      ? requestedYearId
      : activeYear.academic_year_id;
    const yearObj = years.find((y) => y.academic_year_id === cleanYearId) || activeYear;
    const cleanSemester = requestedSemester
      ? this.normalizeSemester(requestedSemester, wib.autoSemester)
      : await schedulesRepo.detectBestSemesterForYear(cleanYearId, wib.autoSemester);

    return { years, yearObj, academicYearId: cleanYearId, semester: cleanSemester, wib };
  }

  async getOverview({ academic_year_id = null, semester = null, user = null } = {}) {
    const ctx = await this.resolveContext(academic_year_id, semester);

    // Lazily ensure canonical subjects & default periods exist for the selected year/semester
    await db.withTransaction(async (client) => {
      await ensureSubjectsSeeded(client, { overwrite: false });
      await ensurePeriodsSeeded(client, ctx.academicYearId, ctx.semester);
    });

    const [periods, classes, subjects, teachers, slots] = await Promise.all([
      schedulesRepo.getPeriods(ctx.academicYearId, ctx.semester),
      schedulesRepo.getClassesForYear(ctx.academicYearId),
      schedulesRepo.getSubjects(),
      schedulesRepo.getTeachersWithCodes(ctx.academicYearId, ctx.semester),
      schedulesRepo.getSlots(ctx.academicYearId, ctx.semester)
    ]);

    const currentPeriod = ctx.wib.isSchoolDay ? findCurrentPeriodFromTime(periods, ctx.wib.timeWib) : null;
    const kbmJp = slots.filter((s) => s.subject_category === 'KBM').length;
    const nonKbmSlots = slots.filter((s) => s.subject_category !== 'KBM').length;
    const activeTeachersScheduled = new Set(slots.map((s) => s.teacher_id).filter(Boolean)).size;

    // Count duplicate (day, period, teacher) defensively (partial unique index guarantees 0)
    const seenTeacherSlots = new Set();
    let conflictCount = 0;
    for (const s of slots) {
      if (!s.teacher_id) continue;
      const key = `${s.day_of_week}|${s.period_number}|${s.teacher_id}`;
      if (seenTeacherSlots.has(key)) conflictCount += 1;
      seenTeacherSlots.add(key);
    }

    return {
      meta: {
        academic_year_id: ctx.academicYearId,
        academic_year_name: ctx.yearObj.name,
        semester: ctx.semester,
        academic_years: ctx.years,
        days: ACTIVE_DAYS,
        today_day_of_week: ctx.wib.dayOfWeek,
        today_day_label: ctx.wib.dayLabel,
        today_time_wib: ctx.wib.timeWib,
        is_school_day: ctx.wib.isSchoolDay,
        current_period_number: currentPeriod && currentPeriod.match_state === 'ACTIVE' ? currentPeriod.period_number : null,
        current_period_label: currentPeriod ? currentPeriod.label : null,
        has_active_schedule: slots.length > 0
      },
      viewer: {
        role: user?.role || 'GURU',
        teacher_id: user?.teacher_id || null,
        is_admin: user?.role === 'ADMIN'
      },
      periods,
      classes,
      subjects,
      teachers,
      slots,
      summary: {
        total_slots: slots.length,
        kbm_jp: kbmJp,
        non_kbm_slots: nonKbmSlots,
        active_teachers_scheduled: activeTeachersScheduled,
        conflict_count: conflictCount
      }
    };
  }

  async getActiveNowForResponder({ teacher_id = null, day_of_week = null, time_wib = null } = {}) {
    const years = await schedulesRepo.getAcademicYears();
    const activeYear = years.find((y) => y.is_active) || years[0] || { academic_year_id: '2026/2027', name: 'Tahun Ajaran 2026/2027' };
    const wib = getWibClock(day_of_week, time_wib);
    const semester = await schedulesRepo.detectBestSemesterForYear(activeYear.academic_year_id, wib.autoSemester);

    const periods = await schedulesRepo.getPeriods(activeYear.academic_year_id, semester);
    const effectivePeriods = periods.length > 0 ? periods : DEFAULT_PERIODS;
    const currentPeriod = wib.isSchoolDay ? findCurrentPeriodFromTime(effectivePeriods, wib.timeWib) : null;

    if (!wib.isSchoolDay) {
      return {
        academic_year_id: activeYear.academic_year_id,
        semester,
        is_school_day: false,
        day_of_week: wib.dayOfWeek,
        day_label: wib.dayLabel,
        time_wib: wib.timeWib,
        current_period: null,
        suggested_fill: null,
        today_teacher_blocks: [],
        active_class_slots: [],
        day_slots: []
      };
    }

    const allDaySlots = await schedulesRepo.getSlotsForDay(
      activeYear.academic_year_id,
      semester,
      wib.dayOfWeek,
      null
    );
    const activeDaySlots = teacher_id
      ? allDaySlots.filter((s) => s.teacher_id === teacher_id)
      : allDaySlots;

    // Group consecutive periods for the selected teacher (same class + same subject)
    const blocks = [];
    if (teacher_id && activeDaySlots.length > 0) {
      for (const s of activeDaySlots) {
        const prev = blocks[blocks.length - 1];
        if (
          prev &&
          prev.class_id === s.class_id &&
          prev.subject_id === s.subject_id &&
          prev.periods[prev.periods.length - 1] === Number(s.period_number) - 1
        ) {
          prev.periods.push(Number(s.period_number));
        } else {
          blocks.push({
            class_id: s.class_id,
            class_name: s.class_name,
            subject_id: s.subject_id,
            subject_code: s.subject_code,
            subject_name: s.subject_name,
            periods: [Number(s.period_number)]
          });
        }
      }
    }

    // Attach period time bounds & determine suggested block
    const periodMap = new Map(effectivePeriods.filter((p) => !p.is_break).map((p) => [Number(p.period_number), p]));
    const enrichedBlocks = blocks.map((b) => {
      const pFirst = periodMap.get(b.periods[0]);
      const pLast = periodMap.get(b.periods[b.periods.length - 1]);
      const isOngoing = currentPeriod && currentPeriod.period_number
        ? b.periods.includes(Number(currentPeriod.period_number))
        : false;
      return {
        ...b,
        start_time: pFirst ? pFirst.start_time : null,
        end_time: pLast ? pLast.end_time : null,
        is_ongoing: isOngoing
      };
    });

    let suggestedFill = null;
    if (teacher_id && enrichedBlocks.length > 0) {
      suggestedFill = enrichedBlocks.find((b) => b.is_ongoing) || null;
      if (!suggestedFill && currentPeriod && currentPeriod.period_number) {
        // Fallback to earliest upcoming block today if teacher hasn't started yet
        suggestedFill = enrichedBlocks.find((b) => b.periods[0] >= Number(currentPeriod.period_number)) || enrichedBlocks[0];
      }
    }

    const activeClassSlots = currentPeriod && currentPeriod.period_number
      ? allDaySlots.filter((s) => Number(s.period_number) === Number(currentPeriod.period_number))
      : [];

    return {
      academic_year_id: activeYear.academic_year_id,
      semester,
      is_school_day: true,
      day_of_week: wib.dayOfWeek,
      day_label: wib.dayLabel,
      time_wib: wib.timeWib,
      current_period: currentPeriod,
      suggested_fill: suggestedFill,
      today_teacher_blocks: enrichedBlocks,
      active_class_slots: activeClassSlots,
      day_slots: allDaySlots
    };
  }

  async upsertSlots({ academic_year_id, semester, day_of_week, period_number, period_numbers, class_id, subject_id, teacher_id, note, userId }) {
    const cleanYear = String(academic_year_id || '').trim();
    if (!cleanYear) throw new BadRequestError('Tahun Ajaran wajib dipilih.');
    const cleanSemester = this.normalizeSemester(semester);
    const cleanDay = this.normalizeDay(day_of_week);
    const cleanClassId = String(class_id || '').trim();
    const cleanSubjectId = String(subject_id || '').trim();
    const cleanTeacherId = teacher_id ? String(teacher_id).trim() : null;

    const rawPeriods = Array.isArray(period_numbers) && period_numbers.length > 0
      ? period_numbers
      : [period_number];
    const cleanPeriods = [...new Set(rawPeriods.map((p) => Number(p)))].sort((a, b) => a - b);

    if (cleanPeriods.length === 0 || cleanPeriods.some((p) => !Number.isInteger(p) || p < 1 || p > 12)) {
      throw new BadRequestError('Nomor Jam Pelajaran (period_number) harus antara 1 sampai 12.');
    }
    if (!cleanClassId) throw new BadRequestError('Kelas wajib dipilih.');
    if (!cleanSubjectId) throw new BadRequestError('Mata Pelajaran wajib dipilih.');

    const subj = await schedulesRepo.getSubjectById(cleanSubjectId);
    if (!subj) throw new NotFoundError('Mata Pelajaran tidak ditemukan.');

    if (subj.category === 'KBM' && !cleanTeacherId) {
      throw new BadRequestError(`Mata pelajaran ${subj.name} wajib memilih Guru Pengampu.`);
    }

    const effectiveTeacherId = subj.category === 'KBM' ? cleanTeacherId : null;

    return await db.withTransaction(async (client) => {
      // Verify class exists
      const clsRes = await client.query(`SELECT class_id, class_name, level FROM classes WHERE class_id = $1`, [cleanClassId]);
      const cls = clsRes.rows[0];
      if (!cls) throw new NotFoundError('Kelas tidak ditemukan.');

      // Conflict detection across all requested periods
      if (effectiveTeacherId) {
        const tRes = await client.query(`SELECT teacher_id, name FROM teachers WHERE teacher_id = $1`, [effectiveTeacherId]);
        if (tRes.rows.length === 0) throw new NotFoundError('Data Guru tidak ditemukan.');

        for (const pNum of cleanPeriods) {
          const conflict = await schedulesRepo.findTeacherConflict(client, {
            academicYearId: cleanYear,
            semester: cleanSemester,
            dayOfWeek: cleanDay,
            periodNumber: pNum,
            teacherId: effectiveTeacherId,
            excludeClassId: cleanClassId
          });
          if (conflict) {
            throw new ConflictError(
              `Bentrok Jadwal Guru! ${conflict.teacher_name} sudah terjadwal mengajar ${conflict.subject_name} (${conflict.subject_code}) di ${conflict.class_name} pada hari ${DAY_LABELS[cleanDay]} Jam ke-${pNum}.`,
              { conflict: { ...conflict, period_number: pNum, day_of_week: cleanDay } }
            );
          }
        }
      }

      const savedRows = [];
      for (const pNum of cleanPeriods) {
        const scheduleId = `SCH-${cleanYear.replace(/[^0-9]/g, '')}-${cleanSemester}-${cleanDay}-P${pNum}-${cleanClassId.replace(/[^A-Za-z0-9]/g, '').slice(-8)}-${crypto.randomBytes(2).toString('hex')}`;
        try {
          const upsertRes = await client.query(
            `INSERT INTO class_schedules (
               schedule_id, academic_year_id, semester, day_of_week, period_number,
               class_id, subject_id, teacher_id, note, updated_by_user_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (academic_year_id, semester, day_of_week, period_number, class_id)
             DO UPDATE SET
               subject_id = EXCLUDED.subject_id,
               teacher_id = EXCLUDED.teacher_id,
               note = EXCLUDED.note,
               updated_by_user_id = EXCLUDED.updated_by_user_id,
               updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [scheduleId, cleanYear, cleanSemester, cleanDay, pNum, cleanClassId, cleanSubjectId, effectiveTeacherId, note || null, userId || null]
          );
          savedRows.push(upsertRes.rows[0]);
        } catch (err) {
          if (err && err.code === '23505') {
            throw new ConflictError(
              `Bentrok Jadwal Guru pada hari ${DAY_LABELS[cleanDay]} Jam ke-${pNum}. Guru yang sama tidak dapat mengajar dua kelas di jam yang sama.`
            );
          }
          throw err;
        }
      }

      return savedRows;
    });
  }

  async deleteSlot(scheduleId) {
    const res = await db.query(
      `DELETE FROM class_schedules WHERE schedule_id = $1 RETURNING schedule_id`,
      [scheduleId]
    );
    if (res.rowCount === 0) {
      throw new NotFoundError('Slot jadwal tidak ditemukan.');
    }
    return { deleted: true, schedule_id: scheduleId };
  }

  async clearCell({ academic_year_id, semester, day_of_week, period_number, class_id }) {
    const cleanYear = String(academic_year_id || '').trim();
    const cleanSemester = this.normalizeSemester(semester);
    const cleanDay = this.normalizeDay(day_of_week);
    const cleanPeriod = Number(period_number);
    const cleanClassId = String(class_id || '').trim();

    const res = await db.query(
      `DELETE FROM class_schedules
       WHERE academic_year_id = $1 AND semester = $2 AND day_of_week = $3 AND period_number = $4 AND class_id = $5
       RETURNING schedule_id`,
      [cleanYear, cleanSemester, cleanDay, cleanPeriod, cleanClassId]
    );
    return { deleted: res.rowCount > 0, count: res.rowCount };
  }

  async upsertSubject({ subject_id, code, name, category = 'KBM', color_tone = 'emerald' }) {
    const cleanCode = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    const cleanName = String(name || '').trim();
    const cleanCategory = ['KBM', 'NON_KBM', 'BREAK'].includes(String(category).toUpperCase())
      ? String(category).toUpperCase()
      : 'KBM';
    const cleanTone = ['emerald', 'teal', 'indigo', 'sky', 'amber', 'rose', 'violet', 'slate'].includes(color_tone)
      ? color_tone
      : 'emerald';

    if (!cleanCode || cleanCode.length > 20) {
      throw new BadRequestError('Kode mapel wajib diisi (maks 20 karakter).');
    }
    if (!cleanName || cleanName.length > 120) {
      throw new BadRequestError('Nama mata pelajaran wajib diisi.');
    }

    try {
      if (subject_id) {
        const res = await db.query(
          `UPDATE subjects
           SET code = $2, name = $3, category = $4, color_tone = $5, is_active = TRUE, updated_at = CURRENT_TIMESTAMP
           WHERE subject_id = $1
           RETURNING *`,
          [subject_id, cleanCode, cleanName, cleanCategory, cleanTone]
        );
        if (res.rowCount === 0) throw new NotFoundError('Mata pelajaran tidak ditemukan.');
        return res.rows[0];
      }

      const newId = `SUBJ-${cleanCode.replace(/[^A-Z0-9]/g, '').slice(0, 14) || crypto.randomBytes(3).toString('hex')}`;
      const res = await db.query(
        `INSERT INTO subjects (subject_id, code, name, category, color_tone, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           color_tone = EXCLUDED.color_tone,
           is_active = TRUE,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [newId, cleanCode, cleanName, cleanCategory, cleanTone]
      );
      return res.rows[0];
    } catch (err) {
      if (err && err.code === '23505') {
        throw new ConflictError(`Kode mata pelajaran "${cleanCode}" sudah digunakan.`);
      }
      throw err;
    }
  }

  async deleteSubject(subjectId) {
    const refCheck = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM class_schedules WHERE subject_id = $1`,
      [subjectId]
    );
    if (Number(refCheck.rows[0]?.cnt || 0) > 0) {
      throw new ConflictError('Mata pelajaran masih terpasang pada jadwal pelajaran. Hapus atau ganti slot jadwal terkait terlebih dahulu.');
    }
    const res = await db.query(`DELETE FROM subjects WHERE subject_id = $1 RETURNING subject_id`, [subjectId]);
    if (res.rowCount === 0) throw new NotFoundError('Mata pelajaran tidak ditemukan.');
    return { deleted: true, subject_id: subjectId };
  }

  async updatePeriods({ academic_year_id, semester, periods }) {
    const cleanYear = String(academic_year_id || '').trim();
    const cleanSemester = this.normalizeSemester(semester);
    if (!Array.isArray(periods) || periods.length === 0) {
      throw new BadRequestError('Daftar jam pelajaran tidak boleh kosong.');
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    const sanitized = periods.map((p, idx) => {
      const startTime = String(p.start_time || '').trim();
      const endTime = String(p.end_time || '').trim();
      const isBreak = Boolean(p.is_break);
      const label = String(p.label || (isBreak ? 'Istirahat' : `Jam ke-${idx + 1}`)).trim();
      const periodNumber = isBreak ? null : Number(p.period_number);

      if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        throw new BadRequestError(`Format jam tidak valid pada "${label}" (gunakan HH:MM).`);
      }
      if (startTime >= endTime) {
        throw new BadRequestError(`Jam selesai harus lebih besar dari jam mulai pada "${label}".`);
      }
      if (!isBreak && (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 12)) {
        throw new BadRequestError(`Nomor jam pelajaran tidak valid pada "${label}".`);
      }

      return {
        sort_order: idx + 1,
        period_number: periodNumber,
        label,
        start_time: startTime,
        end_time: endTime,
        is_break: isBreak
      };
    });

    return await db.withTransaction(async (client) => {
      await client.query(
        `DELETE FROM schedule_periods WHERE academic_year_id = $1 AND semester = $2`,
        [cleanYear, cleanSemester]
      );
      const inserted = [];
      for (const p of sanitized) {
        const id = `PRD-${cleanYear.replace(/[^0-9]/g, '')}-${cleanSemester}-${String(p.sort_order).padStart(2, '0')}`;
        const res = await client.query(
          `INSERT INTO schedule_periods (
             period_config_id, academic_year_id, semester, sort_order, period_number,
             label, start_time, end_time, is_break
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [id, cleanYear, cleanSemester, p.sort_order, p.period_number, p.label, p.start_time, p.end_time, p.is_break]
        );
        inserted.push(res.rows[0]);
      }
      return inserted;
    });
  }

  async updateTeacherShortCode({ academic_year_id, semester, teacher_id, short_code }) {
    const cleanYear = String(academic_year_id || '').trim();
    const cleanSemester = this.normalizeSemester(semester);
    const cleanTeacherId = String(teacher_id || '').trim();
    const cleanCode = short_code ? String(short_code).trim().toUpperCase().slice(0, 10) : '';

    if (!cleanTeacherId) throw new BadRequestError('Guru wajib dipilih.');

    if (!cleanCode) {
      await db.query(
        `DELETE FROM teacher_schedule_codes WHERE academic_year_id = $1 AND semester = $2 AND teacher_id = $3`,
        [cleanYear, cleanSemester, cleanTeacherId]
      );
      return { teacher_id: cleanTeacherId, short_code: null };
    }

    try {
      const res = await db.query(
        `INSERT INTO teacher_schedule_codes (academic_year_id, semester, teacher_id, short_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (academic_year_id, semester, teacher_id)
         DO UPDATE SET short_code = EXCLUDED.short_code, updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [cleanYear, cleanSemester, cleanTeacherId, cleanCode]
      );
      return res.rows[0];
    } catch (err) {
      if (err && err.code === '23505') {
        throw new ConflictError(`Kode guru "${cleanCode}" sudah dipakai oleh guru lain pada semester ini.`);
      }
      throw err;
    }
  }

  async copySchedule({ from_academic_year_id, from_semester, to_academic_year_id, to_semester, overwrite = false, userId = null }) {
    const srcYear = String(from_academic_year_id || '').trim();
    const dstYear = String(to_academic_year_id || '').trim();
    const srcSem = this.normalizeSemester(from_semester);
    const dstSem = this.normalizeSemester(to_semester);

    if (!srcYear || !dstYear) throw new BadRequestError('Tahun Ajaran asal dan tujuan wajib diisi.');
    if (srcYear === dstYear && srcSem === dstSem) {
      throw new BadRequestError('Tahun Ajaran dan Semester tujuan tidak boleh sama persis dengan sumber.');
    }

    return await db.withTransaction(async (client) => {
      // Ensure target academic year exists cleanly in academic_years
      const yearCheck = await client.query(`SELECT academic_year_id FROM academic_years WHERE academic_year_id = $1`, [dstYear]);
      if (yearCheck.rows.length === 0) {
        throw new NotFoundError(`Tahun Ajaran tujuan "${dstYear}" belum terdaftar di Master Tahun Ajaran.`);
      }

      const srcSlotsRes = await client.query(
        `SELECT cs.*, c.class_name, c.level AS class_level
         FROM class_schedules cs
         JOIN classes c ON c.class_id = cs.class_id
         WHERE cs.academic_year_id = $1 AND cs.semester = $2`,
        [srcYear, srcSem]
      );
      if (srcSlotsRes.rows.length === 0) {
        throw new BadRequestError(`Sumber jadwal (${srcYear} • ${srcSem}) masih kosong.`);
      }

      const targetClasses = await schedulesRepo.getClassesForYear(dstYear);
      const targetClassByName = new Map(targetClasses.map((c) => [c.class_name.toLowerCase(), c]));
      const targetClassByLevel = new Map(targetClasses.map((c) => [Number(c.level), c]));

      if (overwrite) {
        await client.query(`DELETE FROM class_schedules WHERE academic_year_id = $1 AND semester = $2`, [dstYear, dstSem]);
        await client.query(`DELETE FROM teacher_schedule_codes WHERE academic_year_id = $1 AND semester = $2`, [dstYear, dstSem]);
        await client.query(`DELETE FROM schedule_periods WHERE academic_year_id = $1 AND semester = $2`, [dstYear, dstSem]);
      }

      // Copy period config
      const srcPeriods = await client.query(
        `SELECT * FROM schedule_periods WHERE academic_year_id = $1 AND semester = $2 ORDER BY sort_order ASC`,
        [srcYear, srcSem]
      );
      if (srcPeriods.rows.length > 0) {
        for (const p of srcPeriods.rows) {
          const newPid = `PRD-${dstYear.replace(/[^0-9]/g, '')}-${dstSem}-${String(p.sort_order).padStart(2, '0')}`;
          await client.query(
            `INSERT INTO schedule_periods (
               period_config_id, academic_year_id, semester, sort_order, period_number, label, start_time, end_time, is_break
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (academic_year_id, semester, sort_order) DO NOTHING`,
            [newPid, dstYear, dstSem, p.sort_order, p.period_number, p.label, p.start_time, p.end_time, p.is_break]
          );
        }
      } else {
        await ensurePeriodsSeeded(client, dstYear, dstSem);
      }

      // Copy teacher short codes
      const srcCodes = await client.query(
        `SELECT teacher_id, short_code FROM teacher_schedule_codes WHERE academic_year_id = $1 AND semester = $2`,
        [srcYear, srcSem]
      );
      for (const tc of srcCodes.rows) {
        await client.query(
          `INSERT INTO teacher_schedule_codes (academic_year_id, semester, teacher_id, short_code)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (academic_year_id, semester, teacher_id) DO NOTHING`,
          [dstYear, dstSem, tc.teacher_id, tc.short_code]
        );
      }

      // Copy schedule slots remapping target classes by name or level
      let copiedCount = 0;
      for (const s of srcSlotsRes.rows) {
        const mappedClass =
          targetClasses.find((c) => c.class_id === s.class_id) ||
          targetClassByName.get(String(s.class_name || '').toLowerCase()) ||
          targetClassByLevel.get(Number(s.class_level)) ||
          { class_id: s.class_id };

        const newId = `SCH-${dstYear.replace(/[^0-9]/g, '')}-${dstSem}-${s.day_of_week}-P${s.period_number}-${mappedClass.class_id.replace(/[^A-Za-z0-9]/g, '').slice(-8)}-${crypto.randomBytes(2).toString('hex')}`;
        const ins = await client.query(
          `INSERT INTO class_schedules (
             schedule_id, academic_year_id, semester, day_of_week, period_number,
             class_id, subject_id, teacher_id, note, updated_by_user_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (academic_year_id, semester, day_of_week, period_number, class_id) DO NOTHING`,
          [newId, dstYear, dstSem, s.day_of_week, s.period_number, mappedClass.class_id, s.subject_id, s.teacher_id, s.note, userId]
        );
        copiedCount += ins.rowCount || 0;
      }

      return {
        from: `${srcYear} (${srcSem})`,
        to: `${dstYear} (${dstSem})`,
        copied_slots: copiedCount
      };
    });
  }

  async importRows({ academic_year_id, semester, rows = [], overwrite = false, userId = null }) {
    const cleanYear = String(academic_year_id || '').trim();
    const cleanSemester = this.normalizeSemester(semester);
    if (!cleanYear) throw new BadRequestError('Tahun Ajaran wajib dipilih.');
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestError('Data baris jadwal yang akan diimpor tidak boleh kosong.');
    }

    return await db.withTransaction(async (client) => {
      await ensureSubjectsSeeded(client, { overwrite: false });
      await ensurePeriodsSeeded(client, cleanYear, cleanSemester);

      const subjRes = await client.query(`SELECT subject_id, code, name, category FROM subjects WHERE is_active = TRUE`);
      const subjByCode = new Map(subjRes.rows.map((s) => [s.code.toUpperCase(), s]));

      const teacherRes = await client.query(
        `SELECT t.teacher_id, t.name, tsc.short_code
         FROM teachers t
         LEFT JOIN teacher_schedule_codes tsc
           ON tsc.teacher_id = t.teacher_id AND tsc.academic_year_id = $1 AND tsc.semester = $2
         WHERE t.status = 'Active'`,
        [cleanYear, cleanSemester]
      );
      const teacherByCode = new Map(
        teacherRes.rows.filter((t) => t.short_code).map((t) => [String(t.short_code).toUpperCase(), t])
      );

      const classes = await schedulesRepo.getClassesForYear(cleanYear);
      const classByLevel = new Map(classes.map((c) => [Number(c.level), c]));
      const classByName = new Map(classes.map((c) => [c.class_name.trim().toUpperCase(), c]));
      const classById = new Map(classes.map((c) => [c.class_id, c]));

      if (overwrite) {
        await client.query(`DELETE FROM class_schedules WHERE academic_year_id = $1 AND semester = $2`, [cleanYear, cleanSemester]);
      }

      // Check batch-internal teacher conflicts first before modifying DB
      const batchTeacherSlotCheck = new Map();
      const normalizedRows = [];

      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const dayOfWeek = this.normalizeDay(r.day_of_week);
        const periodNumber = Number(r.period_number);
        if (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 12) {
          throw new BadRequestError(`Baris #${i + 1}: nomor Jam ke-${r.period_number} tidak valid.`);
        }

        const rawClass = String(r.class_id || r.class_name || '').trim();
        const levelLookup = rawClass.toUpperCase() === 'X' ? 10 : rawClass.toUpperCase() === 'XI' ? 11 : rawClass.toUpperCase() === 'XII' ? 12 : Number(rawClass);
        const cls =
          classById.get(rawClass) ||
          classByName.get(rawClass.toUpperCase()) ||
          (!Number.isNaN(levelLookup) ? classByLevel.get(levelLookup) : null);
        if (!cls) {
          throw new BadRequestError(`Baris #${i + 1}: kelas "${rawClass}" tidak ditemukan.`);
        }

        const codeNorm = normalizeSubjectCode(r.subject_code || r.subject || '');
        const subj = subjByCode.get(codeNorm);
        if (!subj) {
          throw new BadRequestError(`Baris #${i + 1}: kode/nama mapel "${r.subject_code || r.subject}" belum terdaftar di Master Mapel.`);
        }

        let teacher = null;
        if (subj.category === 'KBM') {
          const rawTeacher = String(r.teacher_id || r.teacher_code || r.teacher_name || '').trim();
          if (rawTeacher) {
            teacher =
              teacherRes.rows.find((t) => t.teacher_id === rawTeacher) ||
              teacherByCode.get(rawTeacher.toUpperCase()) ||
              matchTeacherRow(teacherRes.rows, [rawTeacher]);
          }
          if (!teacher) {
            throw new BadRequestError(`Baris #${i + 1}: guru "${rawTeacher || '-'}" untuk mapel ${subj.code} (${cls.class_name} Jam ${periodNumber}) tidak ditemukan.`);
          }

          const slotKey = `${dayOfWeek}|${periodNumber}|${teacher.teacher_id}`;
          const prev = batchTeacherSlotCheck.get(slotKey);
          if (prev && prev.class_id !== cls.class_id) {
            throw new ConflictError(
              `Bentrok pada data impor! ${teacher.name} terjadwal ganda di ${prev.class_name} dan ${cls.class_name} pada ${DAY_LABELS[dayOfWeek]} Jam ke-${periodNumber}.`
            );
          }
          batchTeacherSlotCheck.set(slotKey, { class_id: cls.class_id, class_name: cls.class_name });
        }

        normalizedRows.push({
          dayOfWeek,
          periodNumber,
          classId: cls.class_id,
          subjectId: subj.subject_id,
          teacherId: subj.category === 'KBM' && teacher ? teacher.teacher_id : null,
          note: r.note || null
        });
      }

      let importedCount = 0;
      for (const item of normalizedRows) {
        if (item.teacherId && !overwrite) {
          const conflict = await schedulesRepo.findTeacherConflict(client, {
            academicYearId: cleanYear,
            semester: cleanSemester,
            dayOfWeek: item.dayOfWeek,
            periodNumber: item.periodNumber,
            teacherId: item.teacherId,
            excludeClassId: item.classId
          });
          if (conflict) {
            throw new ConflictError(
              `Bentrok Jadwal Guru! ${conflict.teacher_name} sudah terjadwal di ${conflict.class_name} pada ${DAY_LABELS[item.dayOfWeek]} Jam ke-${item.periodNumber}.`
            );
          }
        }

        const scheduleId = `SCH-${cleanYear.replace(/[^0-9]/g, '')}-${cleanSemester}-${item.dayOfWeek}-P${item.periodNumber}-${item.classId.replace(/[^A-Za-z0-9]/g, '').slice(-8)}-${crypto.randomBytes(2).toString('hex')}`;
        await client.query(
          `INSERT INTO class_schedules (
             schedule_id, academic_year_id, semester, day_of_week, period_number,
             class_id, subject_id, teacher_id, note, updated_by_user_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (academic_year_id, semester, day_of_week, period_number, class_id)
           DO UPDATE SET
             subject_id = EXCLUDED.subject_id,
             teacher_id = EXCLUDED.teacher_id,
             note = EXCLUDED.note,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_at = CURRENT_TIMESTAMP`,
          [scheduleId, cleanYear, cleanSemester, item.dayOfWeek, item.periodNumber, item.classId, item.subjectId, item.teacherId, item.note, userId]
        );
        importedCount += 1;
      }

      return { academic_year_id: cleanYear, semester: cleanSemester, imported_slots: importedCount };
    });
  }

  async seedDefault({ academic_year_id = '2026/2027', semester = 'GANJIL', overwrite = false } = {}) {
    const cleanSemester = this.normalizeSemester(semester);
    return await db.withTransaction(async (client) => {
      return await seedDefaultSchedule2026Ganjil(client, {
        academicYearId: academic_year_id,
        semester: cleanSemester,
        overwrite: Boolean(overwrite)
      });
    });
  }
}

module.exports = new SchedulesService();
module.exports.getWibClock = getWibClock;
module.exports.findCurrentPeriodFromTime = findCurrentPeriodFromTime;
module.exports.DAY_LABELS = DAY_LABELS;
