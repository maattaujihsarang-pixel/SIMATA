/**
 * SIMATA Chatbot Read-Only Data Context Module
 * AI-02 — GEMINI SIMATA KNOWLEDGE + FAQ + READ-ONLY DATA
 * 
 * Tanggung Jawab:
 * - Menentukan intent pertanyaan secara selektif (selective context).
 * - Menghindari query database jika pertanyaan bersifat knowledge-only (misal: "Apa itu SIMATA?").
 * - Mengambil fakta aktual (siswa, guru, kelas, presensi siswa/guru) hanya jika relevan dengan pertanyaan.
 * - Sanitasi data ketat: TIDAK pernah menyertakan password, token, API key, NIK, phone, email, atau private Drive URL.
 * - Penentuan tanggal server-side (hari ini / kemarin) sesuai timezone aplikasi.
 * - Berjalan di atas helper abstraksi existing (getStudents, getTeachers, getClasses, getStudentAttendance, getTeacherAttendance).
 */

/**
 * Mendeteksi kebutuhan data aktual secara selektif berdasarkan teks prompt pengguna.
 * Menghindari database query yang tidak diperlukan.
 * 
 * @param {string} prompt - Teks pertanyaan user
 * @return {Object} Intent flags
 */
function detectChatbotDataIntent(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return {
      isKnowledgeOnly: true,
      needsStudents: false,
      needsClasses: false,
      needsTeachers: false,
      needsStudentAttendance: false,
      needsTeacherAttendance: false,
      targetDate: null
    };
  }

  const p = prompt.toLowerCase();

  // Keyword check untuk penentuan tanggal (server-side)
  let targetDate = null;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  
  if (p.indexOf("kemarin") !== -1) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    targetDate = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } else if (p.indexOf("hari ini") !== -1 || p.indexOf("sekarang") !== -1) {
    targetDate = today;
  } else {
    // Cek apakah ada format YYYY-MM-DD
    const dateMatch = p.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (dateMatch) {
      targetDate = dateMatch[0];
    } else {
      // Default jika menanyakan presensi tanpa tanggal spesifik: gunakan hari ini
      targetDate = today;
    }
  }

  // Kata kunci indikator data presensi / absensi
  const hasAttendanceKeyword = (
    p.indexOf("hadir") !== -1 ||
    p.indexOf("presensi") !== -1 ||
    p.indexOf("absen") !== -1 ||
    p.indexOf("kehadiran") !== -1 ||
    p.indexOf("tidak hadir") !== -1 ||
    p.indexOf("belum hadir") !== -1 ||
    p.indexOf("alpa") !== -1 ||
    p.indexOf("sakit") !== -1 ||
    p.indexOf("izin") !== -1
  );

  // Kata kunci indikator guru
  const hasTeacherKeyword = (
    p.indexOf("guru") !== -1 ||
    p.indexOf("ustadz") !== -1 ||
    p.indexOf("pengajar") !== -1 ||
    p.indexOf("wali kelas") !== -1
  );

  // Kata kunci indikator siswa / kelas
  const hasStudentKeyword = (
    p.indexOf("siswa") !== -1 ||
    p.indexOf("murid") !== -1 ||
    p.indexOf("santri") !== -1 ||
    p.indexOf("peserta didik") !== -1 ||
    p.indexOf("kelas 10") !== -1 ||
    p.indexOf("kelas 11") !== -1 ||
    p.indexOf("kelas 12") !== -1 ||
    p.indexOf("rombel") !== -1
  );

  // Pertanyaan definisi murni (Knowledge-only)
  const isPureDefinition = (
    (p.indexOf("apa itu") === 0 || p.indexOf("apakah yang dimaksud") === 0 || p.indexOf("jelaskan") === 0 || p.indexOf("bagaimana cara") === 0) &&
    !hasAttendanceKeyword &&
    p.indexOf("berapa") === -1 &&
    p.indexOf("siapa saja") === -1 &&
    p.indexOf("daftar") === -1
  );

  if (isPureDefinition && !p.includes("berapa") && !p.includes("siapa")) {
    return {
      isKnowledgeOnly: true,
      needsStudents: false,
      needsClasses: false,
      needsTeachers: false,
      needsStudentAttendance: false,
      needsTeacherAttendance: false,
      targetDate: null
    };
  }

  // Cek apakah memerlukan data Guru
  const needsTeacherAttendance = hasTeacherKeyword && hasAttendanceKeyword;
  const needsTeachers = hasTeacherKeyword || (p.indexOf("wali kelas") !== -1);

  // Cek apakah memerlukan data Siswa
  const needsStudentAttendance = (hasStudentKeyword || p.indexOf("siapa yang belum") !== -1 || p.indexOf("siapa yang tidak") !== -1) && hasAttendanceKeyword;
  const needsStudents = hasStudentKeyword || needsStudentAttendance || p.indexOf("jumlah siswa") !== -1 || p.indexOf("daftar siswa") !== -1;
  const needsClasses = needsStudents || needsStudentAttendance;

  // Jika tidak ada kata kunci data aktual yang cocok, anggap knowledge-only
  const hasAnyDataNeed = needsStudents || needsTeachers || needsStudentAttendance || needsTeacherAttendance;

  return {
    isKnowledgeOnly: !hasAnyDataNeed,
    needsStudents: needsStudents,
    needsClasses: needsClasses,
    needsTeachers: needsTeachers,
    needsStudentAttendance: needsStudentAttendance,
    needsTeacherAttendance: needsTeacherAttendance,
    targetDate: hasAnyDataNeed ? targetDate : null
  };
}

