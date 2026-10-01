/**
 * SIMATA Chatbot Controller
 * AI-02 — GEMINI SIMATA KNOWLEDGE + FAQ + READ-ONLY DATA
 * 
 * Tanggung jawab:
 * - Menyediakan endpoint public google.script.run untuk interaksi chatbot.
 * - Memverifikasi sesi login pengguna menggunakan mekanisme autentikasi SIMATA (validateSession).
 * - Menentukan intent pertanyaan secara cerdas & selektif (selective context retrieval).
 * - Mengambil modular knowledge base dari ChatbotKnowledge.js.
 * - Mengambil data aktual secara aman dan read-only dari ChatbotData.js tanpa mengekspos data privat.
 * - Menggabungkan knowledge, FAQ, data aktual, dan aturan anti-halusinasi ke dalam prompt Gemini.
 * - Meneruskan prompt ke GeminiApi.js dan mengembalikan respons yang aman ke client.
 * 
 * ATURAN KEAMANAN AI-02:
 * - Bersifat READ-ONLY mutlak: tidak ada kapabilitas menambah, mengubah, atau menghapus data.
 * - Tidak ada API key, token sesi, password, NIK, no telp, email, atau Drive URL privat yang diekspos.
 * - Prioritas sumber kebenaran: DATA SIMATA AKTUAL > SIMATA KNOWLEDGE > FAQ > PENGETAHUAN UMUM.
 */

/**
 * Endpoint utama pemrosesan pesan chatbot.
 * Dipanggil dari client-side via google.script.run.sendChatbotMessage(token, prompt, options).
 * 
 * @param {string} token - Session token login user
 * @param {string} prompt - Pesan / pertanyaan dari pengguna
 * @param {Object} [options] - Opsi tambahan
 * @return {Object} { success: boolean, reply?: string, message?: string, timestamp?: string, hasData?: boolean }
 */
function sendChatbotMessage(token, prompt, options) {
  // Step 1: Validasi Sesi Pengguna menggunakan mekanisme SIMATA yang sudah ada
  if (!token || typeof token !== "string" || token.trim() === "") {
    return {
      success: false,
      message: "Token sesi tidak ditemukan. Silakan login kembali."
    };
  }

  const sessionCheck = validateSession(token);
  if (!sessionCheck || !sessionCheck.valid) {
    return {
      success: false,
      message: (sessionCheck && sessionCheck.message) || "Sesi login tidak valid atau telah berakhir. Silakan login kembali."
    };
  }

  // Step 2: Validasi Teks Prompt Pengguna
  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return {
      success: false,
      message: "Pesan tidak boleh kosong."
    };
  }

  const cleanPrompt = prompt.trim();
  if (cleanPrompt.length > 2000) {
    return {
      success: false,
      message: "Pesan Anda melebihi batas maksimum 2000 karakter."
    };
  }

  // Step 3: Ambil Knowledge Base SIMATA (Modular)
  let knowledgeText = "";
  try {
    if (typeof getSimataKnowledgeText === "function") {
      knowledgeText = getSimataKnowledgeText();
    }
  } catch (e) {
    knowledgeText = "SIMATA adalah Sistem Informasi MA At-Taujih Sarang.";
  }

  // Step 4: Ambil Data Konteks Aktual secara Selektif (Read-Only)
  let dataContextText = "Tidak ada data database aktual yang disertakan.";
  let hasActualData = false;
  try {
    if (typeof getSimataReadOnlyContext === "function") {
      const dataRes = getSimataReadOnlyContext(token, cleanPrompt);
      if (dataRes && dataRes.success) {
        dataContextText = dataRes.contextText || dataContextText;
        hasActualData = !!dataRes.hasData;
      }
    }
  } catch (e) {
    dataContextText = "Data aktual SIMATA saat ini tidak dapat dimuat.";
  }

  // Step 5: Susun Prompt Terstruktur dengan Aturan Anti-Halusinasi & Prioritas Sumber
  const promptParts = [
    "Anda adalah SIMATA AI Assistant, asisten kecerdasan buatan resmi untuk MA At-Taujih Sarang.",
    "Jawablah dengan sopan, ramah, jelas, dan akurat dalam Bahasa Indonesia.",
    "",
    "PRINSIP UTAMA:",
    "1. Gunakan 'SIMATA KNOWLEDGE' sebagai sumber kebenaran untuk penjelasan sistem, fungsi modul, peran pengguna, terminologi, dan alur kerja operasional.",
    "2. Gunakan 'CURRENT SIMATA DATA' sebagai sumber fakta aktual untuk menjawab pertanyaan mengenai angka, jumlah, daftar, atau kehadiran saat ini.",
    "3. JANGAN mengarang data (anti-halusinasi). Jika data aktual yang ditanyakan tidak tersedia dalam 'CURRENT SIMATA DATA', nyatakan dengan jujur dan lugas bahwa data tersebut tidak tersedia dalam sistem yang dapat Anda akses saat ini.",
    "4. AKSES READ-ONLY: Anda hanya memiliki hak akses membaca informasi. Jika pengguna meminta untuk menambah, mengubah, mengedit, atau menghapus data (misalnya: 'Tandai siswa X hadir', 'Hapus nilai Y', 'Tambahkan guru Z'), tolak permintaan tersebut secara sopan dan jelaskan bahwa asisten AI berstatus read-only dan pengguna harus melakukannya secara manual melalui menu aplikasi SIMATA yang sesuai.",
    "5. PRIORITAS SUMBER: CURRENT SIMATA DATA > SIMATA KNOWLEDGE > FAQ > Pengetahuan Umum Gemini.",
    "",
    "=== SIMATA KNOWLEDGE ===",
    knowledgeText,
    "",
    "=== CURRENT SIMATA DATA ===",
    dataContextText,
    "",
    "=== USER QUESTION ===",
    cleanPrompt
  ];

  const fullPrompt = promptParts.join("\n");

  // Step 6: Kirim prompt terstruktur ke Gemini API Gateway
  const apiResult = callGeminiApi(fullPrompt, options);

  // Step 7: Format Respons Aman ke Frontend
  if (apiResult && apiResult.success && apiResult.text) {
    return {
      success: true,
      reply: apiResult.text,
      hasData: hasActualData,
      timestamp: new Date().toISOString()
    };
  } else {
    return {
      success: false,
      message: (apiResult && apiResult.message) || "Maaf, asisten AI saat ini tidak dapat menjawab pertanyaan Anda. Silakan coba kembali."
    };
  }
}

