const schedulesService = require('../services/schedules.service');

class SchedulesController {
  async getOverview(req, res, next) {
    try {
      const data = await schedulesService.getOverview({
        academic_year_id: req.query.academic_year_id || null,
        semester: req.query.semester || null,
        user: req.user
      });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getActiveNow(req, res, next) {
    try {
      const data = await schedulesService.getActiveNowForResponder({
        teacher_id: req.query.teacher_id || null,
        day_of_week: req.query.day_of_week !== undefined ? req.query.day_of_week : null,
        time_wib: req.query.time_wib || null
      });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async upsertSlot(req, res, next) {
    try {
      const saved = await schedulesService.upsertSlots({
        ...req.body,
        userId: req.user?.user_id || null
      });
      res.status(200).json({
        success: true,
        message: `Berhasil menyimpan ${saved.length} slot jadwal.`,
        data: saved
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteSlot(req, res, next) {
    try {
      const result = await schedulesService.deleteSlot(req.params.scheduleId);
      res.status(200).json({
        success: true,
        message: 'Slot jadwal berhasil dihapus.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async clearCell(req, res, next) {
    try {
      const result = await schedulesService.clearCell(req.body);
      res.status(200).json({
        success: true,
        message: result.deleted ? 'Slot jadwal berhasil dikosongkan.' : 'Slot sudah kosong.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async upsertSubject(req, res, next) {
    try {
      const subject = await schedulesService.upsertSubject(req.body);
      res.status(200).json({
        success: true,
        message: `Mata pelajaran "${subject.name}" berhasil disimpan.`,
        data: subject
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteSubject(req, res, next) {
    try {
      const result = await schedulesService.deleteSubject(req.params.subjectId);
      res.status(200).json({
        success: true,
        message: 'Mata pelajaran berhasil dihapus.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async updatePeriods(req, res, next) {
    try {
      const updated = await schedulesService.updatePeriods(req.body);
      res.status(200).json({
        success: true,
        message: 'Pengaturan jam pelajaran & istirahat berhasil diperbarui.',
        data: updated
      });
    } catch (err) {
      next(err);
    }
  }

  async updateTeacherCode(req, res, next) {
    try {
      const updated = await schedulesService.updateTeacherShortCode(req.body);
      res.status(200).json({
        success: true,
        message: 'Kode guru berhasil diperbarui.',
        data: updated
      });
    } catch (err) {
      next(err);
    }
  }

  async copySchedule(req, res, next) {
    try {
      const result = await schedulesService.copySchedule({
        ...req.body,
        userId: req.user?.user_id || null
      });
      res.status(200).json({
        success: true,
        message: `Berhasil menyalin ${result.copied_slots} slot jadwal dari ${result.from} ke ${result.to}.`,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async importRows(req, res, next) {
    try {
      const result = await schedulesService.importRows({
        ...req.body,
        userId: req.user?.user_id || null
      });
      res.status(200).json({
        success: true,
        message: `Berhasil mengimpor ${result.imported_slots} slot jadwal.`,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async seedDefault(req, res, next) {
    try {
      const result = await schedulesService.seedDefault(req.body || {});
      res.status(200).json({
        success: true,
        message: `Seed jadwal resmi selesai (${result.matched_teachers}/19 guru terpetakan, ${result.rows_written} slot tersimpan).`,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SchedulesController();
