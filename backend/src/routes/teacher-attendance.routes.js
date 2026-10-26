const express = require('express');
const multer = require('multer');
const teacherAttendanceController = require('../controllers/teacher-attendance.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

router.use(authMiddleware);
router.use(requireGuruOrAdmin);

// Record teacher attendance with single photo (supports field 'photo' or 'file', and base64)
router.post('/', upload.single('photo'), (req, res, next) => {
  // If file was uploaded under 'file' instead of 'photo', fallback check
  if (!req.file && req.files && req.files.file) {
    req.file = req.files.file[0];
  }

  // Support base64 photo_data or photo in JSON payload
  if (!req.file && req.body && (req.body.photo_data || req.body.photo)) {
    const photoStr = req.body.photo_data || req.body.photo;
    if (typeof photoStr === 'string' && photoStr.startsWith('data:')) {
      const parts = photoStr.split(',');
      const meta = parts[0];
      const data = parts[1];
      const mimeMatch = meta.match(/data:([^;]+);base64/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const buf = Buffer.from(data, 'base64');
      req.file = {
        buffer: buf,
        originalname: 'photo.jpg',
        mimetype: mimeType,
        size: buf.length
      };
    }
  }

  teacherAttendanceController.recordWithEvidence(req, res, next);
});

router.get('/', (req, res, next) => teacherAttendanceController.list(req, res, next));
router.get('/:id', (req, res, next) => teacherAttendanceController.get(req, res, next));
router.put('/:id', (req, res, next) => teacherAttendanceController.update(req, res, next));

module.exports = router;

