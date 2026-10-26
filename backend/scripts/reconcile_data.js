const { query, closePool } = require('../src/config/database');
const logger = require('../src/utils/logger.util');

async function reconcileDatabase() {
  logger.info('Running database reconciliation checks...');

  const results = {
    timestamp: new Date().toISOString(),
    status: 'UNKNOWN',
    counts: {},
    integrity: {},
    issues: []
  };

  try {
    // 1. Check counts
    const usersRes = await query(`SELECT COUNT(*)::int as count FROM users`);
    const teachersRes = await query(`SELECT COUNT(*)::int as count FROM teachers`);
    const studentsRes = await query(`SELECT COUNT(*)::int as count FROM students`);
    const classesRes = await query(`SELECT COUNT(*)::int as count FROM classes`);
    const yearRes = await query(`SELECT COUNT(*)::int as count FROM academic_years`);

    results.counts = {
      users: usersRes.rows[0].count,
      teachers: teachersRes.rows[0].count,
      students: studentsRes.rows[0].count,
      classes: classesRes.rows[0].count,
      academic_years: yearRes.rows[0].count
    };

    // 2. Validate expected numbers
    const expected = {
      users: 2,
      teachers: 19,
      students: 47,
      classes: 3,
      academic_years: 1
    };

    for (const [key, expVal] of Object.entries(expected)) {
      if (results.counts[key] !== expVal) {
        results.issues.push(`Mismatch on '${key}': expected ${expVal}, found ${results.counts[key]}`);
      }
    }

    // 3. Integrity check: 0 orphan students
    const orphanStudentsRes = await query(`
      SELECT COUNT(*)::int as count 
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.class_id
      WHERE c.class_id IS NULL
    `);
    results.integrity.orphan_students = orphanStudentsRes.rows[0].count;
    if (results.integrity.orphan_students > 0) {
      results.issues.push(`Integrity Error: Found ${results.integrity.orphan_students} orphan students without valid class_id`);
    }

    // 4. Integrity check: Ensure Guruattaujih is NOT present
    const trialUserRes = await query(`
      SELECT COUNT(*)::int as count FROM users WHERE LOWER(username) = 'guruattaujih'
    `);
    results.integrity.trial_user_count = trialUserRes.rows[0].count;
    if (results.integrity.trial_user_count > 0) {
      results.issues.push(`Exclusion Violation: Trial account 'Guruattaujih' found in target users table`);
    }

    // 5. Integrity check: Bcrypt hash format ($2a$ or $2b$)
    const invalidHashRes = await query(`
      SELECT COUNT(*)::int as count FROM users WHERE password_hash NOT LIKE '$2%'
    `);
    results.integrity.invalid_password_hashes = invalidHashRes.rows[0].count;
    if (results.integrity.invalid_password_hashes > 0) {
      results.issues.push(`Security Violation: Found ${results.integrity.invalid_password_hashes} users with unhashed/invalid passwords`);
    }

    // 6. Integrity check: Clean transaction tables
    const studentAttCount = await query(`SELECT COUNT(*)::int as count FROM student_attendance`);
    const teacherAttCount = await query(`SELECT COUNT(*)::int as count FROM teacher_attendance`);
    results.counts.student_attendance = studentAttCount.rows[0].count;
    results.counts.teacher_attendance = teacherAttCount.rows[0].count;

    results.status = results.issues.length === 0 ? 'PASS' : 'FAIL';
    logger.info('Database reconciliation complete:', results);
    return results;
  } catch (error) {
    logger.error('Reconciliation failed / runtime error:', error.message);
    results.status = 'PENDING';
    results.error = error.message;
    return results;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  reconcileDatabase()
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.status === 'PASS' ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = reconcileDatabase;