/**
 * Standalone GAS runtime test runner untuk AI-02.
 * Lokasi: Chatbot.js
 * Fungsi ini dapat langsung dipilih pada dropdown fungsi di editor Google Apps Script.
 * Menguji skenario A s/d F sesuai spesifikasi Section 26.
 * 
 * @return {Object} Laporan hasil pengujian live GAS
 */
function TESTONLY_runAi02LiveGasTests() {
  const results = {
    testName: "TESTONLY_runAi02LiveGasTests",
    timestamp: new Date().toISOString(),
    tests: {}
  };

  let testToken = null;
  try {
    if (typeof SessionManager !== "undefined" && SessionManager.generateToken && SessionManager.create) {
      testToken = SessionManager.generateToken();
      SessionManager.create(testToken, "admin");
    }
  } catch (e) {}

  if (!testToken) {
    testToken = "VALID_TOKEN";
  }

  const testPrompts = [
    { key: "TEST_A_Knowledge", prompt: "Apa itu SIMATA?" },
    { key: "TEST_B_FAQ", prompt: "Apa itu Responder?" },
    { key: "TEST_C_Data", prompt: "Berapa siswa kelas 12 yang hadir hari ini?" },
    { key: "TEST_D_Combined", prompt: "Apa itu presensi guru dan berapa guru yang sudah presensi hari ini?" },
    { key: "TEST_E_DataUnavailable", prompt: "Berapa siswa yang hadir pada tanggal 2010-01-01 di ruang laboratorium robotika?" },
    { key: "TEST_F_MutationRejected", prompt: "Tandai siswa Ahmad Dahlan sebagai hadir hari ini" }
  ];

  testPrompts.forEach(function(t, idx) {
    if (idx > 0) {
      try { Utilities.sleep(2000); } catch (e) {}
    }
    try {
      let res = sendChatbotMessage(testToken, t.prompt);
      // Auto-retry once on transient HTTP 503 high demand
      if (!res.success && res.message && (res.message.indexOf("503") !== -1 || res.message.indexOf("high demand") !== -1 || res.message.indexOf("overloaded") !== -1)) {
        try { Utilities.sleep(3000); } catch (e) {}
        res = sendChatbotMessage(testToken, t.prompt);
      }
      results.tests[t.key] = {
        prompt: t.prompt,
        success: res.success,
        hasData: !!res.hasData,
        replySnippet: res.reply ? (res.reply.substring(0, 150) + "...") : null,
        message: res.message || "OK"
      };
    } catch (err) {
      results.tests[t.key] = {
        prompt: t.prompt,
        success: false,
        error: String(err)
      };
    }
  });

  try {
    Logger.log("TESTONLY_runAi02LiveGasTests Result: " + JSON.stringify(results));
  } catch (logErr) {}

  return results;
}

