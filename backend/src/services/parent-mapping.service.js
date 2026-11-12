const { query } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError } = require('../errors');
const logger = require('../utils/logger.util');

class ParentMappingService {
  /**
   * Mengambil semua akun orang tua beserta daftar siswa yang terhubung
   */
  async getAllParentsWithStudents() {
    const sql = `
      SELECT 
        u.user_id,
        u.username,
        u.full_name AS parent_name,
        u.status,
        u.created_at,
        psm.student_id,
        psm.relationship_type,
        psm.created_at AS linked_at,
        s.nisn,
        s.name AS student_name,
        s.status AS student_status,
        c.class_name
      FROM users u
      LEFT JOIN parent_student_mappings psm ON u.user_id = psm.parent_user_id
      LEFT JOIN students s ON psm.student_id = s.student_id
      LEFT JOIN classes c ON s.class_id = c.class_id
      WHERE u.role = 'ORANG_TUA'
      ORDER BY u.full_name ASC, s.name ASC
    `;

    const result = await query(sql);

    // Grouping by parent user_id
    const parentsMap = new Map();

    for (const row of result.rows) {
      if (!parentsMap.has(row.user_id)) {
        parentsMap.set(row.user_id, {
          user_id: row.user_id,
          username: row.username,
          parent_name: row.parent_name,
          status: row.status,
          created_at: row.created_at,
          students: []
        });
      }

      if (row.student_id) {
        parentsMap.get(row.user_id).students.push({
          student_id: row.student_id,
          nisn: row.nisn,
          student_name: row.student_name,
          student_status: row.student_status,
          class_name: row.class_name,
          relationship_type: row.relationship_type,
          linked_at: row.linked_at
        });
      }
    }

    return Array.from(parentsMap.values());
  }

  /**
   * Menghubungkan akun orang tua ke siswa
   */
  async linkStudent(parentUserId, studentId, relationshipType = 'ORANG_TUA') {
    if (!parentUserId || !studentId) {
      throw new BadRequestError('ID akun orang tua dan ID siswa wajib diisi');
    }

    const rel = (relationshipType || 'ORANG_TUA').toUpperCase();
    const validRel = ['AYAH', 'IBU', 'WALI', 'ORANG_TUA'];
    if (!validRel.includes(rel)) {
      throw new BadRequestError(`Tipe hubungan harus salah satu dari: ${validRel.join(', ')}`);
    }

    // 1. Verifikasi akun orang tua
    const parentRes = await query('SELECT user_id, role, full_name FROM users WHERE user_id = $1', [parentUserId]);
    if (parentRes.rows.length === 0) {
      throw new NotFoundError(`Akun pengguna ID ${parentUserId} tidak ditemukan`);
    }
    if (parentRes.rows[0].role !== 'ORANG_TUA') {
      throw new BadRequestError(`Akun pengguna '${parentRes.rows[0].full_name}' bukan bertipe role 'ORANG_TUA'`);
    }

    // 2. Verifikasi data siswa
    const studentRes = await query('SELECT student_id, name FROM students WHERE student_id = $1', [studentId]);
    if (studentRes.rows.length === 0) {
      throw new NotFoundError(`Data siswa dengan ID '${studentId}' tidak ditemukan`);
    }

    // 3. Simpan atau perbarui hubungan
    const insertRes = await query(
      `INSERT INTO parent_student_mappings (parent_user_id, student_id, relationship_type, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (parent_user_id, student_id)
       DO UPDATE SET relationship_type = EXCLUDED.relationship_type
       RETURNING parent_user_id, student_id, relationship_type, created_at`,
      [parentUserId, studentId, rel]
    );

    logger.info(`Linked student ${studentId} to parent user ${parentUserId} as ${rel}`);
    return {
      ...insertRes.rows[0],
      parent_name: parentRes.rows[0].full_name,
      student_name: studentRes.rows[0].name
    };
  }

  /**
   * Melepaskan hubungan siswa dari akun orang tua
   */
  async unlinkStudent(parentUserId, studentId) {
    if (!parentUserId || !studentId) {
      throw new BadRequestError('ID akun orang tua dan ID siswa wajib diisi');
    }

    const deleteRes = await query(
      `DELETE FROM parent_student_mappings 
       WHERE parent_user_id = $1 AND student_id = $2
       RETURNING *`,
      [parentUserId, studentId]
    );

    if (deleteRes.rows.length === 0) {
      throw new NotFoundError(`Hubungan antara orang tua ID ${parentUserId} dan siswa '${studentId}' tidak ditemukan`);
    }

    logger.info(`Unlinked student ${studentId} from parent user ${parentUserId}`);
    return {
      message: 'Hubungan orang tua dan siswa berhasil dihapus',
      unlinked: deleteRes.rows[0]
    };
  }

  /**
   * IDOR-safe: Mengambil profil siswa yang terhubung dengan akun orang tua yang sedang login
   */
  async getMyStudents(parentUserId) {
    if (!parentUserId) {
      throw new BadRequestError('ID pengguna tidak valid');
    }

    const sql = `
      SELECT 
        s.student_id,
        s.nisn,
        s.name,
        s.name AS student_name,
        s.gender,
        s.status,
        c.class_id,
        c.class_name,
        psm.relationship_type,
        psm.created_at AS linked_at
      FROM parent_student_mappings psm
      JOIN students s ON psm.student_id = s.student_id
      LEFT JOIN classes c ON s.class_id = c.class_id
      WHERE psm.parent_user_id = $1
      ORDER BY s.name ASC
    `;

    const result = await query(sql, [parentUserId]);
    return result.rows;
  }
}

module.exports = new ParentMappingService();
