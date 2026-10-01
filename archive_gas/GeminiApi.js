/**
 * SIMATA Gemini API Gateway
 * AI-01 — Fondasi Gemini AI Assistant SIMATA
 * 
 * Tanggung jawab:
 * - Membaca kredensial Gemini API dari Script Properties secara aman.
 * - Mengirim HTTP request ke Google Gemini REST API via UrlFetchApp.
 * - Normalisasi respons dan penanganan error tanpa membocorkan API key.
 * 
 * ATURAN KERAS:
 * - API key TIDAK BOLEH dikirim ke client browser atau dicetak ke log.
 * - Modul ini TIDAK mengakses sheet atau database SIMATA.
 */

const GEMINI_CONFIG = {
  DEFAULT_MODEL: "gemini-3.6-flash",
  API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/models/",
  MAX_PROMPT_LENGTH: 50000,
  DEFAULT_MAX_TOKENS: 1024,
  DEFAULT_TEMPERATURE: 0.7
};

/**
 * Membaca Gemini API key secara aman dari Script Properties.
 * Kunci TIDAK PERNAH dikembalikan ke client frontend.
 * 
 * @return {Object} { success: boolean, key?: string, message?: string }
 */
function getGeminiApiKey() {
  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GEMINI_API_KEY");

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
      return {
        success: false,
        message: "Gemini API key belum dikonfigurasi pada Script Properties."
      };
    }

    return {
      success: true,
      key: apiKey.trim()
    };
  } catch (error) {
    return {
      success: false,
      message: "Gagal membaca konfigurasi Gemini API dari Script Properties."
    };
  }
}

/**
 * Mendapatkan model Gemini yang akan digunakan.
 * Dapat di-override melalui Script Property 'GEMINI_MODEL'.
 * 
 * @return {string}
 */
function getGeminiModel() {
  try {
    const props = PropertiesService.getScriptProperties();
    const customModel = props.getProperty("GEMINI_MODEL");
    if (customModel && typeof customModel === "string" && customModel.trim() !== "") {
      return customModel.trim();
    }
  } catch (e) {
    // Fallback ke default jika Script Properties tidak dapat dibaca
  }
  return GEMINI_CONFIG.DEFAULT_MODEL;
}

/**
 * Mengirimkan prompt teks ke Gemini API via UrlFetchApp.
 * 
 * @param {string} prompt - Teks pertanyaan dari user
 * @param {Object} [options] - Opsi konfigurasi tambahan (systemInstruction, temperature, maxOutputTokens, model)
 * @return {Object} { success: boolean, text?: string, message?: string, finishReason?: string }
 */
