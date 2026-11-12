const express = require('express');
const financeSettingsController = require('../controllers/finance-settings.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireFinanceStaff } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Membaca pengaturan keuangan (Staff Keuangan: Admin & Bendahara)
router.get('/', requireFinanceStaff, (req, res, next) => financeSettingsController.getSettings(req, res, next));

// Memperbarui pengaturan keuangan (Staff Keuangan: Admin & Bendahara)
router.put('/', requireFinanceStaff, (req, res, next) => financeSettingsController.updateSettings(req, res, next));

module.exports = router;
