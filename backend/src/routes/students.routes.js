const express = require('express');
const multer = require('multer');
const studentsController = require('../controllers/students.controller');
const profilePhotoController = require('../controllers/profile-photo.controller');
const studentDocumentController = require('../controllers/student-document.controller');
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

// Document endpoints (FEATURE 004 - Kartu Pelajar)
router.get('/:id/documents/kartu-pelajar', requireGuruOrAdmin, (req, res, next) => studentDocumentController.getStudentKartuPelajar(req, res, next));
router.get('/:id/documents/kartu-pelajar/meta', requireGuruOrAdmin, (req, res, next) => studentDocumentController.getStudentKartuPelajarMeta(req, res, next));
router.post('/:id/documents/kartu-pelajar', requireAdmin, upload.single('document'), (req, res, next) => studentDocumentController.uploadStudentKartuPelajar(req, res, next));
router.put('/:id/documents/kartu-pelajar', requireAdmin, upload.single('document'), (req, res, next) => studentDocumentController.uploadStudentKartuPelajar(req, res, next));
router.delete('/:id/documents/kartu-pelajar', requireAdmin, (req, res, next) => studentDocumentController.deleteStudentKartuPelajar(req, res, next));

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


