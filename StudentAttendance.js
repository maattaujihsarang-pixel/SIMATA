const STUDENT_ATTENDANCE_HEADERS = [
  "attendanceId",
  "date",
  "academicYear",
  "studentId",
  "classId",
  "status",
  "method",
  "timestamp",
  "note"
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



function buildStudentAttendanceObject(headers, row) {
  const attendance = {};

  STUDENT_ATTENDANCE_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    attendance[header] = index !== -1 ? normalizeString(row[index]) : "";
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

  const attendanceId = normalizeString(data.attendanceId);
  if (!attendanceId) {
    return {
      success: false,
      message: "attendanceId wajib diisi."
    };
  }

  if (findStudentAttendanceRowById(sheet, attendanceId)) {
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

  const timestamp = normalizeString(data.timestamp);
  const note = normalizeString(data.note);

  const row = [
    attendanceId,
    dateValidation.value,
    academicYear,
    studentValidation.value,
    classValidation.value,
    statusValidation.value,
    methodValidation.value,
    timestamp,
    note
  ];

  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000);

  if (!lockAcquired) {
    return {
      success: false,
      message: "Server sedang sibuk memproses presensi. Silakan coba lagi."
    };
  }

  try {
    // Duplicate protection: prevent multiple student attendance records for the
    // same studentId + classId + date + academicYear combination.
    const existing = getStudentAttendance({
      studentId: studentValidation.value,
      classId: classValidation.value,
      date: dateValidation.value,
      academicYear: academicYear
    });
    if (existing && existing.success && existing.attendances && existing.attendances.length > 0) {
      return {
        success: false,
        message: "Student attendance untuk siswa, kelas, tanggal, dan tahun akademik tersebut sudah ada."
      };
    }

    sheet.appendRow(row);

    return {
      success: true,
      message: "Student attendance berhasil ditambahkan.",
      attendance: {
        attendanceId: attendanceId,
        date: dateValidation.value,
        academicYear: academicYear,
        studentId: studentValidation.value,
        classId: classValidation.value,
        status: statusValidation.value,
        method: methodValidation.value,
        timestamp: timestamp,
        note: note
      }
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

  rowValues[headerMap["date"]] = dateValidation.value;
  rowValues[headerMap["academicYear"]] = academicYear;
  rowValues[headerMap["classId"]] = classValidation.value;
  rowValues[headerMap["status"]] = statusValidation.value;
  rowValues[headerMap["method"]] = methodValidation.value;
  rowValues[headerMap["timestamp"]] = timestamp;
  rowValues[headerMap["note"]] = note;

  sheet.getRange(attendanceRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data student attendance berhasil diperbarui.",
    attendance: buildStudentAttendanceObject(headers, rowValues)
  };
}
