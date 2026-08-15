const CLASS_HEADERS = [
  "classId",
  "className",
  "level",
  "academicYear",
  "homeroomTeacherId",
  "status"
];

function getClassesSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_CLASSES);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet Classes tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function buildClassObject(headers, row) {
  const klass = {};

  CLASS_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    klass[header] = index !== -1 ? normalizeString(row[index]) : "";
  });

  return klass;
}

function findClassRowById(sheet, classId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["classId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(classId);

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

function isClassIdExists(sheet, classId) {
  return !!findClassRowById(sheet, classId);
}



function validateClassStatus(status) {
  const normalized = normalizeString(status) || "Active";
  if (normalized !== "Active" && normalized !== "Inactive") {
    return {
      success: false,
      message: "Status harus Active atau Inactive."
    };
  }
  return {
    success: true,
    value: normalized
  };
}

function validateHomeroomTeacherId(teacherId) {
  const normalizedTeacherId = normalizeString(teacherId);
  if (!normalizedTeacherId) {
    return {
      success: true,
      value: ""
    };
  }

  const teacherResult = getTeacherById(normalizedTeacherId);
  if (!teacherResult.success) {
    return {
      success: false,
      message: "homeroomTeacherId tidak valid atau guru tidak ditemukan."
    };
  }

  return {
    success: true,
    value: normalizedTeacherId
  };
}

function getClasses() {
  const sheetResult = getClassesSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      success: true,
      classes: []
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const classes = rows.map(function(row) {
    return buildClassObject(headers, row);
  });

  return {
    success: true,
    classes: classes
  };
}

function getClassById(classId) {
  const sheetResult = getClassesSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(classId)) {
    return {
      success: false,
      message: "classId tidak boleh kosong."
    };
  }

  const classRow = findClassRowById(sheetResult.sheet, classId);
  if (!classRow) {
    return {
      success: false,
      message: "Data kelas tidak ditemukan."
    };
  }

  return {
    success: true,
    class: buildClassObject(classRow.headers, classRow.rowValues)
  };
}

function createClass(data) {
  const sheetResult = getClassesSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;

  const classId = normalizeString(data.classId);
  if (!classId) {
    return {
      success: false,
      message: "classId wajib diisi."
    };
  }

  if (isClassIdExists(sheet, classId)) {
    return {
      success: false,
      message: "classId sudah digunakan."
    };
  }

  const className = normalizeString(data.className);
  if (!className) {
    return {
      success: false,
      message: "className wajib diisi."
    };
  }

  const academicYear = normalizeString(data.academicYear);
  if (!academicYear) {
    return {
      success: false,
      message: "academicYear wajib diisi."
    };
  }

  const statusValidation = validateClassStatus(data.status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const level = normalizeString(data.level);
  const homeroomTeacherIdValidation = validateHomeroomTeacherId(data.homeroomTeacherId);
  if (!homeroomTeacherIdValidation.success) {
    return homeroomTeacherIdValidation;
  }

  const row = [
    classId,
    className,
    level,
    academicYear,
    homeroomTeacherIdValidation.value,
    statusValidation.value
  ];

  sheet.appendRow(row);

  return {
    success: true,
    message: "Data kelas berhasil ditambahkan.",
    class: {
      classId: classId,
      className: className,
      level: level,
      academicYear: academicYear,
      homeroomTeacherId: homeroomTeacherIdValidation.value,
      status: statusValidation.value
    }
  };
}

function updateClass(data) {
  const sheetResult = getClassesSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const classId = normalizeString(data.classId);
  if (!classId) {
    return {
      success: false,
      message: "classId tidak boleh kosong."
    };
  }

  const sheet = sheetResult.sheet;
  const classRow = findClassRowById(sheet, classId);
  if (!classRow) {
    return {
      success: false,
      message: "Data kelas tidak ditemukan."
    };
  }

  const headers = classRow.headers;
  const headerMap = classRow.headerMap;
  const rowValues = classRow.rowValues.slice();

  const className = data.className !== undefined ? normalizeString(data.className) : normalizeString(rowValues[headerMap["className"]]);
  if (!className) {
    return {
      success: false,
      message: "className wajib diisi."
    };
  }

  const academicYear = data.academicYear !== undefined ? normalizeString(data.academicYear) : normalizeString(rowValues[headerMap["academicYear"]]);
  if (!academicYear) {
    return {
      success: false,
      message: "academicYear wajib diisi."
    };
  }

  const level = data.level !== undefined ? normalizeString(data.level) : normalizeString(rowValues[headerMap["level"]]);
  const homeroomTeacherIdValidation = validateHomeroomTeacherId(data.homeroomTeacherId !== undefined ? data.homeroomTeacherId : rowValues[headerMap["homeroomTeacherId"]]);
  if (!homeroomTeacherIdValidation.success) {
    return homeroomTeacherIdValidation;
  }

  const statusValue = data.status !== undefined ? data.status : rowValues[headerMap["status"]];
  const statusValidation = validateClassStatus(statusValue);
  if (!statusValidation.success) {
    return statusValidation;
  }

  rowValues[headerMap["className"]] = className;
  rowValues[headerMap["level"]] = level;
  rowValues[headerMap["academicYear"]] = academicYear;
  rowValues[headerMap["homeroomTeacherId"]] = homeroomTeacherIdValidation.value;
  rowValues[headerMap["status"]] = statusValidation.value;

  sheet.getRange(classRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data kelas berhasil diperbarui.",
    class: buildClassObject(headers, rowValues)
  };
}

function setClassStatus(classId, status) {
  const sheetResult = getClassesSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(classId)) {
    return {
      success: false,
      message: "classId tidak boleh kosong."
    };
  }

  if (status === undefined || status === null || normalizeString(status) === "") {
    return {
      success: false,
      message: "status wajib diisi dan harus Active atau Inactive."
    };
  }

  const statusValidation = validateClassStatus(status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const classRow = findClassRowById(sheetResult.sheet, classId);
  if (!classRow) {
    return {
      success: false,
      message: "Data kelas tidak ditemukan."
    };
  }

  const rowValues = classRow.rowValues.slice();
  rowValues[classRow.headerMap["status"]] = statusValidation.value;

  sheetResult.sheet.getRange(classRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Status kelas berhasil diperbarui.",
    class: buildClassObject(classRow.headers, rowValues)
  };
}
