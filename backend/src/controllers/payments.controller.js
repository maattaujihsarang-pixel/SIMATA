const paymentsService = require('../services/payments.service');
const fs = require('fs');

class PaymentsController {
  /**
   * POST /api/v1/finance/payments
   * Catat pembayaran baru (CASH / BANK_TRANSFER) + alokasi opsional + bukti transfer opsional
   */
  async recordPayment(req, res, next) {
    try {
      const meta = {
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('user-agent')
      };

      const result = await paymentsService.recordPayment({
        ...req.body,
        file: req.file || null,
        user: req.user,
        meta
      });

      res.status(201).json({
        status: 'success',
        message: 'Pembayaran berhasil dicatat.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/finance/payments/:id/allocate
   * Alokasi lanjutan sisa pembayaran ke tagihan (Q.4)
   */
  async allocatePayment(req, res, next) {
    try {
      const meta = {
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('user-agent')
      };

      const result = await paymentsService.allocatePayment({
        paymentId: req.params.id,
        allocations: req.body.allocations,
        user: req.user,
        meta
      });

      res.status(200).json({
        status: 'success',
        message: 'Alokasi pembayaran berhasil diperbarui.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/finance/payments/:id
   * Koreksi data pembayaran biasa (Edit with Audit)
   */
  async updatePayment(req, res, next) {
    try {
      const meta = {
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('user-agent')
      };

      const result = await paymentsService.updatePayment({
        paymentId: req.params.id,
        payment_date: req.body.payment_date,
        amount: req.body.amount,
        payment_method: req.body.payment_method,
        reference_number: req.body.reference_number,
        notes: req.body.notes,
        reason: req.body.reason,
        user: req.user,
        meta
      });

      res.status(200).json({
        status: 'success',
        message: 'Data pembayaran berhasil dikoreksi.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/finance/payments/:id/void & POST /api/v1/finance/payments/:id/void
   * Batalkan pembayaran secara permanen (VOID)
   */
  async voidPayment(req, res, next) {
    try {
      const meta = {
        ip: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('user-agent')
      };

      const result = await paymentsService.voidPayment({
        paymentId: req.params.id,
        reason: req.body.reason,
        user: req.user,
        meta
      });

      res.status(200).json({
        status: 'success',
        message: 'Pembayaran berhasil dibatalkan (VOID).',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/finance/payments
   * Daftar pembayaran dengan filter, pencarian, dan pagination
   */
  async getPayments(req, res, next) {
    try {
      const result = await paymentsService.getPayments(req.query, req.user);
      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: result.pagination
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/finance/payments/:id
   * Detail pembayaran tunggal lengkap dengan histori alokasi dan audit trail
   */
  async getPaymentById(req, res, next) {
    try {
      const result = await paymentsService.getPaymentById(req.params.id, req.user);
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/finance/payments/:id/receipt
   * Ambil data cetak kuitansi resmi kasir madrasah (Q.1)
   */
  async getReceipt(req, res, next) {
    try {
      const result = await paymentsService.getReceiptData(req.params.id, req.user);
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/finance/documents/:documentId/download
   * Unduh file bukti transfer (privat & terautentikasi)
   */
  async downloadDocument(req, res, next) {
    try {
      const { filePath, mimeType, originalName } = await paymentsService.getDocumentFile(
        req.params.documentId,
        req.user
      );

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          status: 'fail',
          message: 'Berkas bukti fisik tidak ditemukan di server.'
        });
      }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PaymentsController();
