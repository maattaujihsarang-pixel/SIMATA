const db = require('../config/database');

function sanitizeDate(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s.split('T')[0];
}

function sanitizeInt(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function sanitizeGender(val) {
  if (val === undefined || val === null) return null;
  const g = String(val).trim().toUpperCase();
  if (g === 'L' || g.startsWith('LAKI')) return 'L';
  if (g === 'P' || g.startsWith('PEREMPUAN')) return 'P';
  return null;
}

function sanitizeString(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

class TeacherRepository {
  async findAll({ status = null } = {}) {
    let sql = `SELECT teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
                      qr_code_id, birth_place, birth_date, village, district, regency,
                      phone, email, education, major, graduation_year, teaching_hours,
                      created_at, updated_at
               FROM teachers`;
    const params = [];

    if (status) {
      sql += ` WHERE status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY name ASC`;
    const res = await db.query(sql, params);
    return res.rows;
  }

  async findById(teacherId) {
    const res = await db.query(
      `SELECT teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
              qr_code_id, birth_place, birth_date, village, district, regency,
              phone, email, education, major, graduation_year, teaching_hours,
              created_at, updated_at
       FROM teachers
       WHERE teacher_id = $1`,
      [teacherId]
    );
    return res.rows[0] || null;
  }

  async getNextSequence() {
    const res = await db.query(
      `SELECT teacher_id FROM teachers 
       WHERE teacher_id LIKE 'TCH-%' 
       ORDER BY teacher_id DESC LIMIT 1`
    );
    if (res.rows.length === 0) return 1;
    const match = res.rows[0].teacher_id.match(/TCH-(\d+)/);
    return match ? parseInt(match[1], 10) + 1 : 1;
  }

  async create(data) {
    const teacherId = sanitizeString(data.teacher_id || data.teacherId);
    const name = sanitizeString(data.name || data.full_name || data.fullName);
    const position = sanitizeString(data.position) || 'Guru Mapel';
    const status = sanitizeString(data.status) || 'Active';
    const subject = sanitizeString(data.subject || data.subject_specialty || data.subjectSpecialty);
    const gender = sanitizeGender(data.gender);
    const nip = sanitizeString(data.nip);
    const nuptk = sanitizeString(data.nuptk);
    const nik = sanitizeString(data.nik);
    const qrCodeId = sanitizeString(data.qr_code_id !== undefined ? data.qr_code_id : data.qrCodeId);
    const birthPlace = sanitizeString(data.birth_place !== undefined ? data.birth_place : data.birthPlace);
    const birthDate = sanitizeDate(data.birth_date !== undefined ? data.birth_date : data.birthDate);
    const village = sanitizeString(data.village);
    const district = sanitizeString(data.district);
    const regency = sanitizeString(data.regency);
    const phone = sanitizeString(data.phone);
    const email = sanitizeString(data.email);
    const education = sanitizeString(data.education);
    const major = sanitizeString(data.major);
    const graduationYear = sanitizeString(data.graduation_year !== undefined ? data.graduation_year : data.graduationYear);
    const teachingHours = sanitizeInt(data.teaching_hours !== undefined ? data.teaching_hours : data.teachingHours);

    const res = await db.query(
      `INSERT INTO teachers (
        teacher_id, name, position, status, subject, gender, nip, nuptk, nik,
        qr_code_id, birth_place, birth_date, village, district, regency,
        phone, email, education, major, graduation_year, teaching_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        teacherId, name, position, status, subject, gender, nip, nuptk, nik,
        qrCodeId, birthPlace, birthDate, village, district, regency,
        phone, email, education, major, graduationYear, teachingHours
      ]
    );
    return res.rows[0];
  }

  async update(teacherId, data) {
    const existing = await this.findById(teacherId);
    if (!existing) return null;

    const name = ('name' in data || 'full_name' in data || 'fullName' in data)
      ? (sanitizeString(data.name || data.full_name || data.fullName) || existing.name)
      : existing.name;

    const position = ('position' in data)
      ? (sanitizeString(data.position) || existing.position)
      : existing.position;

    const status = ('status' in data)
      ? (sanitizeString(data.status) || existing.status)
      : existing.status;

    const subject = ('subject' in data || 'subject_specialty' in data || 'subjectSpecialty' in data)
      ? (sanitizeString(data.subject || data.subject_specialty || data.subjectSpecialty) || existing.subject)
      : existing.subject;

    const gender = ('gender' in data)
      ? sanitizeGender(data.gender)
      : existing.gender;

    const nip = ('nip' in data)
      ? sanitizeString(data.nip)
      : existing.nip;

    const nuptk = ('nuptk' in data)
      ? sanitizeString(data.nuptk)
      : existing.nuptk;

    const nik = ('nik' in data)
      ? sanitizeString(data.nik)
      : existing.nik;

    const qrCodeId = ('qr_code_id' in data || 'qrCodeId' in data)
      ? sanitizeString(data.qr_code_id !== undefined ? data.qr_code_id : data.qrCodeId)
      : existing.qr_code_id;

    const birthPlace = ('birth_place' in data || 'birthPlace' in data)
      ? sanitizeString(data.birth_place !== undefined ? data.birth_place : data.birthPlace)
      : existing.birth_place;

    const birthDate = ('birth_date' in data || 'birthDate' in data)
      ? sanitizeDate(data.birth_date !== undefined ? data.birth_date : data.birthDate)
      : existing.birth_date;

    const village = ('village' in data)
      ? sanitizeString(data.village)
      : existing.village;

    const district = ('district' in data)
      ? sanitizeString(data.district)
      : existing.district;

    const regency = ('regency' in data)
      ? sanitizeString(data.regency)
      : existing.regency;

    const phone = ('phone' in data)
      ? sanitizeString(data.phone)
      : existing.phone;

    const email = ('email' in data)
      ? sanitizeString(data.email)
      : existing.email;

    const education = ('education' in data)
      ? sanitizeString(data.education)
      : existing.education;

    const major = ('major' in data)
      ? sanitizeString(data.major)
      : existing.major;

    const graduationYear = ('graduation_year' in data || 'graduationYear' in data)
      ? sanitizeString(data.graduation_year !== undefined ? data.graduation_year : data.graduationYear)
      : existing.graduation_year;

    const teachingHours = ('teaching_hours' in data || 'teachingHours' in data)
      ? sanitizeInt(data.teaching_hours !== undefined ? data.teaching_hours : data.teachingHours)
      : existing.teaching_hours;

    const res = await db.query(
      `UPDATE teachers SET
        name = COALESCE($2, name),
        position = COALESCE($3, position),
        status = COALESCE($4, status),
        subject = COALESCE($5, subject),
        gender = $6,
        nip = $7,
        nuptk = $8,
        nik = $9,
        qr_code_id = $10,
        birth_place = $11,
        birth_date = $12,
        village = $13,
        district = $14,
        regency = $15,
        phone = $16,
        email = $17,
        education = $18,
        major = $19,
        graduation_year = $20,
        teaching_hours = $21,
        updated_at = CURRENT_TIMESTAMP
      WHERE teacher_id = $1
      RETURNING *`,
      [
        teacherId, name, position, status, subject,
        gender, nip, nuptk, nik, qrCodeId,
        birthPlace, birthDate, village, district,
        regency, phone, email, education,
        major, graduationYear, teachingHours
      ]
    );
    return res.rows[0] || null;
  }

  async updateStatus(teacherId, status) {
    const res = await db.query(
      `UPDATE teachers 
       SET status = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE teacher_id = $1 
       RETURNING teacher_id, name, status, updated_at`,
      [teacherId, status]
    );
    return res.rows[0] || null;
  }

  async delete(teacherId) {
    const res = await db.query(
      `DELETE FROM teachers WHERE teacher_id = $1 RETURNING teacher_id`,
      [teacherId]
    );
    return res.rowCount > 0;
  }
}

module.exports = new TeacherRepository();

