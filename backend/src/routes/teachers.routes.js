const express = require('express');
const multer = require('multer');
const teachersController = require('../controllers/teachers.controller');
const profilePhotoController = require('../controllers/profile-photo.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireGuruOrAdmin } = require('../middleware/role.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(authMiddleware);

// Profile photo endpoints
router.get('/:id/photo', requireGuruOrAdmin, (req, res, next) => profilePhotoController.getTeacherPhoto(req, res, next));
router.get('/:id/photo/meta', requireGuruOrAdmin, (req, res, next) => profilePhotoController.getTeacherMetadata(req, res, next));
router.post('/:id/photo', requireAdmin, upload.single('photo'), (req, res, next) => profilePhotoController.uploadTeacherPhoto(req, res, next));
router.patch('/:id/photo/framing', requireAdmin, (req, res, next) => profilePhotoController.updateTeacherFraming(req, res, next));
router.delete('/:id/photo', requireAdmin, (req, res, next) => profilePhotoController.deleteTeacherPhoto(req, res, next));

// Read endpoints accessible by GURU and ADMIN
router.get('/', requireGuruOrAdmin, (req, res, next) => teachersController.list(req, res, next));
router.get('/:id', requireGuruOrAdmin, (req, res, next) => teachersController.get(req, res, next));

// Modification endpoints restricted to ADMIN
router.post('/', requireAdmin, (req, res, next) => teachersController.create(req, res, next));
router.put('/:id', requireAdmin, (req, res, next) => teachersController.update(req, res, next));
router.patch('/:id/status', requireAdmin, (req, res, next) => teachersController.updateStatus(req, res, next));
router.delete('/:id', requireAdmin, (req, res, next) => teachersController.delete(req, res, next));

module.exports = router;


