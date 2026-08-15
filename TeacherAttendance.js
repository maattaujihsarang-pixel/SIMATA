const TEACHER_ATTENDANCE_HEADERS = [
  "attendanceId",
  "date",
  "academicYear",
  "teacherId",
  "status",
  "method",
  "timestamp",
  "note"
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

  return {
    success: true,
    attendance: buildTeacherAttendanceObject(attendanceRow.headers, attendanceRow.rowValues)
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

  // NOTE: Removed strict duplicate protection by teacherId+date+academicYear
  // per policy — teacher attendance uniqueness is enforced only by attendanceId.

  const row = [
    attendanceId,
    dateValidation.value,
    academicYear,
    teacherValidation.value,
    statusValidation.value,
    methodValidation.value,
    timestamp,
    note
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
      note: note
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

  sheet.getRange(attendanceRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data teacher attendance berhasil diperbarui.",
    attendance: buildTeacherAttendanceObject(headers, rowValues)
  };
}
