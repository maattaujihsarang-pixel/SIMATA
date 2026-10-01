const TEACHER_ATTENDANCE_HEADERS = [
  "attendanceId",
  "date",
  "academicYear",
  "teacherId",
  "status",
  "method",
  "timestamp",
  "note",
  "period",
  "subject",
  "materi",
  "classId"
];

function getTeacherAttendanceSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_TEACHER_ATTENDANCE);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet TeacherAttendance tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function buildTeacherAttendanceObject(headers, row) {
  const attendance = {};

  TEACHER_ATTENDANCE_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    attendance[header] = index !== -1 ? normalizeString(row[index]) : "";
  });

  return attendance;
}

function findTeacherAttendanceRowById(sheet, attendanceId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["attendanceId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(attendanceId);

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



function validateAttendanceStatus(status) {
  const allowed = ["Hadir", "Izin", "Sakit", "Alpa"];
  const normalized = normalizeString(status);
  if (!allowed.includes(normalized)) {
    return {
      success: false,
      message: "Status attendance harus salah satu: Hadir, Izin, Sakit, Alpa."
    };
  }
  return {
    success: true,
    value: normalized
  };
}

function validateAttendanceMethod(method) {
  const allowed = ["Manual", "QR"];
  const normalized = normalizeString(method);
  if (!normalized) {
    return {
      success: true,
      value: ""
    };
  }
  if (!allowed.includes(normalized)) {
    return {
      success: false,
      message: "Method attendance harus Manual atau QR."
    };
  }
  return {
    success: true,
    value: normalized
  };
}

function validateDateFormat(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return {
      success: false,
      message: "date wajib diisi dengan format YYYY-MM-DD."
    };
  }

  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoPattern.test(normalized)) {
    return {
      success: false,
      message: "date harus dalam format YYYY-MM-DD."
    };
  }

  return {
    success: true,
    value: normalized
  };
}

function validateTeacherId(teacherId) {
  const normalized = normalizeString(teacherId);
  if (!normalized) {
    return {
      success: false,
      message: "teacherId wajib diisi."
    };
  }

  const teacherResult = getTeacherById(normalized);
  if (!teacherResult.success) {
    return {
      success: false,
      message: "teacherId tidak valid atau guru tidak ditemukan."
    };
  }

  return {
    success: true,
    value: normalized
  };
}

function validateClassIdForTeacherAttendance(classId) {
  const normalized = normalizeString(classId);
  if (!normalized) {
    return {
      success: false,
      message: "Kelas yang diajar (classId) wajib dipilih."
    };
  }

  const classResult = getClassById(normalized);
  if (!classResult || !classResult.success || !classResult.class) {
    return {
      success: false,
      message: "classId tidak valid atau kelas tidak ditemukan."
    };
  }

  const classStatus = normalizeString(classResult.class.status);
  if (classStatus && classStatus !== "Active") {
    return {
      success: false,
      message: "Kelas tidak aktif (" + classStatus + ")."
    };
  }

  return {
    success: true,
    value: normalized,
    className: normalizeString(classResult.class.className) || normalized
  };
}

function getTeacherIdByQrCodeId(qrCodeId) {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return null;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const qrIndex = headerMap["qrCodeId"];
  const idIndex = headerMap["teacherId"];

  if (qrIndex === undefined || qrIndex === -1 || idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedQr = normalizeString(qrCodeId);
  if (!normalizedQr) {
    return null;
  }

  for (let i = 0; i < values.length; i++) {
    if (normalizeString(values[i][qrIndex]) === normalizedQr) {
      return normalizeString(values[i][idIndex]);
    }
  }

  return null;
}

function getTeacherAttendance(filters) {
  const sheetResult = getTeacherAttendanceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      success: true,
      attendances: []
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedFilters = {};
  if (filters) {
    Object.keys(filters).forEach(function(key) {
      normalizedFilters[key] = normalizeString(filters[key]);
    });
  }

  const attendances = rows.map(function(row) {
    return buildTeacherAttendanceObject(headers, row);
  }).filter(function(attendance) {
    if (!normalizedFilters || Object.keys(normalizedFilters).length === 0) {
      return true;
    }
    return Object.keys(normalizedFilters).every(function(key) {
      if (!normalizedFilters[key]) {
        return true;
      }
      return normalizeString(attendance[key]) === normalizedFilters[key];
    });
  });

  const classMap = {};
  try {
    const classesRes = getClasses();
    if (classesRes && classesRes.success && Array.isArray(classesRes.classes)) {
      classesRes.classes.forEach(function(c) {
        if (c.classId) {
          classMap[c.classId] = c.className || c.classId;
        }
      });
    }
  } catch (e) {}

  attendances.forEach(function(att) {
    att.className = classMap[att.classId] || "";
  });

  return {
    success: true,
    attendances: attendances
  };
}

function getTeacherAttendanceById(attendanceId) {
  const sheetResult = getTeacherAttendanceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(attendanceId)) {
    return {
      success: false,
      message: "attendanceId tidak boleh kosong."
    };
  }

  const attendanceRow = findTeacherAttendanceRowById(sheetResult.sheet, attendanceId);
  if (!attendanceRow) {
    return {
      success: false,
      message: "Data attendance tidak ditemukan."
    };
  }

  const att = buildTeacherAttendanceObject(attendanceRow.headers, attendanceRow.rowValues);
  try {
    const classRes = getClassById(att.classId);
    att.className = (classRes && classRes.success && classRes.class && classRes.class.className) || "";
  } catch (e) {}

  return {
    success: true,
    attendance: att
  };
}