function callGeminiApi(prompt, options) {
  // 1. Validasi prompt
  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return {
      success: false,
      message: "Prompt pertanyaan tidak boleh kosong."
    };
  }

  const cleanPrompt = prompt.trim();
  if (cleanPrompt.length > GEMINI_CONFIG.MAX_PROMPT_LENGTH) {
    return {
      success: false,
      message: "Pertanyaan terlalu panjang. Maksimal " + GEMINI_CONFIG.MAX_PROMPT_LENGTH + " karakter."
    };
  }

  // 2. Baca API Key
  const keyResult = getGeminiApiKey();
  if (!keyResult.success || !keyResult.key) {
    return {
      success: false,
      message: keyResult.message || "Gemini API key belum dikonfigurasi."
    };
  }
  const apiKey = keyResult.key;

  // 3. Tentukan model & endpoint
  const modelName = (options && options.model) ? options.model : getGeminiModel();
  const endpoint = GEMINI_CONFIG.API_BASE_URL + encodeURIComponent(modelName) + ":generateContent";

  // 4. Bangun Payload request
  const systemText = (options && options.systemInstruction) 
    ? options.systemInstruction 
    : "Anda adalah SIMATA AI Assistant, asisten kecerdasan buatan resmi untuk MA At-Taujih Sarang. Berikan jawaban yang ramah, sopan, ringkas, jelas, dan santun dalam Bahasa Indonesia. Pada tahap ini, Anda adalah asisten umum dan belum terhubung ke database operasional madrasah.";

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: cleanPrompt }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        { text: systemText }
      ]
    },
    generationConfig: {
      temperature: (options && typeof options.temperature === "number") ? options.temperature : GEMINI_CONFIG.DEFAULT_TEMPERATURE,
      maxOutputTokens: (options && typeof options.maxOutputTokens === "number") ? options.maxOutputTokens : GEMINI_CONFIG.DEFAULT_MAX_TOKENS
    }
  };

  // 5. Parameter UrlFetchApp
  const fetchOptions = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-goog-api-key": apiKey
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, fetchOptions);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      const parsed = normalizeGeminiResponse(responseText, apiKey);
      parsed.httpCode = 200;
      parsed.model = modelName;
      parsed.endpoint = endpoint;
      return parsed;
    }

    // Ekstrak pesan diagnostik aman dari Gemini API untuk status non-2xx
    const errorDetail = sanitizeGeminiDiagnosticResponse(responseText, apiKey);

    if (responseCode === 400) {
      return {
        success: false,
        httpCode: 400,
        model: modelName,
        message: "Format permintaan tidak dapat diproses oleh Gemini API: " + errorDetail,
        errorDetail: errorDetail
      };
    } else if (responseCode === 401 || responseCode === 403) {
      return {
        success: false,
        httpCode: responseCode,
        model: modelName,
        message: "Otorisasi Gemini API gagal (" + responseCode + "): " + errorDetail,
        errorDetail: errorDetail
      };
    } else if (responseCode === 404) {
      return {
        success: false,
        httpCode: 404,
        model: modelName,
        endpoint: endpoint,
        message: "Model atau endpoint Gemini tidak ditemukan (HTTP 404): " + errorDetail,
        errorDetail: errorDetail
      };
    } else if (responseCode === 429) {
      return {
        success: false,
        httpCode: 429,
        model: modelName,
        message: "Batas frekuensi/kuota panggilan Gemini API tercapai (HTTP 429): " + errorDetail,
        errorDetail: errorDetail
      };
    } else if (responseCode >= 500) {
      return {
        success: false,
        httpCode: responseCode,
        model: modelName,
        message: "Layanan server Gemini API sedang mengalami kendala (HTTP " + responseCode + "): " + errorDetail,
        errorDetail: errorDetail
      };
    } else {
      return {
        success: false,
        httpCode: responseCode,
        model: modelName,
        message: "Terjadi kesalahan HTTP " + responseCode + " saat menghubungi Gemini API: " + errorDetail,
        errorDetail: errorDetail
      };
    }
  } catch (fetchError) {
    return {
      success: false,
      message: "Gagal terhubung ke Gemini API: " + (fetchError && fetchError.message ? fetchError.message : "Network error")
    };
  }
}

/**
 * Helper untuk mengekstrak dan membersihkan pesan error dari respons mentah Gemini API.
 * Menjamin bahwa nilai API key TIDAK PERNAH lolos atau bocor ke dalam output diagnostik.
 * 
 * @param {string} responseText - Raw response text dari Gemini API
 * @param {string} [apiKey] - API key aktif untuk dipastikan ter-redact jika muncul
 * @return {string} Pesan error yang sudah dibersihkan
 */
function sanitizeGeminiDiagnosticResponse(responseText, apiKey) {
  if (!responseText || typeof responseText !== "string") {
    return "Tidak ada respons dari Gemini API.";
  }

  let sanitized = responseText;

  // 1. Redact API key aktif jika ditemukan dalam response text (defense-in-depth)
  if (apiKey && typeof apiKey === "string" && apiKey.length > 5) {
    sanitized = sanitized.split(apiKey).join("[REDACTED_API_KEY]");
  }

  // Redact sembarang pola Google API Key (AIza...)
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_API_KEY]");

  // 2. Parse JSON jika memungkinkan
  try {
    const data = JSON.parse(sanitized);
    if (data && data.error) {
      const err = data.error;
      const status = err.status ? (" [" + err.status + "]") : "";
      const msg = err.message || JSON.stringify(err);
      return (msg + status).trim();
    }
  } catch (e) {
    // Non-JSON response, lanjutkan ke pembatasan panjang string
  }

  // 3. Batasi panjang pesan jika teks mentah/HTML
  const trimmed = sanitized.trim();
  if (trimmed.length > 500) {
    return trimmed.substring(0, 500) + "... (truncated)";
  }
  return trimmed || "Respons kosong.";
}

