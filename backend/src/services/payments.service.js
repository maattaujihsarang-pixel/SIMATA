const { query, withTransaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../errors');
const { generateUUID } = require('../utils/id-generator.util');
const { terbilangRupiah } = require('../utils/terbilang.util');
const financeDocumentStorage = require('../storage/finance-document-storage.provider');
const masterService = require('./master.service');
const logger = require('../utils/logger.util');

class PaymentsService {
  /**
   * Helper: Standarisasi metode pembayaran
   */
  _normalizePaymentMethod(method) {
    if (!method) return 'CASH';
    const m = String(method).trim().toUpperCase();
    if (m === 'TUNAI' || m === 'CASH') return 'CASH';
    if (m === 'TRANSFER' || m === 'BANK_TRANSFER') return 'BANK_TRANSFER';
    throw new BadRequestError(`Metode pembayaran '${method}' tidak didukung. Gunakan CASH atau BANK_TRANSFER.`);
  }

  /**
   * Helper: Validasi format tanggal YYYY-MM-DD
   */
  _validateDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestError('Format tanggal tidak valid. Gunakan format YYYY-MM-DD.');
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      throw new BadRequestError('Tanggal pembayaran tidak valid.');
    }
    return dateStr;
  }

  /**
   * 1. Pencatatan Pembayaran Baru (Initial Payment Recording)
   */
  async recordPayment({
    student_id,
    academic_year_id,
    payment_date,
    amount,
    payment_method,
    reference_number = null,
    notes = null,
    allocations = [],
    file = null,
    user,
    meta = {}
  }) {
    if (!student_id) {
      throw new BadRequestError('student_id wajib diisi.');
    }
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestError('Nominal pembayaran harus berupa angka positif lebih dari 0.');
    }

    const normMethod = this._normalizePaymentMethod(payment_method);
    const validPaymentDate = this._validateDate(payment_date || new Date().toISOString().slice(0, 10));

    // Validasi siswa
    const studentRes = await query(
      `SELECT s.student_id, s.name, s.nisn, s.class_id, c.class_name 
       FROM students s 
       LEFT JOIN classes c ON c.class_id = s.class_id 
       WHERE s.student_id = $1`,
      [student_id]
    );
    if (studentRes.rows.length === 0) {
      throw new NotFoundError(`Siswa dengan ID '${student_id}' tidak ditemukan.`);
    }
    const student = studentRes.rows[0];

    // Validasi atau ambil tahun ajaran aktif
    let targetAyId = academic_year_id;
    if (!targetAyId) {
      const activeAy = await masterService.getActiveAcademicYear();
      targetAyId = activeAy.academic_year_id;
    } else {
      const ayCheck = await query('SELECT academic_year_id FROM academic_years WHERE academic_year_id = $1', [targetAyId]);
      if (ayCheck.rows.length === 0) {
        throw new NotFoundError(`Tahun ajaran '${targetAyId}' tidak ditemukan.`);
      }
    }

    // Unggah dokumen transfer jika ada (Opsional - Q.2)
    let savedDoc = null;
    if (file && file.buffer) {
      savedDoc = await financeDocumentStorage.saveDocument({
        buffer: file.buffer,
        originalName: file.originalname || 'bukti_transfer.jpg'
      });
    }

    // Parse allocations
    let allocList = [];
    if (typeof allocations === 'string') {
      try {
        allocList = JSON.parse(allocations);
      } catch (e) {
        throw new BadRequestError('Format data alokasi tidak valid (harus array JSON).');
      }
    } else if (Array.isArray(allocations)) {
      allocList = allocations;
    }

    // Eksekusi transaksi atomik
    return withTransaction(async (client) => {
      // 1. Simpan metadata dokumen jika diunggah
      let documentId = null;
      if (savedDoc) {
        documentId = savedDoc.documentId;
        await client.query(
          `INSERT INTO finance_documents (
            document_id, document_type, file_name, original_name, storage_path, 
            mime_type, file_size, uploaded_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            documentId,
            'BUKTI_PEMBAYARAN_SISWA',
            savedDoc.fileName,
            savedDoc.originalName,
            savedDoc.storagePath,
            savedDoc.mimeType,
            savedDoc.fileSize,
            user.user_id
          ]
        );
      }

      // 2. Validasi & Penguncian Invoices jika ada alokasi
      let totalAllocated = 0;
      const validAllocations = [];

      if (allocList.length > 0) {
        // Ambil ID invoice unik dan urutkan ASC untuk linear lock order
        const targetInvoiceIds = [...new Set(allocList.map(a => a.invoice_id).filter(Boolean))].sort();

        if (targetInvoiceIds.length > 0) {
          // Lock target invoices in ASC order
          const invRes = await client.query(
            `SELECT invoice_id, student_id, status, total_amount, amount_paid 
             FROM student_invoices 
             WHERE invoice_id = ANY($1) 
             ORDER BY invoice_id ASC 
             FOR UPDATE`,
            [targetInvoiceIds]
          );

          const invoiceMap = new Map();
          invRes.rows.forEach(inv => invoiceMap.set(inv.invoice_id, inv));

          for (const alloc of allocList) {
            const allocAmt = Number(alloc.amount);
            if (isNaN(allocAmt) || allocAmt <= 0) continue;

            const inv = invoiceMap.get(alloc.invoice_id);
            if (!inv) {
              throw new NotFoundError(`Tagihan '${alloc.invoice_id}' tidak ditemukan.`);
            }
            if (inv.student_id !== student_id) {
              throw new BadRequestError(`Tagihan '${alloc.invoice_id}' bukan milik siswa '${student_id}'.`);
            }
            if (inv.status === 'CANCELLED') {
              throw new BadRequestError(`Tagihan '${alloc.invoice_id}' berstatus CANCELLED dan tidak dapat menerima alokasi.`);
            }

            const remainingDebt = Number(inv.total_amount) - Number(inv.amount_paid);
            if (allocAmt > remainingDebt) {
              throw new BadRequestError(
                `Nominal alokasi Rp ${allocAmt.toLocaleString('id-ID')} melampaui sisa tagihan Rp ${remainingDebt.toLocaleString('id-ID')} untuk '${inv.invoice_id}'.`
              );
            }

            validAllocations.push({
              invoice_id: alloc.invoice_id,
              amount: allocAmt
            });
            totalAllocated += allocAmt;
          }

          if (totalAllocated > parsedAmount) {
            throw new BadRequestError(
              `Total alokasi (Rp ${totalAllocated.toLocaleString('id-ID')}) melebihi nominal pembayaran (Rp ${parsedAmount.toLocaleString('id-ID')}).`
            );
          }
        }
      }

      // 3. Pembangkitan Nomor Kuitansi Transaksional Konkuren (Q.1)
      const seqRes = await client.query('SELECT fn_generate_next_receipt_number(CURRENT_TIMESTAMP) AS receipt_number');
      const receiptNumber = seqRes.rows[0].receipt_number;

      // 4. Insert student_payments
      const paymentId = `PAY-${generateUUID()}`;
      const insertPaySql = `
        INSERT INTO student_payments (
          payment_id, receipt_number, receipt_issued_at, student_id, academic_year_id,
          payment_date, amount, payment_method, reference_number, notes,
          document_id, recorded_by_user_id, status, created_at, updated_at
        ) VALUES (
          $1, $2, CURRENT_TIMESTAMP, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING *
      `;

      const payRes = await client.query(insertPaySql, [
        paymentId,
        receiptNumber,
        student_id,
        targetAyId,
        validPaymentDate,
        parsedAmount,
        normMethod,
        reference_number || null,
        notes || null,
        documentId,
        user.user_id
      ]);
      const payment = payRes.rows[0];

      // 5. Insert payment_allocations
      const savedAllocations = [];
      for (const a of validAllocations) {
        const allocId = `ALC-${generateUUID()}`;
        const allocRes = await client.query(
          `INSERT INTO payment_allocations (
            allocation_id, payment_id, invoice_id, amount, allocated_by_user_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *`,
          [allocId, paymentId, a.invoice_id, a.amount, user.user_id]
        );
        savedAllocations.push(allocRes.rows[0]);
      }

      // 6. Record Audit Log (Append-Only)
      await client.query(
        `INSERT INTO payment_audit_logs (
          payment_id, action_type, changed_by_user_id, reason,
          old_values, new_values, old_allocations, new_allocations,
          ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          paymentId,
          'INSERT',
          user.user_id,
          notes ? `Pencatatan pembayaran awal: ${notes}` : 'Pencatatan pembayaran awal',
          null,
          JSON.stringify(payment),
          null,
          JSON.stringify(savedAllocations),
          meta.ip || null,
          meta.userAgent || null
        ]
      );

      const unallocatedAmount = parsedAmount - totalAllocated;

      logger.info(`Payment recorded successfully: ${receiptNumber} for student ${student_id} (Rp ${parsedAmount})`);

      return {
        ...payment,
        amount: Number(payment.amount),
        student_name: student.name,
        student_nisn: student.nisn,
        class_name: student.class_name,
        allocations: savedAllocations,
        total_allocated: totalAllocated,
        unallocated_amount: unallocatedAmount,
        terbilang: terbilangRupiah(payment.amount)
      };
    });
  }

  /**
   * 2. Alokasi Lanjutan Sisa Pembayaran (POST /payments/:id/allocate - Q.4)
   */
  async allocatePayment({
    paymentId,
    allocations = [],
    user,
    meta = {}
  }) {
    let allocList = [];
    if (typeof allocations === 'string') {
      try {
        allocList = JSON.parse(allocations);
      } catch (e) {
        throw new BadRequestError('Format alokasi tidak valid.');
      }
    } else if (Array.isArray(allocations)) {
      allocList = allocations;
    }

    if (!allocList || allocList.length === 0) {
      throw new BadRequestError('Daftar alokasi tidak boleh kosong.');
    }

    return withTransaction(async (client) => {
      // 1. Ambil target invoice IDs dan urutkan ASC untuk penguncian bebas deadlock
      const targetInvoiceIds = [...new Set(allocList.map(a => a.invoice_id).filter(Boolean))].sort();
      if (targetInvoiceIds.length === 0) {
        throw new BadRequestError('Invoice target tidak valid.');
      }

      // Lock invoices ASC
      const invRes = await client.query(
        `SELECT invoice_id, student_id, status, total_amount, amount_paid 
         FROM student_invoices 
         WHERE invoice_id = ANY($1) 
         ORDER BY invoice_id ASC 
         FOR UPDATE`,
        [targetInvoiceIds]
      );
      const invoiceMap = new Map();
      invRes.rows.forEach(inv => invoiceMap.set(inv.invoice_id, inv));

      // 2. Lock payment
      const payRes = await client.query(
        `SELECT * FROM student_payments WHERE payment_id = $1 FOR UPDATE`,
        [paymentId]
      );
      if (payRes.rows.length === 0) {
        throw new NotFoundError(`Pembayaran '${paymentId}' tidak ditemukan.`);
      }
      const payment = payRes.rows[0];

      if (payment.status === 'VOID') {
        throw new BadRequestError(`Pembayaran '${payment.receipt_number}' berstatus VOID dan tidak dapat menerima alokasi.`);
      }

      // 3. Hitung alokasi aktif saat ini
      const existingAllocRes = await client.query(
        `SELECT * FROM payment_allocations WHERE payment_id = $1`,
        [paymentId]
      );
      const existingAllocations = existingAllocRes.rows;
      const currentAllocated = existingAllocations.reduce((sum, a) => sum + Number(a.amount), 0);
      const unallocatedAmount = Number(payment.amount) - currentAllocated;

      // 4. Validasi alokasi baru
      let totalNewAlloc = 0;
      const processedAllocations = [];

      for (const item of allocList) {
        const amt = Number(item.amount);
        if (isNaN(amt) || amt <= 0) continue;

        const inv = invoiceMap.get(item.invoice_id);
        if (!inv) {
          throw new NotFoundError(`Tagihan '${item.invoice_id}' tidak ditemukan.`);
        }
        if (inv.student_id !== payment.student_id) {
          throw new BadRequestError(`Tagihan '${item.invoice_id}' bukan milik siswa pembayaran (${payment.student_id}).`);
        }
        if (inv.status === 'CANCELLED') {
          throw new BadRequestError(`Tagihan '${item.invoice_id}' berstatus CANCELLED dan tidak dapat menerima alokasi.`);
        }

        const remainingDebt = Number(inv.total_amount) - Number(inv.amount_paid);
        if (amt > remainingDebt) {
          throw new BadRequestError(
            `Nominal alokasi Rp ${amt.toLocaleString('id-ID')} melampaui sisa tagihan Rp ${remainingDebt.toLocaleString('id-ID')} pada tagihan '${inv.invoice_id}'.`
          );
        }

        processedAllocations.push({
          invoice_id: item.invoice_id,
          amount: amt
        });
        totalNewAlloc += amt;
      }

      if (totalNewAlloc <= 0) {
        throw new BadRequestError('Nominal alokasi harus lebih dari 0.');
      }
      if (totalNewAlloc > unallocatedAmount) {
        throw new BadRequestError(
          `Total alokasi baru (Rp ${totalNewAlloc.toLocaleString('id-ID')}) melebihi sisa dana pembayaran yang belum dialokasikan (Rp ${unallocatedAmount.toLocaleString('id-ID')}).`
        );
      }

      // 5. Simpan baris alokasi (insert atau update jika invoice sudah ada)
      for (const a of processedAllocations) {
        const existing = existingAllocations.find(ex => ex.invoice_id === a.invoice_id);
        if (existing) {
          const newAllocAmt = Number(existing.amount) + a.amount;
          await client.query(
            `UPDATE payment_allocations 
             SET amount = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE allocation_id = $2`,
            [newAllocAmt, existing.allocation_id]
          );
        } else {
          const allocId = `ALC-${generateUUID()}`;
          await client.query(
            `INSERT INTO payment_allocations (
              allocation_id, payment_id, invoice_id, amount, allocated_by_user_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [allocId, paymentId, a.invoice_id, a.amount, user.user_id]
          );
        }
      }

      // Ambil daftar alokasi terbaru
      const updatedAllocRes = await client.query(
        `SELECT * FROM payment_allocations WHERE payment_id = $1`,
        [paymentId]
      );
      const updatedAllocations = updatedAllocRes.rows;

      // 6. Record Audit Log
      await client.query(
        `INSERT INTO payment_audit_logs (
          payment_id, action_type, changed_by_user_id, reason,
          old_values, new_values, old_allocations, new_allocations,
          ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          paymentId,
          'ALLOCATE',
          user.user_id,
          `Alokasi lanjutan sebesar Rp ${totalNewAlloc.toLocaleString('id-ID')} ke ${processedAllocations.length} tagihan.`,
          JSON.stringify(payment),
          JSON.stringify(payment),
          JSON.stringify(existingAllocations),
          JSON.stringify(updatedAllocations),
          meta.ip || null,
          meta.userAgent || null
        ]
      );

      const newTotalAllocated = updatedAllocations.reduce((sum, a) => sum + Number(a.amount), 0);
      const newUnallocated = Number(payment.amount) - newTotalAllocated;

      logger.info(`Subsequent allocation successful for ${payment.receipt_number}: +Rp ${totalNewAlloc}`);

      return {
        ...payment,
        amount: Number(payment.amount),
        allocations: updatedAllocations,
        total_allocated: newTotalAllocated,
        unallocated_amount: newUnallocated
      };
    });
  }

  /**
   * 3. Koreksi Data Pembayaran Biasa (PUT /payments/:id - Edit with Audit)
   */
  async updatePayment({
    paymentId,
    payment_date,
    amount,
    payment_method,
    reference_number,
    notes,
    reason,
    user,
    meta = {}
  }) {
    if (!reason || String(reason).trim().length < 10) {
      throw new BadRequestError('Alasan perubahan pembayaran wajib diisi minimal 10 karakter.');
    }

    return withTransaction(async (client) => {
      // Lock payment
      const payRes = await client.query(
        `SELECT * FROM student_payments WHERE payment_id = $1 FOR UPDATE`,
        [paymentId]
      );
      if (payRes.rows.length === 0) {
        throw new NotFoundError(`Pembayaran '${paymentId}' tidak ditemukan.`);
      }
      const payment = payRes.rows[0];

      if (payment.status === 'VOID') {
        throw new BadRequestError(`Pembayaran '${payment.receipt_number}' berstatus VOID dan tidak dapat diedit.`);
      }

      // Ambil alokasi aktif
      const allocRes = await client.query(
        `SELECT * FROM payment_allocations WHERE payment_id = $1`,
        [paymentId]
      );
      const existingAllocations = allocRes.rows;
      const totalAllocated = existingAllocations.reduce((sum, a) => sum + Number(a.amount), 0);

      let newAmount = payment.amount;
      if (amount !== undefined && amount !== null) {
        const parsedAmt = Number(amount);
        if (isNaN(parsedAmt) || parsedAmt <= 0) {
          throw new BadRequestError('Nominal pembayaran baru harus berupa angka positif.');
        }
        if (parsedAmt < totalAllocated) {
          throw new BadRequestError(
            `Nominal pembayaran (Rp ${parsedAmt.toLocaleString('id-ID')}) tidak boleh lebih kecil dari total alokasi yang sudah berjalan (Rp ${totalAllocated.toLocaleString('id-ID')}).`
          );
        }
        newAmount = parsedAmt;
      }

      const newDate = payment_date ? this._validateDate(payment_date) : payment.payment_date;
      const newMethod = payment_method ? this._normalizePaymentMethod(payment_method) : payment.payment_method;
      const newRef = reference_number !== undefined ? reference_number : payment.reference_number;
      const newNotes = notes !== undefined ? notes : payment.notes;

      // Update student_payments
      // Catatan: receipt_number, receipt_issued_at, dan student_id IMMUTABLE
      const updateRes = await client.query(
        `UPDATE student_payments 
         SET payment_date = $1, amount = $2, payment_method = $3, 
             reference_number = $4, notes = $5, updated_at = CURRENT_TIMESTAMP 
         WHERE payment_id = $6 
         RETURNING *`,
        [newDate, newAmount, newMethod, newRef, newNotes, paymentId]
      );
      const updatedPayment = updateRes.rows[0];

      // Record Audit Log (Append-Only)
      await client.query(
        `INSERT INTO payment_audit_logs (
          payment_id, action_type, changed_by_user_id, reason,
          old_values, new_values, old_allocations, new_allocations,
          ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          paymentId,
          'UPDATE',
          user.user_id,
          reason,
          JSON.stringify(payment),
          JSON.stringify(updatedPayment),
          JSON.stringify(existingAllocations),
          JSON.stringify(existingAllocations),
          meta.ip || null,
          meta.userAgent || null
        ]
      );

      const unallocatedAmount = Number(updatedPayment.amount) - totalAllocated;

      logger.info(`Payment updated: ${payment.receipt_number} by user ${user.user_id}. Reason: ${reason}`);

      return {
        ...updatedPayment,
        amount: Number(updatedPayment.amount),
        allocations: existingAllocations,
        total_allocated: totalAllocated,
        unallocated_amount: unallocatedAmount
      };
    });
  }

  /**
   * 4. Pembatalan / VOID Pembayaran (PATCH /payments/:id/void & VOID-and-re-record)
   */
  async voidPayment({
    paymentId,
    reason,
    user,
    meta = {}
  }) {
    if (!reason || String(reason).trim().length < 10) {
      throw new BadRequestError('Alasan pembatalan (VOID) wajib diisi minimal 10 karakter.');
    }

    return withTransaction(async (client) => {
      // 1. Dapatkan daftar invoice yang terhubung dengan pembayaran ini
      const allocRes = await client.query(
        `SELECT DISTINCT invoice_id 
         FROM payment_allocations 
         WHERE payment_id = $1 
         ORDER BY invoice_id ASC`,
        [paymentId]
      );
      const affectedInvoiceIds = allocRes.rows.map(r => r.invoice_id);

      // 2. Lock seluruh invoice terkait ASC
      if (affectedInvoiceIds.length > 0) {
        await client.query(
          `SELECT invoice_id FROM student_invoices WHERE invoice_id = ANY($1) ORDER BY invoice_id ASC FOR UPDATE`,
          [affectedInvoiceIds]
        );
      }

      // 3. Lock payment
      const payRes = await client.query(
        `SELECT * FROM student_payments WHERE payment_id = $1 FOR UPDATE`,
        [paymentId]
      );
      if (payRes.rows.length === 0) {
        throw new NotFoundError(`Pembayaran '${paymentId}' tidak ditemukan.`);
      }
      const payment = payRes.rows[0];

      if (payment.status === 'VOID') {
        throw new BadRequestError(`Pembayaran '${payment.receipt_number}' sudah berstatus VOID (status terminal).`);
      }

      // Ambil snapshot alokasi lama
      const fullAllocRes = await client.query(
        `SELECT * FROM payment_allocations WHERE payment_id = $1`,
        [paymentId]
      );
      const oldAllocations = fullAllocRes.rows;

      // 4. Update status menjadi VOID
      // Trigger trg_after_payment_status_change akan menghitung ulang seluruh student_invoices
      // tanpa menghapus baris payment_allocations secara fisik (retensi non-destruktif).
      const voidRes = await client.query(
        `UPDATE student_payments 
         SET status = 'VOID', void_at = CURRENT_TIMESTAMP, 
             void_by_user_id = $1, void_reason = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE payment_id = $3 
         RETURNING *`,
        [user.user_id, reason, paymentId]
      );
      const voidedPayment = voidRes.rows[0];

      // 5. Record Audit Log
      await client.query(
        `INSERT INTO payment_audit_logs (
          payment_id, action_type, changed_by_user_id, reason,
          old_values, new_values, old_allocations, new_allocations,
          ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          paymentId,
          'VOID',
          user.user_id,
          reason,
          JSON.stringify(payment),
          JSON.stringify(voidedPayment),
          JSON.stringify(oldAllocations),
          JSON.stringify([]), // Representasi pelepasan alokasi aktif
          meta.ip || null,
          meta.userAgent || null
        ]
      );

      logger.info(`Payment VOIDED: ${payment.receipt_number} by user ${user.user_id}. Reason: ${reason}`);

      return {
        ...voidedPayment,
        amount: Number(voidedPayment.amount),
        allocations: oldAllocations,
        total_allocated: 0,
        unallocated_amount: 0
      };
    });
  }

  /**
   * 5. Daftar Pembayaran dengan Filter, Pagination, dan RBAC Scoping
   */
  async getPayments(filters = {}, user = null) {
    const {
      student_id,
      academic_year_id,
      status,
      payment_method,
      start_date,
      end_date,
      search,
      page = 1,
      limit = 20
    } = filters;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));
    const queryParams = [];
    let paramIndex = 1;

    let baseSql = `
      SELECT 
        p.payment_id,
        p.receipt_number,
        p.receipt_issued_at,
        p.student_id,
        s.name AS student_name,
        s.nisn AS student_nisn,
        c.class_name,
        p.academic_year_id,
        p.payment_date,
        p.amount,
        p.payment_method,
        p.reference_number,
        p.notes,
        p.status,
        p.void_at,
        p.void_reason,
        p.document_id,
        doc.file_name AS document_file_name,
        doc.original_name AS document_original_name,
        u_rec.name AS recorded_by_name,
        u_void.name AS void_by_name,
        p.created_at,
        p.updated_at,
        COALESCE(
          (SELECT SUM(pa.amount) 
           FROM payment_allocations pa 
           WHERE pa.payment_id = p.payment_id AND p.status = 'ACTIVE'), 0.00
        ) AS total_allocated
      FROM student_payments p
      JOIN students s ON s.student_id = p.student_id
      LEFT JOIN classes c ON c.class_id = s.class_id
      LEFT JOIN finance_documents doc ON doc.document_id = p.document_id
      LEFT JOIN users u_rec ON u_rec.user_id = p.recorded_by_user_id
      LEFT JOIN users u_void ON u_void.user_id = p.void_by_user_id
      WHERE 1=1
    `;

    // RBAC: Orang Tua Scoping
    if (user && String(user.role).toUpperCase() === 'ORANG_TUA') {
      baseSql += ` AND p.student_id IN (
        SELECT student_id FROM parent_student_mappings WHERE parent_user_id = $${paramIndex}
      )`;
      queryParams.push(user.user_id);
      paramIndex++;
    }

    if (student_id) {
      baseSql += ` AND p.student_id = $${paramIndex}`;
      queryParams.push(student_id);
      paramIndex++;
    }

    if (academic_year_id) {
      baseSql += ` AND p.academic_year_id = $${paramIndex}`;
      queryParams.push(academic_year_id);
      paramIndex++;
    }

    if (status) {
      baseSql += ` AND p.status = $${paramIndex}`;
      queryParams.push(status.toUpperCase());
      paramIndex++;
    }

    if (payment_method) {
      const norm = this._normalizePaymentMethod(payment_method);
      baseSql += ` AND p.payment_method = $${paramIndex}`;
      queryParams.push(norm);
      paramIndex++;
    }

    if (start_date) {
      baseSql += ` AND p.payment_date >= $${paramIndex}`;
      queryParams.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      baseSql += ` AND p.payment_date <= $${paramIndex}`;
      queryParams.push(end_date);
      paramIndex++;
    }

    if (search) {
      baseSql += ` AND (
        p.receipt_number ILIKE $${paramIndex} OR
        s.name ILIKE $${paramIndex} OR
        s.nisn ILIKE $${paramIndex} OR
        p.reference_number ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Count total query
    const countSql = `SELECT COUNT(*) AS total FROM (${baseSql}) sub`;
    const countRes = await query(countSql, queryParams);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    // Order & Pagination
    baseSql += ` ORDER BY p.receipt_issued_at DESC, p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parseInt(limit, 10), offset);

    const rowsRes = await query(baseSql, queryParams);

    const data = rowsRes.rows.map(row => {
      const amt = Number(row.amount);
      const alloc = Number(row.total_allocated);
      const unallocated = row.status === 'ACTIVE' ? Math.max(0, amt - alloc) : 0;
      return {
        ...row,
        amount: amt,
        total_allocated: alloc,
        unallocated_amount: unallocated
      };
    });

    return {
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / parseInt(limit, 10))
      }
    };
  }

  /**
   * 6. Detail Pembayaran Tunggal (IDOR-safe)
   */
  async getPaymentById(paymentId, user = null) {
    const payRes = await query(
      `SELECT 
        p.*,
        s.name AS student_name,
        s.nisn AS student_nisn,
        c.class_name,
        doc.file_name AS document_file_name,
        doc.original_name AS document_original_name,
        doc.mime_type AS document_mime_type,
        doc.file_size AS document_file_size,
        u_rec.name AS recorded_by_name,
        u_void.name AS void_by_name
       FROM student_payments p
       JOIN students s ON s.student_id = p.student_id
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN finance_documents doc ON doc.document_id = p.document_id
       LEFT JOIN users u_rec ON u_rec.user_id = p.recorded_by_user_id
       LEFT JOIN users u_void ON u_void.user_id = p.void_by_user_id
       WHERE p.payment_id = $1`,
      [paymentId]
    );

    if (payRes.rows.length === 0) {
      throw new NotFoundError(`Pembayaran dengan ID '${paymentId}' tidak ditemukan.`);
    }

    const payment = payRes.rows[0];

    // IDOR Protection: Orang tua hanya boleh akses pembayaran anaknya
    if (user && String(user.role).toUpperCase() === 'ORANG_TUA') {
      const mapRes = await query(
        `SELECT 1 FROM parent_student_mappings WHERE parent_user_id = $1 AND student_id = $2`,
        [user.user_id, payment.student_id]
      );
      if (mapRes.rows.length === 0) {
        throw new ForbiddenError('Anda tidak memiliki izin untuk melihat rincian pembayaran siswa ini.');
      }
    }

    // Ambil alokasi tagihan
    const allocRes = await query(
      `SELECT 
        pa.allocation_id,
        pa.payment_id,
        pa.invoice_id,
        pa.amount,
        pa.created_at,
        inv.title AS invoice_title,
        inv.period_key,
        inv.total_amount AS invoice_total_amount,
        inv.amount_paid AS invoice_amount_paid,
        inv.status AS invoice_status,
        fc.name AS fee_category_name
       FROM payment_allocations pa
       JOIN student_invoices inv ON inv.invoice_id = pa.invoice_id
       JOIN fee_categories fc ON fc.fee_category_id = inv.fee_category_id
       WHERE pa.payment_id = $1
       ORDER BY inv.invoice_id ASC`,
      [paymentId]
    );

    const allocations = allocRes.rows.map(a => ({
      ...a,
      amount: Number(a.amount),
      invoice_total_amount: Number(a.invoice_total_amount),
      invoice_amount_paid: Number(a.invoice_amount_paid)
    }));

    const totalAllocated = payment.status === 'ACTIVE'
      ? allocations.reduce((sum, a) => sum + a.amount, 0)
      : 0;

    const unallocatedAmount = payment.status === 'ACTIVE'
      ? Math.max(0, Number(payment.amount) - totalAllocated)
      : 0;

    // Ambil audit logs (khusus ADMIN dan BENDAHARA)
    let auditLogs = [];
    if (!user || ['ADMIN', 'BENDAHARA'].includes(String(user.role).toUpperCase())) {
      const auditRes = await query(
        `SELECT 
          al.audit_id,
          al.action_type,
          al.reason,
          al.old_values,
          al.new_values,
          al.old_allocations,
          al.new_allocations,
          al.ip_address,
          al.created_at,
          u.name AS actor_name
         FROM payment_audit_logs al
         LEFT JOIN users u ON u.user_id = al.changed_by_user_id
         WHERE al.payment_id = $1
         ORDER BY al.created_at DESC`,
        [paymentId]
      );
      auditLogs = auditRes.rows;
    }

    return {
      ...payment,
      amount: Number(payment.amount),
      total_allocated: totalAllocated,
      unallocated_amount: unallocatedAmount,
      terbilang: terbilangRupiah(payment.amount),
      allocations,
      audit_logs: auditLogs
    };
  }

  /**
   * 7. Data Kuitansi Kasir untuk Ditampilkan & Dicetak (Q.1)
   */
  async getReceiptData(paymentId, user = null) {
    const payment = await this.getPaymentById(paymentId, user);

    // Ambil pengaturan madrasah dari finance_settings
    const settingsRes = await query(`SELECT setting_key, setting_value FROM finance_settings`);
    const settings = {};
    settingsRes.rows.forEach(r => {
      settings[r.setting_key] = r.setting_value;
    });

    return {
      receipt: {
        receipt_number: payment.receipt_number,
        receipt_issued_at: payment.receipt_issued_at,
        payment_date: payment.payment_date,
        payment_method: payment.payment_method,
        reference_number: payment.reference_number,
        notes: payment.notes,
        status: payment.status,
        is_void: payment.status === 'VOID',
        void_at: payment.void_at,
        void_reason: payment.void_reason,
        void_by: payment.void_by_name
      },
      madrasah: {
        name: settings.school_name || 'MA At-Taujih',
        treasurer: settings.treasurer_name || 'Bendahara Madrasah',
        bank_name: settings.bank_name || 'BSI',
        bank_account: settings.bank_account_number || '',
        bank_holder: settings.bank_account_holder || '',
        footer_note: settings.receipt_footer_note || 'Bukti pembayaran sah tercatat di SIMATA.'
      },
      student: {
        student_id: payment.student_id,
        name: payment.student_name,
        nisn: payment.student_nisn,
        class_name: payment.class_name
      },
      nominal: {
        amount: payment.amount,
        total_allocated: payment.total_allocated,
        unallocated_amount: payment.unallocated_amount,
        terbilang: payment.terbilang
      },
      allocations: payment.allocations.map(a => ({
        invoice_title: a.invoice_title,
        period_key: a.period_key,
        fee_category: a.fee_category_name,
        invoice_total: a.invoice_total_amount,
        allocated_amount: a.amount
      })),
      recorded_by: payment.recorded_by_name
    };
  }

  /**
   * 8. Ambil File Dokumen Privat (Bukti Transfer)
   */
  async getDocumentFile(documentId, user = null) {
    const docRes = await query(
      `SELECT doc.*, p.student_id 
       FROM finance_documents doc
       LEFT JOIN student_payments p ON p.document_id = doc.document_id
       WHERE doc.document_id = $1`,
      [documentId]
    );

    if (docRes.rows.length === 0) {
      throw new NotFoundError('Dokumen tidak ditemukan.');
    }

    const doc = docRes.rows[0];

    // IDOR Protection: jika role orang tua, cek izin
    if (user && String(user.role).toUpperCase() === 'ORANG_TUA' && doc.student_id) {
      const mapRes = await query(
        `SELECT 1 FROM parent_student_mappings WHERE parent_user_id = $1 AND student_id = $2`,
        [user.user_id, doc.student_id]
      );
      if (mapRes.rows.length === 0) {
        throw new ForbiddenError('Anda tidak memiliki akses ke dokumen ini.');
      }
    }

    const filePath = financeDocumentStorage.getDocumentPath(doc.file_name);
    return {
      filePath,
      mimeType: doc.mime_type,
      originalName: doc.original_name
    };
  }
}

module.exports = new PaymentsService();
