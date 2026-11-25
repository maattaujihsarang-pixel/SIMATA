const gradesService = require('../services/grades.service');

class GradesController {
  async getOverview(req, res, next) {
    try {
      const data = await gradesService.getOverview(req.query || {}, req.user);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  async getStudentKhs(req, res, next) {
    try {
      const data = await gradesService.getStudentKhs(req.params.studentId, req.query || {}, req.user);
      res.status(200).json({ status: 'success', data });
    } catch (err) {
      next(err);
    }
  }

  async saveBatchGrades(req, res, next) {
    try {
      const data = await gradesService.saveBatchGrades(req.body || {}, req.user);
      res.status(200).json({
        status: 'success',
        message: `Berhasil menyimpan ${data.saved_count} nilai mata pelajaran ${data.subject_name}.`,
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async updateSubjectKkm(req, res, next) {
    try {
      const data = await gradesService.updateSubjectKkm(req.body || {});
      res.status(200).json({
        status: 'success',
        message: `KKM ${data.subject_name} diperbarui menjadi ${data.kkm}.`,
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async updatePeriodPublication(req, res, next) {
    try {
      const data = await gradesService.updatePeriodPublication(req.body || {}, req.user);
      res.status(200).json({
        status: 'success',
        message: data.is_published
          ? 'Nilai periode ini berhasil diterbitkan untuk Orang Tua / Wali Murid.'
          : 'Publikasi nilai ke Orang Tua ditarik kembali ke mode Draft Internal.',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStudentNote(req, res, next) {
    try {
      const data = await gradesService.updateStudentNote(req.body || {}, req.user);
      res.status(200).json({
        status: 'success',
        message: 'Catatan Wali Kelas berhasil disimpan.',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async updatePortalSettings(req, res, next) {
    try {
      const data = await gradesService.updatePortalSettings(req.body || {}, req.user);
      res.status(200).json({
        status: 'success',
        message: 'Pengaturan Portal RDM & Cetak Nilai berhasil disimpan.',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async seedAstsGanjil(req, res, next) {
    try {
      const data = await gradesService.seedOfficialAstsGanjil2026(req.user);
      res.status(200).json({
        status: 'success',
        message: `Data awal ASTS Ganjil berhasil dimuat (${data.seeded_students} siswa, ${data.seeded_grades} nilai).`,
        data
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new GradesController();
