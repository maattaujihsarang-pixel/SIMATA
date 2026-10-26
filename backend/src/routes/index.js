const express = require('express');

const authRoutes = require('./auth.routes');
const teachersRoutes = require('./teachers.routes');
const classesRoutes = require('./classes.routes');
const studentsRoutes = require('./students.routes');
const usersRoutes = require('./users.routes');
const studentAttendanceRoutes = require('./student-attendance.routes');
const teacherAttendanceRoutes = require('./teacher-attendance.routes');
const responderRoutes = require('./responder.routes');
const evidenceRoutes = require('./evidence.routes');
const dashboardRoutes = require('./dashboard.routes');
const chatbotRoutes = require('./chatbot.routes');
const masterService = require('../services/master.service');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

// Health Check
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'SIMATA API'
  });
});

// Academic Years
router.get('/academic-years/active', authMiddleware, async (req, res, next) => {
  try {
    const year = await masterService.getActiveAcademicYear();
    res.status(200).json({ status: 'success', data: year });
  } catch (err) {
    next(err);
  }
});

router.get('/academic-years', authMiddleware, async (req, res, next) => {
  try {
    const years = await masterService.getAllAcademicYears();
    res.status(200).json({ status: 'success', data: years });
  } catch (err) {
    next(err);
  }
});

// Domain Mounts
router.use('/auth', authRoutes);
router.use('/teachers', teachersRoutes);
router.use('/classes', classesRoutes);
router.use('/students', studentsRoutes);
router.use('/users', usersRoutes);
router.use('/attendance/students', studentAttendanceRoutes);
router.use('/attendance/teachers', teacherAttendanceRoutes);
router.use('/responder', responderRoutes);
router.use('/evidences', evidenceRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/chatbot', chatbotRoutes);

module.exports = router;

