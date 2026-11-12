const express = require('express');
const parentMappingController = require('../controllers/parent-mapping.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireParent } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Endpoint portal orang tua untuk mengambil profil siswa binaannya (IDOR Safe)
router.get('/my-students', requireParent, (req, res, next) => parentMappingController.getMyStudents(req, res, next));

// Endpoint administratif untuk daftar akun orang tua beserta siswanya
router.get('/', requireAdmin, (req, res, next) => parentMappingController.listParents(req, res, next));

// Menghubungkan siswa ke akun orang tua
router.post('/link-student', requireAdmin, (req, res, next) => parentMappingController.linkStudent(req, res, next));

// Melepaskan hubungan siswa dari akun orang tua
router.delete('/:userId/unlink-student/:studentId', requireAdmin, (req, res, next) => parentMappingController.unlinkStudent(req, res, next));

module.exports = router;
