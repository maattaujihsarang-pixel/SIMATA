const db = require('../config/database');
const { getTodayISODate } = require('../utils/date.util');

class DashboardService {
  async getDashboardSummary(date = null) {
    const targetDate = date || getTodayISODate();

    // 1. Total active students
    const studentsRes = await db.query(
      `SELECT COUNT(*)::int as total FROM students WHERE status = 'Active'`
    );

    // 2. Total active teachers
    const teachersRes = await db.query(
      `SELECT COUNT(*)::int as total FROM teachers WHERE status = 'Active'`
    );

    // 3. Total active classes
    const classesRes = await db.query(
      `SELECT COUNT(*)::int as total FROM classes WHERE status = 'Active'`
    );

    // 4. Student attendance breakdown for targetDate
    const studentAttRes = await db.query(
      `SELECT status, COUNT(*)::int as count
       FROM student_attendance
       WHERE attendance_date = $1
       GROUP BY status`,
      [targetDate]
    );

    const studentStats = {
      hadir: 0,
      izin: 0,
      sakit: 0,
      alpa: 0,
      total_recorded: 0
    };

    for (const row of studentAttRes.rows) {
      const key = (row.status || '').toLowerCase();
      if (studentStats[key] !== undefined) {
        studentStats[key] = row.count;
      }
      studentStats.total_recorded += row.count;
    }

    // 5. Teacher attendance count for targetDate
    const teacherAttRes = await db.query(
      `SELECT COUNT(DISTINCT teacher_id)::int as active_teachers_present,
              COUNT(*)::int as total_periods_taught
       FROM teacher_attendance
       WHERE attendance_date = $1`,
      [targetDate]
    );

    // 6. Active academic year
    const yearRes = await db.query(
      `SELECT academic_year_id, name FROM academic_years WHERE is_active = TRUE LIMIT 1`
    );

    return {
      date: targetDate,
      academic_year: yearRes.rows[0] || { academic_year_id: '2026/2027', name: 'Tahun Ajaran 2026/2027' },
      counts: {
        students: studentsRes.rows[0]?.total || 0,
        teachers: teachersRes.rows[0]?.total || 0,
        classes: classesRes.rows[0]?.total || 0
      },
      student_attendance: studentStats,
      teacher_attendance: {
        teachers_present: teacherAttRes.rows[0]?.active_teachers_present || 0,
        periods_taught: teacherAttRes.rows[0]?.total_periods_taught || 0
      }
    };
  }
}

module.exports = new DashboardService();

