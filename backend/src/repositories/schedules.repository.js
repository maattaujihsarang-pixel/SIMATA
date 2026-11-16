const db = require('../config/database');

class SchedulesRepository {
  async getAcademicYears() {
    const res = await db.query(
      `SELECT academic_year_id, name, is_active, start_date, end_date
       FROM academic_years
       ORDER BY is_active DESC, academic_year_id DESC`
    );
    return res.rows;
  }

  async getPeriods(academicYearId, semester) {
    const res = await db.query(
      `SELECT period_config_id, academic_year_id, semester, sort_order,
              period_number, label, start_time, end_time, is_break
       FROM schedule_periods
       WHERE academic_year_id = $1 AND semester = $2
       ORDER BY sort_order ASC`,
      [academicYearId, semester]
    );
    return res.rows;
  }

  async getSubjects() {
    const res = await db.query(
      `SELECT subject_id, code, name, category, color_tone, is_active
       FROM subjects
       WHERE is_active = TRUE
       ORDER BY CASE WHEN category = 'KBM' THEN 0 ELSE 1 END, name ASC`
    );
    return res.rows;
  }

  async getSubjectById(subjectId) {
    const res = await db.query(
      `SELECT subject_id, code, name, category, color_tone, is_active
       FROM subjects
       WHERE subject_id = $1`,
      [subjectId]
    );
    return res.rows[0] || null;
  }

  async getClassesForYear(academicYearId) {
    let res = await db.query(
      `SELECT c.class_id, c.class_name, c.level, c.academic_year_id,
              c.homeroom_teacher_id, c.status, t.name AS homeroom_teacher_name
       FROM classes c
       LEFT JOIN teachers t ON t.teacher_id = c.homeroom_teacher_id
       WHERE c.status = 'Active' AND c.academic_year_id = $1
       ORDER BY c.level ASC, c.class_name ASC`,
      [academicYearId]
    );
    if (res.rows.length === 0) {
      res = await db.query(
        `SELECT c.class_id, c.class_name, c.level, c.academic_year_id,
                c.homeroom_teacher_id, c.status, t.name AS homeroom_teacher_name
         FROM classes c
         LEFT JOIN teachers t ON t.teacher_id = c.homeroom_teacher_id
         WHERE c.status = 'Active'
         ORDER BY c.level ASC, c.class_name ASC`
      );
    }
    return res.rows;
  }

  async getTeachersWithCodes(academicYearId, semester) {
    const res = await db.query(
      `SELECT t.teacher_id, t.name, t.position, t.subject,
              COALESCE(t.teaching_hours, 0)::int AS target_weekly_hours,
              tsc.short_code,
              COALESCE(agg.scheduled_weekly_jp, 0)::int AS scheduled_weekly_jp,
              COALESCE(agg.scheduled_total_slots, 0)::int AS scheduled_total_slots,
              COALESCE(agg.scheduled_classes_count, 0)::int AS scheduled_classes_count,
              agg.scheduled_subjects
       FROM teachers t
       LEFT JOIN teacher_schedule_codes tsc
         ON tsc.teacher_id = t.teacher_id
        AND tsc.academic_year_id = $1
        AND tsc.semester = $2
       LEFT JOIN (
         SELECT cs.teacher_id,
                COUNT(*) FILTER (WHERE sub.category = 'KBM')::int AS scheduled_weekly_jp,
                COUNT(*)::int AS scheduled_total_slots,
                COUNT(DISTINCT cs.class_id)::int AS scheduled_classes_count,
                STRING_AGG(DISTINCT sub.name, ', ' ORDER BY sub.name) AS scheduled_subjects
         FROM class_schedules cs
         JOIN subjects sub ON sub.subject_id = cs.subject_id
         WHERE cs.academic_year_id = $1
           AND cs.semester = $2
           AND cs.teacher_id IS NOT NULL
         GROUP BY cs.teacher_id
       ) agg ON agg.teacher_id = t.teacher_id
       WHERE t.status = 'Active'
       ORDER BY COALESCE(tsc.short_code, 'ZZZ') ASC, t.name ASC`,
      [academicYearId, semester]
    );
    return res.rows;
  }

