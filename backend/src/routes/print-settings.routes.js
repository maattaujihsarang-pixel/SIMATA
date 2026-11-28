const express = require('express');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/role.middleware');
const { BadRequestError } = require('../errors');
const printSettingsService = require('../services/print-settings.service');
const xlsxUtil = require('../utils/xlsx.util');

const router = express.Router();

router.use(authMiddleware);

function decodePngDataUrl(dataUrl, maxBytes = 400 * 1024) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.trim().match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buf = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (buf.length < 24 || buf.length > maxBytes) return null;
  return buf;
}

function resolveLogoPngBuffer(cfg) {
  if (!cfg || cfg.show_logo === false) return null;
  const raw = String(cfg.logo_url || '').trim();
  const decoded = decodePngDataUrl(raw, 450 * 1024);
  if (decoded) return decoded;
  const publicDir = path.resolve(__dirname, '../../../public');
  const candidateRel = raw.startsWith('/assets/') ? raw.replace(/^\/+/, '') : 'assets/logo.png';
  const candidatePath = path.resolve(publicDir, candidateRel);
  if (candidatePath.startsWith(publicDir) && fs.existsSync(candidatePath)) {
    try {
      const buf = fs.readFileSync(candidatePath);
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf;
    } catch (_) {}
  }
  return null;
}

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

router.post('/export-xlsx', async (req, res, next) => {
  try {
    const body = req.body || {};
    const headers = body.headers;
    const rows = body.rows;
    if (!Array.isArray(headers) || headers.length === 0 || headers.length > 80) {
      throw new BadRequestError('Header kolom Excel tidak valid (1–80 kolom).');
    }
    if (!Array.isArray(rows) || rows.length > 5000) {
      throw new BadRequestError('Data baris Excel tidak valid (maksimal 5000 baris).');
    }

    const cfg = await printSettingsService.getPrintSettings();
    const reqOrientation = body.orientation === 'portrait' ? 'portrait' : 'landscape';
    const effectiveOrientation =
      (cfg.default_orientation === 'landscape' || cfg.default_orientation === 'portrait')
        ? cfg.default_orientation
        : reqOrientation;

    const logoPngBuffer = resolveLogoPngBuffer(cfg);
    const sigMode = cfg.signature_mode || 'qr';
    const qrPngBuffer = (sigMode === 'qr' || sigMode === 'qr_stamp')
      ? decodePngDataUrl(body.qr_png_data_url, 400 * 1024)
      : null;

    const xlsxBuffer = xlsxUtil.buildFormattedReportXlsxBuffer({
      sheetName: body.sheet_name || body.title || 'Laporan SIMATA',
      title: body.title || 'LAPORAN RESMI SIMATA',
      subtitle: body.subtitle || '',
      orientation: effectiveOrientation,
      paperSize: cfg.default_paper_size || 'A4',
      printSettings: cfg,
      metaRows: Array.isArray(body.meta_rows) ? body.meta_rows : [],
      headers,
      columns: Array.isArray(body.columns) ? body.columns : [],
      rows,
      summaryRow: (body.summary_row && typeof body.summary_row === 'object') ? body.summary_row : null,
      leftSigner: (body.left_signer && typeof body.left_signer === 'object') ? body.left_signer : null,
      includePrincipalSig: body.include_principal_sig !== false,
      logoPngBuffer,
      qrPngBuffer,
      footerNote: cfg.footer_note
    });

    const rawName = String(body.filename || 'Laporan_SIMATA.xlsx').replace(/[^A-Za-z0-9._-]+/g, '_');
    const safeFilename = rawName.toLowerCase().endsWith('.xlsx') ? rawName : `${rawName}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return res.status(200).send(xlsxBuffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
