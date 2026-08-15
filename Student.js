const STUDENT_HEADERS = [
  "studentId",
  "nis",
  "nisn",
  "name",
  "gender",
  "classId",
  "status",
  "birthDate",
  "qrCodeId"
];

function getStudentsSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STUDENTS);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet Students tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function buildStudentObject(headers, row) {
  const student = {};

  STUDENT_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    student[header] = index !== -1 ? normalizeString(row[index]) : "";
  });

  return student;
}

function findStudentRowById(sheet, studentId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["studentId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(studentId);

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

function isStudentIdExists(sheet, studentId) {
  return !!findStudentRowById(sheet, studentId);
}

function isQrCodeIdExists(sheet, qrCodeId, excludeStudentId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const qrIndex = headerMap["qrCodeId"];
  const idIndex = headerMap["studentId"];

  if (qrIndex === undefined || qrIndex === -1) {
    return false;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return false;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedQr = normalizeString(qrCodeId);
  const normalizedExcludeId = normalizeString(excludeStudentId);

  if (!normalizedQr) {
    return false;
  }

  for (let i = 0; i < values.length; i++) {
    const currentQr = normalizeString(values[i][qrIndex]);
    const currentId = normalizeString(values[i][idIndex]);

    if (currentQr && currentQr === normalizedQr) {
      if (normalizedExcludeId && currentId === normalizedExcludeId) {
        continue;
      }
      return true;
    }
  }

  return false;
}



function validateStudentStatus(status) {
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

function validateStudentGender(gender) {
  const normalized = normalizeString(gender);
  if (!normalized) {
    return {
      success: true,
      value: ""
    };
  }

  if (normalized === "L" || normalized === "P") {
    return {
      success: true,
      value: normalized
    };
  }

  return {
    success: false,
    message: "Gender harus L atau P jika diisi."
  };
}

function getStudents() {
  const sheetResult = getStudentsSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      success: true,
      students: []
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const students = rows.map(function(row) {
    return buildStudentObject(headers, row);
  });

  return {
    success: true,
    students: students
  };
}

function getStudentById(studentId) {
  const sheetResult = getStudentsSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(studentId)) {
    return {
      success: false,
      message: "studentId tidak boleh kosong."
    };
  }

  const studentRow = findStudentRowById(sheetResult.sheet, studentId);
  if (!studentRow) {
    return {
      success: false,
      message: "Data siswa tidak ditemukan."
    };
  }

  return {
    success: true,
    student: buildStudentObject(studentRow.headers, studentRow.rowValues)
  };
}

function createStudent(data) {
  const sheetResult = getStudentsSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);

  const studentId = normalizeString(data.studentId);
  if (!studentId) {
    return {
      success: false,
      message: "studentId wajib diisi."
    };
  }

  if (isStudentIdExists(sheet, studentId)) {
    return {
      success: false,
      message: "studentId sudah digunakan."
    };
  }

  const name = normalizeString(data.name);
  if (!name) {
    return {
      success: false,
      message: "name wajib diisi."
    };
  }

  const statusValidation = validateStudentStatus(data.status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const genderValidation = validateStudentGender(data.gender);
  if (!genderValidation.success) {
    return genderValidation;
  }

  const nis = normalizeString(data.nis);
  const nisn = normalizeString(data.nisn);
  const classId = normalizeString(data.classId);
  const birthDate = normalizeString(data.birthDate);
  const qrCodeId = normalizeString(data.qrCodeId);

  if (qrCodeId && isQrCodeIdExists(sheet, qrCodeId)) {
    return {
      success: false,
      message: "qrCodeId sudah digunakan."
    };
  }

  const row = [
    studentId,
    nis,
    nisn,
    name,
    genderValidation.value,
    classId,
    statusValidation.value,
    birthDate,
    qrCodeId
  ];

  sheet.appendRow(row);

  return {
    success: true,
    message: "Data siswa berhasil ditambahkan.",
    student: {
      studentId: studentId,
      nis: nis,
      nisn: nisn,
      name: name,
      gender: genderValidation.value,
      classId: classId,
      status: statusValidation.value,
      birthDate: birthDate,
      qrCodeId: qrCodeId
    }
  };
}

function updateStudent(studentId, data) {
  const sheetResult = getStudentsSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(studentId)) {
    return {
      success: false,
      message: "studentId tidak boleh kosong."
    };
  }

  if (data.studentId && normalizeString(data.studentId) !== normalizeString(studentId)) {
    return {
      success: false,
      message: "studentId tidak boleh diubah."
    };
  }

  const sheet = sheetResult.sheet;
  const studentRow = findStudentRowById(sheet, studentId);

  if (!studentRow) {
    return {
      success: false,
      message: "Data siswa tidak ditemukan."
    };
  }

  const headers = studentRow.headers;
  const headerMap = studentRow.headerMap;
  const rowValues = studentRow.rowValues.slice();

  const name = data.name !== undefined ? normalizeString(data.name) : normalizeString(rowValues[headerMap["name"]]);
  if (!name) {
    return {
      success: false,
      message: "name wajib diisi."
    };
  }

  const statusValue = data.status !== undefined ? data.status : rowValues[headerMap["status"]];
  const statusValidation = validateStudentStatus(statusValue);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const genderValue = data.gender !== undefined ? data.gender : rowValues[headerMap["gender"]];
  const genderValidation = validateStudentGender(genderValue);
  if (!genderValidation.success) {
    return genderValidation;
  }

  const nis = data.nis !== undefined ? normalizeString(data.nis) : normalizeString(rowValues[headerMap["nis"]]);
  const nisn = data.nisn !== undefined ? normalizeString(data.nisn) : normalizeString(rowValues[headerMap["nisn"]]);
  const classId = data.classId !== undefined ? normalizeString(data.classId) : normalizeString(rowValues[headerMap["classId"]]);
  const birthDate = data.birthDate !== undefined ? normalizeString(data.birthDate) : normalizeString(rowValues[headerMap["birthDate"]]);
  const qrCodeId = data.qrCodeId !== undefined ? normalizeString(data.qrCodeId) : normalizeString(rowValues[headerMap["qrCodeId"]]);

  if (qrCodeId && isQrCodeIdExists(sheet, qrCodeId, studentId)) {
    return {
      success: false,
      message: "qrCodeId sudah digunakan oleh siswa lain."
    };
  }

  rowValues[headerMap["nis"]] = nis;
  rowValues[headerMap["nisn"]] = nisn;
  rowValues[headerMap["name"]] = name;
  rowValues[headerMap["gender"]] = genderValidation.value;
  rowValues[headerMap["classId"]] = classId;
  rowValues[headerMap["status"]] = statusValidation.value;
  rowValues[headerMap["birthDate"]] = birthDate;
  rowValues[headerMap["qrCodeId"]] = qrCodeId;

  sheet.getRange(studentRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data siswa berhasil diperbarui.",
    student: buildStudentObject(headers, rowValues)
  };
}

function setStudentStatus(studentId, status) {
  const sheetResult = getStudentsSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(studentId)) {
    return {
      success: false,
      message: "studentId tidak boleh kosong."
    };
  }

  if (status === undefined || status === null || normalizeString(status) === "") {
    return {
      success: false,
      message: "status wajib diisi dan harus Active atau Inactive."
    };
  }

  const statusValidation = validateStudentStatus(status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const studentRow = findStudentRowById(sheetResult.sheet, studentId);
  if (!studentRow) {
    return {
      success: false,
      message: "Data siswa tidak ditemukan."
    };
  }

  const rowValues = studentRow.rowValues.slice();
  rowValues[studentRow.headerMap["status"]] = statusValidation.value;

  sheetResult.sheet.getRange(studentRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Status siswa berhasil diperbarui.",
    student: buildStudentObject(studentRow.headers, rowValues)
  };
}

