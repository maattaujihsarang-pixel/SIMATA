/**
 * SIMATA Chatbot Knowledge Base & FAQ Module
 * AI-02 — GEMINI SIMATA KNOWLEDGE + FAQ + READ-ONLY DATA
 * 
 * Tanggung Jawab:
 * - Menyediakan sumber kebenaran terstruktur mengenai sistem SIMATA (MA At-Taujih Sarang).
 * - Berisi definisi identitas, tujuan, role pengguna, modul aplikasi, terminologi, alur kerja, FAQ resmi (17 butir), dan troubleshooting.
 * - Desain modular sehingga section dapat dipanggil secara spesifik/selektif tanpa monolithic prompt.
 * 
 * ATURAN KEAMANAN:
 * - Tidak mengandung API key, token, kredensial, password, atau URL private.
 * - Murni berisi pengetahuan konseptual & operasional sistem yang diaudit dari codebase.
 */

var SIMATA_KNOWLEDGE = {
  identity: {
    name: "SIMATA",
    fullName: "Sistem Informasi MA At-Taujih",
    institution: "MA At-Taujih Sarang",
    description: "Sistem informasi administrasi akademik dan manajemen presensi madrasah berbasis Google Apps Script dan Google Sheets untuk MA At-Taujih Sarang."
  },

  purpose: {
    summary: "SIMATA dirancang untuk digitalisasi dan otomatisasi tata kelola madrasah, presensi harian, dan monitoring kegiatan belajar mengajar.",
    features: [
      "Pengelolaan master data Siswa (NIS, NISN, nama, jenis kelamin, kelas, status aktif).",
      "Pengelolaan master data Guru (NIP, NUPTK, nama, mata pelajaran, jabatan, status aktif).",
      "Pengelolaan data Rombongan Belajar / Kelas (Class ID, nama kelas, tingkat, wali kelas).",
      "Pencatatan presensi siswa harian dan per jam pelajaran (status: Hadir, Izin, Sakit, Alpa).",
      "Pencatatan presensi mengajar guru secara mandiri via Responder dengan verifikasi kamera (foto bukti fisik).",
      "Penyimpanan dan pengarsipan foto bukti kehadiran guru ke Google Drive secara otomatis (AttendanceEvidence).",
      "Rekapitulasi presensi siswa dan guru dalam format matriks harian/bulanan serta ekspor/cetak laporan PDF.",
      "Pengelolaan jurnal mengajar dan pencatatan materi pembelajaran yang disampaikan guru di kelas.",
      "Pengelolaan nilai akademik siswa.",
      "Panel Pengaturan sistem, profil akun pengguna, dan audit verifikasi bukti foto responder bagi Administrator.",
      "Dashboard statistik madrasah untuk memantau ringkasan jumlah siswa, guru, kelas, dan kehadiran harian."
    ]
  },

  roles: {
    Admin: {
      title: "Administrator",
      description: "Pengguna dengan hak akses penuh ke seluruh modul, konfigurasi, dan master data SIMATA.",
      capabilities: [
        "Mengelola data master: menambah, mengubah, dan menghapus data Siswa, Guru, dan Kelas.",
        "Mengelola akun pengguna dan hak akses di Pengaturan Keamanan.",
        "Melihat seluruh laporan dan monitoring presensi sekolah (Presensi Siswa dan Presensi Guru).",
        "Mengakses panel audit 'Bukti Foto Responder Guru' di Pengaturan untuk memverifikasi foto kehadiran guru.",
        "Dapat bertindak sebagai Responder presensi guru jika diperlukan."
      ],
      menuAccess: [
        "Dashboard", "Responder", "Presensi Siswa", "Presensi Guru",
        "Rekap & Cetak", "Guru", "Siswa", "Nilai", "Kelas", "Pengaturan (Akun, Akses, Keamanan, Bukti Foto)"
      ]
    },
    Guru: {
      title: "Guru Pengajar",
      description: "Tenaga pendidik dengan hak akses operasional mengajar, presensi kelas, dan profil pribadi.",
      capabilities: [
        "Menjalankan presensi mengajar via modul Responder dengan pengambilan foto kamera langsung di kelas.",
        "Mengisi informasi mata pelajaran dan materi pembelajaran yang diajarkan pada jam pelajaran terkait.",
        "Melihat dan mencatat presensi siswa untuk kelas yang diajar.",
        "Melihat rekapitulasi presensi dan mencetak laporan presensi kelas.",
        "Mengakses pengaturan profil akun personal (username, nama, peran)."
      ],
      restrictions: [
        "Tidak dapat menambah, mengubah, atau menghapus master data Guru, Siswa, dan Kelas.",
        "Tidak dapat mengakses menu monitoring 'Presensi Guru' (khusus Admin).",
        "Tidak dapat mengakses tab 'Keamanan' dan tab 'Bukti Foto Responder Guru' pada menu Pengaturan."
      ],
      menuAccess: [
        "Dashboard", "Responder", "Presensi Siswa", "Rekap & Cetak", "Pengaturan (Akun Pribadi)"
      ]
    }
  },

  modules: {
    dashboard: {
      id: "menu-dashboard",
      name: "Dashboard",
      description: "Pusat informasi utama yang menampilkan statistik ringkas madrasah: jumlah total siswa, jumlah guru, jumlah kelas aktif, dan total kehadiran hari ini."
    },
    responder: {
      id: "menu-responder",
      name: "Responder",
      description: "Antarmuka presensi mandiri guru dengan kamera capture langsung real-time. Guru memilih identitas, kelas yang diajar, jam pelajaran (periode 1–10), mata pelajaran, materi ajar, dan mengambil foto fisik di kelas sebelum mengirimkan presensi."
    },
    studentAttendance: {
      id: "menu-attendance",
      name: "Presensi Siswa",
      description: "Modul pencatatan status kehadiran siswa (Hadir, Izin, Sakit, Alpa) berdasarkan tanggal dan kelas."
    },
    teacherAttendance: {
      id: "menu-teacher-attendance",
      name: "Presensi Guru",
      description: "Modul monitoring riwayat presensi mengajar guru sekolah secara komprehensif per tanggal, kelas, dan jam pelajaran (khusus Administrator)."
    },
    rekapAndPrint: {
      id: "menu-journal",
      name: "Rekap & Cetak",
      description: "Modul rekapitulasi presensi (siswa dan guru) dengan filter tanggal dan kelas, visualisasi matriks jam pelajaran 1–10, serta fitur cetak/ekspor PDF resmi."
    },
    teachers: {
      id: "menu-teachers",
      name: "Guru",
      description: "Pengelolaan direktori master data guru (NIP, NUPTK, nama, mata pelajaran, jabatan, jam mengajar)."
    },
    students: {
      id: "menu-students",
      name: "Siswa",
      description: "Pengelolaan master data siswa (NIS, NISN, nama, jenis kelamin, rombel kelas, status aktif)."
    },
    grades: {
      id: "menu-grades",
      name: "Nilai",
      description: "Modul pencatatan dan monitoring nilai capaian akademik siswa."
    },
    classes: {
      id: "menu-classes",
      name: "Kelas",
      description: "Pengelolaan data rombongan belajar (Class ID, nama kelas, tingkat kelas, tahun ajaran, dan wali kelas)."
    },
    settings: {
      id: "menu-settings",
      name: "Pengaturan",
      description: "Pengaturan sistem terpadu: profil akun (semua user), informasi hak akses, pengelolaan pengguna & keamanan (Admin), serta verifikasi audit Bukti Foto Responder Guru (Admin)."
    }
  },

  terminology: {
    SIMATA: "Sistem Informasi MA At-Taujih, platform web manajemen madrasah di MA At-Taujih Sarang.",
    Admin: "Role pengguna dengan hak administratif penuh mengelola sistem, master data, dan audit bukti foto.",
    Guru: "Role pengguna tenaga pendidik untuk melakukan presensi mengajar, jurnal kelas, dan rekap.",
    Siswa: "Peserta didik aktif yang terdaftar di SIMATA pada rombongan belajar tertentu.",
    NIS: "Nomor Induk Siswa, nomor identifikasi resmi siswa di madrasah.",
    NIK: "Nomor Induk Kependudukan, data identitas resmi kependudukan nasional.",
    NIP: "Nomor Induk Pegawai, identitas kepegawaian resmi guru/staf.",
    Kelas: "Rombongan belajar siswa (misalnya Kelas 10, Kelas 11, Kelas 12).",
    "Class ID": "Kode unik pengenal kelas di database SIMATA (contoh: CLS-2627-10).",
    "Teacher ID": "Kode unik pengenal guru di database SIMATA (contoh: TCH-0001).",
    "Student ID": "Kode unik pengenal siswa di database SIMATA (contoh: STU-0001).",
    Presensi: "Pencatatan kehadiran fisik seseorang dalam kegiatan pembelajaran di madrasah.",
    Kehadiran: "Status kehadiran presensi, mencakup Hadir (H), Izin (I), Sakit (S), dan Alpa/Tanpa Keterangan (A).",
    "Jam Pelajaran": "Nomor sesi atau periode pembelajaran dalam satu hari (periode 1 sampai 10).",
    Periode: "Sinonim dengan Jam Pelajaran (angka 1 s/d 10).",
    Responder: "Fitur presensi interaktif mandiri bagi guru dengan verifikasi tangkapan kamera langsung.",
    Jurnal: "Catatan riwayat kegiatan belajar mengajar (mata pelajaran dan uraian materi yang diajarkan).",
    Rekap: "Agregasi data kehadiran siswa/guru berdasarkan tanggal, bulan, atau rombel kelas.",
    Evidence: "File foto fisik kehadiran guru dari kamera yang disimpan ke Google Drive dan dicatat di sheet AttendanceEvidences.",
    "Bukti Foto": "Sinonim dari Evidence, foto verifikasi kehadiran guru di kelas pada saat presensi Responder.",
    Session: "Sesi aktif login pengguna di browser yang diautentikasi oleh server.",
    Token: "Kunci token acak yang mewakili sesi login aktif pengguna pada aplikasi SIMATA."
  },

  workflows: {
    studentAttendance: {
      title: "Alur Presensi Siswa",
      steps: [
        "1. Pengguna login ke akun SIMATA.",
        "2. Pilih menu 'Presensi Siswa' pada sidebar navigasi.",
        "3. Pilih kelas dan tentukan tanggal presensi yang ingin diinput.",
        "4. Sistem menampilkan daftar nama siswa pada kelas yang dipilih.",
        "5. Tentukan status kehadiran masing-masing siswa (Hadir, Sakit, Izin, atau Alpa).",
        "6. Klik tombol 'Simpan' untuk merekam data kehadiran siswa ke database.",
        "7. Data presensi langsung masuk ke database dan dapat ditinjau pada menu 'Rekap & Cetak'."
      ]
    },
    teacherAttendanceResponder: {
      title: "Alur Presensi Guru via Responder",
      steps: [
        "1. Guru atau Admin login ke akun SIMATA.",
        "2. Buka menu 'Responder' pada sidebar.",
        "3. Pilih identitas Guru (otomatis terpilih jika login sebagai Guru).",
        "4. Pilih Kelas yang sedang diajar saat ini.",
        "5. Pilih Jam Pelajaran / Periode (1 s/d 10) yang sedang berlangsung.",
        "6. Masukkan nama Mata Pelajaran dan ringkasan Materi ajar yang diajarkan.",
        "7. Arahkan kamera dan ambil foto bukti kehadiran fisik di kelas secara langsung.",
        "8. Klik tombol 'Kirim Presensi Guru'.",
        "9. Server memvalidasi data, mencatat data kehadiran di TeacherAttendance, mengunggah foto ke Google Drive SIMATA, dan membuat record relasi di AttendanceEvidence."
      ]
    },
    rekapAndPrint: {
      title: "Alur Rekapitulasi & Cetak Laporan",
      steps: [
        "1. Masuk ke menu 'Rekap & Cetak' pada sidebar.",
        "2. Tentukan jenis rekap yang diinginkan (Presensi Siswa Harian/Bulanan atau Presensi Guru Harian/Bulanan).",
        "3. Terapkan filter tanggal dan kelas yang ingin dilihat.",
        "4. Klik tombol 'Filter' / 'Tampilkan' untuk merender matriks kehadiran.",
        "5. Tinjau statistik kehadiran (Hadir, Izin, Sakit, Alpa).",
        "6. Klik tombol cetak/print untuk mencetak dokumen atau mengekspor ke file PDF."
      ]
    }
  },

  faq: [
    {
      id: 1,
      question: "Apa itu SIMATA?",
      answer: "SIMATA (Sistem Informasi MA At-Taujih) adalah sistem informasi administrasi madrasah berbasis web yang digunakan untuk mengelola data siswa, data guru, rombel kelas, pencatatan presensi siswa dan guru, rekapitulasi kehadiran, serta pencetakan laporan di MA At-Taujih Sarang."
    },
    {
      id: 2,
      question: "SIMATA digunakan untuk apa?",
      answer: "SIMATA digunakan untuk mempermudah tata kelola administrasi akademik dan kehadiran di MA At-Taujih Sarang, meliputi: manajemen master data siswa & guru, pencatatan kehadiran siswa harian/per jam, presensi mandiri guru via Responder dengan foto bukti fisik, monitoring presensi, rekapitulasi kehadiran, cetak laporan, dan pencatatan materi pembelajaran/jurnal."
    },
    {
      id: 3,
      question: "Siapa yang dapat menggunakan SIMATA?",
      answer: "SIMATA digunakan oleh dua role utama: (1) Admin (administrator madrasah/staf tata usaha dengan akses penuh ke seluruh modul, master data, dan audit bukti foto) dan (2) Guru (tenaga pendidik dengan akses ke Responder presensi kelas, jurnal materi, rekapitulasi kelas yang diampu, dan profil personal)."
    },
    {
      id: 4,
      question: "Apa itu presensi siswa?",
      answer: "Presensi siswa adalah proses pencatatan kehadiran peserta didik dalam rombongan belajar tertentu pada tanggal dan jam pelajaran yang ditentukan, dengan status Hadir, Izin, Sakit, atau Alpa."
    },
    {
      id: 5,
      question: "Apa itu presensi guru?",
      answer: "Presensi guru adalah pencatatan kehadiran tenaga pendidik saat melaksanakan kegiatan belajar mengajar di kelas pada jam pelajaran tertentu, dilengkapi dengan informasi mata pelajaran, materi pelajaran, dan bukti foto kamera fisik."
    },
    {
      id: 6,
      question: "Apa itu Jam Pelajaran?",
      answer: "Jam Pelajaran (periode) adalah nomor sesi pembelajaran dalam satu hari di madrasah, mulai dari periode 1 hingga 10, yang mengaitkan kehadiran siswa maupun guru dengan rentang waktu belajar mengajar tertentu."
    },
    {
      id: 7,
      question: "Apa perbedaan presensi siswa dan presensi guru?",
      answer: "Presensi siswa mencatat status kehadiran peserta didik dalam rombel kelas per tanggal/jam. Sementara presensi guru mencatat kehadiran pendidik yang mengajar di kelas pada jam tertentu secara mandiri melalui modul Responder dengan kewajiban menyertakan foto bukti fisik dari kamera dan materi pembelajaran."
    },
    {
      id: 8,
      question: "Apa itu Responder?",
      answer: "Responder adalah modul presensi mandiri guru di SIMATA yang dilengkapi fitur penangkapan kamera langsung (live camera capture). Guru menggunakannya untuk mengisi presensi saat mengajar di kelas, memilih jam pelajaran 1–10, mata pelajaran, materi ajar, serta mengirimkan foto kehadiran fisik secara real-time."
    },
    {
      id: 9,
      question: "Apa itu bukti foto/evidence?",
      answer: "Bukti foto (AttendanceEvidence) adalah foto fisik yang diambil melalui kamera Responder saat guru melakukan presensi kehadiran di kelas. Foto ini tersimpan di Google Drive sekolah dan terhubung dengan ID presensi guru untuk keperluan verifikasi dan audit oleh Admin."
    },
    {
      id: 10,
      question: "Bagaimana melihat rekap presensi?",
      answer: "Untuk melihat rekap presensi, buka menu 'Rekap & Cetak' pada sidebar, pilih jenis laporan (Siswa atau Guru, mode harian atau per kelas), tentukan filter tanggal dan kelas, lalu sistem akan menampilkan matriks rekapitulasi kehadiran lengkap."
    },
    {
      id: 11,
      question: "Bagaimana mencetak rekap?",
      answer: "Setelah membuka data rekapitulasi pada menu 'Rekap & Cetak' dan menerapkan filter yang sesuai, klik tombol cetak (ikon printer) yang tersedia pada tampilan. Dialog cetak browser akan terbuka dan Anda dapat mencetak ke printer fisik atau menyimpannya sebagai format PDF."
    },
    {
      id: 12,
      question: "Kenapa data siswa belum lengkap?",
      answer: "Kelengkapan data siswa bergantung pada data master yang telah diinputkan atau diimpor oleh Administrator madrasah ke dalam sistem SIMATA. Jika terdapat data siswa yang kurang atau belum masuk rombel, hubungi Administrator untuk melengkapi master data siswa."
    },
    {
      id: 13,
      question: "Kenapa presensi tidak muncul?",
      answer: "Presensi mungkin tidak muncul karena beberapa faktor: (1) belum ada data presensi yang disimpan untuk tanggal atau kelas yang dipilih, (2) filter tanggal atau kelas belum sesuai, (3) sesi login Anda telah berakhir, atau (4) siswa/kelas yang bersangkutan berstatus tidak aktif."
    },
    {
      id: 14,
      question: "Kenapa saya tidak bisa membuka menu tertentu?",
      answer: "Ketersediaan menu diatur berdasarkan role akun pengguna. Akun dengan role 'Guru' tidak dapat mengakses menu master data (tambah/edit guru, siswa, kelas), monitoring presensi guru sekolah, serta tab Keamanan dan Bukti Foto di Pengaturan. Menu-menu tersebut khusus disediakan untuk role 'Admin'."
    },
    {
      id: 15,
      question: "Apakah AI dapat mengubah data SIMATA?",
      answer: "Tidak. Pada AI-02, SIMATA AI Assistant hanya memiliki akses baca (read-only) terhadap data yang diberikan kepadanya dan tidak memiliki kemampuan untuk menambah, mengubah, atau menghapus data SIMATA."
    },
    {
      id: 16,
      question: "Apakah jawaban AI selalu benar?",
      answer: "Informasi sistem berasal dari Knowledge Base resmi SIMATA, sedangkan data kuantitatif terkini diambil langsung dari data aktual database SIMATA. Jika data yang ditanyakan tidak tersedia atau berada di luar akses, AI akan menyatakan bahwa data tidak tersedia dan tidak akan mengarang data."
    },
    {
      id: 17,
      question: "Apakah AI bisa melihat semua data SIMATA?",
      answer: "Tidak. AI hanya memiliki akses selektif ke data operasional yang relevan dan aman untuk menjawab pertanyaan Anda (konteks read-only). AI tidak memiliki akses ke password akun, token sesi, nomor telepon pribadi, email, NIK, atau kunci rahasia sistem."
    }
  ],

  troubleshooting: {
    cameraError: "Jika kamera Responder tidak muncul, pastikan Anda telah memberikan izin (allow permission) akses kamera di browser dan tidak ada aplikasi lain yang sedang memblokir kamera.",
    sessionExpired: "Jika sesi login berakhir, Anda akan diarahkan ke halaman login. Silakan masukkan username dan password Anda kembali.",
    dataNotSaved: "Jika presensi gagal disimpan, pastikan seluruh kolom wajib (guru, kelas, jam pelajaran, mapel, materi, dan foto) telah terisi serta koneksi internet Anda stabil.",
    blankReport: "Jika halaman rekap kosong, pastikan Anda telah memilih tanggal dan kelas yang valid dan memiliki catatan kehadiran di database."
  }
};