/**
 * Helper diagnostik untuk merekam struktur JSON dari respons Gemini secara aman.
 * 
 * @param {Object} data - Objek hasil parse JSON
 * @param {string} rawJson - String JSON mentah
 * @param {string} [apiKey] - API key untuk redaksi
 * @return {Object} Struktur diagnostik aman
 */
function inspectGeminiResponseStructure(data, rawJson, apiKey) {
  const diag = {
    topLevelKeys: data ? Object.keys(data) : [],
    candidateCount: 0,
    candidate0Keys: [],
    finishReason: null,
    contentStructure: null,
    partsStructure: null
  };

  try {
    if (data && Array.isArray(data.candidates)) {
      diag.candidateCount = data.candidates.length;
      if (data.candidates.length > 0) {
        const c0 = data.candidates[0] || {};
        diag.candidate0Keys = Object.keys(c0);
        diag.finishReason = c0.finishReason || "NOT_SET";
        if (c0.content) {
          diag.contentStructure = {
            type: typeof c0.content,
            keys: (typeof c0.content === "object" && c0.content !== null) ? Object.keys(c0.content) : null
          };
          if (c0.content.parts) {
            diag.partsStructure = {
              isArray: Array.isArray(c0.content.parts),
              length: Array.isArray(c0.content.parts) ? c0.content.parts.length : 0,
              items: Array.isArray(c0.content.parts)
                ? c0.content.parts.map(function(p, i) {
                    if (typeof p === "object" && p !== null) {
                      return {
                        index: i,
                        keys: Object.keys(p),
                        hasText: typeof p.text === "string",
                        textLen: typeof p.text === "string" ? p.text.length : 0,
                        isThought: !!p.thought
                      };
                    }
                    return { index: i, type: typeof p };
                  })
                : typeof c0.content.parts
            };
          }
        }
      }
    }
  } catch (err) {
    diag.inspectError = String(err);
  }

  // Sanitized raw snippet (maks 3000 karakter, API key redacted)
  let snippet = typeof rawJson === "string" ? rawJson : JSON.stringify(data);
  if (apiKey && typeof apiKey === "string" && apiKey.length > 5) {
    snippet = snippet.split(apiKey).join("[REDACTED_API_KEY]");
  }
  snippet = snippet.replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_API_KEY]");
  if (snippet.length > 3000) {
    snippet = snippet.substring(0, 3000) + "... (truncated)";
  }
  diag.sanitizedRawSnippet = snippet;

  return diag;
}

/**
 * Melakukan normalisasi respons JSON mentah dari Gemini API.
 * Mendukung ekstraksi teks multi-strategi (parts array, thought-filtering, candidate text, root text).
 * 
 * @param {string} rawJson - Teks respons JSON mentah
 * @param {string} [apiKey] - API key untuk redaksi pengujian
 * @return {Object} { success: boolean, text?: string, finishReason?: string, message?: string, responseDiagnostic?: Object }
 */
