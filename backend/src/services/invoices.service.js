const { query, withTransaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../errors');
const logger = require('../utils/logger.util');

class InvoicesService {
  /**
   * Validasi format kanonikal period_key dan konsistensinya terhadap academic_year_id (Q.5)
   */
  validatePeriodKey(periodKey, academicYearId) {
    if (!periodKey || typeof periodKey !== 'string') {
      throw new BadRequestError('Kolom period_key wajib diisi.');
    }

    const key = periodKey.trim();

    // 6 Format Canonical Baku
    const regexMonthly = /^\d{4}-(0[1-9]|1[0-2])$/;
    const regexSemester = /^\d{4}-SMT[1-2]$/;
    const regexAnnual = /^\d{4}-ANNUAL$/;
    const regexOnce = /^\d{4}-ONCE$/;
    const regexPTS = /^\d{4}-PTS[1-2]$/;
    const regexPASPAT = /^\d{4}-(PAS1|PAT2)$/;

    const isMatch = (
      regexMonthly.test(key) ||
      regexSemester.test(key) ||
      regexAnnual.test(key) ||
      regexOnce.test(key) ||
      regexPTS.test(key) ||
      regexPASPAT.test(key)
    );

    if (!isMatch) {
      throw new BadRequestError(
        `Format period_key '${key}' tidak valid. Harus mengikuti format kanonikal: YYYY-MM, YYYY-SMT1/2, YYYY-ANNUAL, YYYY-ONCE, YYYY-PTS1/2, atau YYYY-PAS1/PAT2.`
      );
    }

    // Konsistensi terhadap academic_year_id (format: YYYY1/YYYY2, misal '2026/2027')
    if (academicYearId && academicYearId.includes('/')) {
      const parts = academicYearId.split('/');
      const y1 = parseInt(parts[0], 10);
      const y2 = parseInt(parts[1], 10);

      const keyYear = parseInt(key.substring(0, 4), 10);

      if (regexMonthly.test(key)) {
        const month = parseInt(key.substring(5, 7), 10);
        if (month >= 7 && month <= 12 && keyYear !== y1) {
          throw new BadRequestError(`Bulan ${month.toString().padStart(2, '0')} pada tahun ajaran ${academicYearId} harus menggunakan tahun awal (${y1}).`);
        }
        if (month >= 1 && month <= 6 && keyYear !== y2) {
          throw new BadRequestError(`Bulan ${month.toString().padStart(2, '0')} pada tahun ajaran ${academicYearId} harus menggunakan tahun genap (${y2}).`);
        }
      } else if (regexSemester.test(key)) {
        if (key.endsWith('SMT1') && keyYear !== y1) {
          throw new BadRequestError(`SMT1 pada tahun ajaran ${academicYearId} harus menggunakan tahun awal (${y1}).`);
        }
        if (key.endsWith('SMT2') && keyYear !== y2) {
          throw new BadRequestError(`SMT2 pada tahun ajaran ${academicYearId} harus menggunakan tahun genap (${y2}).`);
        }
      } else if (regexAnnual.test(key) || regexOnce.test(key)) {
        if (keyYear !== y1) {
          throw new BadRequestError(`Tagihan tahunan / sekali bayar pada tahun ajaran ${academicYearId} harus menggunakan tahun awal (${y1}).`);
        }
      } else if (regexPTS.test(key)) {
        if (key.endsWith('PTS1') && keyYear !== y1) {
          throw new BadRequestError(`PTS1 pada tahun ajaran ${academicYearId} harus menggunakan tahun awal (${y1}).`);
        }
        if (key.endsWith('PTS2') && keyYear !== y2) {
          throw new BadRequestError(`PTS2 pada tahun ajaran ${academicYearId} harus menggunakan tahun genap (${y2}).`);
        }
      } else if (regexPASPAT.test(key)) {
        if (key.endsWith('PAS1') && keyYear !== y1) {
          throw new BadRequestError(`PAS1 pada tahun ajaran ${academicYearId} harus menggunakan tahun awal (${y1}).`);
        }
        if (key.endsWith('PAT2') && keyYear !== y2) {
          throw new BadRequestError(`PAT2 pada tahun ajaran ${academicYearId} harus menggunakan tahun genap (${y2}).`);
        }
      }
    }

    return key;
  }

  /**
   * Preview target siswa dan total nominal tagihan sebelum penerbitan massal (Atomisitas & Verifikasi)
   */
  async previewInvoices(criteria) {
    const { fee_category_id, academic_year_id, period_key, target_type, target_id, total_amount } = criteria;

    if (!fee_category_id || !academic_year_id || !period_key || !target_type) {
      throw new BadRequestError('fee_category_id, academic_year_id, period_key, dan target_type wajib diisi.');
    }

    // 1. Validasi kanonikal period_key
    const validPeriodKey = this.validatePeriodKey(period_key, academic_year_id);

    // 2. Ambil kategori biaya
    const catRes = await query('SELECT fee_category_id, name, default_amount FROM fee_categories WHERE fee_category_id = $1', [fee_category_id]);
    if (catRes.rows.length === 0) {
      throw new NotFoundError(`Jenis biaya '${fee_category_id}' tidak ditemukan`);
    }
    const category = catRes.rows[0];

    const unitAmount = total_amount !== undefined ? Number(total_amount) : Number(category.default_amount);
    if (unitAmount <= 0) {
      throw new BadRequestError('Nominal tagihan harus lebih besar dari 0.');
    }

    // 3. Query calon siswa target
    let studentSql = `
      SELECT s.student_id, s.name, s.nisn, s.class_id, c.class_name 
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.class_id
      WHERE s.status = 'Active'
    `;
    const studentParams = [];

    const normTarget = target_type.toUpperCase();
    if (normTarget === 'CLASS') {
      if (!target_id) throw new BadRequestError('target_id (class_id) wajib diisi untuk target_type CLASS.');
      studentParams.push(target_id);
      studentSql += ` AND s.class_id = $${studentParams.length}`;
    } else if (normTarget === 'INDIVIDUAL') {
      if (!target_id) throw new BadRequestError('target_id (student_id) wajib diisi untuk target_type INDIVIDUAL.');
      studentParams.push(target_id);
      studentSql += ` AND s.student_id = $${studentParams.length}`;
    } else if (normTarget !== 'ALL') {
      throw new BadRequestError("target_type harus bernilai 'ALL', 'CLASS', atau 'INDIVIDUAL'.");
    }

    studentSql += ` ORDER BY c.class_name ASC, s.name ASC`;
    const candidateStudents = await query(studentSql, studentParams);

    // 4. Query tagihan aktif yang sudah ada untuk periode ini
    const existingInvoices = await query(
      `SELECT student_id, invoice_id, title, status, total_amount, amount_paid 
       FROM student_invoices 
       WHERE fee_category_id = $1 AND academic_year_id = $2 AND period_key = $3 AND status <> 'CANCELLED'`,
      [fee_category_id, academic_year_id, validPeriodKey]
    );

    const existingStudentMap = new Map();
    existingInvoices.rows.forEach(inv => {
      existingStudentMap.set(inv.student_id, inv);
    });

    const eligibleStudents = [];
    const alreadyInvoicedStudents = [];

    for (const student of candidateStudents.rows) {
      if (existingStudentMap.has(student.student_id)) {
        alreadyInvoicedStudents.push({
          student_id: student.student_id,
          name: student.name,
          class_name: student.class_name,
          existing_invoice_id: existingStudentMap.get(student.student_id).invoice_id,
          existing_status: existingStudentMap.get(student.student_id).status
        });
      } else {
        eligibleStudents.push({
          student_id: student.student_id,
          name: student.name,
          class_name: student.class_name,
          nisn: student.nisn
        });
      }
    }

    const eligibleCount = eligibleStudents.length;
    const totalProjectedAmount = eligibleCount * unitAmount;

    return {
      fee_category: {
        fee_category_id: category.fee_category_id,
        name: category.name
      },
      academic_year_id,
      period_key: validPeriodKey,
      unit_amount: unitAmount,
      total_candidates: candidateStudents.rows.length,
      eligible_count: eligibleCount,
      total_projected_amount: totalProjectedAmount,
      already_invoiced_count: alreadyInvoicedStudents.length,
      eligible_students: eligibleStudents,
      already_invoiced_students: alreadyInvoicedStudents
    };
  }

  /**
   * Penerbitan tagihan secara atomik (Batch per siswa terpilih dalam satu transaksi)
   */
  async generateInvoices(payload, userId) {
    const { fee_category_id, academic_year_id, period_key, target_type, target_id, total_amount, title, due_date, notes } = payload;

    if (!fee_category_id || !academic_year_id || !period_key || !target_type) {
      throw new BadRequestError('fee_category_id, academic_year_id, period_key, dan target_type wajib diisi.');
    }

    const validPeriodKey = this.validatePeriodKey(period_key, academic_year_id);

    // Dapatkan preview target
    const preview = await this.previewInvoices(payload);
    if (preview.eligible_count === 0) {
      throw new ConflictError(
        `Tidak ada siswa yang memenuhi syarat untuk penerbitan tagihan. Seluruh ${preview.already_invoiced_count} siswa target telah memiliki tagihan aktif pada periode ${validPeriodKey}.`
      );
    }

    const unitAmount = preview.unit_amount;
    const invoiceTitle = title && String(title).trim() 
      ? String(title).trim() 
      : `${preview.fee_category.name} - Periode ${validPeriodKey}`;

    return withTransaction(async (client) => {
      const generatedInvoices = [];
      const timestamp = new Date();
      const datePrefix = timestamp.toISOString().slice(0, 10).replace(/-/g, '');
      const ayClean = academic_year_id.replace('/', '');

      for (let i = 0; i < preview.eligible_students.length; i++) {
        const student = preview.eligible_students[i];
        
        // Generate Unique Structured invoice_id: INV-<AY>-<DATE>-<RANDOM>
        const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
        const invoiceId = `INV-${ayClean}-${datePrefix}-${i + 1}-${randomPart}`;

        const insertSql = `
          INSERT INTO student_invoices (
            invoice_id,
            student_id,
            academic_year_id,
            fee_category_id,
            period_key,
            title,
            total_amount,
            amount_paid,
            status,
            due_date,
            notes,
            created_by_user_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, 'UNPAID', $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (student_id, academic_year_id, fee_category_id, period_key) WHERE status <> 'CANCELLED'
          DO NOTHING
          RETURNING *
        `;

        const res = await client.query(insertSql, [
          invoiceId,
          student.student_id,
          academic_year_id,
          fee_category_id,
          validPeriodKey,
          invoiceTitle,
          unitAmount,
          due_date || null,
          notes || null,
          userId
        ]);

        if (res.rows && res.rows.length > 0) {
          generatedInvoices.push({
            ...res.rows[0],
            student_name: student.name,
            class_name: student.class_name
          });
        }
      }

      logger.info(`Generated ${generatedInvoices.length} invoices for category ${fee_category_id} (period: ${validPeriodKey})`);

      return {
        success: true,
        generated_count: generatedInvoices.length,
        total_amount: generatedInvoices.length * unitAmount,
        skipped_count: preview.already_invoiced_count,
        invoices: generatedInvoices
      };
    });
  }

  /**
   * Mengambil daftar seluruh tagihan dengan filter dan RBAC
   */
  async getInvoices(filters = {}, user = null) {
    const { student_id, class_id, academic_year_id, fee_category_id, period_key, status, search, limit = 50, offset = 0 } = filters;

    let baseSql = `
      SELECT 
        i.invoice_id,
        i.student_id,
        s.name AS student_name,
        s.nisn,
        s.class_id,
        c.class_name,
        i.academic_year_id,
        i.fee_category_id,
        fc.name AS fee_category_name,
        i.period_key,
        i.title,
        i.total_amount,
        i.amount_paid,
        (i.total_amount - i.amount_paid) AS remaining_amount,
        i.status,
        i.due_date,
        i.notes,
        i.cancellation_reason,
        i.cancelled_at,
        i.created_at,
        i.updated_at
      FROM student_invoices i
      JOIN students s ON i.student_id = s.student_id
      LEFT JOIN classes c ON s.class_id = c.class_id
      JOIN fee_categories fc ON i.fee_category_id = fc.fee_category_id
      WHERE 1=1
    `;
    const params = [];

    // RBAC: Proteksi Akun ORANG_TUA (Hanya tagihan siswa binaannya, exclude CANCELLED)
    if (user && String(user.role).toUpperCase() === 'ORANG_TUA') {
      params.push(user.user_id);
      baseSql += ` AND i.student_id IN (
        SELECT student_id FROM parent_student_mappings WHERE parent_user_id = $${params.length}
      )`;
      // Portal Orang Tua hanya menampilkan tagihan aktif/relevan
      if (!status) {
        baseSql += ` AND i.status <> 'CANCELLED'`;
      }
    }

    if (student_id) {
      params.push(student_id);
      baseSql += ` AND i.student_id = $${params.length}`;
    }

    if (class_id) {
      params.push(class_id);
      baseSql += ` AND s.class_id = $${params.length}`;
    }

    if (academic_year_id) {
      params.push(academic_year_id);
      baseSql += ` AND i.academic_year_id = $${params.length}`;
    }

    if (fee_category_id) {
      params.push(fee_category_id);
      baseSql += ` AND i.fee_category_id = $${params.length}`;
    }

    if (period_key) {
      params.push(period_key);
      baseSql += ` AND i.period_key = $${params.length}`;
    }

    if (status) {
      params.push(status.toUpperCase());
      baseSql += ` AND i.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      baseSql += ` AND (s.name ILIKE $${params.length} OR s.nisn ILIKE $${params.length} OR i.title ILIKE $${params.length} OR i.invoice_id ILIKE $${params.length})`;
    }

    baseSql += ` ORDER BY i.created_at DESC, s.name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit) || 50);
    params.push(Number(offset) || 0);

    const result = await query(baseSql, params);

    // Format nominal
    return result.rows.map(row => ({
      ...row,
      total_amount: Number(row.total_amount),
      amount_paid: Number(row.amount_paid),
      remaining_amount: Number(row.remaining_amount)
    }));
  }

  /**
   * Mengambil detail tagihan spesifik berdasarkan invoice_id (dengan proteksi Anti-IDOR)
   */
  async getInvoiceById(invoiceId, user = null) {
    const sql = `
      SELECT 
        i.invoice_id,
        i.student_id,
        s.name AS student_name,
        s.nisn,
        s.class_id,
        c.class_name,
        i.academic_year_id,
        i.fee_category_id,
        fc.name AS fee_category_name,
        i.period_key,
        i.title,
        i.total_amount,
        i.amount_paid,
        (i.total_amount - i.amount_paid) AS remaining_amount,
        i.status,
        i.due_date,
        i.notes,
        i.cancellation_reason,
        i.cancelled_at,
        i.created_by_user_id,
        u.full_name AS created_by_user_name,
        i.created_at,
        i.updated_at
      FROM student_invoices i
      JOIN students s ON i.student_id = s.student_id
      LEFT JOIN classes c ON s.class_id = c.class_id
      JOIN fee_categories fc ON i.fee_category_id = fc.fee_category_id
      LEFT JOIN users u ON i.created_by_user_id = u.user_id
      WHERE i.invoice_id = $1
    `;

    const result = await query(sql, [invoiceId]);
    if (result.rows.length === 0) {
      throw new NotFoundError(`Tagihan dengan ID '${invoiceId}' tidak ditemukan.`);
    }

    const invoice = result.rows[0];

    // Anti-IDOR Guard untuk role ORANG_TUA
    if (user && String(user.role).toUpperCase() === 'ORANG_TUA') {
      const mapping = await query(
        `SELECT 1 FROM parent_student_mappings WHERE parent_user_id = $1 AND student_id = $2`,
        [user.user_id, invoice.student_id]
      );
      if (mapping.rows.length === 0) {
        throw new ForbiddenError('Akses ditolak. Anda tidak memiliki wewenang untuk melihat tagihan siswa ini.');
      }
    }

    return {
      ...invoice,
      total_amount: Number(invoice.total_amount),
      amount_paid: Number(invoice.amount_paid),
      remaining_amount: Number(invoice.remaining_amount)
    };
  }

  /**
   * Membatalkan tagihan siswa (Hanya jika amount_paid = 0)
   */
  async cancelInvoice(invoiceId, cancellationReason, userId) {
    if (!cancellationReason || !String(cancellationReason).trim()) {
      throw new BadRequestError('Alasan pembatalan tagihan (cancellation_reason) wajib diisi.');
    }

    const reason = String(cancellationReason).trim();

    return withTransaction(async (client) => {
      // Lock row invoice untuk konsistensi
      const checkRes = await client.query(
        `SELECT invoice_id, student_id, status, total_amount, amount_paid 
         FROM student_invoices 
         WHERE invoice_id = $1 
         FOR UPDATE`,
        [invoiceId]
      );

      if (checkRes.rows.length === 0) {
        throw new NotFoundError(`Tagihan dengan ID '${invoiceId}' tidak ditemukan.`);
      }

      const inv = checkRes.rows[0];

      if (inv.status === 'CANCELLED') {
        throw new BadRequestError(`Tagihan '${invoiceId}' sudah berstatus CANCELLED sebelumnya.`);
      }

      if (Number(inv.amount_paid) > 0) {
        throw new BadRequestError(
          `Tagihan '${invoiceId}' tidak dapat dibatalkan karena sudah memiliki alokasi pembayaran sebesar Rp ${Number(inv.amount_paid).toLocaleString('id-ID')}. Batalkan atau alihkan pembayaran terlebih dahulu.`
        );
      }

      const updateRes = await client.query(
        `UPDATE student_invoices 
         SET status = 'CANCELLED',
             cancellation_reason = $1,
             cancelled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE invoice_id = $2
         RETURNING *`,
        [reason, invoiceId]
      );

      logger.info(`Invoice cancelled: ${invoiceId} by user ${userId}. Reason: ${reason}`);
      return updateRes.rows[0];
    });
  }

  /**
   * Mengambil ringkasan tagihan untuk siswa tertentu (Portal Orang Tua / Rekap Siswa)
   */
  async getStudentInvoicesSummary(studentId, user = null) {
    if (!studentId) {
      throw new BadRequestError('student_id wajib diisi.');
    }

    // Anti-IDOR Guard untuk role ORANG_TUA
    if (user && String(user.role).toUpperCase() === 'ORANG_TUA') {
      const mapping = await query(
        `SELECT 1 FROM parent_student_mappings WHERE parent_user_id = $1 AND student_id = $2`,
        [user.user_id, studentId]
      );
      if (mapping.rows.length === 0) {
        throw new ForbiddenError('Akses ditolak. Anda tidak memiliki wewenang untuk melihat data siswa ini.');
      }
    }

    const sql = `
      SELECT 
        i.status,
        COUNT(*)::INTEGER AS count,
        COALESCE(SUM(i.total_amount), 0.00)::NUMERIC(14,2) AS total_amount,
        COALESCE(SUM(i.amount_paid), 0.00)::NUMERIC(14,2) AS total_paid,
        COALESCE(SUM(i.total_amount - i.amount_paid), 0.00)::NUMERIC(14,2) AS total_remaining
      FROM student_invoices i
      WHERE i.student_id = $1 AND i.status <> 'CANCELLED'
      GROUP BY i.status
    `;

    const res = await query(sql, [studentId]);
    return res.rows.map(r => ({
      status: r.status,
      count: Number(r.count),
      total_amount: Number(r.total_amount),
      total_paid: Number(r.total_paid),
      total_remaining: Number(r.total_remaining)
    }));
  }
}

module.exports = new InvoicesService();
