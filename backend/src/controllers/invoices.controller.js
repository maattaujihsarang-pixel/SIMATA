const invoicesService = require('../services/invoices.service');

class InvoicesController {
  async preview(req, res, next) {
    try {
      const data = await invoicesService.previewInvoices(req.body);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async generate(req, res, next) {
    try {
      const userId = req.user.user_id;
      const data = await invoicesService.generateInvoices(req.body, userId);
      return res.status(201).json({
        status: 'success',
        message: `Berhasil menerbitkan ${data.generated_count} tagihan siswa.`,
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req, res, next) {
    try {
      const data = await invoicesService.getInvoices(req.query, req.user);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async get(req, res, next) {
    try {
      const data = await invoicesService.getInvoiceById(req.params.id, req.user);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async cancel(req, res, next) {
    try {
      const { cancellation_reason } = req.body;
      const userId = req.user.user_id;
      const data = await invoicesService.cancelInvoice(req.params.id, cancellation_reason, userId);
      return res.status(200).json({
        status: 'success',
        message: 'Tagihan siswa berhasil dibatalkan.',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  async studentSummary(req, res, next) {
    try {
      const data = await invoicesService.getStudentInvoicesSummary(req.params.studentId, req.user);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new InvoicesController();
