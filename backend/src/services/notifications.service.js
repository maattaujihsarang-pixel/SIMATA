const db = require('../config/database');
const attendanceEvidenceRepository = require('../repositories/attendance-evidence.repository');
const classRepository = require('../repositories/class.repository');
const studentRepository = require('../repositories/student.repository');
const teacherRepository = require('../repositories/teacher.repository');
const schedulesService = require('./schedules.service');
const { getTodayISODate } = require('../utils/date.util');
const { BadRequestError, NotFoundError } = require('../errors');
const { generateUUID } = require('../utils/id-generator.util');

const KEY_RULES = 'notification_rules_config';
const KEY_BROADCASTS = 'notification_broadcasts';
const KEY_EVENTS = 'notification_events_log';

const VALID_PRIORITIES = new Set(['info', 'warning', 'urgent', 'success']);
const VALID_CATEGORIES = new Set(['presensi', 'jadwal', 'responder', 'peringatan', 'info']);
const VALID_TARGET_ROLES = new Set(['ALL', 'ADMIN', 'GURU']);

const DEFAULT_NOTIFICATION_RULES = {
  school_end_time: '13:00',
  teacher_remind_time: '12:30',
  daily_digest_time: '14:30',
  consecutive_alpha_threshold: 3,
  upcoming_class_lead_minutes: 15,
  enable_class_incomplete: true,
  enable_teacher_forgot: true,
  enable_schedule_conflict: true,
  enable_responder: true,
  enable_early_warning_alpha: true,
  enable_upcoming_teaching: true,
  enable_daily_digest: true,
  enable_academic_kts: true,
  enable_finance_grades: true,
  custom_holidays: []
};

const DAY_NAMES_ID = {
  0: 'Ahad',
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu'
};

function parseMinutesFromHHMM(timeStr) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function normalizeHHMM(val, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(val || '').trim());
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getCurrentWibClock(overrideDay = null, overrideTime = null) {
  let dayOfWeek;
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

  let timeWib;
  if (overrideTime && /^\d{1,2}:\d{2}$/.test(String(overrideTime).trim())) {
    timeWib = normalizeHHMM(overrideTime, '08:00');
  } else {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const hh = (parts.find((p) => p.type === 'hour') || { value: '07' }).value;
    const mm = (parts.find((p) => p.type === 'minute') || { value: '00' }).value;
    timeWib = `${hh}:${mm}`;
  }

  return {
    dayOfWeek,
    dayLabel: DAY_NAMES_ID[dayOfWeek] || 'Hari Ini',
    timeWib,
    minutes: parseMinutesFromHHMM(timeWib) ?? 480
  };
}

function getNextISODate(isoDate) {
  try {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return dt.toISOString().slice(0, 10);
  } catch (_) {
    return '';
  }
}

function safeParseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function normalizeRulesConfig(raw = {}) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const holidaysRaw = Array.isArray(obj.custom_holidays) ? obj.custom_holidays : [];
  const cleanHolidays = holidaysRaw
    .filter((h) => h && /^\d{4}-\d{2}-\d{2}$/.test(String(h.date || '').trim()))
    .map((h) => ({
      date: String(h.date).trim(),
      title: String(h.title || 'Hari Libur / Eksepsi').trim().slice(0, 120)
    }));

  const alphaThreshold = Math.max(1, Math.min(30, parseInt(obj.consecutive_alpha_threshold, 10) || DEFAULT_NOTIFICATION_RULES.consecutive_alpha_threshold));
  const leadMinutes = Math.max(5, Math.min(90, parseInt(obj.upcoming_class_lead_minutes, 10) || DEFAULT_NOTIFICATION_RULES.upcoming_class_lead_minutes));

  const toBool = (v, def) => (v === undefined ? def : Boolean(v));

  return {
    school_end_time: normalizeHHMM(obj.school_end_time, DEFAULT_NOTIFICATION_RULES.school_end_time),
    teacher_remind_time: normalizeHHMM(obj.teacher_remind_time, DEFAULT_NOTIFICATION_RULES.teacher_remind_time),
    daily_digest_time: normalizeHHMM(obj.daily_digest_time, DEFAULT_NOTIFICATION_RULES.daily_digest_time),
    consecutive_alpha_threshold: alphaThreshold,
    upcoming_class_lead_minutes: leadMinutes,
    enable_class_incomplete: toBool(obj.enable_class_incomplete, true),
    enable_teacher_forgot: toBool(obj.enable_teacher_forgot, true),
    enable_schedule_conflict: toBool(obj.enable_schedule_conflict, true),
    enable_responder: toBool(obj.enable_responder, true),
    enable_early_warning_alpha: toBool(obj.enable_early_warning_alpha, true),
    enable_upcoming_teaching: toBool(obj.enable_upcoming_teaching, true),
    enable_daily_digest: toBool(obj.enable_daily_digest, true),
    enable_academic_kts: toBool(obj.enable_academic_kts, true),
    enable_finance_grades: toBool(obj.enable_finance_grades, true),
    custom_holidays: cleanHolidays.slice(0, 60)
  };
}

