/**
 * SIMATA Database Initialization Helper
 * v0.1.1-dev
 */

const DATABASE_SCHEMAS = [
  {
    sheetName: CONFIG.SHEET_USERS,
    headers: ["username", "password", "name", "role"],
    idHeader: "username"
  },
  {
    sheetName: CONFIG.SHEET_SESSIONS,
    headers: ["token", "username", "loginTime", "expiredTime", "status"],
    idHeader: "token"
  },
  {
    sheetName: CONFIG.SHEET_STUDENTS,
    headers: ["studentId", "nis", "nisn", "name", "gender", "classId", "status", "birthDate", "qrCodeId"],
    idHeader: "studentId"
  },
  {
    sheetName: CONFIG.SHEET_TEACHERS,
    headers: ["teacherId", "nip", "nuptk", "name", "position", "status", "subject", "qrCodeId"],
    idHeader: "teacherId"
  },
  {
    sheetName: CONFIG.SHEET_CLASSES,
    headers: ["classId", "className", "level", "academicYear", "homeroomTeacherId", "status"],
    idHeader: "classId"
  },
  {
    sheetName: CONFIG.SHEET_STUDENT_ATTENDANCE,
    headers: ["attendanceId", "date", "academicYear", "studentId", "classId", "status", "method", "timestamp", "note"],
    idHeader: "attendanceId"
  },
  {
    sheetName: CONFIG.SHEET_TEACHER_ATTENDANCE,
    headers: ["attendanceId", "date", "academicYear", "teacherId", "status", "method", "timestamp", "note"],
    idHeader: "attendanceId"
  },
  {
    sheetName: CONFIG.SHEET_JOURNAL,
    headers: ["journalId", "date", "academicYear", "teacherId", "classId", "subject", "content", "note", "status"],
    idHeader: "journalId"
  },
  {
    sheetName: CONFIG.SHEET_GRADES,
    headers: ["gradeId", "studentId", "classId", "subject", "assessmentType", "score", "semester", "academicYear", "date", "remarks"],
    idHeader: "gradeId"
  }
];

function initializeDatabase() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const result = {
    success: true,
    createdSheets: [],
    existingSheets: [],
    warnings: []
  };

  DATABASE_SCHEMAS.forEach(function(schema) {
    const sheet = ss.getSheetByName(schema.sheetName);

    if (!sheet) {
      createSheetWithHeader(ss, schema.sheetName, schema.headers);
      result.createdSheets.push(schema.sheetName);
      return;
    }

    result.existingSheets.push(schema.sheetName);

    if (!hasExpectedHeader(sheet, schema.headers)) {
      result.warnings.push("Header mismatch or missing header row for sheet: " + schema.sheetName);
    }

    const duplicateIds = findDuplicateIds(sheet, schema.idHeader);
    if (duplicateIds.length > 0) {
      result.warnings.push("Duplicate IDs found in " + schema.sheetName + ": " + duplicateIds.join(", "));
    }
  });

  return result;
}

function createSheetWithHeader(ss, sheetName, headers) {
  const sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}



function hasExpectedHeader(sheet, expectedHeaders) {
  const actualHeaders = getSheetHeaders(sheet);
  if (actualHeaders.length < expectedHeaders.length) {
    return false;
  }

  for (let i = 0; i < expectedHeaders.length; i++) {
    if (actualHeaders[i] !== expectedHeaders[i]) {
      return false;
    }
  }

  return true;
}

function findDuplicateIds(sheet, idHeader) {
  const headers = getSheetHeaders(sheet);
  const idIndex = headers.indexOf(idHeader);

  if (idIndex === -1) {
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const values = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
  const seen = {};
  const duplicates = [];

  values.forEach(function(row) {
    const value = String(row[0]).trim();
    if (!value) {
      return;
    }

    if (seen[value]) {
      if (duplicates.indexOf(value) === -1) {
        duplicates.push(value);
      }
    } else {
      seen[value] = true;
    }
  });

  return duplicates;
}
