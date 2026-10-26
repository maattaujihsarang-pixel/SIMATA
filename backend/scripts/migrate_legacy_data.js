const fs = require('fs');
const path = require('path');
const { query, withTransaction, closePool } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password.util');
const logger = require('../src/utils/logger.util');

const SEED_DATA_PATH = path.join(__dirname, '../data/production_seed_data.json');

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, idx) => {
    obj[h] = row[idx];
  });
  return obj;
}

function parseNullableDate(val) {
  if (!val || typeof val !== 'string' || !val.trim()) return null;
  const d = new Date(val.trim());
  return isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(s) {
  if (!s || typeof s !== 'string') return 'Active';
  const trimmed = s.trim();
  if (trimmed === 'Aktif' || trimmed.toLowerCase() === 'active') return 'Active';
  if (trimmed === 'Nonaktif' || trimmed.toLowerCase() === 'inactive') return 'Inactive';
  return 'Active';
}

async function migrateLegacyData(options = {}) {
  logger.info('Starting legacy data migration...');

  if (!fs.existsSync(SEED_DATA_PATH)) {
    throw new Error(`Production seed data not found at ${SEED_DATA_PATH}`);
  }

  const rawContent = fs.readFileSync(SEED_DATA_PATH, 'utf8');
  const rawData = JSON.parse(rawContent);

  const stats = {
    academic_years: 0,
    teachers: 0,
    users: 0,
    classes: 0,
    students: 0,
    excluded_users: 0
  };

  await withTransaction(async (client) => {
    // 1. Academic Year: 2026/2027
    logger.info('Migrating Academic Year: 2026/2027...');
    await client.query(`
      INSERT INTO academic_years (academic_year_id, name, is_active, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (academic_year_id) DO UPDATE 
      SET name = EXCLUDED.name, is_active = EXCLUDED.is_active;
    `, ['2026/2027', 'Tahun Ajaran 2026/2027', true, '2026-07-15', '2027-06-30']);
    stats.academic_years = 1;

    // 2. Teachers: 19 records
    logger.info('Migrating Teachers (19 records)...');
    const teacherRows = rawData.Teachers.rows;
    for (const row of teacherRows) {
      const t = rowToObj(rawData.Teachers.headers, row);
      await client.query(`
        INSERT INTO teachers (
          teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
          qr_code_id, birth_place, birth_date, village, district, regency,
          phone, email, education, major, graduation_year, teaching_hours
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (teacher_id) DO UPDATE SET
          name = EXCLUDED.name,
          position = EXCLUDED.position,
          status = EXCLUDED.status,
          subject = EXCLUDED.subject;
      `, [
        t.teacherId,
        t.name,
        t.position || 'Guru Mapel',
        normalizeStatus(t.status),
        t.subject || 'Umum',
        (t.gender && (t.gender === 'L' || t.gender === 'P')) ? t.gender : null,
        t.nip || null,
        t.nuptk || null,
        t.nik || null,
        t.qrCodeId || null,
        t.birthPlace || null,
        parseNullableDate(t.birthDate),
        t.village || null,
        t.district || null,
        t.regency || null,
        t.phone || null,
        t.email || null,
        t.education || null,
        t.major || null,
        t.graduationYear || null,
        t.teachingHours ? parseInt(t.teachingHours, 10) : null
      ]);
      stats.teachers++;
    }

    // 3. Classes: 3 records
    logger.info('Migrating Classes (3 records)...');
    const classRows = rawData.Classes.rows;
    for (const row of classRows) {
      const c = rowToObj(rawData.Classes.headers, row);
      await client.query(`
        INSERT INTO classes (class_id, class_name, level, academic_year_id, homeroom_teacher_id, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (class_id) DO UPDATE SET
          class_name = EXCLUDED.class_name,
          level = EXCLUDED.level,
          homeroom_teacher_id = EXCLUDED.homeroom_teacher_id,
          status = EXCLUDED.status;
      `, [
        c.classId,
        c.className,
        parseInt(c.level, 10),
        c.academicYear || '2026/2027',
        (c.homeroomTeacherId && c.homeroomTeacherId.trim()) ? c.homeroomTeacherId.trim() : null,
        normalizeStatus(c.status)
      ]);
      stats.classes++;
    }

    // 4. Students: 47 records
    logger.info('Migrating Students (47 records)...');
    const studentRows = rawData.Students.rows;
    for (const row of studentRows) {
      const s = rowToObj(rawData.Students.headers, row);
      await client.query(`
        INSERT INTO students (student_id, class_id, name, gender, nis, nisn, birth_date, qr_code_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (student_id) DO UPDATE SET
          class_id = EXCLUDED.class_id,
          name = EXCLUDED.name,
          qr_code_id = EXCLUDED.qr_code_id,
          status = EXCLUDED.status;
      `, [
        s.studentId,
        s.classId,
        s.name,
        (s.gender && (s.gender === 'L' || s.gender === 'P')) ? s.gender : null,
        s.nis || null,
        s.nisn || null,
        parseNullableDate(s.birthDate),
        s.qrCodeId || null,
        normalizeStatus(s.status)
      ]);
      stats.students++;
    }

    // 5. Users: 2 production records (Exclude 'Guruattaujih')
    // Rules:
    // - Use legacy password verified from production_raw_data.json
    // - Hash with bcrypt
    // - Set must_change_password = true
    // - Do not replace Admin1 with INITIAL_ADMIN_PASSWORD automatically unless --bootstrap-admin explicitly passed
    logger.info('Migrating Users (2 production records, 1 trial excluded)...');
    const userRows = rawData.Users.rows;
    for (const row of userRows) {
      const u = rowToObj(rawData.Users.headers, row);

      // EXCLUSION: Guruattaujih
      if (u.Username && u.Username.toLowerCase() === 'guruattaujih') {
        logger.info(`Excluding trial account: ${u.Username}`);
        stats.excluded_users++;
        continue;
      }

      // Check if user should use legacy password
      let passwordToHash = u.Password;
      if (options.bootstrapAdmin && u.Username === 'Admin1' && process.env.INITIAL_ADMIN_PASSWORD) {
        logger.info('Explicit bootstrap admin option active: using INITIAL_ADMIN_PASSWORD for Admin1');
        passwordToHash = process.env.INITIAL_ADMIN_PASSWORD;
      }

      const passwordHash = await hashPassword(passwordToHash);

      // Link Guru_001 to teacher_id
      let teacherId = null;
      if (u.Username === 'Guru_001') {
        teacherId = 'TCH-0001';
      }

      await client.query(`
        INSERT INTO users (username, password_hash, full_name, role, status, teacher_id, must_change_password)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (username) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          teacher_id = EXCLUDED.teacher_id,
          must_change_password = EXCLUDED.must_change_password;
      `, [
        u.Username,
        passwordHash,
        u.Nama,
        u.Role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'GURU',
        normalizeStatus(u.Status),
        teacherId,
        true // Enforce must_change_password = true for migrated legacy credentials
      ]);
      stats.users++;
    }
  });

  logger.info('Legacy data migration completed successfully:', stats);
  return stats;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    bootstrapAdmin: args.includes('--bootstrap-admin')
  };

  migrateLegacyData(options)
    .then((stats) => {
      console.log('Migration finished successfully.', stats);
      closePool().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Migration failed / PostgreSQL runtime pending:', err.message);
      closePool().then(() => process.exit(1));
    });
}

module.exports = migrateLegacyData;
