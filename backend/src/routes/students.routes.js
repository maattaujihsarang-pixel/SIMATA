const express = require('express');
const multer = require('multer');
const studentsController = require('../controllers/students.controller');
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
router.get('/:id/photo', requireGuruOrAdmin, (req, res, next) => profilePhotoController.getStudentPhoto(req, res, next));
router.get('/:id/photo/meta', requireGuruOrAdmin, (req, res, next) => profilePhotoController.getStudentMetadata(req, res, next));
router.post('/:id/photo', requireAdmin, upload.single('photo'), (req, res, next) => profilePhotoController.uploadStudentPhoto(req, res, next));
router.patch('/:id/photo/framing', requireAdmin, (req, res, next) => profilePhotoController.updateStudentFraming(req, res, next));
router.delete('/:id/photo', requireAdmin, (req, res, next) => profilePhotoController.deleteStudentPhoto(req, res, next));

// Read endpoints
router.get('/', requireGuruOrAdmin, (req, res, next) => studentsController.list(req, res, next));
router.get('/qr/:qr_code_id', requireGuruOrAdmin, (req, res, next) => studentsController.getByQr(req, res, next));
router.get('/:id', requireGuruOrAdmin, (req, res, next) => studentsController.get(req, res, next));

// Modification endpoints restricted to ADMIN
router.post('/', requireAdmin, (req, res, next) => studentsController.create(req, res, next));
router.put('/:id', requireAdmin, (req, res, next) => studentsController.update(req, res, next));
router.patch('/:id/status', requireAdmin, (req, res, next) => studentsController.updateStatus(req, res, next));
router.delete('/:id', requireAdmin, (req, res, next) => studentsController.delete(req, res, next));

module.exports = router;


