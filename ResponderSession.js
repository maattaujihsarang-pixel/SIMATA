/**
 * SIMATA Responder Session Backend
 * Phase 4.2 - QR + Responder Implementation
 * 
 * Manages responder sessions for absensi siswa
 * Schema: sessionId, operatorId, startedAt, finishedAt, evidenceId, status
 */

const RESPONDER_SESSION_HEADERS = [
  "sessionId",
  "operatorId",
  "startedAt",
  "finishedAt",
  "evidenceId",
  "status"
];

const RESPONDER_STATUS_ACTIVE = "ACTIVE";
const RESPONDER_STATUS_FINISHED = "FINISHED";
const RESPONDER_STATUS_CANCELLED = "CANCELLED";

function getResponderSessionSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_RESPONDER_SESSIONS);

  if (!sheet) {
    return { success: false, message: "Sheet ResponderSessions tidak ditemukan." };
  }

  return { success: true, sheet: sheet };
}

function buildResponderSessionObject(headers, row) {
  const session = {};

  RESPONDER_SESSION_HEADERS.forEach(function(header) {
    const idx = headers.indexOf(header);
    session[header] = idx !== -1 ? normalizeString(row[idx]) : "";
  });

  return session;
}

function findResponderSessionRowById(sheet, sessionId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["sessionId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(sessionId);

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

function validateResponderStatus(status) {
  const normalized = normalizeString(status);
  const allowed = [RESPONDER_STATUS_ACTIVE, RESPONDER_STATUS_FINISHED, RESPONDER_STATUS_CANCELLED];

  if (!allowed.includes(normalized)) {
    return {
      success: false,
      message: "Status harus ACTIVE, FINISHED, atau CANCELLED."
    };
  }

  return {
    success: true,
    value: normalized
  };
}

/**
 * Get responder session by ID
 * Returns current session including its operator, evidence, status
 */
function getResponderSessionById(sessionId) {
  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(sessionId)) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const sessionRow = findResponderSessionRowById(sheetResult.sheet, sessionId);
  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  return {
    success: true,
    session: buildResponderSessionObject(sessionRow.headers, sessionRow.rowValues)
  };
}

/**
 * Helper: Retrieve user role from Users sheet
 */
function getAuthenticatedUserRole(username) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) {
    return null;
  }

  const data = sheet.getDataRange().getValues();
  const normalizedUsername = normalizeString(username);

  for (let i = 1; i < data.length; i++) {
    if (normalizeString(data[i][0]) === normalizedUsername) {
      return normalizeString(data[i][3]); // role column
    }
  }

  return null;
}

/**
 * Helper: Validate whether role is permitted for Responder (ADMIN and GURU only)
 */
function isResponderRoleAllowed(role) {
  const normalizedRole = normalizeString(role).toLowerCase();
  return (
    normalizedRole === "admin" ||
    normalizedRole === "administrator" ||
    normalizedRole === "guru" ||
    normalizedRole === "teacher"
  );
}

/**
 * Create new responder session
 * Requires valid session token
 * Resolves operatorId from server-side validated session
 * Role Guard: Only ADMIN and GURU are allowed to create responder sessions
 * Returns sessionId and initial status ACTIVE
 */
function createResponderSession(token) {
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

  // Role Guard: Only Admin & Guru are permitted
  const userRole = getAuthenticatedUserRole(operatorId);
  if (!userRole || !isResponderRoleAllowed(userRole)) {
    return {
      success: false,
      message: "Akses ditolak: Hanya Admin dan Guru yang diizinkan membuat sesi responder."
    };
  }

  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;

  // Generate unique sessionId (UUID-based)
  const sessionId = "SESSION-" + Utilities.getUuid().substring(0, 12);

  // Check if sessionId somehow exists (very unlikely with UUID)
  if (findResponderSessionRowById(sheet, sessionId)) {
    return {
      success: false,
      message: "Gagal generate sessionId unik."
    };
  }

  const now = new Date();
  const startedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");

  const row = [
    sessionId,
    operatorId,
    startedAt,
    "", // finishedAt empty initially
    "", // evidenceId empty initially
    RESPONDER_STATUS_ACTIVE
  ];

  sheet.appendRow(row);

  return {
    success: true,
    message: "Responder session berhasil dibuat.",
    session: {
      sessionId: sessionId,
      operatorId: operatorId,
      startedAt: startedAt,
      finishedAt: "",
      evidenceId: "",
      status: RESPONDER_STATUS_ACTIVE
    }
  };
}

/**
 * Link evidence to responder session
 * Called when evidence photo is captured and uploaded
 */