  async getSlots(academicYearId, semester) {
    const res = await db.query(
      `SELECT cs.schedule_id,
              cs.academic_year_id,
              cs.semester,
              cs.day_of_week,
              cs.period_number,
              cs.class_id,
              c.class_name,
              c.level AS class_level,
              cs.subject_id,
              sub.code AS subject_code,
              sub.name AS subject_name,
              sub.category AS subject_category,
              sub.color_tone,
              cs.teacher_id,
              t.name AS teacher_name,
              tsc.short_code AS teacher_short_code,
              cs.note,
              cs.updated_at
       FROM class_schedules cs
       JOIN classes c ON c.class_id = cs.class_id
       JOIN subjects sub ON sub.subject_id = cs.subject_id
       LEFT JOIN teachers t ON t.teacher_id = cs.teacher_id
       LEFT JOIN teacher_schedule_codes tsc
         ON tsc.teacher_id = cs.teacher_id
        AND tsc.academic_year_id = cs.academic_year_id
        AND tsc.semester = cs.semester
       WHERE cs.academic_year_id = $1
         AND cs.semester = $2
       ORDER BY cs.day_of_week ASC, cs.period_number ASC, c.level ASC, c.class_name ASC`,
      [academicYearId, semester]
    );
    return res.rows;
  }

  async getSlotsForDay(academicYearId, semester, dayOfWeek, teacherId = null) {
    const params = [academicYearId, semester, dayOfWeek];
    let teacherClause = '';
    if (teacherId) {
      params.push(teacherId);
      teacherClause = ` AND cs.teacher_id = $4`;
    }
    const res = await db.query(
      `SELECT cs.schedule_id,
              cs.academic_year_id,
              cs.semester,
              cs.day_of_week,
              cs.period_number,
              cs.class_id,
              c.class_name,
              c.level AS class_level,
              cs.subject_id,
              sub.code AS subject_code,
              sub.name AS subject_name,
              sub.category AS subject_category,
              sub.color_tone,
              cs.teacher_id,
              t.name AS teacher_name,
              tsc.short_code AS teacher_short_code
       FROM class_schedules cs
       JOIN classes c ON c.class_id = cs.class_id
       JOIN subjects sub ON sub.subject_id = cs.subject_id
       LEFT JOIN teachers t ON t.teacher_id = cs.teacher_id
       LEFT JOIN teacher_schedule_codes tsc
         ON tsc.teacher_id = cs.teacher_id
        AND tsc.academic_year_id = cs.academic_year_id
        AND tsc.semester = cs.semester
       WHERE cs.academic_year_id = $1
         AND cs.semester = $2
         AND cs.day_of_week = $3
         ${teacherClause}
       ORDER BY cs.period_number ASC, c.level ASC, c.class_name ASC`,
      params
    );
    return res.rows;
  }

  async detectBestSemesterForYear(academicYearId, fallbackSemester) {
    const res = await db.query(
      `SELECT semester, COUNT(*)::int AS cnt
       FROM class_schedules
       WHERE academic_year_id = $1
       GROUP BY semester
       ORDER BY cnt DESC`,
      [academicYearId]
    );
    if (res.rows.length === 0) return fallbackSemester;
    const hasFallback = res.rows.find((r) => r.semester === fallbackSemester && Number(r.cnt) > 0);
    if (hasFallback) return fallbackSemester;
    return res.rows[0].semester || fallbackSemester;
  }

  async findTeacherConflict(client, { academicYearId, semester, dayOfWeek, periodNumber, teacherId, excludeClassId }) {
    if (!teacherId) return null;
    const res = await client.query(
      `SELECT cs.schedule_id, cs.class_id, c.class_name, sub.name AS subject_name,
              sub.code AS subject_code, t.name AS teacher_name
       FROM class_schedules cs
       JOIN classes c ON c.class_id = cs.class_id
       JOIN subjects sub ON sub.subject_id = cs.subject_id
       JOIN teachers t ON t.teacher_id = cs.teacher_id
       WHERE cs.academic_year_id = $1
         AND cs.semester = $2
         AND cs.day_of_week = $3
         AND cs.period_number = $4
         AND cs.teacher_id = $5
         AND cs.class_id <> $6
       LIMIT 1`,
      [academicYearId, semester, dayOfWeek, periodNumber, teacherId, excludeClassId]
    );
    return res.rows[0] || null;
  }
}

module.exports = new SchedulesRepository();
