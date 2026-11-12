const express = require('express');
const multer = require('multer');
const paymentsController = require('../controllers/payments.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireRole, requireFinanceStaff } = require('../middleware/role.middleware');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

// Seluruh rute pembayaran memerlukan autentikasi aktif
router.use(authMiddleware);

// 1. Dokumen Bukti Transfer (Download privat)
router.get(
  '/documents/:documentId/download',
  requireRole('ADMIN', 'BENDAHARA', 'ORANG_TUA'),
  (req, res, next) => paymentsController.downloadDocument(req, res, next)
);

// 2. Daftar & Detail Pembayaran (Read-only terbuka untuk Admin, Bendahara, dan Orang Tua - Guru ditolak)
router.get(
  '/',
  requireRole('ADMIN', 'BENDAHARA', 'ORANG_TUA'),
  (req, res, next) => paymentsController.getPayments(req, res, next)
);

router.get(
  '/:id',
  requireRole('ADMIN', 'BENDAHARA', 'ORANG_TUA'),
  (req, res, next) => paymentsController.getPaymentById(req, res, next)
);

router.get(
  '/:id/receipt',
  requireRole('ADMIN', 'BENDAHARA', 'ORANG_TUA'),
  (req, res, next) => paymentsController.getReceipt(req, res, next)
);

// 3. Mutasi Pembayaran (Hanya ADMIN dan BENDAHARA)
router.post(
  '/',
  requireFinanceStaff,
  upload.single('file'),
  (req, res, next) => paymentsController.recordPayment(req, res, next)
);

router.post(
  '/:id/allocate',
  requireFinanceStaff,
  (req, res, next) => paymentsController.allocatePayment(req, res, next)
);

router.put(
  '/:id',
  requireFinanceStaff,
  (req, res, next) => paymentsController.updatePayment(req, res, next)
);

// Dukung PATCH dan POST untuk pembatalan / VOID
router.patch(
  '/:id/void',
  requireFinanceStaff,
  (req, res, next) => paymentsController.voidPayment(req, res, next)
);

router.post(
  '/:id/void',
  requireFinanceStaff,
  (req, res, next) => paymentsController.voidPayment(req, res, next)
);

module.exports = router;