function linkEvidenceToSession(sessionId, evidenceId) {
  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sessionId_normalized = normalizeString(sessionId);
  const evidenceId_normalized = normalizeString(evidenceId);

  if (!sessionId_normalized || !evidenceId_normalized) {
    return {
      success: false,
      message: "sessionId dan evidenceId wajib diisi."
    };
  }

  const sheet = sheetResult.sheet;
  const sessionRow = findResponderSessionRowById(sheet, sessionId_normalized);

  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  const status = normalizeString(sessionRow.rowValues[sessionRow.headerMap["status"]]);

  if (status !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat menerima evidence."
    };
  }

  const rowValues = sessionRow.rowValues.slice();
  rowValues[sessionRow.headerMap["evidenceId"]] = evidenceId_normalized;

  sheet.getRange(sessionRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Evidence berhasil dikaitkan ke session."
  };
}

/**
 * Finish responder session
 * Marks session as FINISHED
 * Requires valid token and verifies caller is session owner
 * Session dapat selesai hanya jika status ACTIVE
 */
function finishResponderSession(token, sessionId) {
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

  const authenticatedUsername = normalizeString(session.username);
  if (!authenticatedUsername) {
    return {
      success: false,
      message: "Identitas pengguna tidak valid."
    };
  }

  // Step 2: Validate Session ID
  const sessionId_normalized = normalizeString(sessionId);
  if (!sessionId_normalized) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const sessionRow = findResponderSessionRowById(sheet, sessionId_normalized);

  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  // Step 3: Verify Status ACTIVE
  const status = normalizeString(sessionRow.rowValues[sessionRow.headerMap["status"]]);
  if (status !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat di-finish. Status saat ini: " + status
    };
  }

  // Step 4: Ownership Check (session.operatorId === authenticated username)
  const sessionOperatorId = normalizeString(sessionRow.rowValues[sessionRow.headerMap["operatorId"]]);
  if (sessionOperatorId !== authenticatedUsername) {
    return {
      success: false,
      message: "Akses ditolak: Anda bukan operator pemilik sesi responder ini."
    };
  }

  // Step 5: Update Session to FINISHED
  const now = new Date();
  const finishedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");

  const rowValues = sessionRow.rowValues.slice();
  rowValues[sessionRow.headerMap["finishedAt"]] = finishedAt;
  rowValues[sessionRow.headerMap["status"]] = RESPONDER_STATUS_FINISHED;

  sheet.getRange(sessionRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Responder session berhasil diselesaikan.",
    session: buildResponderSessionObject(sessionRow.headers, rowValues)
  };
}

/**
 * Cancel responder session
 * Marks session as CANCELLED
 * Requires valid token and verifies caller is session owner
 * Dapat dibatalkan hanya jika status ACTIVE
 */
function cancelResponderSession(token, sessionId) {
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

  const authenticatedUsername = normalizeString(session.username);
  if (!authenticatedUsername) {
    return {
      success: false,
      message: "Identitas pengguna tidak valid."
    };
  }

  // Step 2: Validate Session ID
  const sessionId_normalized = normalizeString(sessionId);
  if (!sessionId_normalized) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const sessionRow = findResponderSessionRowById(sheet, sessionId_normalized);

  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  // Step 3: Verify Status ACTIVE
  const status = normalizeString(sessionRow.rowValues[sessionRow.headerMap["status"]]);
  if (status !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat dibatalkan. Status saat ini: " + status
    };
  }

  // Step 4: Ownership Check (session.operatorId === authenticated username)
  const sessionOperatorId = normalizeString(sessionRow.rowValues[sessionRow.headerMap["operatorId"]]);
  if (sessionOperatorId !== authenticatedUsername) {
    return {
      success: false,
      message: "Akses ditolak: Anda bukan operator pemilik sesi responder ini."
    };
  }

  // Step 5: Update Session to CANCELLED
  const now = new Date();
  const finishedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");

  const rowValues = sessionRow.rowValues.slice();
  rowValues[sessionRow.headerMap["finishedAt"]] = finishedAt;
  rowValues[sessionRow.headerMap["status"]] = RESPONDER_STATUS_CANCELLED;

  sheet.getRange(sessionRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Responder session berhasil dibatalkan.",
    session: buildResponderSessionObject(sessionRow.headers, rowValues)
  };
}

/**
 * Get all responder sessions (for admin dashboard)
 * Supports filter by operatorId, status, date range
 */
