/**
 * SIMATA Attendance Evidence Backend
 * Sprint 4 - Evidence Storage Integration
 * 
 * Manages evidence photo captures for responder sessions
 * Schema: evidenceId, sessionId, operatorId, capturedAt, fileId, fileUrl
 */

const ATTENDANCE_EVIDENCE_HEADERS = [
  "evidenceId",
  "sessionId",
  "operatorId",
  "capturedAt",
  "fileId",
  "fileUrl"
];

const MAX_IMAGE_PAYLOAD_LENGTH = 2000000; // ~2MB string limit guard

function getAttendanceEvidenceSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_ATTENDANCE_EVIDENCES);

  if (!sheet) {
    return { success: false, message: "Sheet AttendanceEvidences tidak ditemukan." };
  }

  return { success: true, sheet: sheet };
}

function buildAttendanceEvidenceObject(headers, row) {
  const evidence = {};

  ATTENDANCE_EVIDENCE_HEADERS.forEach(function(header) {
    const idx = headers.indexOf(header);
    evidence[header] = idx !== -1 ? normalizeString(row[idx]) : "";
  });

  return evidence;
}

function findAttendanceEvidenceRowsBySessionId(sheet, sessionId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const sessionIndex = headerMap["sessionId"];

  if (sessionIndex === undefined || sessionIndex === -1) {
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedSessionId = normalizeString(sessionId);
  const matches = [];

  for (let i = 0; i < values.length; i++) {
    if (normalizeString(values[i][sessionIndex]) === normalizedSessionId) {
      matches.push({
        rowIndex: i + 2,
        rowValues: values[i],
        headers: headers,
        headerMap: headerMap
      });
    }
  }

  return matches;
}

function findAttendanceEvidenceRowById(sheet, evidenceId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["evidenceId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(evidenceId);

  for (let i = 0; i < values.length; i++) {
    if (normalizeString(values[i][idIndex]) === normalizedId) {
      return {
        rowIndex: i + 2,
        rowValues: values[i],
        headers: headers,
        headerMap: headerMap
      };
    }
  }

  return null;
}

/**
 * Get attendance evidence by evidenceId
 */
function getAttendanceEvidenceById(evidenceId) {
  const sheetResult = getAttendanceEvidenceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(evidenceId)) {
    return {
      success: false,
      message: "evidenceId tidak boleh kosong."
    };
  }

  const rowMatch = findAttendanceEvidenceRowById(sheetResult.sheet, evidenceId);
  if (!rowMatch) {
    return {
      success: false,
      message: "Data evidence tidak ditemukan."
    };
  }

  return {
    success: true,
    evidence: buildAttendanceEvidenceObject(rowMatch.headers, rowMatch.rowValues)
  };
}

/**
 * Get attendance evidence by sessionId
 */
function getAttendanceEvidenceBySessionId(sessionId) {
  const sheetResult = getAttendanceEvidenceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(sessionId)) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const matches = findAttendanceEvidenceRowsBySessionId(sheetResult.sheet, sessionId);
  if (matches.length === 0) {
    return {
      success: false,
      message: "Evidence untuk sesi ini tidak ditemukan."
    };
  }

  if (matches.length > 1) {
    return {
      success: false,
      message: "DATA INCONSISTENCY: Ditemukan lebih dari 1 data evidence untuk sesi ini."
    };
  }

  return {
    success: true,
    evidence: buildAttendanceEvidenceObject(matches[0].headers, matches[0].rowValues)
  };
}

/**
 * Parse and validate image payload (Base64 Data URL)
 */
function parseImagePayload(imagePayload) {
  if (!imagePayload || typeof imagePayload !== "string") {
    return {
      success: false,
      message: "Payload gambar tidak boleh kosong."
    };
  }

  if (imagePayload.length > MAX_IMAGE_PAYLOAD_LENGTH) {
    return {
      success: false,
      message: "Ukuran data gambar melebihi batas maksimum server."
    };
  }

  const dataUrlPrefixMatch = imagePayload.match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/);
  if (!dataUrlPrefixMatch) {
    return {
      success: false,
      message: "Format gambar tidak valid. Harus berupa Base64 Data URL (image/jpeg atau image/png)."
    };
  }

  const mimeType = dataUrlPrefixMatch[1] === "image/jpg" ? "image/jpeg" : dataUrlPrefixMatch[1];
  const base64Content = dataUrlPrefixMatch[2];

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64Content);
  } catch (e) {
    return {
      success: false,
      message: "Gagal mendecode data Base64 gambar."
    };
  }

  if (!bytes || bytes.length === 0) {
    return {
      success: false,
      message: "Data gambar kosong setelah didecode."
    };
  }

  return {
    success: true,
    mimeType: mimeType,
    bytes: bytes
  };
}

