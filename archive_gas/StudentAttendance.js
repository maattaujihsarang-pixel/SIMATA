const STUDENT_ATTENDANCE_HEADERS = [
  "attendanceId",
  "date",
  "academicYear",
  "studentId",
  "classId",
  "status",
  "method",
  "timestamp",
  "note",
  "period"
];

function getStudentAttendanceSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STUDENT_ATTENDANCE);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet StudentAttendance tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function normalizeDateValue(value) {
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0); }
  function daysInMonth(y, m) {
    var dims = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return (m === 2 && isLeap(y)) ? 29 : dims[m];
  }
  function validCalendar(y, m, d) {
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";
    var y = value.getFullYear();
    var m = value.getMonth() + 1;
    var d = value.getDate();
    if (!validCalendar(y, m, d)) return "";
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  if (typeof value === "string") {
    var str = value.trim();
    if (!str) return "";

    // YYYY-MM-DD
    var mIso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mIso) {
      var y = parseInt(mIso[1], 10), mo = parseInt(mIso[2], 10), dy = parseInt(mIso[3], 10);
      return validCalendar(y, mo, dy) ? (mIso[1] + "-" + mIso[2] + "-" + mIso[3]) : "";
    }

    // ISO timestamp YYYY-MM-DDTHH:mm:ss...
    var mTs = str.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (mTs) {
      var parts = mTs[1].split("-");
      var y = parseInt(parts[0], 10), mo = parseInt(parts[1], 10), dy = parseInt(parts[2], 10);
      return validCalendar(y, mo, dy) ? mTs[1] : "";
    }

    // YYYY/MM/DD
    var mSlash = str.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (mSlash) {
      var y = parseInt(mSlash[1], 10), mo = parseInt(mSlash[2], 10), dy = parseInt(mSlash[3], 10);
      return validCalendar(y, mo, dy) ? (mSlash[1] + "-" + mSlash[2] + "-" + mSlash[3]) : "";
    }

    // DD/MM/YYYY (Indonesian format e.g. 16/09/2026 or 5/9/2026)
    var mId = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mId) {
      var dy = parseInt(mId[1], 10), mo = parseInt(mId[2], 10), y = parseInt(mId[3], 10);
      return validCalendar(y, mo, dy)
        ? (mId[3] + "-" + String(mo).padStart(2, "0") + "-" + String(dy).padStart(2, "0")) : "";
    }

    return "";
  }

  return "";
}

/**
 * Normalize the timestamp field read back from Google Sheets getValues().
 *
 * Google Sheets auto-parses ISO datetime strings stored via appendRow() into
 * internal datetime cells. When getValues() reads them back, GAS returns a
 * native Date object. Using normalizeString(Date) would produce
 * Date.prototype.toString() — an engine-specific long string, not comparable.
 *
 * This function:
 *   - native Date (valid)   → epoch milliseconds as number (Date.getTime())
 *   - native Date (invalid) → empty string ""
 *   - string               → pass through trimmed (ISO strings from write paths)
 *   - other types          → empty string ""
 */
function normalizeTimestampValue(value) {
  if (value instanceof Date) {
    var ms = value.getTime();
    return isNaN(ms) ? "" : ms;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function buildStudentAttendanceObject(headers, row) {
  const attendance = {};

  STUDENT_ATTENDANCE_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    if (index !== -1 && row[index] !== undefined) {
      if (header === "date") {
        attendance[header] = normalizeDateValue(row[index]);
      } else if (header === "timestamp") {
        attendance[header] = normalizeTimestampValue(row[index]);
      } else {
        attendance[header] = normalizeString(row[index]);
      }
    } else {
      attendance[header] = "";
    }
  });

  return attendance;
}