function getResponderSessions(filters) {
  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return { success: true, sessions: [] };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedFilters = {};

  if (filters) {
    Object.keys(filters).forEach(function(k) {
      normalizedFilters[k] = normalizeString(filters[k]);
    });
  }

  const sessions = rows.map(function(row) {
    return buildResponderSessionObject(headers, row);
  }).filter(function(session) {
    if (!normalizedFilters || Object.keys(normalizedFilters).length === 0) {
      return true;
    }

    return Object.keys(normalizedFilters).every(function(key) {
      if (!normalizedFilters[key]) {
        return true;
      }

      return normalizeString(session[key]) === normalizedFilters[key];
    });
  });

  return { success: true, sessions: sessions };
}

/**
 * Protected Responder Student Lookup
 * 
 * Verifies:
 * 1. Token is valid (SessionManager.validate(token))
 * 2. Session exists, status is ACTIVE
 * 3. Session ownership (session.operatorId === authenticated username)
 * 4. Operator role is permitted (ADMIN or GURU only)
 * 5. qrCodeId maps to a valid student
 * 
 * Returns ONLY minimal operational student data (Data Minimization):
 * - studentId, name, nis, nisn, classId, status
 * (Excludes sensitive fields: gender, birthDate, qrCodeId)
 */
function lookupStudentByQr(token, sessionId, qrCodeId) {
  // Step 1: Validate session token
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

  const authenticatedUsername = normalizeString(session.username);
  if (!authenticatedUsername) {
    return {
      success: false,
      message: "Identitas pengguna tidak valid."
    };
  }

  // Step 2: Validate Session ID
  const sessionId_normalized = normalizeString(sessionId);
  if (!sessionId_normalized) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const sessionRow = findResponderSessionRowById(sheet, sessionId_normalized);

  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  // Step 3: Verify Status ACTIVE
  const status = normalizeString(sessionRow.rowValues[sessionRow.headerMap["status"]]);
  if (status !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat melakukan lookup QR siswa. Status sesi: " + status
    };
  }

  // Step 4: Ownership Check (session.operatorId === authenticated username)
  const sessionOperatorId = normalizeString(sessionRow.rowValues[sessionRow.headerMap["operatorId"]]);
  if (sessionOperatorId !== authenticatedUsername) {
    return {
      success: false,
      message: "Akses ditolak: Anda bukan operator pemilik sesi responder ini."
    };
  }

  // Step 5: Role Guard (Only ADMIN and GURU are allowed)
  const userRole = getAuthenticatedUserRole(authenticatedUsername);
  if (!userRole || !isResponderRoleAllowed(userRole)) {
    return {
      success: false,
      message: "Akses ditolak: Hanya Admin dan Guru yang diizinkan melakukan pemindaian siswa."
    };
  }

  // Step 6: Validate QR Code ID
  const qrCodeId_normalized = normalizeString(qrCodeId);
  if (!qrCodeId_normalized) {
    return {
      success: false,
      message: "qrCodeId tidak boleh kosong."
    };
  }

  // Step 7: Resolve studentId from qrCodeId
  const studentId = getStudentIdByQrCodeId(qrCodeId_normalized);
  if (!studentId) {
    return {
      success: false,
      message: "QR Code \"" + qrCodeId_normalized + "\" tidak terdaftar pada database siswa."
    };
  }

  // Step 8: Fetch full student record
  const studentResult = getStudentById(studentId);
  if (!studentResult || !studentResult.success || !studentResult.student) {
    return {
      success: false,
      message: (studentResult && studentResult.message) || "Data siswa tidak ditemukan."
    };
  }

  const rawStudent = studentResult.student;

  // Step 9: Data Minimization - Return ONLY required operational fields
  const sanitizedStudent = {
    studentId: normalizeString(rawStudent.studentId),
    name: normalizeString(rawStudent.name),
    nis: normalizeString(rawStudent.nis),
    nisn: normalizeString(rawStudent.nisn),
    classId: normalizeString(rawStudent.classId),
    status: normalizeString(rawStudent.status) || "Active"
  };

  return {
    success: true,
    student: sanitizedStudent
  };
}

/**
 * Protected Responder Student Attendance Recording
 * 
 * Server-Enforced Security Flow:
 * 1. Validate session token -> authenticatedUsername
 * 2. Validate sessionId -> session must exist & status === ACTIVE
 * 3. Validate session ownership: session.operatorId === authenticatedUsername
 * 4. Role Guard: operator role must be ADMIN or GURU
 * 5. Server-side Student Resolution:
 *    - qrCodeId -> studentId (via getStudentIdByQrCodeId)
 *    - studentId -> student record (via getStudentById)
 *    - student.classId -> class record (via getClassById)
 *    - class.academicYear -> resolved academicYear
 * 6. Status validation: validateAttendanceStatus(status || "Hadir")
 * 7. Server-generated values:
 *    - date: YYYY-MM-DD from server clock
 *    - timestamp: ISO datetime from server clock
 *    - method: forced to "QR"
 *    - attendanceId: auto-generated structured ID
 * 8. Call createStudentAttendance({ ... }) -> native duplicate protection
 * 9. Multi-Student Session: does not finish or cancel session
 */
