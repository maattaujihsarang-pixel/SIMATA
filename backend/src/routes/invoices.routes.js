const express = require('express');
const invoicesController = require('../controllers/invoices.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireFinanceStaff } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Preview target & total nominal (Staff Keuangan: Admin & Bendahara)
router.post('/preview', requireFinanceStaff, (req, res, next) => invoicesController.preview(req, res, next));

// Penerbitan tagihan secara massal/atomik (Staff Keuangan: Admin & Bendahara)
router.post('/generate', requireFinanceStaff, (req, res, next) => invoicesController.generate(req, res, next));

// Membatalkan tagihan siswa (Staff Keuangan: Admin & Bendahara)
router.patch('/:id/cancel', requireFinanceStaff, (req, res, next) => invoicesController.cancel(req, res, next));

// Ringkasan tagihan per siswa (Didukung proteksi Anti-IDOR untuk ORANG_TUA)
router.get('/students/:studentId/summary', (req, res, next) => invoicesController.studentSummary(req, res, next));

// Daftar tagihan & detail tagihan (Didukung filter & proteksi Anti-IDOR untuk ORANG_TUA)
router.get('/', (req, res, next) => invoicesController.list(req, res, next));
router.get('/:id', (req, res, next) => invoicesController.get(req, res, next));

module.exports = router;
