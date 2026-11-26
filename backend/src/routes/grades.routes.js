const express = require('express');
const gradesController = require('../controllers/grades.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdmin, requireGuruOrAdmin, requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authMiddleware);

// Read endpoints (Admin, Guru, and Orang Tua with strict server-side child & publication filtering)
router.get('/overview', requireRole('ADMIN', 'GURU', 'ORANG_TUA'), (req, res, next) =>
  gradesController.getOverview(req, res, next)
);
router.get('/student/:studentId/khs', requireRole('ADMIN', 'GURU', 'ORANG_TUA'), (req, res, next) =>
  gradesController.getStudentKhs(req, res, next)
);

// Teacher & Admin grade entry, KKM per mapel, homeroom notes, and period publication
router.post('/batch', requireGuruOrAdmin, (req, res, next) =>
  gradesController.saveBatchGrades(req, res, next)
);
router.put('/kkm', requireGuruOrAdmin, (req, res, next) =>
  gradesController.updateSubjectKkm(req, res, next)
);
router.put('/publish', requireGuruOrAdmin, (req, res, next) =>
  gradesController.updatePeriodPublication(req, res, next)
);
router.put('/student-note', requireGuruOrAdmin, (req, res, next) =>
  gradesController.updateStudentNote(req, res, next)
);

// Admin-only: RDM Portal Link & Principal configuration + Official ASTS Ganjil seed + Academic Year Archives
router.put('/portal-settings', requireAdmin, (req, res, next) =>
  gradesController.updatePortalSettings(req, res, next)
);
router.post('/seed-asts-ganjil', requireAdmin, (req, res, next) =>
  gradesController.seedAstsGanjil(req, res, next)
);
router.get('/academic-years', requireGuruOrAdmin, (req, res, next) =>
  gradesController.listAcademicYears(req, res, next)
);
router.post('/academic-years', requireAdmin, (req, res, next) =>
  gradesController.createAcademicYear(req, res, next)
);
router.put('/academic-years/archive', requireAdmin, (req, res, next) =>
  gradesController.setYearArchive(req, res, next)
);
router.put('/academic-years/activate', requireAdmin, (req, res, next) =>
  gradesController.activateAcademicYear(req, res, next)
);

module.exports = router;