class NotificationsService {
  async getRawSettingsState() {
    let map = {};
    try {
      map = await attendanceEvidenceRepository.getSystemSettings([KEY_RULES, KEY_BROADCASTS, KEY_EVENTS]);
    } catch (_) {
      map = {};
    }
    const rules = normalizeRulesConfig(safeParseJson(map[KEY_RULES]?.setting_value, {}));
    const broadcastsRaw = safeParseJson(map[KEY_BROADCASTS]?.setting_value, []);
    const eventsRaw = safeParseJson(map[KEY_EVENTS]?.setting_value, []);
    return {
      rules,
      broadcasts: Array.isArray(broadcastsRaw) ? broadcastsRaw : [],
      events: Array.isArray(eventsRaw) ? eventsRaw : []
    };
  }

  async getRulesConfig() {
    const state = await this.getRawSettingsState();
    return state.rules;
  }

  async updateRulesConfig(payload = {}, userId = null) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestError('Payload pengaturan notifikasi tidak valid');
    }
    const current = await this.getRulesConfig();
    const merged = normalizeRulesConfig({ ...current, ...payload });
    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_RULES,
      JSON.stringify(merged),
      'Konfigurasi aturan otomatis pusat notifikasi SIMATA (BUG 66)',
      userId
    );
    return merged;
  }

  async createBroadcast(payload = {}, user = null) {
    const title = String(payload.title || '').trim();
    const message = String(payload.message || '').trim();
    if (!title || !message) {
      throw new BadRequestError('Judul dan isi pengumuman notifikasi wajib diisi');
    }
    const category = VALID_CATEGORIES.has(payload.category) ? payload.category : 'info';
    const priority = VALID_PRIORITIES.has(payload.priority) ? payload.priority : 'info';
    const targetRole = VALID_TARGET_ROLES.has(payload.target_role) ? payload.target_role : 'ALL';
    const targetTeacherId = payload.target_teacher_id ? String(payload.target_teacher_id).trim() : null;
    const actionMenu = payload.action_menu ? String(payload.action_menu).trim() : null;

    const state = await this.getRawSettingsState();
    const item = {
      id: `bc-${generateUUID().slice(0, 12)}`,
      title: title.slice(0, 140),
      message: message.slice(0, 600),
      category,
      priority,
      target_role: targetRole,
      target_teacher_id: targetTeacherId || null,
      action_menu: actionMenu || null,
      action_label: actionMenu ? 'Buka Menu Terkait \u2192' : null,
      author_name: user?.full_name || 'Admin SIMATA',
      created_at: new Date().toISOString()
    };

    const nextBroadcasts = [item, ...state.broadcasts].slice(0, 50);
    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_BROADCASTS,
      JSON.stringify(nextBroadcasts),
      'Daftar pengumuman manual pusat notifikasi SIMATA (BUG 66)',
      user?.user_id || null
    );
    return item;
  }

  async deleteBroadcast(broadcastId, user = null) {
    const cleanId = String(broadcastId || '').trim();
    const state = await this.getRawSettingsState();
    const exists = state.broadcasts.some((b) => b.id === cleanId);
    if (!exists) {
      throw new NotFoundError(`Pengumuman '${cleanId}' tidak ditemukan`);
    }
    const nextBroadcasts = state.broadcasts.filter((b) => b.id !== cleanId);
    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_BROADCASTS,
      JSON.stringify(nextBroadcasts),
      'Daftar pengumuman manual pusat notifikasi SIMATA (BUG 66)',
      user?.user_id || null
    );
    return { deleted_id: cleanId };
  }

  async logEvent(payload = {}, user = null) {
    const title = String(payload.title || '').trim();
    const message = String(payload.message || '').trim();
    if (!title || !message) {
      throw new BadRequestError('title dan message event notifikasi wajib diisi');
    }
    const category = VALID_CATEGORIES.has(payload.category) ? payload.category : 'info';
    const priority = VALID_PRIORITIES.has(payload.priority) ? payload.priority : 'info';
    const state = await this.getRawSettingsState();

    const evt = {
      id: `evt-${generateUUID().slice(0, 12)}`,
      title: title.slice(0, 140),
      message: message.slice(0, 400),
      category,
      priority,
      target_role: VALID_TARGET_ROLES.has(payload.target_role) ? payload.target_role : 'ALL',
      target_teacher_id: payload.target_teacher_id ? String(payload.target_teacher_id).trim() : null,
      action_menu: payload.action_menu ? String(payload.action_menu).trim() : null,
      action_label: payload.action_label ? String(payload.action_label).trim() : null,
      action_payload: payload.action_payload && typeof payload.action_payload === 'object' ? payload.action_payload : null,
      created_at: new Date().toISOString()
    };

    const nextEvents = [evt, ...state.events].slice(0, 40);
    await attendanceEvidenceRepository.upsertSystemSetting(
      KEY_EVENTS,
      JSON.stringify(nextEvents),
      'Log aktivitas jadwal, responder & sistem pusat notifikasi SIMATA (BUG 66)',
      user?.user_id || null
    );
    return evt;
  }

  async safeQuery(sql, params = []) {
    try {
      const res = await db.query(sql, params);
      return res.rows || [];
    } catch (_) {
      return [];
    }
  }

  async getNotificationsFeed({ user = null, date = null, time_wib = null, day_of_week = null } = {}) {
    const targetDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim()))
      ? String(date).trim()
      : getTodayISODate();
    const wib = getCurrentWibClock(day_of_week, time_wib);
    const tomorrowDate = getNextISODate(targetDate);
    const isAdmin = user?.role === 'ADMIN';
    const viewerTeacherId = user?.teacher_id || null;

    const { rules, broadcasts, events } = await this.getRawSettingsState();

    const customHolidayToday = rules.custom_holidays.find((h) => h.date === targetDate) || null;
    const customHolidayTomorrow = rules.custom_holidays.find((h) => h.date === tomorrowDate) || null;
    const isWeeklyHoliday = wib.dayOfWeek === 5; // Jumat libur KBM rutin MA At-Taujih
    const isHoliday = Boolean(customHolidayToday || isWeeklyHoliday);
    const holidayTitle = customHolidayToday
      ? customHolidayToday.title
      : (isWeeklyHoliday ? 'Libur Mingguan (Hari Jumat)' : null);

    // Fetch core domain entities cleanly in parallel
    const [
      allClasses,
      allStudents,
      allTeachers,
      todayStudentAttRows,
      todayTeacherAttRows,
      alphaStudentAttRows,
      pendingInvoicesRows,
      evidenceRows
    ] = await Promise.all([
      classRepository.findAll().catch(() => []),
      studentRepository.findAll({ status: 'Active' }).catch(() => []),
      teacherRepository.findAll({ status: 'Active' }).catch(() => []),
      this.safeQuery(
        `SELECT sa.attendance_id, sa.student_id, sa.class_id, sa.period, sa.status, sa.attendance_date,
                s.name AS student_name, c.class_name
         FROM student_attendance sa
         JOIN students s ON sa.student_id = s.student_id
         LEFT JOIN classes c ON sa.class_id = c.class_id
         WHERE sa.attendance_date = $1`,
        [targetDate]
      ),
      this.safeQuery(
        `SELECT ta.attendance_id, ta.teacher_id, ta.class_id, ta.attendance_date, ta.period, ta.subject, ta.status,
                t.name AS teacher_name, c.class_name
         FROM teacher_attendance ta
         JOIN teachers t ON ta.teacher_id = t.teacher_id
         LEFT JOIN classes c ON ta.class_id = c.class_id
         WHERE ta.attendance_date = $1`,
        [targetDate]
      ),
      this.safeQuery(
        `SELECT sa.student_id, sa.class_id, sa.attendance_date, sa.status,
                s.name AS student_name, c.class_name
         FROM student_attendance sa
         JOIN students s ON sa.student_id = s.student_id
         LEFT JOIN classes c ON sa.class_id = c.class_id
         WHERE LOWER(sa.status) = LOWER($1)`,
        ['Alpa']
      ),
      isAdmin
        ? this.safeQuery(
            `SELECT i.invoice_id, i.student_id, i.status, i.total_amount, i.amount_paid,
                    s.name AS student_name, c.class_name
             FROM student_invoices i
             JOIN students s ON i.student_id = s.student_id
             LEFT JOIN classes c ON s.class_id = c.class_id`
          )
        : Promise.resolve([]),
      this.safeQuery(
        `SELECT evidence_id, file_id, attendance_id, captured_at
         FROM attendance_evidences`
      )
    ]);

    // Fetch schedule overview/slots safely (works seamlessly even if schedules tables aren't populated)
    let dayScheduleSlots = [];
    let schedulePeriods = [];
    let scheduleConflictCount = 0;
    try {
      const activeDaySched = await schedulesService.getActiveNowForResponder({
        teacher_id: null,
        day_of_week: wib.dayOfWeek,
        time_wib: wib.timeWib
      });
      dayScheduleSlots = Array.isArray(activeDaySched?.day_slots) ? activeDaySched.day_slots : [];
    } catch (_) {
      dayScheduleSlots = [];
    }
    try {
      const overview = await schedulesService.getOverview({ user });
      schedulePeriods = Array.isArray(overview?.periods) ? overview.periods : [];
      scheduleConflictCount = Number(overview?.summary?.conflict_count || 0);
    } catch (_) {
      schedulePeriods = [];
      scheduleConflictCount = 0;
    }

    const feed = [];

    // 1. Smart Holiday & H-1 Reminder
    if (isHoliday) {
      feed.push({
        id: `holiday-${targetDate}`,
        category: 'info',
        priority: 'info',
        title: `Hari Libur / Eksepsi: ${holidayTitle}`,
        message: 'Pengingat presensi kelas dan presensi guru otomatis dijeda hari ini agar tidak menimbulkan notifikasi palsu.',
        timestamp: `${wib.dayLabel}, ${targetDate} • Otomatis`,
        created_at: new Date().toISOString(),
        resolved: false,
        action_label: 'Lihat Jadwal Pelajaran \u2192',
        action_menu: 'menu-schedules',
        snoozable: false
      });
    } else if (customHolidayTomorrow) {
      feed.push({
        id: `holiday-h1-${tomorrowDate}`,
        category: 'info',
        priority: 'info',
        title: `Besok Libur / Eksepsi: ${customHolidayTomorrow.title}`,
        message: `Tercatat jadwal khusus pada ${tomorrowDate}. Pengingat presensi otomatis akan dijeda besok.`,
        timestamp: 'Pengingat H-1 • Otomatis',
        created_at: new Date().toISOString(),
        resolved: false,
        action_label: 'Atur Kalender Libur \u2192',
        action_menu: 'notif-settings',
        snoozable: false
      });
    }

    // Group active classes & student counts
    const activeClasses = allClasses.filter((c) => !c.status || c.status === 'Active');
    const studentsByClass = new Map();
    for (const st of allStudents) {
      if (!st.class_id) continue;
      if (!studentsByClass.has(st.class_id)) studentsByClass.set(st.class_id, []);
      studentsByClass.get(st.class_id).push(st);
    }

    const populatedClasses = activeClasses.filter((c) => (studentsByClass.get(c.class_id) || []).length > 0);
    const recordedByClassPeriod = new Map();
    for (const row of todayStudentAttRows) {
      const cid = row.class_id;
      const pNum = Number(row.period || 1);
      if (!cid || !pNum) continue;
      if (!recordedByClassPeriod.has(cid)) recordedByClassPeriod.set(cid, new Map());
      const pMap = recordedByClassPeriod.get(cid);
      if (!pMap.has(pNum)) pMap.set(pNum, new Set());
      pMap.get(pNum).add(row.student_id);
    }

    // Determine expected periods per class today from scheduled KBM slots (fallback to [1] only if schedule isn't seeded for that class)
    const expectedPeriodsByClass = new Map();
    const classesWithAnySchedule = new Set();
    for (const slot of dayScheduleSlots) {
      if (!slot.class_id || !slot.period_number) continue;
      classesWithAnySchedule.add(slot.class_id);
      if (slot.subject_category && slot.subject_category !== 'KBM') continue;
      if (!expectedPeriodsByClass.has(slot.class_id)) expectedPeriodsByClass.set(slot.class_id, new Set());
      expectedPeriodsByClass.get(slot.class_id).add(Number(slot.period_number));
    }

    // Classes relevant for viewer (Admin: all populated classes; Guru: homeroom or scheduled today, falling back to all if unscheduled)
    const teacherClassIds = new Set();
    if (!isAdmin && viewerTeacherId) {
      for (const c of populatedClasses) {
        if (c.homeroom_teacher_id === viewerTeacherId) teacherClassIds.add(c.class_id);
      }
      for (const slot of dayScheduleSlots) {
        if (slot.teacher_id === viewerTeacherId && slot.class_id) teacherClassIds.add(slot.class_id);
      }
    }
    const relevantClasses = (!isAdmin && viewerTeacherId && teacherClassIds.size > 0)
      ? populatedClasses.filter((c) => teacherClassIds.has(c.class_id))
      : populatedClasses;

    const incompleteClasses = [];
    for (const cls of relevantClasses) {
      const totalInClass = (studentsByClass.get(cls.class_id) || []).length;
      const periodSet = expectedPeriodsByClass.get(cls.class_id);
      const expectedPeriods = (periodSet && periodSet.size > 0)
        ? Array.from(periodSet).sort((a, b) => a - b)
        : (classesWithAnySchedule.has(cls.class_id) ? [] : [1]);
      const classRecMap = recordedByClassPeriod.get(cls.class_id) || new Map();

      const missingPeriods = [];
      for (const pNum of expectedPeriods) {
        const recSet = classRecMap.get(pNum) || new Set();
        if (recSet.size < totalInClass) {
          missingPeriods.push(pNum);
        }
      }

      if (missingPeriods.length > 0) {
        incompleteClasses.push({
          class_id: cls.class_id,
          class_name: cls.class_name || cls.class_id,
          missing_periods: missingPeriods,
          total_periods: expectedPeriods.length,
          total: totalInClass
        });
      }
    }

    const schoolEndMin = parseMinutesFromHHMM(rules.school_end_time) ?? 780;
    const isPastSchoolEnd = wib.minutes >= schoolEndMin;

    // 2. Pengingat Jam Pulang — Presensi Kelas Belum Lengkap + Auto-Resolve
    if (!isHoliday && rules.enable_class_incomplete && relevantClasses.length > 0) {
      if (incompleteClasses.length > 0) {
        const namesPreview = incompleteClasses.slice(0, 3).map((c) => {
          if (c.total_periods > 1) {
            const pList = c.missing_periods.slice(0, 5).join(', ') + (c.missing_periods.length > 5 ? '...' : '');
            return `${c.class_name} (kurang Jam ${pList})`;
          }
          return c.class_name;
        }).join(', ');
        const extraTxt = incompleteClasses.length > 3 ? ` +${incompleteClasses.length - 3} kelas lainnya` : '';
        feed.push({
          id: `class-incomplete-${targetDate}`,
          category: 'presensi',
          priority: isPastSchoolEnd ? 'urgent' : 'warning',
          title: isPastSchoolEnd
            ? `Pengingat Jam Pulang: ${incompleteClasses.length} Kelas Belum Lengkap Presensi`
            : `${incompleteClasses.length} Kelas Belum Lengkap Presensi Hari Ini`,
          message: `${namesPreview}${extraTxt} belum lengkap presensi siswa tanggal ${targetDate}. Harap segera dilengkapi.`,
          timestamp: `${isPastSchoolEnd ? `Batas ${rules.school_end_time} WIB` : `${wib.timeWib} WIB`} • Otomatis`,
          created_at: new Date().toISOString(),
          resolved: false,
          action_label: `Lengkapi ${incompleteClasses[0].class_name} \u2192`,
          action_menu: 'menu-attendance',
          action_payload: {
            class_id: incompleteClasses[0].class_id,
            period: incompleteClasses[0].missing_periods[0]
          },
          snoozable: true,
          meta: { incomplete_classes: incompleteClasses }
        });
      } else {
        feed.push({
          id: `class-incomplete-${targetDate}`,
          category: 'presensi',
          priority: 'success',
          title: 'Presensi Seluruh Kelas Hari Ini Lengkap \u2713',
          message: `Semua ${relevantClasses.length} kelas aktif telah terdata lengkap presensi siswanya pada ${targetDate}.`,
          timestamp: `${wib.timeWib} WIB • Selesai Otomatis`,
          created_at: new Date().toISOString(),
          resolved: true,
          action_label: 'Lihat Rekap Presensi \u2192',
          action_menu: 'menu-journal',
          snoozable: false
        });
      }
    }

    // 3. Pengingat Guru Lupa / Belum Presensi (Per Slot Mengajar bila tersedia) + Auto-Resolve
    const recordedTeacherIds = new Set(todayTeacherAttRows.map((r) => r.teacher_id).filter(Boolean));
    const recordedTeacherSlots = new Set(
      todayTeacherAttRows.map((r) => `${r.teacher_id}|${r.class_id}|${Number(r.period)}`)
    );
    const kbmTeacherSlots = dayScheduleSlots.filter(
      (s) => s.teacher_id && (!s.subject_category || s.subject_category === 'KBM')
    );
    const scheduledTeacherIds = new Set(kbmTeacherSlots.map((s) => s.teacher_id));
    const expectedTeachers = scheduledTeacherIds.size > 0
      ? allTeachers.filter((t) => scheduledTeacherIds.has(t.teacher_id))
      : allTeachers;
    const isTeacherMissingToday = (teacherId) => {
      const tSlots = kbmTeacherSlots.filter((s) => s.teacher_id === teacherId);
      if (tSlots.length === 0) return !recordedTeacherIds.has(teacherId);
      return tSlots.some((s) => !recordedTeacherSlots.has(`${teacherId}|${s.class_id}|${Number(s.period_number)}`));
    };
    const teacherRemindMin = parseMinutesFromHHMM(rules.teacher_remind_time) ?? 750;
    const isPastTeacherRemind = wib.minutes >= teacherRemindMin;

    if (!isHoliday && rules.enable_teacher_forgot) {
      if (isAdmin && expectedTeachers.length > 0) {
        const missingTeachers = expectedTeachers.filter((t) => isTeacherMissingToday(t.teacher_id));
        if (missingTeachers.length > 0) {
          const previewNames = missingTeachers.slice(0, 3).map((t) => t.name).join(', ');
          const extra = missingTeachers.length > 3 ? ` +${missingTeachers.length - 3} guru lainnya` : '';
          feed.push({
            id: `teacher-forgot-${targetDate}`,
            category: 'presensi',
            priority: isPastTeacherRemind ? 'urgent' : 'warning',
            title: `${missingTeachers.length} Guru Belum Lengkap Presensi Hari Ini`,
            message: `${previewNames}${extra} belum lengkap presensi mengajar pada ${targetDate}.`,
            timestamp: `${wib.timeWib} WIB • Pengingat Guru`,
            created_at: new Date().toISOString(),
            resolved: false,
            action_label: 'Cek Presensi Guru \u2192',
            action_menu: 'menu-teacher-attendance',
            snoozable: true,
            meta: { missing_teacher_count: missingTeachers.length }
          });
        } else {
          feed.push({
            id: `teacher-forgot-${targetDate}`,
            category: 'presensi',
            priority: 'success',
            title: 'Presensi Guru Hari Ini 100% Lengkap \u2713',
            message: `Seluruh ${expectedTeachers.length} guru bertugas pada ${targetDate} telah tercatat presensinya.`,
            timestamp: `${wib.timeWib} WIB • Selesai Otomatis`,
            created_at: new Date().toISOString(),
            resolved: true,
            action_label: 'Buka Presensi Guru \u2192',
            action_menu: 'menu-teacher-attendance',
            snoozable: false
          });
        }
      } else if (!isAdmin && viewerTeacherId) {
        const selfExpected = expectedTeachers.some((t) => t.teacher_id === viewerTeacherId);
        if (selfExpected) {
          if (isTeacherMissingToday(viewerTeacherId)) {
            feed.push({
              id: `teacher-self-forgot-${viewerTeacherId}-${targetDate}`,
              category: 'presensi',
              priority: isPastTeacherRemind ? 'urgent' : 'warning',
              title: 'Pengingat: Anda Belum Presensi Hari Ini',
              message: `Sistem belum mencatat presensi mengajar Anda untuk tanggal ${targetDate}. Segera lakukan presensi agar rekap harian lengkap.`,
              timestamp: `${wib.timeWib} WIB • Pengingat Pribadi`,
              created_at: new Date().toISOString(),
              resolved: false,
              action_label: 'Presensi Sekarang \u2192',
              action_menu: 'menu-teacher-attendance',
              snoozable: true
            });
          } else {
            feed.push({
              id: `teacher-self-forgot-${viewerTeacherId}-${targetDate}`,
              category: 'presensi',
              priority: 'success',
              title: 'Presensi Mengajar Anda Sudah Tercatat \u2713',
              message: `Terima kasih, presensi mengajar Anda hari ini (${targetDate}) telah masuk ke sistem SIMATA.`,
              timestamp: `${wib.timeWib} WIB • Selesai Otomatis`,
              created_at: new Date().toISOString(),
              resolved: true,
              action_label: 'Lihat Presensi \u2192',
              action_menu: 'menu-teacher-attendance',
              snoozable: false
            });
          }
        }
      }
    }

    // 4. Pengingat Jam Mengajar Berikutnya (Upcoming / Ongoing Lesson)
    if (!isHoliday && rules.enable_upcoming_teaching && dayScheduleSlots.length > 0 && schedulePeriods.length > 0) {
      const periodTimeMap = new Map(
        schedulePeriods.filter((p) => !p.is_break).map((p) => [Number(p.period_number), p])
      );
      const viewerSlots = !isAdmin && viewerTeacherId
        ? dayScheduleSlots.filter((s) => s.teacher_id === viewerTeacherId)
        : dayScheduleSlots;

      for (const slot of viewerSlots) {
        const pMeta = periodTimeMap.get(Number(slot.period_number));
        if (!pMeta) continue;
        const pStart = parseMinutesFromHHMM(pMeta.start_time);
        const pEnd = parseMinutesFromHHMM(pMeta.end_time);
        if (pStart === null || pEnd === null) continue;
        const diff = pStart - wib.minutes;
        const isUpcoming = diff >= 0 && diff <= rules.upcoming_class_lead_minutes;
        const isOngoingUnmarked = wib.minutes >= pStart && wib.minutes < pEnd &&
          !todayTeacherAttRows.some((ta) => ta.class_id === slot.class_id && Number(ta.period) === Number(slot.period_number));

        if ((isUpcoming || isOngoingUnmarked) && (!isAdmin || viewerSlots.length <= 2)) {
          feed.push({
            id: `upcoming-slot-${slot.class_id}-p${slot.period_number}-${targetDate}`,
            category: 'jadwal',
            priority: isOngoingUnmarked ? 'warning' : 'info',
            title: isUpcoming
              ? `${diff} Menit Lagi: Jam ke-${slot.period_number} (${slot.class_name || slot.class_id})`
              : `Jam ke-${slot.period_number} Sedang Berlangsung (${slot.class_name || slot.class_id})`,
            message: `Mapel ${slot.subject_name || slot.subject_code || '-'} (${pMeta.start_time}\u2013${pMeta.end_time} WIB)${slot.teacher_name ? ` • ${slot.teacher_name}` : ''}.`,
            timestamp: `${pMeta.start_time} WIB • Jadwal Mengajar`,
            created_at: new Date().toISOString(),
            resolved: false,
            action_label: 'Buka Presensi Kelas \u2192',
            action_menu: 'menu-attendance',
            action_payload: { class_id: slot.class_id },
            snoozable: true
          });
          break; // show highest priority upcoming/active lesson card cleanly
        }
      }
    }

    // 5. Peringatan Konflik Jadwal & Pergantian Jam (from scheduler + events log)
    if (rules.enable_schedule_conflict && scheduleConflictCount > 0) {
      feed.push({
        id: `schedule-conflict-${targetDate}`,
        category: 'jadwal',
        priority: 'urgent',
        title: `Peringatan Konflik Jadwal (${scheduleConflictCount} Bentrok Terdeteksi)`,
        message: 'Terdapat jadwal guru pada hari dan jam yang sama di lebih dari satu kelas. Mohon periksa tabel Jadwal Pelajaran.',
        timestamp: 'Deteksi Jadwal • Otomatis',
        created_at: new Date().toISOString(),
        resolved: false,
        action_label: 'Periksa Jadwal \u2192',
        action_menu: 'menu-schedules',
        snoozable: false
      });
    }

    // 6. Peringatan Dini Siswa Alfa Beruntun (Early Warning Siswa)
    if (rules.enable_early_warning_alpha && alphaStudentAttRows.length > 0) {
      const alphaDatesByStudent = new Map();
      const studentInfoMap = new Map();
      for (const row of alphaStudentAttRows) {
        if (!row.student_id) continue;
        if (!alphaDatesByStudent.has(row.student_id)) alphaDatesByStudent.set(row.student_id, new Set());
        alphaDatesByStudent.get(row.student_id).add(row.attendance_date);
        studentInfoMap.set(row.student_id, {
          name: row.student_name || row.student_id,
          class_name: row.class_name || row.class_id || '-'
        });
      }
      const flaggedStudents = [];
      for (const [sid, dateSet] of alphaDatesByStudent.entries()) {
        if (dateSet.size >= rules.consecutive_alpha_threshold) {
          const info = studentInfoMap.get(sid);
          flaggedStudents.push({ student_id: sid, name: info.name, class_name: info.class_name, count: dateSet.size });
        }
      }
      if (flaggedStudents.length > 0) {
        const preview = flaggedStudents.slice(0, 3).map((s) => `${s.name} (${s.class_name}: ${s.count}x)`).join(', ');
        feed.push({
          id: `early-warning-alpha-${targetDate}`,
          category: 'peringatan',
          priority: 'warning',
          title: `Peringatan Dini: ${flaggedStudents.length} Siswa Tercatat Alpa \u2265 ${rules.consecutive_alpha_threshold} Hari`,
          message: `Perlu perhatian/tindak lanjut: ${preview}.`,
          timestamp: 'Early Warning Siswa • Otomatis',
          created_at: new Date().toISOString(),
          resolved: false,
          action_label: 'Cek Data Siswa \u2192',
          action_menu: 'menu-students',
          snoozable: true,
          meta: { flagged_students: flaggedStudents }
        });
      }
    }

    // 7. Responder Insights & Logged Events (Schedule changes, conflicts resolved, Responder activity)
    if (rules.enable_responder && evidenceRows.length > 0 && isAdmin) {
      feed.push({
        id: `responder-evidence-summary-${targetDate}`,
        category: 'responder',
        priority: 'info',
        title: `Aktivitas Bukti Responder (${evidenceRows.length} Arsip Foto)`,
        message: 'Terhubung dengan retensi bukti foto Responder Guru. Pastikan laporan sesi scan lapangan sudah ditinjau.',
        timestamp: 'Responder & Bukti • Otomatis',
        created_at: new Date().toISOString(),
        resolved: false,
        action_label: 'Buka Responder \u2192',
        action_menu: 'menu-responder',
        snoozable: false
      });
    }

    for (const evt of events) {
      if (evt.category === 'responder' && !rules.enable_responder) continue;
      if (evt.category === 'jadwal' && !rules.enable_schedule_conflict) continue;
      if (evt.target_role && evt.target_role !== 'ALL' && evt.target_role !== (user?.role || 'GURU')) continue;
      if (evt.target_teacher_id && evt.target_teacher_id !== viewerTeacherId) continue;
      feed.push({
        id: evt.id,
        category: evt.category,
        priority: evt.priority || 'info',
        title: evt.title,
        message: evt.message,
        timestamp: `${String(evt.created_at || '').slice(11, 16) || wib.timeWib} WIB • Log Sistem`,
        created_at: evt.created_at,
        resolved: false,
        action_label: evt.action_label || (evt.action_menu ? 'Buka Menu \u2192' : null),
        action_menu: evt.action_menu || null,
        action_payload: evt.action_payload || null,
        snoozable: true
      });
    }

    // 8. Kelengkapan Data KTS & Keuangan / Nilai
    if (rules.enable_academic_kts && allStudents.length > 0) {
      const ktsIncompleteCount = allStudents.filter(
        (s) => !s.has_photo || !String(s.birth_place || '').trim() || !String(s.address || '').trim() || !String(s.dormitory || '').trim()
      ).length;
      if (ktsIncompleteCount > 0) {
        feed.push({
          id: `audit-kts-${targetDate}`,
          category: 'info',
          priority: 'info',
          title: `Audit KTS: ${ktsIncompleteCount} Siswa Belum Lengkap Data / Pasfoto`,
          message: 'Lengkapi pasfoto 3\u00d74, TTL, alamat, atau asrama agar kartu identitas seluruh siswa siap dicetak.',
          timestamp: 'Audit Data KTS • Harian',
          created_at: new Date().toISOString(),
          resolved: false,
          action_label: 'Buka Studio KTS \u2192',
          action_menu: 'menu-kts',
          snoozable: false
        });
      }
    }

    if (rules.enable_finance_grades && isAdmin && pendingInvoicesRows.length > 0) {
      const unpaid = pendingInvoicesRows.filter((inv) => ['UNPAID', 'PARTIAL'].includes(String(inv.status || '').toUpperCase()));
      if (unpaid.length > 0) {
        feed.push({
          id: `finance-pending-${targetDate}`,
          category: 'info',
          priority: 'info',
          title: `Pusat Keuangan: ${unpaid.length} Tagihan Siswa Belum Lunas`,
          message: 'Terdapat tagihan berstatus belum lunas / cicilan di menu Pusat Keuangan.',
          timestamp: 'Info Keuangan • Harian',
          created_at: new Date().toISOString(),
          resolved: false,
          action_label: 'Buka Pusat Keuangan \u2192',
          action_menu: 'menu-finance',
          snoozable: false
        });
      }
    }

    // 9. Daily Closing Digest (Ringkasan Penutup Hari)
    const digestMin = parseMinutesFromHHMM(rules.daily_digest_time) ?? 870;
    if (!isHoliday && rules.enable_daily_digest && isAdmin && wib.minutes >= digestMin) {
      const hadirCount = todayStudentAttRows.filter((r) => String(r.status || '').toLowerCase() === 'hadir').length;
      const totalAtt = todayStudentAttRows.length;
      const pct = totalAtt > 0 ? Math.round((hadirCount / totalAtt) * 100) : 0;
      const completedClassesCount = relevantClasses.length - incompleteClasses.length;
      feed.push({
        id: `daily-digest-${targetDate}`,
        category: 'info',
        priority: 'info',
        title: `Ringkasan Penutup Hari (${targetDate})`,
        message: `Kelas presensi lengkap: ${completedClassesCount}/${relevantClasses.length} • Kehadiran siswa tercatat: ${pct}% • Guru presensi: ${recordedTeacherIds.size}/${expectedTeachers.length || allTeachers.length} • Konflik jadwal: ${scheduleConflictCount}.`,
        timestamp: `Penutup Hari (${rules.daily_digest_time} WIB)`,
        created_at: new Date().toISOString(),
        resolved: false,
        action_label: 'Lihat Laporan Harian \u2192',
        action_menu: 'menu-reports',
        snoozable: false
      });
    }

    // 10. Manual Admin Broadcasts
    for (const bc of broadcasts) {
      if (bc.target_role && bc.target_role !== 'ALL' && bc.target_role !== (user?.role || 'GURU')) continue;
      if (bc.target_teacher_id && bc.target_teacher_id !== viewerTeacherId) continue;
      feed.push({
        id: bc.id,
        category: bc.category || 'info',
        priority: bc.priority || 'info',
        title: bc.title,
        message: bc.message,
        timestamp: `${bc.author_name || 'Admin'} • Pengumuman`,
        created_at: bc.created_at,
        resolved: false,
        action_label: bc.action_label || (bc.action_menu ? 'Buka Menu \u2192' : null),
        action_menu: bc.action_menu || null,
        snoozable: false,
        is_broadcast: true
      });
    }

    // Sort: unresolved urgent -> warning -> info -> resolved success
    const rankMap = { urgent: 0, warning: 1, info: 2, success: 3 };
    feed.sort((a, b) => {
      if (Boolean(a.resolved) !== Boolean(b.resolved)) return a.resolved ? 1 : -1;
      const ra = rankMap[a.priority] ?? 2;
      const rb = rankMap[b.priority] ?? 2;
      if (ra !== rb) return ra - rb;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    const activeCount = feed.filter((n) => !n.resolved).length;
    const urgentCount = feed.filter((n) => !n.resolved && n.priority === 'urgent').length;

    return {
      date: targetDate,
      server_time_wib: wib.timeWib,
      day_label: wib.dayLabel,
      is_holiday: isHoliday,
      holiday_title: holidayTitle,
      rules,
      broadcasts,
      summary: {
        total: feed.length,
        active: activeCount,
        urgent: urgentCount,
        resolved: feed.length - activeCount
      },
      feed
    };
  }
}

module.exports = new NotificationsService();