/**
 * Validate and retrieve Google Drive Folder
 */
function getEvidenceDriveFolder() {
  const folderId = normalizeString(CONFIG.EVIDENCE_FOLDER_ID);

  if (!folderId || folderId === "CONFIGURE_ME") {
    return {
      success: false,
      message: "Folder Google Drive belum dikonfigurasi (EVIDENCE_FOLDER_ID masih default). Hubungi Admin."
    };
  }

  try {
    const folder = DriveApp.getFolderById(folderId);
    if (!folder) {
      return {
        success: false,
        message: "Folder Google Drive evidence tidak ditemukan."
      };
    }
    return {
      success: true,
      folder: folder
    };
  } catch (error) {
    return {
      success: false,
      message: "Gagal mengakses folder Google Drive: " + (error && error.message ? error.message : String(error))
    };
  }
}

/**
 * Main backend endpoint: Create and link attendance evidence to an active responder session
 * 
 * Identity contract:
 * Token is validated server-side. operatorId = session.username.
 * No client operatorId is accepted.
 */
function createAttendanceEvidence(token, sessionId, imagePayload) {
  // Step 1: Validate Token & Identity
  if (!token || typeof token !== "string" || token.trim() === "") {
    return {
      success: false,
      message: "Token sesi tidak boleh kosong."
    };
  }

  const session = SessionManager.validate(token.trim());
  if (!session || !session.valid || !session.username) {
    return {
      success: false,
      message: "Sesi tidak valid atau telah berakhir."
    };
  }

  const operatorId = normalizeString(session.username);
  if (!operatorId) {
    return {
      success: false,
      message: "Identitas operator tidak valid."
    };
  }

  // Step 2: Validate Session ID & Session Ownership
  const normalizedSessionId = normalizeString(sessionId);
  if (!normalizedSessionId) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const responderSessionSheetResult = getResponderSessionSheet();
  if (!responderSessionSheetResult.success) {
    return responderSessionSheetResult;
  }

  const responderSessionSheet = responderSessionSheetResult.sheet;
  const responderSessionRow = findResponderSessionRowById(responderSessionSheet, normalizedSessionId);

  if (!responderSessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  const responderSessionObj = buildResponderSessionObject(
    responderSessionRow.headers,
    responderSessionRow.rowValues
  );

  if (responderSessionObj.status !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat menerima evidence. Status saat ini: " + responderSessionObj.status
    };
  }

  if (normalizeString(responderSessionObj.operatorId) !== operatorId) {
    return {
      success: false,
      message: "Akses ditolak: Anda bukan operator pemilik sesi responder ini."
    };
  }

  // Step 3: Pre-flight Check for Existing Evidence & Inconsistency / Idempotency
  const evidenceSheetResult = getAttendanceEvidenceSheet();
  if (!evidenceSheetResult.success) {
    return evidenceSheetResult;
  }

  const evidenceSheet = evidenceSheetResult.sheet;
  const existingMatches = findAttendanceEvidenceRowsBySessionId(evidenceSheet, normalizedSessionId);

  if (existingMatches.length > 1) {
    return {
      success: false,
      message: "DATA INCONSISTENCY: Ditemukan lebih dari 1 data evidence untuk sesi ini."
    };
  }

  if (existingMatches.length === 1) {
    const existingEvidence = buildAttendanceEvidenceObject(
      existingMatches[0].headers,
      existingMatches[0].rowValues
    );

    // If session is already linked to this evidence -> return existing evidence (Idempotent success)
    if (normalizeString(responderSessionObj.evidenceId) === normalizeString(existingEvidence.evidenceId)) {
      return {
        success: true,
        message: "Evidence sudah tercatat dan ditautkan ke sesi ini.",
        evidence: existingEvidence
      };
    }

    // If evidence row exists but session link is missing (Failure Case C recovery / reconciliation)
    const relinkResult = linkEvidenceToSession(normalizedSessionId, existingEvidence.evidenceId);
    if (relinkResult.success) {
      return {
        success: true,
        message: "Evidence berhasil direkonsiliasi dan ditautkan ke sesi.",
        evidence: existingEvidence
      };
    } else {
      return {
        success: false,
        message: "Evidence ditemukan tetapi gagal ditautkan ke sesi: " + (relinkResult.message || "")
      };
    }
  }

  // If session already claims an evidenceId but no row found in AttendanceEvidences
  if (normalizeString(responderSessionObj.evidenceId)) {
    return {
      success: false,
      message: "Sesi ini sudah memiliki evidenceId terdaftar namun record tidak ditemukan."
    };
  }

  // Step 4: Validate Image Payload
  const imageParseResult = parseImagePayload(imagePayload);
  if (!imageParseResult.success) {
    return imageParseResult;
  }

  // Step 5: Validate Drive Folder
  const folderResult = getEvidenceDriveFolder();
  if (!folderResult.success) {
    return folderResult;
  }

  const folder = folderResult.folder;

  // Step 6: Create File in Google Drive (Outside ScriptLock)
  const now = new Date();
  const timestampStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
  const capturedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const shortId = Utilities.getUuid().substring(0, 6);
  const filename = "EVIDENCE_" + normalizedSessionId + "_" + timestampStr + "_" + shortId + ".jpg";

  let createdFile = null;
  let fileId = "";
  let fileUrl = "";

  try {
    const blob = Utilities.newBlob(imageParseResult.bytes, imageParseResult.mimeType, filename);
    createdFile = folder.createFile(blob);
    fileId = createdFile.getId();
    fileUrl = createdFile.getUrl();
  } catch (driveError) {
    return {
      success: false,
      message: "Gagal mengunggah foto bukti ke Google Drive: " + (driveError && driveError.message ? driveError.message : String(driveError))
    };
  }

  // Step 7: Persistence & Linking under short ScriptLock
  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000); // 5 seconds max wait for persistence

  if (!lockAcquired) {
    if (createdFile) {
      try { createdFile.setTrashed(true); } catch (e) { Logger.log("Failed to trash file: " + e); }
    }
    return {
      success: false,
      message: "Server sedang sibuk memproses antrean persistence. Silakan coba lagi."
    };
  }

  try {
    // RE-CHECK under lock: Ensure no other concurrent request recorded evidence for this session
    const recheckMatches = findAttendanceEvidenceRowsBySessionId(evidenceSheet, normalizedSessionId);

    if (recheckMatches.length > 0) {
      // Concurrent request already recorded evidence -> trash the newly created duplicate file
      if (createdFile) {
        try { createdFile.setTrashed(true); } catch (e) { Logger.log("Failed to trash duplicate file: " + e); }
      }

      if (recheckMatches.length > 1) {
        return {
          success: false,
          message: "DATA INCONSISTENCY: Ditemukan lebih dari 1 data evidence untuk sesi ini."
        };
      }

      const concurrentEvidence = buildAttendanceEvidenceObject(
        recheckMatches[0].headers,
        recheckMatches[0].rowValues
      );

      return {
        success: true,
        message: "Evidence untuk sesi ini sudah tercatat oleh proses lain.",
        evidence: concurrentEvidence
      };
    }

    const evidenceId = "EVID-" + Utilities.getUuid().substring(0, 12);
    const row = [
      evidenceId,
      normalizedSessionId,
      operatorId,
      capturedAt,
      fileId,
      fileUrl
    ];

    // Append to AttendanceEvidences sheet
    evidenceSheet.appendRow(row);

    // Link evidenceId to ResponderSessions
    const linkResult = linkEvidenceToSession(normalizedSessionId, evidenceId);

    if (!linkResult.success) {
      // State 2: Evidence row and Drive file exist, but session link failed.
      // Do NOT delete the evidence row; return clear error for deterministic reconciliation on retry.
      return {
        success: false,
        message: "Evidence tersimpan tetapi gagal ditautkan ke sesi (" + (linkResult.message || "") + "). Silakan coba lagi untuk rekonsiliasi.",
        evidence: {
          evidenceId: evidenceId,
          sessionId: normalizedSessionId,
          operatorId: operatorId,
          capturedAt: capturedAt,
          fileId: fileId,
          fileUrl: fileUrl
        }
      };
    }

    return {
      success: true,
      message: "Evidence berhasil disimpan dan ditautkan ke sesi.",
      evidence: {
        evidenceId: evidenceId,
        sessionId: normalizedSessionId,
        operatorId: operatorId,
        capturedAt: capturedAt,
        fileId: fileId,
        fileUrl: fileUrl
      }
    };

  } catch (persistenceError) {
    // If appendRow or lock persistence crashed before successful state recording, best-effort trash file
    if (createdFile) {
      try { createdFile.setTrashed(true); } catch (e) { Logger.log("Failed to trash file after persistence error: " + e); }
    }
    return {
      success: false,
      message: "Gagal menyimpan metadata evidence ke database: " + (persistenceError && persistenceError.message ? persistenceError.message : String(persistenceError))
    };
  } finally {
    lock.releaseLock();
  }
}