function findStudentAttendanceRowById(sheet, attendanceId) {
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

function validateSinglePeriod(period) {
  const normalized = normalizeString(period);
  if (!normalized) {
    return {
      success: false,
      message: "Jam ke- (period) wajib diisi."
    };
  }

  // Canonical integer string 1 to 10 only (rejects 0, 11, -1, 01, 001, 1.0, abc, etc.)
  if (!/^(?:[1-9]|10)$/.test(normalized)) {
    return {
      success: false,
      message: "Nilai Jam ke- (period) tidak valid: \"" + normalized + "\". Hanya diperbolehkan Jam ke-1 sampai Jam ke-10."
    };
  }

  return {
    success: true,
    value: normalized
  };
}

function normalizeAndValidatePeriods(periodsInput) {
  let rawList = [];
  if (Array.isArray(periodsInput)) {
    rawList = periodsInput;
  } else if (periodsInput !== undefined && periodsInput !== null && String(periodsInput).trim() !== "") {
    rawList = [periodsInput];
  }

  if (rawList.length === 0) {
    return {
      success: false,
      message: "Pilih minimal satu Jam ke- (period) terlebih dahulu."
    };
  }

  const validSet = new Set();
  for (let i = 0; i < rawList.length; i++) {
    const check = validateSinglePeriod(rawList[i]);
    if (!check.success) {
      return check;
    }
    validSet.add(check.value);
  }

  if (validSet.size === 0) {
    return {
      success: false,
      message: "Pilih minimal satu Jam ke- (period) terlebih dahulu."
    };
  }

  const sortedPeriods = Array.from(validSet).sort(function(a, b) {
    return parseInt(a, 10) - parseInt(b, 10);
  });

  return {
    success: true,
    periods: sortedPeriods
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

function validateStudentId(studentId) {
  const normalized = normalizeString(studentId);
  if (!normalized) {
    return {
      success: false,
      message: "studentId wajib diisi."
    };
  }

  const studentResult = getStudentById(normalized);
  if (!studentResult.success) {
    return {
      success: false,
      message: "studentId tidak valid atau siswa tidak ditemukan."
    };
  }

  return {
    success: true,
    value: normalized
  };
}

function validateClassId(classId) {
  const normalized = normalizeString(classId);
  if (!normalized) {
    return {
      success: false,
      message: "classId wajib diisi."
    };
  }

  const classResult = getClassById(normalized);
  if (!classResult.success) {
    return {
      success: false,
      message: "classId tidak valid atau kelas tidak ditemukan."
    };
  }

  return {
    success: true,
    value: normalized
  };
}

function getStudentIdByQrCodeId(qrCodeId) {
  const sheetResult = getStudentsSheet();
  if (!sheetResult.success) {
    return null;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const qrIndex = headerMap["qrCodeId"];
  const idIndex = headerMap["studentId"];

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

function getStudentAttendance(filters) {
  const sheetResult = getStudentAttendanceSheet();
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
    return buildStudentAttendanceObject(headers, row);
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

  return {
    success: true,
    attendances: attendances
  };
}

function getStudentAttendanceById(attendanceId) {
  const sheetResult = getStudentAttendanceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(attendanceId)) {
    return {
      success: false,
      message: "attendanceId tidak boleh kosong."
    };
  }

  const attendanceRow = findStudentAttendanceRowById(sheetResult.sheet, attendanceId);
  if (!attendanceRow) {
    return {
      success: false,
      message: "Data attendance tidak ditemukan."
    };
  }

  return {
    success: true,
    attendance: buildStudentAttendanceObject(attendanceRow.headers, attendanceRow.rowValues)
  };
}

function createStudentAttendance(data) {
  const sheetResult = getStudentAttendanceSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;

  // Validate periods input: accepts array `periods` or single `period`/`jamKe`
  const periodsValidation = normalizeAndValidatePeriods(data.periods || data.period || data.jamKe);
  if (!periodsValidation.success) {
    return periodsValidation;
  }
  const periods = periodsValidation.periods;

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

  let studentId = normalizeString(data.studentId);
  if (!studentId && normalizeString(data.qrCodeId)) {
    studentId = getStudentIdByQrCodeId(data.qrCodeId);
  }

  const studentValidation = validateStudentId(studentId);
  if (!studentValidation.success) {
    return studentValidation;
  }

  const classValidation = validateClassId(data.classId);
  if (!classValidation.success) {
    return classValidation;
  }

  const statusValidation = validateAttendanceStatus(data.status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const methodValidation = validateAttendanceMethod(data.method);
  if (!methodValidation.success) {
    return methodValidation;
  }

  const now = new Date();
  const timestamp = normalizeString(data.timestamp) || Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const note = normalizeString(data.note);

  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000);

  if (!lockAcquired) {
    return {
      success: false,
      message: "Server sedang sibuk memproses presensi. Silakan coba lagi."
    };
  }

  try {
    // Duplicate protection (Atomic All-or-Nothing check across all requested periods)
    const existing = getStudentAttendance({
      studentId: studentValidation.value,
      classId: classValidation.value,
      date: dateValidation.value,
      academicYear: academicYear
    });

    const duplicatePeriods = [];
    if (existing && existing.success && existing.attendances) {
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
      const dupText = duplicatePeriods.map(function(p) { return "Jam ke-" + p; }).join(", ");
      return {
        success: false,
        message: "Student attendance untuk siswa tersebut pada tanggal " + dateValidation.value + " untuk " + dupText + " sudah tercatat. Tidak ada perubahan yang disimpan.",
        duplicatePeriods: duplicatePeriods
      };
    }

    const createdAttendances = [];
    periods.forEach(function(p) {
      const rowAttendanceId = (periods.length === 1 && data.attendanceId)
        ? normalizeString(data.attendanceId)
        : ("ATT-STD-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "-P" + p + "-" + Utilities.getUuid().substring(0, 6));

      const row = [
        rowAttendanceId,
        dateValidation.value,
        academicYear,
        studentValidation.value,
        classValidation.value,
        statusValidation.value,
        methodValidation.value,
        timestamp,
        note,
        p
      ];

      sheet.appendRow(row);

      createdAttendances.push({
        attendanceId: rowAttendanceId,
        date: dateValidation.value,
        academicYear: academicYear,
        studentId: studentValidation.value,
        classId: classValidation.value,
        status: statusValidation.value,
        method: methodValidation.value,
        timestamp: timestamp,
        note: note,
        period: p
      });
    });

    return {
      success: true,
      message: "Student attendance berhasil ditambahkan untuk " + periods.length + " jam pelajaran.",
      count: periods.length,
      periods: periods,
      attendances: createdAttendances,
      attendance: createdAttendances[0]
    };
  } finally {
    lock.releaseLock();
  }
}

function updateStudentAttendance(data) {
  const sheetResult = getStudentAttendanceSheet();
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
  const attendanceRow = findStudentAttendanceRowById(sheet, attendanceId);
  if (!attendanceRow) {
    return {
      success: false,
      message: "Data attendance tidak ditemukan."
    };
  }

  const headers = attendanceRow.headers;
  const headerMap = attendanceRow.headerMap;
  const rowValues = attendanceRow.rowValues.slice();

  const studentId = normalizeString(rowValues[headerMap["studentId"]]);
  if (data.studentId !== undefined && normalizeString(data.studentId) !== studentId) {
    return {
      success: false,
      message: "studentId tidak boleh diubah."
    };
  }

  const classId = data.classId !== undefined ? normalizeString(data.classId) : normalizeString(rowValues[headerMap["classId"]]);
  const classValidation = validateClassId(classId);
  if (!classValidation.success) {
    return classValidation;
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

  // Handle single period update
  let targetPeriod = headerMap["period"] !== undefined && rowValues[headerMap["period"]] !== undefined
    ? normalizeString(rowValues[headerMap["period"]])
    : "";

  if (data.period !== undefined && normalizeString(data.period) !== "") {
    const periodValidation = validateSinglePeriod(data.period);
    if (!periodValidation.success) {
      return periodValidation;
    }
    targetPeriod = periodValidation.value;

    // Check duplicate against other records for same student + class + date + academicYear
    const existing = getStudentAttendance({
      studentId: studentId,
      classId: classValidation.value,
      date: dateValidation.value,
      academicYear: academicYear
    });

    if (existing && existing.success && existing.attendances) {
      const isDuplicate = existing.attendances.some(function(att) {
        return normalizeString(att.attendanceId) !== attendanceId && normalizeString(att.period) === targetPeriod;
      });
      if (isDuplicate) {
        return {
          success: false,
          message: "Student attendance untuk siswa tersebut pada tanggal " + dateValidation.value + " dan Jam ke-" + targetPeriod + " sudah ada pada record lain."
        };
      }
    }
  }

  rowValues[headerMap["date"]] = dateValidation.value;
  rowValues[headerMap["academicYear"]] = academicYear;
  rowValues[headerMap["classId"]] = classValidation.value;
  rowValues[headerMap["status"]] = statusValidation.value;
  rowValues[headerMap["method"]] = methodValidation.value;
  rowValues[headerMap["timestamp"]] = timestamp;
  rowValues[headerMap["note"]] = note;
  if (headerMap["period"] !== undefined) {
    rowValues[headerMap["period"]] = targetPeriod;
  }

  sheet.getRange(attendanceRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data student attendance berhasil diperbarui.",
    attendance: buildStudentAttendanceObject(headers, rowValues)
  };
}
