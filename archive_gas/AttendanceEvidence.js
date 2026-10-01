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
  "fileUrl",
  "attendanceId"
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

/**
 * Ensure AttendanceEvidences sheet has all required headers, including column 7 attendanceId
 */
function ensureAttendanceEvidenceHeaders(sheet) {
  if (!sheet) return;
  const headers = getSheetHeaders(sheet);
  if (headers.length === 0) {
    sheet.getRange(1, 1, 1, ATTENDANCE_EVIDENCE_HEADERS.length).setValues([ATTENDANCE_EVIDENCE_HEADERS]);
    return;
  }
  const headerMap = getHeaderMap(headers);
  if (headerMap["attendanceId"] === undefined || headerMap["attendanceId"] === -1) {
    sheet.getRange(1, headers.length + 1).setValue("attendanceId");
  }
}

/**
 * Find attendance evidence row by attendanceId
 */
function findAttendanceEvidenceRowByAttendanceId(sheet, attendanceId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const attIdIndex = headerMap["attendanceId"];

  if (attIdIndex === undefined || attIdIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedAttId = normalizeString(attendanceId);

  for (let i = 0; i < values.length; i++) {
    if (normalizeString(values[i][attIdIndex]) === normalizedAttId) {
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
 * Save evidence photo for Teacher Attendance to Google Drive and link to attendanceId(s).
 * 
 * Order of operation:
 * 1. Validate photoDataUrl and attendanceIds.
 * 2. Upload file to Google Drive folder CONFIG.EVIDENCE_FOLDER_ID.
 * 3. Open AttendanceEvidences sheet and ensure headers (column 7 attendanceId).
 * 4. Append row(s) under ScriptLock for each attendanceId.
 * 5. Returns { success: true, fileId, fileUrl, evidenceIds } or { success: false, message }.
 */
function saveTeacherAttendanceEvidence(sessionId, operatorId, photoDataUrl, attendanceIds) {
  if (!photoDataUrl || typeof photoDataUrl !== "string") {
    return { success: false, message: "Data foto bukti tidak valid atau kosong." };
  }
  if (!Array.isArray(attendanceIds) || attendanceIds.length === 0) {
    return { success: false, message: "Daftar attendanceId tidak boleh kosong untuk menautkan bukti foto." };
  }

  const imageParseResult = parseImagePayload(photoDataUrl);
  if (!imageParseResult.success) {
    return imageParseResult;
  }

  const folderResult = getEvidenceDriveFolder();
  if (!folderResult.success) {
    return folderResult;
  }

  const folder = folderResult.folder;
  const now = new Date();
  const timestampStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
  const capturedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const shortId = Utilities.getUuid().substring(0, 6);
  const filename = "TEACHER_EVIDENCE_" + attendanceIds[0] + "_" + timestampStr + "_" + shortId + ".jpg";

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

  const sheetResult = getAttendanceEvidenceSheet();
  if (!sheetResult.success) {
    if (createdFile) {
      try { createdFile.setTrashed(true); } catch (e) {}
    }
    return sheetResult;
  }
  const sheet = sheetResult.sheet;
  ensureAttendanceEvidenceHeaders(sheet);

  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000);
  if (!lockAcquired) {
    if (createdFile) {
      try { createdFile.setTrashed(true); } catch (e) {}
    }
    return {
      success: false,
      message: "Server sedang sibuk memproses antrean persistence bukti foto."
    };
  }

  try {
    const createdEvidenceIds = [];
    attendanceIds.forEach(function(attId) {
      const evidenceId = "EVID-TCH-" + timestampStr + "-" + Utilities.getUuid().substring(0, 6);
      sheet.appendRow([
        evidenceId,
        sessionId || "",
        operatorId || "",
        capturedAt,
        fileId,
        fileUrl,
        attId
      ]);
      createdEvidenceIds.push(evidenceId);
    });

    return {
      success: true,
      fileId: fileId,
      fileUrl: fileUrl,
      evidenceIds: createdEvidenceIds
    };
  } catch (err) {
    if (createdFile) {
      try { createdFile.setTrashed(true); } catch (e) {}
    }
    return {
      success: false,
      message: "Gagal menyimpan record evidence ke sheet: " + (err && err.message ? err.message : String(err))
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Admin endpoint: Get teacher attendance records and their photo evidence status for a specific date.
 * Server-side authorization enforced: valid session token + ADMIN role required.
 */
function getTeacherPhotoEvidenceByDate(token, dateStr) {
  // Step 1: Server-side authorization check (ADMIN only)
  const adminCheck = validateAdminSession(token);
  if (!adminCheck || !adminCheck.valid) {
    return {
      success: false,
      message: (adminCheck && adminCheck.message) || "Akses ditolak: Hanya Admin yang berwenang mengakses bukti foto."
    };
  }

  // Step 2: Date validation
  if (!dateStr || typeof dateStr !== "string" || !dateStr.trim()) {
    return {
      success: false,
      message: "Tanggal wajib diisi."
    };
  }

  const cleanDate = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return {
      success: false,
      message: "Format tanggal tidak valid. Gunakan format YYYY-MM-DD."
    };
  }

  // Step 3: Fetch TeacherAttendance records for the date
  const attRes = getTeacherAttendance({ date: cleanDate });
  if (!attRes || !attRes.success) {
    return {
      success: false,
      message: (attRes && attRes.message) || "Gagal memuat absensi guru dari database."
    };
  }

  const attendances = attRes.attendances || [];

  // Step 4: Build evidence map from AttendanceEvidences sheet
  const evidenceMapByAttId = {};
  const evidenceSheetRes = getAttendanceEvidenceSheet();
  if (evidenceSheetRes.success) {
    const evSheet = evidenceSheetRes.sheet;
    ensureAttendanceEvidenceHeaders(evSheet);
    const evHeaders = getSheetHeaders(evSheet);
    const evHeaderMap = getHeaderMap(evHeaders);
    const attIdCol = evHeaderMap["attendanceId"];
    const evIdCol = evHeaderMap["evidenceId"];
    const fileIdCol = evHeaderMap["fileId"];
    const capturedAtCol = evHeaderMap["capturedAt"];

    if (attIdCol !== undefined && attIdCol !== -1 && evSheet.getLastRow() > 1) {
      const evValues = evSheet.getRange(2, 1, evSheet.getLastRow() - 1, evHeaders.length).getValues();
      for (let i = 0; i < evValues.length; i++) {
        const aId = normalizeString(evValues[i][attIdCol]);
        if (aId) {
          evidenceMapByAttId[aId] = {
            evidenceId: normalizeString(evValues[i][evIdCol]),
            fileId: normalizeString(evValues[i][fileIdCol]),
            capturedAt: normalizeString(evValues[i][capturedAtCol])
          };
        }
      }
    }
  }

  // Step 5: Master lookups for teacher and class metadata
  let teacherLookup = {};
  try {
    const tRes = getTeachers();
    if (tRes && tRes.success && Array.isArray(tRes.teachers)) {
      tRes.teachers.forEach(function(t) {
        teacherLookup[t.teacherId] = {
          name: t.name || t.teacherId,
          nik: t.nik || '-',
          nip: t.nip || '-',
          nuptk: t.nuptk || '-'
        };
      });
    }
  } catch (e) {}

  let classLookup = {};
  try {
    const cRes = getClasses();
    if (cRes && cRes.success && Array.isArray(cRes.classes)) {
      cRes.classes.forEach(function(c) {
        classLookup[c.classId] = c.className || c.classId;
      });
    }
  } catch (e) {}

  // Step 6: Map records
  const records = attendances.map(function(att) {
    const tInfo = teacherLookup[att.teacherId] || {};
    const tName = att.teacherName || tInfo.name || att.teacherId;
    const cName = classLookup[att.classId] || att.className || att.classId || '-';
    const evInfo = evidenceMapByAttId[att.attendanceId];
    const hasPhoto = Boolean(evInfo && evInfo.fileId);

    // Format nik/nonik
    let nikDisplay = '-';
    if (tInfo.nik && tInfo.nik !== '-') {
      nikDisplay = tInfo.nik;
    } else if (tInfo.nip && tInfo.nip !== '-') {
      nikDisplay = tInfo.nip;
    } else if (tInfo.nuptk && tInfo.nuptk !== '-') {
      nikDisplay = tInfo.nuptk;
    }

    return {
      attendanceId: att.attendanceId,
      date: att.date,
      teacherId: att.teacherId,
      teacherName: tName,
      nik: nikDisplay,
      period: att.period,
      classId: att.classId,
      className: cName,
      status: att.status,
      method: att.method,
      timestamp: att.timestamp,
      subject: att.subject,
      materi: att.materi,
      hasPhoto: hasPhoto,
      evidenceId: evInfo ? evInfo.evidenceId : ""
    };
  });

  // Sort records: Jam ke- ascending, then teacher name
  records.sort(function(a, b) {
    const pA = parseInt(a.period, 10) || 999;
    const pB = parseInt(b.period, 10) || 999;
    if (pA !== pB) return pA - pB;
    return (a.teacherName || '').localeCompare(b.teacherName || '');
  });

  return {
    success: true,
    date: cleanDate,
    total: records.length,
    records: records
  };
}

/**
 * Admin endpoint: Retrieve photo evidence image (Base64 DataURL) and metadata for an attendance record.
 * Server-side authorization enforced: valid session token + ADMIN role required.
 * IDOR protection: Validates attendanceId existence and verifies evidence ownership.
 */
function getTeacherPhotoDetail(token, attendanceId) {
  // Step 1: Server-side authorization check (ADMIN only)
  const adminCheck = validateAdminSession(token);
  if (!adminCheck || !adminCheck.valid) {
    return {
      success: false,
      message: (adminCheck && adminCheck.message) || "Akses ditolak: Hanya Admin yang berwenang melihat foto bukti."
    };
  }

  // Step 2: Validate attendanceId
  const cleanAttId = normalizeString(attendanceId);
  if (!cleanAttId) {
    return {
      success: false,
      message: "attendanceId tidak boleh kosong."
    };
  }

  // Step 3: Look up AttendanceEvidences by attendanceId
  const evidenceSheetRes = getAttendanceEvidenceSheet();
  if (!evidenceSheetRes.success) {
    return evidenceSheetRes;
  }

  const evSheet = evidenceSheetRes.sheet;
  ensureAttendanceEvidenceHeaders(evSheet);
  const evMatch = findAttendanceEvidenceRowByAttendanceId(evSheet, cleanAttId);
  if (!evMatch) {
    return {
      success: false,
      message: "Bukti foto tidak ditemukan untuk absensi ini."
    };
  }

  const evObj = buildAttendanceEvidenceObject(evMatch.headers, evMatch.rowValues);
  const fileId = evObj.fileId;
  if (!fileId) {
    return {
      success: false,
      message: "File ID bukti foto tidak valid pada database."
    };
  }

  // Step 4: Fetch image file from Google Drive
  let file = null;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (driveErr) {
    return {
      success: false,
      message: "Foto tidak dapat ditampilkan: File di Google Drive tidak ditemukan atau akses terbatas."
    };
  }

  if (!file) {
    return {
      success: false,
      message: "Foto tidak dapat ditampilkan: File di Google Drive tidak ditemukan."
    };
  }

  // Step 5: Read bytes & construct Base64 DataURL
  let photoDataUrl = "";
  try {
    const mimeType = file.getMimeType() || "image/jpeg";
    const bytes = file.getBlob().getBytes();
    if (!bytes || bytes.length === 0) {
      return {
        success: false,
        message: "Foto tidak dapat ditampilkan: Data file kosong."
      };
    }
    photoDataUrl = "data:" + mimeType + ";base64," + Utilities.base64Encode(bytes);
  } catch (readErr) {
    return {
      success: false,
      message: "Gagal membaca konten foto dari Google Drive: " + (readErr && readErr.message ? readErr.message : String(readErr))
    };
  }

  return {
    success: true,
    attendanceId: cleanAttId,
    evidenceId: evObj.evidenceId,
    photoDataUrl: photoDataUrl
  };
}


