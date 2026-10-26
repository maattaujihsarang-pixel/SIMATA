const { BadRequestError } = require('../errors');
const dashboardService = require('./dashboard.service');

class ChatbotService {
  async processMessage(userMessage) {
    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      throw new BadRequestError('Pesan tidak boleh kosong');
    }

    const cleanMessage = userMessage.trim().substring(0, 500); // Limit input length
    const lower = cleanMessage.toLowerCase();

    // Check for common madrasah queries
    if (lower.includes('jadwal') || lower.includes('jam')) {
      return {
        reply: 'Jam pelajaran di MA At-Taujih Sarang dimulai dari Jam ke-1 (07.00 WIB) sampai Jam ke-10 (14.30 WIB). Pastikan presensi dicatat tepat waktu pada setiap pergantian jam pelajaran.',
        intent: 'SCHEDULE_INFO'
      };
    }

    if (lower.includes('absen') || lower.includes('presensi') || lower.includes('hadir')) {
      const summary = await dashboardService.getDashboardSummary();
      return {
        reply: `Informasi Presensi Hari Ini (${summary.date}): Siswa Hadir: ${summary.student_attendance.hadir}, Izin: ${summary.student_attendance.izin}, Sakit: ${summary.student_attendance.sakit}, Alpa: ${summary.student_attendance.alpa}. Total Guru Mengajar: ${summary.teacher_attendance.teachers_present} orang.`,
        intent: 'ATTENDANCE_SUMMARY'
      };
    }

    if (lower.includes('guru') || lower.includes('pengajar')) {
      return {
        reply: 'MA At-Taujih Sarang memiliki 19 guru pengampu yang aktif untuk berbagai mata pelajaran keagamaan dan umum.',
        intent: 'TEACHER_INFO'
      };
    }

    if (lower.includes('kelas') || lower.includes('rombel')) {
      return {
        reply: 'Saat ini terdapat 3 rombongan belajar aktif pada Tahun Ajaran 2026/2027: Kelas 10, Kelas 11, dan Kelas 12.',
        intent: 'CLASS_INFO'
      };
    }

    return {
      reply: `Halo! Saya asisten virtual SIMATA (Sistem Informasi MA At-Taujih Sarang). Saya dapat membantu memberikan informasi terkait jadwal madrasah, rekap presensi harian, daftar guru, atau rombel kelas. Ada yang bisa saya bantu?`,
      intent: 'GENERAL_ASSISTANCE'
    };
  }
}

module.exports = new ChatbotService();