function normalizeGeminiResponse(rawJson, apiKey) {
  try {
    const data = JSON.parse(rawJson);

    // 1. Periksa apakah ada error di dalam payload JSON
    if (data.error) {
      return {
        success: false,
        message: "Gemini API mengembalikan pesan: " + (data.error.message || "Unknown API error")
      };
    }

    // 2. Periksa apakah prompt diblokir oleh filter keamanan
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      return {
        success: false,
        message: "Pertanyaan tidak dapat diproses karena filter keamanan (" + data.promptFeedback.blockReason + ")."
      };
    }

    // Rekam struktur respons untuk diagnostik
    const structureDiag = inspectGeminiResponseStructure(data, rawJson, apiKey);

    // 3. Validasi candidates
    const candidates = data.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return {
        success: false,
        message: "Gemini API tidak mengembalikan respons teks.",
        responseDiagnostic: structureDiag
      };
    }

    const candidate = candidates[0];
    const finishReason = candidate.finishReason || "UNKNOWN";

    if (finishReason === "SAFETY") {
      return {
        success: false,
        finishReason: finishReason,
        message: "Respons AI dihentikan oleh kebijakan keamanan konten (SAFETY).",
        responseDiagnostic: structureDiag
      };
    }

    // 4. Ekstraksi teks multi-strategi
    let extractedText = "";

    // Strategi A: candidate.content.parts array
    if (candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
      const parts = candidate.content.parts;
      
      // A1: Ambil text parts non-thought (jawaban final yang ditujukan untuk pengguna)
      let nonThoughtText = "";
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p && typeof p.text === "string" && !p.thought) {
          nonThoughtText += p.text;
        } else if (typeof p === "string") {
          nonThoughtText += p;
        }
      }

      if (nonThoughtText.trim()) {
        extractedText = nonThoughtText.trim();
      } else {
        // A2: Fallback jika semua parts berupa thought atau flag thought tidak digunakan
        let allPartsText = "";
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (p && typeof p.text === "string") {
            allPartsText += p.text;
          }
        }
        if (allPartsText.trim()) {
          extractedText = allPartsText.trim();
        }
      }
    }

    // Strategi B: candidate.content adalah string langsung atau candidate.content.text ada
    if (!extractedText && candidate.content) {
      if (typeof candidate.content === "string" && candidate.content.trim()) {
        extractedText = candidate.content.trim();
      } else if (typeof candidate.content.text === "string" && candidate.content.text.trim()) {
        extractedText = candidate.content.text.trim();
      }
    }

    // Strategi C: candidate.text ada langsung pada candidate
    if (!extractedText && typeof candidate.text === "string" && candidate.text.trim()) {
      extractedText = candidate.text.trim();
    }

    // Strategi D: candidate.parts ada langsung pada candidate (tanpa wrapper .content)
    if (!extractedText && Array.isArray(candidate.parts) && candidate.parts.length > 0) {
      for (let i = 0; i < candidate.parts.length; i++) {
        const p = candidate.parts[i];
        if (p && typeof p.text === "string") {
          extractedText += p.text;
        }
      }
      extractedText = extractedText.trim();
    }

    // Strategi E: Root-level data.text atau data.output_text
    if (!extractedText) {
      if (typeof data.text === "string" && data.text.trim()) {
        extractedText = data.text.trim();
      } else if (typeof data.output_text === "string" && data.output_text.trim()) {
        extractedText = data.output_text.trim();
      }
    }

    // Jika setelah semua strategi teks tetap tidak ditemukan
    if (!extractedText) {
      return {
        success: false,
        finishReason: finishReason,
        message: "Struktur respons Gemini tidak memuat bagian teks.",
        responseDiagnostic: structureDiag
      };
    }

    return {
      success: true,
      text: extractedText,
      finishReason: finishReason,
      responseDiagnostic: structureDiag
    };
  } catch (parseError) {
    return {
      success: false,
      message: "Gagal memproses struktur data dari respons Gemini API: " + (parseError && parseError.message ? parseError.message : String(parseError))
    };
  }
}

/**
 * Standalone verification function untuk menguji konektivitas Gemini API
 * tanpa menyentuh data atau database SIMATA.
 * 
 * @return {Object}
 */
function TESTONLY_testGeminiConnection() {
  const modelName = getGeminiModel();
  const endpoint = GEMINI_CONFIG.API_BASE_URL + encodeURIComponent(modelName) + ":generateContent";
  const testPrompt = "Halo Gemini, berikan respons satu kalimat untuk mengonfirmasi bahwa koneksi berhasil.";
  const result = callGeminiApi(testPrompt, {
    maxOutputTokens: 512,
    temperature: 0.2
  });

  const diagnosticOutput = {
    testName: "TESTONLY_testGeminiConnection",
    timestamp: new Date().toISOString(),
    success: result.success,
    httpCode: result.httpCode || (result.success ? 200 : null),
    model: modelName,
    endpoint: endpoint,
    replySnippet: result.success ? (result.text.substring(0, 100) + "...") : null,
    message: result.message || "OK",
    errorDetail: result.errorDetail || null,
    responseDiagnostic: result.responseDiagnostic || null
  };

  try {
    Logger.log("TESTONLY_testGeminiConnection Result: " + JSON.stringify(diagnosticOutput));
  } catch (logErr) {
    // Abaikan jika di luar lingkungan Google Apps Script
  }

  return diagnosticOutput;
}