/**
 * Mengambil konteks data aktual SIMATA secara selektif dan aman (READ-ONLY).
 * Hanya dieksekusi jika sesi pengguna valid.
 * 
 * @param {string} token - Session token login user
 * @param {string} prompt - Teks pertanyaan user
 * @return {Object} { success: boolean, hasData: boolean, contextText: string, targetDate?: string, unauthorized?: boolean }
 */
function getSimataReadOnlyContext(token, prompt) {
  // Step 1: Validasi Sesi Pengguna
  if (!token || typeof token !== "string" || token.trim() === "") {
    return {
      success: false,
      unauthorized: true,
      message: "Token sesi tidak ditemukan. Akses data ditolak."
    };
  }

  const sessionCheck = validateSession(token);
  if (!sessionCheck || !sessionCheck.valid) {
    return {
      success: false,
      unauthorized: true,
      message: "Sesi login tidak valid atau telah berakhir. Akses data ditolak."
    };
  }

  // Step 2: Deteksi Kebutuhan Konteks secara Selektif
  const intent = detectChatbotDataIntent(prompt);

  // Jika pertanyaan bersifat knowledge-only (misal: "Apa itu SIMATA?"), JANGAN query database!
  if (intent.isKnowledgeOnly) {
    return {
      success: true,
      hasData: false,
      contextText: "Tidak ada data database yang diperlukan untuk pertanyaan ini (pertanyaan konseptual/knowledge-base).",
      intent: intent
    };
  }

  const lines = [];
  const targetDate = intent.targetDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  lines.push("Data Aktual SIMATA (Per Tanggal: " + targetDate + "):");

  let fetchedAny = false;

  // 1. Data Kelas (jika relevan)
  const classMap = {};
  if (intent.needsClasses) {
    try {
      const clsRes = getClasses();
      if (clsRes && clsRes.success && Array.isArray(clsRes.classes)) {
        clsRes.classes.forEach(function(c) {
          if (c.classId) {
            classMap[c.classId] = c.className || c.classId;
          }
        });
        lines.push("- Total Kelas Aktif: " + clsRes.classes.length + " (" + clsRes.classes.map(function(c) { return c.className; }).join(", ") + ")");
        fetchedAny = true;
      }
    } catch (e) {
      // safe fallback
    }
  }

  // 2. Data Siswa (jika relevan)
  if (intent.needsStudents) {
    try {
      const stdRes = getStudents();
      if (stdRes && stdRes.success && Array.isArray(stdRes.students)) {
        // Hanya ambil field aman: studentId, nis, name, gender, classId, status
        const activeStudents = stdRes.students.filter(function(s) {
          return !s.status || String(s.status).toLowerCase() === "active" || String(s.status).toLowerCase() === "aktif";
        });
        lines.push("- Total Siswa Terdaftar: " + stdRes.students.length + " (Siswa Aktif: " + activeStudents.length + ")");
        
        // Ringkasan jumlah siswa per kelas
        const countByClass = {};
        activeStudents.forEach(function(s) {
          const cName = classMap[s.classId] || s.classId || "Tanpa Kelas";
          countByClass[cName] = (countByClass[cName] || 0) + 1;
        });
        const classBreakdown = Object.keys(countByClass).map(function(cn) {
          return cn + ": " + countByClass[cn] + " siswa";
        }).join("; ");
        if (classBreakdown) {
          lines.push("- Jumlah Siswa per Kelas: " + classBreakdown);
        }

        // Jika pertanyaan spesifik menanyakan nama siswa atau mencari seseorang
        if (prompt.length < 100 && (prompt.toLowerCase().indexOf("siapa") !== -1 || prompt.toLowerCase().indexOf("daftar") !== -1)) {
          const sampleList = activeStudents.slice(0, 30).map(function(s) {
            return s.name + " (" + (classMap[s.classId] || s.classId) + ")";
          }).join(", ");
          lines.push("- Contoh Siswa: " + sampleList + (activeStudents.length > 30 ? " ... (dan lainnya)" : ""));
        }

        fetchedAny = true;
      }
    } catch (e) {
      // safe fallback
    }
  }

  // 3. Data Presensi Siswa (jika relevan)
  if (intent.needsStudentAttendance) {
    try {
      const attRes = getStudentAttendance({ date: targetDate });
      if (attRes && attRes.success && Array.isArray(attRes.attendances)) {
        const atts = attRes.attendances;
        let hadir = 0, izin = 0, sakit = 0, alpa = 0;
        atts.forEach(function(a) {
          const st = String(a.status || "").toLowerCase();
          if (st === "hadir" || st === "h") hadir++;
          else if (st === "izin" || st === "i") izin++;
          else if (st === "sakit" || st === "s") sakit++;
          else if (st === "alpa" || st === "a") alpa++;
        });
        lines.push("- Presensi Siswa (" + targetDate + "): Total Terisi = " + atts.length +
                   " [Hadir: " + hadir + ", Izin: " + izin + ", Sakit: " + sakit + ", Alpa: " + alpa + "]");
        fetchedAny = true;
      } else {
        lines.push("- Presensi Siswa (" + targetDate + "): Belum ada data presensi siswa yang dicatat untuk tanggal ini.");
        fetchedAny = true;
      }
    } catch (e) {
      lines.push("- Presensi Siswa: Gagal memuat data presensi.");
    }
  }

  // 4. Data Guru (jika relevan)
  if (intent.needsTeachers) {
    try {
      const tchRes = getTeachers();
      if (tchRes && tchRes.success && Array.isArray(tchRes.teachers)) {
        // Field aman saja: teacherId, nip, name, position, subject, status
        const activeTeachers = tchRes.teachers.filter(function(t) {
          return !t.status || String(t.status).toLowerCase() === "active" || String(t.status).toLowerCase() === "aktif";
        });
        lines.push("- Total Guru Terdaftar: " + tchRes.teachers.length + " (Guru Aktif: " + activeTeachers.length + ")");
        
        const teacherList = activeTeachers.map(function(t) {
          return t.name + (t.subject ? " (Mapel: " + t.subject + ")" : "");
        }).join("; ");
        lines.push("- Daftar Guru & Mapel: " + (teacherList || "Belum ada data guru"));
        fetchedAny = true;
      }
    } catch (e) {
      // safe fallback
    }
  }

  // 5. Data Presensi Guru (jika relevan)
  if (intent.needsTeacherAttendance) {
    try {
      const tAttRes = getTeacherAttendance({ date: targetDate });
      if (tAttRes && tAttRes.success && Array.isArray(tAttRes.attendances)) {
        const tAtts = tAttRes.attendances;
        lines.push("- Presensi Mengajar Guru (" + targetDate + "): Total Sesi Mengajar = " + tAtts.length);
        if (tAtts.length > 0) {
          const detailList = tAtts.map(function(ta) {
            return "- Guru ID " + ta.teacherId + " mengajar kelas " + (ta.className || ta.classId) + " Jam ke-" + (ta.period || "-") + " Mapel: " + (ta.subject || "-") + " (Materi: " + (ta.materi || "-") + ")";
          }).join("\n  ");
          lines.push("  Detail Sesi Guru Hari Ini:\n  " + detailList);
        } else {
          lines.push("- Catatan: Belum ada guru yang melakukan presensi mengajar via Responder pada tanggal " + targetDate + ".");
        }
        fetchedAny = true;
      } else {
        lines.push("- Catatan: Belum ada data presensi guru yang tercatat untuk tanggal " + targetDate + ".");
        fetchedAny = true;
      }
    } catch (e) {
      lines.push("- Presensi Guru: Gagal memuat data presensi guru.");
    }
  }

  return {
    success: true,
    hasData: fetchedAny,
    targetDate: targetDate,
    intent: intent,
    contextText: lines.join("\n")
  };
}