function createTeacherAttendance(data) {
  const sheetResult = getTeacherAttendanceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;

  const attendanceId = normalizeString(data.attendanceId);
  if (!attendanceId) {
    return {
      success: false,
      message: "attendanceId wajib diisi."
    };
  }

  if (findTeacherAttendanceRowById(sheet, attendanceId)) {
    return {
      success: false,
      message: "attendanceId sudah digunakan."
    };
  }

  const dateValidation = validateDateFormat(data.date);
  if (!dateValidation.success) {
    return dateValidation;
  }

  const academicYear = normalizeString(data.academicYear);
  if (!academicYear) {
    return {
      success: false,
      message: "academicYear wajib diisi."
    };
  }

  let teacherId = normalizeString(data.teacherId);
  if (!teacherId && normalizeString(data.qrCodeId)) {
    teacherId = getTeacherIdByQrCodeId(data.qrCodeId);
  }

  const teacherValidation = validateTeacherId(teacherId);
  if (!teacherValidation.success) {
    return teacherValidation;
  }

  const statusValidation = validateAttendanceStatus(data.status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const methodValidation = validateAttendanceMethod(data.method);
  if (!methodValidation.success) {
    return methodValidation;
  }

  const timestamp = normalizeString(data.timestamp);
  const note = normalizeString(data.note);
  const period = normalizeString(data.period || data.jamKe);
  const subject = normalizeString(data.subject);
  const materi = normalizeString(data.materi || data.content);

  let classId = normalizeString(data.classId);
  if (classId) {
    const classValidation = validateClassIdForTeacherAttendance(classId);
    if (!classValidation.success) {
      return classValidation;
    }
    classId = classValidation.value;
  }

  ensureTeacherAttendanceHeaders(sheet);

  const row = [
    attendanceId,
    dateValidation.value,
    academicYear,
    teacherValidation.value,
    statusValidation.value,
    methodValidation.value,
    timestamp,
    note,
    period,
    subject,
    materi,
    classId
  ];

  sheet.appendRow(row);

  return {
    success: true,
    message: "Teacher attendance berhasil ditambahkan.",
    attendance: {
      attendanceId: attendanceId,
      date: dateValidation.value,
      academicYear: academicYear,
      teacherId: teacherValidation.value,
      status: statusValidation.value,
      method: methodValidation.value,
      timestamp: timestamp,
      note: note,
      period: period,
      subject: subject,
      materi: materi,
      classId: classId
    }
  };
}

function updateTeacherAttendance(data) {
  const sheetResult = getTeacherAttendanceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const attendanceId = normalizeString(data.attendanceId);
  if (!attendanceId) {
    return {
      success: false,
      message: "attendanceId tidak boleh kosong."
    };
  }

  const sheet = sheetResult.sheet;
  const attendanceRow = findTeacherAttendanceRowById(sheet, attendanceId);
  if (!attendanceRow) {
    return {
      success: false,
      message: "Data attendance tidak ditemukan."
    };
  }

  const headers = attendanceRow.headers;
  const headerMap = attendanceRow.headerMap;
  const rowValues = attendanceRow.rowValues.slice();

  const existingTeacherId = normalizeString(rowValues[headerMap["teacherId"]]);
  if (data.teacherId !== undefined && normalizeString(data.teacherId) !== existingTeacherId) {
    return {
      success: false,
      message: "teacherId tidak boleh diubah."
    };
  }

  const dateInput = data.date !== undefined ? data.date : rowValues[headerMap["date"]];
  const dateValidation = validateDateFormat(dateInput);
  if (!dateValidation.success) {
    return dateValidation;
  }

  const academicYear = data.academicYear !== undefined ? normalizeString(data.academicYear) : normalizeString(rowValues[headerMap["academicYear"]]);
  if (!academicYear) {
    return {
      success: false,
      message: "academicYear wajib diisi."
    };
  }

  const statusValue = data.status !== undefined ? data.status : rowValues[headerMap["status"]];
  const statusValidation = validateAttendanceStatus(statusValue);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const methodValue = data.method !== undefined ? data.method : rowValues[headerMap["method"]];
  const methodValidation = validateAttendanceMethod(methodValue);
  if (!methodValidation.success) {
    return methodValidation;
  }

  const timestamp = data.timestamp !== undefined ? normalizeString(data.timestamp) : normalizeString(rowValues[headerMap["timestamp"]]);
  const note = data.note !== undefined ? normalizeString(data.note) : normalizeString(rowValues[headerMap["note"]]);

  rowValues[headerMap["date"]] = dateValidation.value;
  rowValues[headerMap["academicYear"]] = academicYear;
  rowValues[headerMap["status"]] = statusValidation.value;
  rowValues[headerMap["method"]] = methodValidation.value;
  rowValues[headerMap["timestamp"]] = timestamp;
  rowValues[headerMap["note"]] = note;

  if (headerMap["period"] !== undefined) {
    rowValues[headerMap["period"]] = data.period !== undefined ? normalizeString(data.period || data.jamKe) : normalizeString(rowValues[headerMap["period"]]);
  }
  if (headerMap["subject"] !== undefined) {
    rowValues[headerMap["subject"]] = data.subject !== undefined ? normalizeString(data.subject) : normalizeString(rowValues[headerMap["subject"]]);
  }
  if (headerMap["materi"] !== undefined) {
    rowValues[headerMap["materi"]] = data.materi !== undefined ? normalizeString(data.materi || data.content) : normalizeString(rowValues[headerMap["materi"]]);
  }
  if (headerMap["classId"] !== undefined) {
    if (data.classId !== undefined) {
      const normClass = normalizeString(data.classId);
      if (normClass) {
        const classValidation = validateClassIdForTeacherAttendance(normClass);
        if (!classValidation.success) {
          return classValidation;
        }
        rowValues[headerMap["classId"]] = classValidation.value;
      } else {
        rowValues[headerMap["classId"]] = "";
      }
    }
  }

  sheet.getRange(attendanceRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data teacher attendance berhasil diperbarui.",
    attendance: buildTeacherAttendanceObject(headers, rowValues)
  };
}

/**
 * Inspect sheet headers against TEACHER_ATTENDANCE_HEADERS canonical schema
 * Returns detailed status distinguishing safe operations vs invalid schema requiring manual migration.
 */
function inspectTeacherAttendanceHeaders(sheet) {
  const currentHeaders = getSheetHeaders(sheet);
  if (currentHeaders.length === 0) {
    return { status: "EMPTY", safe: true };
  }

  // Case 5: Duplicate header detection
  const seen = new Set();
  for (let i = 0; i < currentHeaders.length; i++) {
    const h = currentHeaders[i];
    if (seen.has(h)) {
      return { status: "SCHEMA_INVALID", reason: "DUPLICATE_HEADER: " + h, headers: currentHeaders, safe: false };
    }
    seen.add(h);
  }

  // Case 4: classId exists but at wrong column (must be index 11 / col 12)
  const classIdIdx = currentHeaders.indexOf("classId");
  if (classIdIdx !== -1 && classIdIdx !== 11) {
    return { status: "SCHEMA_INVALID", reason: "CLASSID_WRONG_COLUMN (index " + classIdIdx + " instead of 11)", headers: currentHeaders, safe: false };
  }

  // Case 6: Columns 1..11 malformed or order changed
  const expectedFirst11 = TEACHER_ATTENDANCE_HEADERS.slice(0, 11);
  for (let i = 0; i < Math.min(11, currentHeaders.length); i++) {
    if (currentHeaders[i] !== expectedFirst11[i]) {
      return { status: "SCHEMA_INVALID", reason: "MALFORMED_COLUMNS_1_TO_11 at index " + i + ": expected '" + expectedFirst11[i] + "', found '" + currentHeaders[i] + "'", headers: currentHeaders, safe: false };
    }
  }

  // Case 2: Valid 11-column legacy header
  if (currentHeaders.length === 11 && classIdIdx === -1) {
    return { status: "VALID_11_LEGACY", safe: true };
  }

  // Case 3: Valid 12-column canonical header
  if (currentHeaders.length === 12 && classIdIdx === 11) {
    return { status: "VALID_12", safe: true };
  }

  return { status: "SCHEMA_INVALID", reason: "UNEXPECTED_COLUMN_COUNT (" + currentHeaders.length + ")", headers: currentHeaders, safe: false };
}

/**
 * Ensure sheet headers include all columns in TEACHER_ATTENDANCE_HEADERS
 * Safe Append Guard:
 * - Empty sheet -> writes canonical 12 headers
 * - Valid 11 legacy -> appends classId to column 12
 * - Valid 12 -> no-op
 * - Malformed / Invalid -> logs error and refuses destructive write
 */
function ensureTeacherAttendanceHeaders(sheet) {
  const inspection = inspectTeacherAttendanceHeaders(sheet);
  if (inspection.status === "EMPTY") {
    sheet.getRange(1, 1, 1, TEACHER_ATTENDANCE_HEADERS.length).setValues([TEACHER_ATTENDANCE_HEADERS]);
    return { status: "CREATED", safe: true };
  }

  if (inspection.status === "VALID_11_LEGACY") {
    const classIdCol = TEACHER_ATTENDANCE_HEADERS.indexOf("classId") + 1; // 12
    sheet.getRange(1, classIdCol).setValue("classId");
    return { status: "SAFE_TO_APPEND", safe: true };
  }

  if (inspection.status === "VALID_12") {
    return { status: "NO_OP", safe: true };
  }

  // Schema is invalid - refuse destructive action
  if (typeof Logger !== "undefined" && Logger.log) {
    Logger.log("WARNING: TeacherAttendance schema invalid: " + inspection.reason + ". Controlled manual migration required.");
  }
  return inspection;
}

/**
 * Record teacher attendance from Responder with live camera validation
 * Server-Enforced Flow:
 * 1. Validate session token -> authenticated username
 * 2. Validate operator role -> ADMIN or GURU only
 * 3. Validate responder session -> existence, status ACTIVE, and ownership
 * 4. Validate teacher -> teacherId exists in Teachers sheet
 * 5. Validate period (jamKe)
 * 6. Validate subject (mata pelajaran)
 * 7. Validate materi (materi pembelajaran)
 * 8. Server date & timestamp from GAS server clock
 * 9. Duplicate protection under ScriptLock (teacherId + date + period)
 * 10. Write record to TeacherAttendance sheet (method: "Camera")
 * 11. Return created attendance object (NO photo stored)
 */
function recordTeacherAttendanceFromResponder(token, sessionId, payload) {
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
      message: "Identitas operator tidak valid."
    };
  }

  // Step 2: Role Guard (ADMIN and GURU only)
  const userRole = getAuthenticatedUserRole(authenticatedUsername);
  if (!userRole || !isResponderRoleAllowed(userRole)) {
    return {
      success: false,
      message: "Akses ditolak: Hanya Admin dan Guru yang diizinkan mencatat absensi guru."
    };
  }

  // Step 3: Validate Responder Session
  const sessionId_normalized = normalizeString(sessionId);
  if (!sessionId_normalized) {
    return {
      success: false,
      message: "sessionId tidak boleh kosong."
    };
  }

  const responderSheetResult = getResponderSessionSheet();
  if (!responderSheetResult.success) {
    return responderSheetResult;
  }

  const responderSheet = responderSheetResult.sheet;
  const sessionRow = findResponderSessionRowById(responderSheet, sessionId_normalized);
  if (!sessionRow) {
    return {
      success: false,
      message: "Responder session tidak ditemukan."
    };
  }

  const sessionStatus = normalizeString(sessionRow.rowValues[sessionRow.headerMap["status"]]);
  if (sessionStatus !== RESPONDER_STATUS_ACTIVE) {
    return {
      success: false,
      message: "Hanya session ACTIVE yang dapat mencatat absensi guru. Status sesi: " + sessionStatus
    };
  }

  const sessionOperatorId = normalizeString(sessionRow.rowValues[sessionRow.headerMap["operatorId"]]);
  if (sessionOperatorId !== authenticatedUsername) {
    return {
      success: false,
      message: "Akses ditolak: Anda bukan operator pemilik sesi responder ini."
    };
  }

  // Step 4: Validate Payload & Teacher
  if (!payload || typeof payload !== "object") {
    return {
      success: false,
      message: "Data absensi guru tidak valid."
    };
  }

  const teacherId = normalizeString(payload.teacherId);
  const teacherValidation = validateTeacherId(teacherId);
  if (!teacherValidation.success) {
    return teacherValidation;
  }

  // Validate Class (Kelas yang Diajar)
  const classId = normalizeString(payload.classId);
  const classValidation = validateClassIdForTeacherAttendance(classId);
  if (!classValidation.success) {
    return classValidation;
  }

  // Step 5: Validate Periods (Jam ke-)
  let rawPeriods = [];
  if (Array.isArray(payload.periods)) {
    rawPeriods = payload.periods;
  } else if (payload.period !== undefined && payload.period !== null && String(payload.period).trim() !== "") {
    rawPeriods = [payload.period];
  } else if (payload.jamKe !== undefined && payload.jamKe !== null && String(payload.jamKe).trim() !== "") {
    rawPeriods = [payload.jamKe];
  } else {
    return {
      success: false,
      message: "Jam ke- (periods) wajib dipilih minimal satu jam."
    };
  }

  if (!Array.isArray(rawPeriods) || rawPeriods.length === 0) {
    return {
      success: false,
      message: "Pilih minimal satu Jam ke- terlebih dahulu."
    };
  }

  // Validate every period value: canonical integer 1 to 10
  const normalizedPeriodsSet = new Set();
  for (let i = 0; i < rawPeriods.length; i++) {
    const pStr = normalizeString(rawPeriods[i]);
    const pNum = parseInt(pStr, 10);
    if (isNaN(pNum) || pNum < 1 || pNum > 10 || String(pNum) !== pStr) {
      return {
        success: false,
        message: "Nilai Jam ke- tidak valid: " + pStr + ". Hanya diperbolehkan Jam ke-1 sampai Jam ke-10."
      };
    }
    normalizedPeriodsSet.add(String(pNum));
  }

  if (normalizedPeriodsSet.size === 0) {
    return {
      success: false,
      message: "Pilih minimal satu Jam ke- terlebih dahulu."
    };
  }

  // Sort ascending
  const periods = Array.from(normalizedPeriodsSet).sort(function(a, b) {
    return Number(a) - Number(b);
  });

  // Step 6: Validate Subject
  const subject = normalizeString(payload.subject);
  if (!subject) {
    return {
      success: false,
      message: "Mata pelajaran wajib diisi."
    };
  }

  // Step 7: Validate Materi
  const materi = normalizeString(payload.materi || payload.content);
  if (!materi) {
    return {
      success: false,
      message: "Materi pembelajaran wajib diisi."
    };
  }

  // Validate Status (Default Hadir)
  const statusValidation = validateAttendanceStatus(payload.status || "Hadir");
  if (!statusValidation.success) {
    return statusValidation;
  }

  // Validate Photo Evidence from Camera (Mandatory for Responder Guru)
  const photoDataUrl = payload.photoDataUrl;
  if (!photoDataUrl || typeof photoDataUrl !== "string" || !photoDataUrl.trim()) {
    return {
      success: false,
      message: "Foto verifikasi langsung dari kamera wajib diambil terlebih dahulu."
    };
  }

  const note = normalizeString(payload.note);

  // Step 8: Server clock Date & Timestamp (GAS Server Clock)
  const now = new Date();
  const date = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");

  // Resolve academicYear (payload, or from Classes master, or default to current calendar year)
  let academicYear = normalizeString(payload.academicYear);
  if (!academicYear) {
    const year = now.getFullYear();
    academicYear = year + "/" + (year + 1);
  }

  const attendanceSheetResult = getTeacherAttendanceSheet();
  if (!attendanceSheetResult.success) {
    return attendanceSheetResult;
  }
  const sheet = attendanceSheetResult.sheet;

  const method = "Camera";

  // Step 9: ScriptLock & Duplicate Protection (teacherId + date + period)
  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000);
  if (!lockAcquired) {
    return {
      success: false,
      message: "Server sedang sibuk memproses absensi guru. Silakan coba lagi."
    };
  }

  try {
    ensureTeacherAttendanceHeaders(sheet);

    // Duplicate check: check ALL selected periods BEFORE writing any row
    const existing = getTeacherAttendance({
      teacherId: teacherValidation.value,
      date: date
    });

    const duplicatePeriods = [];
    if (existing && existing.success && Array.isArray(existing.attendances)) {
      const existingPeriodSet = new Set(
        existing.attendances.map(function(att) {
          return normalizeString(att.period);
        })
      );

      periods.forEach(function(p) {
        if (existingPeriodSet.has(p)) {
          duplicatePeriods.push(p);
        }
      });
    }

    if (duplicatePeriods.length > 0) {
      const dupText = duplicatePeriods.map(function(p) { return "Jam ke-" + p; }).join(" dan ");
      return {
        success: false,
        message: "Guru tersebut sudah tercatat absensinya pada tanggal " + date + " untuk " + dupText + ". Tidak ada perubahan yang disimpan.",
        duplicatePeriods: duplicatePeriods
      };
    }

    // Fetch teacher name and class name for client display
    const teacherObj = getTeacherById(teacherValidation.value);
    const teacherName = (teacherObj && teacherObj.success && teacherObj.teacher && teacherObj.teacher.name) || teacherValidation.value;
    const classObj = getClassById(classValidation.value);
    const className = (classObj && classObj.success && classObj.class && classObj.class.className) || classValidation.value;

    const createdRows = [];
    const createdAttendances = [];

    periods.forEach(function(period) {
      const attendanceId = "ATT-TCH-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().substring(0, 8);
      const row = [
        attendanceId,
        date,
        academicYear,
        teacherValidation.value,
        statusValidation.value,
        method,
        timestamp,
        note,
        period,
        subject,
        materi,
        classValidation.value
      ];
      createdRows.push(row);

      createdAttendances.push({
        attendanceId: attendanceId,
        date: date,
        academicYear: academicYear,
        teacherId: teacherValidation.value,
        teacherName: teacherName,
        classId: classValidation.value,
        className: className,
        status: statusValidation.value,
        method: method,
        timestamp: timestamp,
        note: note,
        period: period,
        subject: subject,
        materi: materi
      });
    });

    // Batch append all rows to sheet
    createdRows.forEach(function(row) {
      sheet.appendRow(row);
    });

    // Step 10: Save Photo Evidence and link to created attendanceId(s)
    const createdAttendanceIds = createdAttendances.map(function(a) {
      return a.attendanceId;
    });

    let evidenceResult = null;
    let evidenceWarning = null;
    try {
      if (typeof saveTeacherAttendanceEvidence === "function") {
        evidenceResult = saveTeacherAttendanceEvidence(
          sessionId_normalized,
          authenticatedUsername,
          photoDataUrl,
          createdAttendanceIds
        );
        if (!evidenceResult || !evidenceResult.success) {
          evidenceWarning = (evidenceResult && evidenceResult.message) || "Gagal menyimpan foto bukti ke Google Drive.";
        }
      }
    } catch (evErr) {
      evidenceWarning = "Gagal memproses bukti foto: " + (evErr && evErr.message ? evErr.message : String(evErr));
    }

    return {
      success: true,
      message: evidenceWarning
        ? ("Absensi guru berhasil dicatat, namun bukti foto belum berhasil tersimpan: " + evidenceWarning)
        : ("Absensi guru berhasil dicatat untuk " + periods.length + " jam pelajaran."),
      count: periods.length,
      periods: periods,
      teacherId: teacherValidation.value,
      teacherName: teacherName,
      classId: classValidation.value,
      className: className,
      subject: subject,
      attendances: createdAttendances,
      attendance: createdAttendances[0],
      evidenceSaved: !evidenceWarning,
      evidenceWarning: evidenceWarning,
      evidenceIds: evidenceResult && evidenceResult.evidenceIds
    };
  } finally {
    lock.releaseLock();
  }
}