function recordStudentAttendanceFromQr(token, sessionId, qrCodeId, status, note) {
  // Step 1: Validate session token
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

  const authenticatedUsername = normalizeString(session.username);
  if (!authenticatedUsername) {
    return {
      success: false,
      message: "Identitas pengguna tidak valid."
    };
  }

  // Step 2: Validate Session ID & existence
  const sessionId_normalized = normalizeString(sessionId);
  if (!sessionId_normalized) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const sheetResult = getResponderSessionSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const sessionRow = findResponderSessionRowById(sheet, sessionId_normalized);

  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  // Step 3: Verify Status ACTIVE
  const sessionStatus = normalizeString(sessionRow.rowValues[sessionRow.headerMap["status"]]);
  if (sessionStatus !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat mencatat absensi siswa. Status sesi: " + sessionStatus
    };
  }

  // Step 4: Ownership Check (session.operatorId === authenticated username)
  const sessionOperatorId = normalizeString(sessionRow.rowValues[sessionRow.headerMap["operatorId"]]);
  if (sessionOperatorId !== authenticatedUsername) {
    return {
      success: false,
      message: "Akses ditolak: Anda bukan operator pemilik sesi responder ini."
    };
  }

  // Step 5: Role Guard (Only ADMIN and GURU are allowed)
  const userRole = getAuthenticatedUserRole(authenticatedUsername);
  if (!userRole || !isResponderRoleAllowed(userRole)) {
    return {
      success: false,
      message: "Akses ditolak: Hanya Admin dan Guru yang diizinkan mencatat absensi siswa."
    };
  }

  // Step 6: Resolve studentId from qrCodeId
  const qrCodeId_normalized = normalizeString(qrCodeId);
  if (!qrCodeId_normalized) {
    return {
      success: false,
      message: "qrCodeId tidak boleh kosong."
    };
  }

  const studentId = getStudentIdByQrCodeId(qrCodeId_normalized);
  if (!studentId) {
    return {
      success: false,
      message: "QR Code \"" + qrCodeId_normalized + "\" tidak terdaftar pada database siswa."
    };
  }

  // Step 8: Resolve student record
  const studentResult = getStudentById(studentId);
  if (!studentResult || !studentResult.success || !studentResult.student) {
    return {
      success: false,
      message: (studentResult && studentResult.message) || "Data siswa tidak ditemukan."
    };
  }

  const student = studentResult.student;
  const classId = normalizeString(student.classId);
  if (!classId) {
    return {
      success: false,
      message: "Siswa tidak memiliki data kelas aktif."
    };
  }

  // Step 9: Resolve academicYear from Classes master
  const classResult = getClassById(classId);
  if (!classResult || !classResult.success || !classResult.class) {
    return {
      success: false,
      message: "Data kelas siswa tidak ditemukan."
    };
  }

  const academicYear = normalizeString(classResult.class.academicYear);
  if (!academicYear) {
    return {
      success: false,
      message: "Tahun akademik untuk kelas siswa tidak ditemukan."
    };
  }

  // Step 10: Validate attendance status (Hadir / Izin / Sakit / Alpa)
  const statusValidation = validateAttendanceStatus(status || "Hadir");
  if (!statusValidation.success) {
    return statusValidation;
  }

  // Step 11: Server-generated fields
  const now = new Date();
  const date = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const attendanceId = "ATT-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().substring(0, 8);
  const note_normalized = normalizeString(note);

  // Step 12: Construct attendance payload
  const attendanceData = {
    attendanceId: attendanceId,
    date: date,
    academicYear: academicYear,
    studentId: studentId,
    classId: classId,
    status: statusValidation.value,
    method: "QR",
    timestamp: timestamp,
    note: note_normalized
  };

  // Step 13: Call createStudentAttendance (handles native duplicate check)
  const createResult = createStudentAttendance(attendanceData);
  if (!createResult || !createResult.success) {
    return createResult;
  }

  return {
    success: true,
    message: "Presensi siswa berhasil dicatat.",
    attendance: createResult.attendance,
    student: {
      studentId: student.studentId,
      name: student.name,
      nis: student.nis,
      classId: classId,
      status: statusValidation.value
    }
  };
}