/**
 * Mengambil isi section knowledge tertentu secara modular.
 * @param {string} sectionKey - 'identity' | 'purpose' | 'roles' | 'modules' | 'terminology' | 'workflows' | 'faq' | 'troubleshooting'
 * @return {Object|null}
 */
function getSimataKnowledgeSection(sectionKey) {
  if (!sectionKey || typeof sectionKey !== "string") {
    return null;
  }
  return SIMATA_KNOWLEDGE[sectionKey.trim().toLowerCase()] || null;
}

/**
 * Membangun ringkasan teks knowledge untuk disematkan ke dalam prompt AI.
 * Dapat dipanggil secara selektif berdasarkan kebutuhan.
 * 
 * @param {Object} [options] - Opsi seleksi section { sections?: string[], includeFaq?: boolean }
 * @return {string} Teks Markdown terstruktur yang siap dibaca oleh LLM
 */
function getSimataKnowledgeText(options) {
  const opts = options || {};
  const requestedSections = Array.isArray(opts.sections) && opts.sections.length > 0
    ? opts.sections.map(function(s) { return String(s).toLowerCase(); })
    : ["identity", "purpose", "roles", "modules", "terminology", "workflows", "troubleshooting"];

  const parts = [];

  if (requestedSections.indexOf("identity") !== -1) {
    const id = SIMATA_KNOWLEDGE.identity;
    parts.push("### IDENTITAS SISTEM\n- Nama: " + id.fullName + " (" + id.name + ")\n- Lembaga: " + id.institution + "\n- Deskripsi: " + id.description);
  }

  if (requestedSections.indexOf("purpose") !== -1) {
    const p = SIMATA_KNOWLEDGE.purpose;
    parts.push("### TUJUAN & FITUR UTAMA\n" + p.summary + "\nFitur:\n" + p.features.map(function(f) { return "- " + f; }).join("\n"));
  }

  if (requestedSections.indexOf("roles") !== -1) {
    const r = SIMATA_KNOWLEDGE.roles;
    parts.push("### PERAN PENGGUNA (ROLES)\n- **Admin**: " + r.Admin.description + "\n  Akses: " + r.Admin.menuAccess.join(", ") +
               "\n- **Guru**: " + r.Guru.description + "\n  Akses: " + r.Guru.menuAccess.join(", ") + "\n  Batasan: " + r.Guru.restrictions.join("; "));
  }

  if (requestedSections.indexOf("modules") !== -1) {
    const m = SIMATA_KNOWLEDGE.modules;
    const modLines = Object.keys(m).map(function(k) {
      return "- **" + m[k].name + "**: " + m[k].description;
    });
    parts.push("### MODUL APLIKASI\n" + modLines.join("\n"));
  }

  if (requestedSections.indexOf("terminology") !== -1) {
    const t = SIMATA_KNOWLEDGE.terminology;
    const termLines = Object.keys(t).map(function(k) {
      return "- **" + k + "**: " + t[k];
    });
    parts.push("### KAMUS ISTILAH\n" + termLines.join("\n"));
  }

  if (requestedSections.indexOf("workflows") !== -1) {
    const w = SIMATA_KNOWLEDGE.workflows;
    parts.push("### ALUR KERJA UTAMA (WORKFLOWS)\n" +
               "**" + w.studentAttendance.title + "**:\n" + w.studentAttendance.steps.join("\n") + "\n\n" +
               "**" + w.teacherAttendanceResponder.title + "**:\n" + w.teacherAttendanceResponder.steps.join("\n") + "\n\n" +
               "**" + w.rekapAndPrint.title + "**:\n" + w.rekapAndPrint.steps.join("\n"));
  }

  if (requestedSections.indexOf("troubleshooting") !== -1) {
    const tb = SIMATA_KNOWLEDGE.troubleshooting;
    parts.push("### PANDUAN TROUBLESHOOTING\n" +
               "- Masalah Kamera: " + tb.cameraError + "\n" +
               "- Sesi Berakhir: " + tb.sessionExpired + "\n" +
               "- Data Tidak Tersimpan: " + tb.dataNotSaved + "\n" +
               "- Rekap Kosong: " + tb.blankReport);
  }

  // FAQ section (default disertakan kecuali includeFaq === false)
  if (opts.includeFaq !== false) {
    const faqList = SIMATA_KNOWLEDGE.faq.map(function(item) {
      return "Q" + item.id + ": " + item.question + "\nA" + item.id + ": " + item.answer;
    }).join("\n\n");
    parts.push("### FAQ OPERASIONAL SIMATA\n" + faqList);
  }

  return parts.join("\n\n");
}
