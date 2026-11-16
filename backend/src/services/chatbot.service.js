const { BadRequestError } = require('../errors');
const dashboardService = require('./dashboard.service');
const schedulesService = require('./schedules.service');

class ChatbotService {
  async processMessage(userMessage) {
    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      throw new BadRequestError('Pesan tidak boleh kosong');
    }

    const cleanMessage = userMessage.trim().substring(0, 500);
    const lower = cleanMessage.toLowerCase();

    // Schedule & School Hours query (real-time synced with Jadwal Pelajaran)
    if (lower.includes('jadwal') || lower.includes('jam') || lower.includes('pelajaran') || lower.includes('istirahat')) {
      try {
        const nowData = await schedulesService.getActiveNowForResponder({});
        const slots = Array.isArray(nowData.active_class_slots) ? nowData.active_class_slots : [];
        const dayText = nowData.is_school_day
          ? `Hari ini (${nowData.day_label}, ${nowData.time_wib} WIB)`
          : `Hari ini (${nowData.day_label}, libur KBM)`;

        let liveSummary = '';
        if (nowData.is_school_day && nowData.current_period) {
          if (nowData.current_period.is_break) {
            liveSummary = ` Saat ini sedang waktu ${nowData.current_period.label} (${nowData.current_period.start_time}–${nowData.current_period.end_time} WIB).`;
          } else if (slots.length > 0) {
            const detail = slots
              .map((s) => `${s.class_name}: ${s.subject_name}${s.teacher_name ? ` (${s.teacher_name})` : ''}`)
              .join(' | ');
            liveSummary = ` Sedang berlangsung ${nowData.current_period.label} (${nowData.current_period.start_time}–${nowData.current_period.end_time} WIB) → ${detail}.`;
          } else {
            liveSummary = ` ${dayText} mengacu pada ${nowData.current_period.label} (${nowData.current_period.start_time}–${nowData.current_period.end_time} WIB).`;
          }
        }

        return {
          reply: `Jadwal KBM MA At-Taujih Sarang aktif setiap hari Sabtu–Kamis (Jumat libur), mulai Jam ke-1 (07.00 WIB) sampai Jam ke-10 (12.50 WIB), dengan waktu Istirahat pukul 09.40–10.10 WIB.${liveSummary} Lihat tabel lengkapnya di menu Jadwal Pelajaran.`,
          intent: 'SCHEDULE_INFO'
        };
      } catch (_) {
        return {
          reply: 'Jadwal KBM MA At-Taujih Sarang aktif hari Sabtu–Kamis (Jumat libur) dari Jam ke-1 (07.00 WIB) sampai Jam ke-10 (12.50 WIB), dengan Istirahat pukul 09.40–10.10 WIB.',
          intent: 'SCHEDULE_INFO'
        };
      }
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
        reply: 'MA At-Taujih Sarang memiliki 19 guru pengampu aktif yang terjadwal pada mata pelajaran keagamaan, umum, dan bahasa.',
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
      reply: `Halo! Saya asisten virtual SIMATA (Sistem Informasi MA At-Taujih Sarang). Saya dapat membantu memberikan informasi terkait jadwal pelajaran, rekap presensi harian, daftar guru, atau rombel kelas. Ada yang bisa saya bantu?`,
      intent: 'GENERAL_ASSISTANCE'
    };
  }
}

module.exports = new ChatbotService();
