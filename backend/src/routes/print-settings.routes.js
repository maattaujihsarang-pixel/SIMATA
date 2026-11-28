const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/role.middleware');
const printSettingsService = require('../services/print-settings.service');

const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const data = await printSettingsService.getPrintSettings();
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const data = await printSettingsService.updatePrintSettings(req.body || {}, req.user);
    res.status(200).json({
      status: 'success',
      message: 'Pengaturan cetak SIMATA berhasil disimpan.',
      data
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
