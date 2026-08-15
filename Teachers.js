const TEACHER_HEADERS = [
  "teacherId",
  "nip",
  "nuptk",
  "name",
  "position",
  "status",
  "subject",
  "qrCodeId"
];

function getTeachersSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_TEACHERS);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet Teachers tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function buildTeacherObject(headers, row) {
  const teacher = {};

  TEACHER_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    teacher[header] = index !== -1 ? normalizeString(row[index]) : "";
  });

  return teacher;
}

function findTeacherRowById(sheet, teacherId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["teacherId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(teacherId);

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

function isTeacherIdExists(sheet, teacherId) {
  return !!findTeacherRowById(sheet, teacherId);
}

function isQrCodeIdExists(sheet, qrCodeId, excludeTeacherId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const qrIndex = headerMap["qrCodeId"];
  const idIndex = headerMap["teacherId"];

  if (qrIndex === undefined || qrIndex === -1) {
    return false;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return false;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedQr = normalizeString(qrCodeId);
  const normalizedExcludeId = normalizeString(excludeTeacherId);

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



function validateTeacherStatus(status) {
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

function getTeachers() {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      success: true,
      teachers: []
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const teachers = rows.map(function(row) {
    return buildTeacherObject(headers, row);
  });

  return {
    success: true,
    teachers: teachers
  };
}

function getTeacherById(teacherId) {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(teacherId)) {
    return {
      success: false,
      message: "teacherId tidak boleh kosong."
    };
  }

  const teacherRow = findTeacherRowById(sheetResult.sheet, teacherId);
  if (!teacherRow) {
    return {
      success: false,
      message: "Data guru tidak ditemukan."
    };
  }

  return {
    success: true,
    teacher: buildTeacherObject(teacherRow.headers, teacherRow.rowValues)
  };
}

function createTeacher(data) {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);

  const teacherId = normalizeString(data.teacherId);
  if (!teacherId) {
    return {
      success: false,
      message: "teacherId wajib diisi."
    };
  }

  if (isTeacherIdExists(sheet, teacherId)) {
    return {
      success: false,
      message: "teacherId sudah digunakan."
    };
  }

  const name = normalizeString(data.name);
  if (!name) {
    return {
      success: false,
      message: "name wajib diisi."
    };
  }

  const statusValidation = validateTeacherStatus(data.status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const nip = normalizeString(data.nip);
  const nuptk = normalizeString(data.nuptk);
  const position = normalizeString(data.position);
  const subject = normalizeString(data.subject);
  const qrCodeId = normalizeString(data.qrCodeId);

  if (qrCodeId && isQrCodeIdExists(sheet, qrCodeId)) {
    return {
      success: false,
      message: "qrCodeId sudah digunakan."
    };
  }

  const row = [
    teacherId,
    nip,
    nuptk,
    name,
    position,
    statusValidation.value,
    subject,
    qrCodeId
  ];

  sheet.appendRow(row);

  return {
    success: true,
    message: "Data guru berhasil ditambahkan.",
    teacher: {
      teacherId: teacherId,
      nip: nip,
      nuptk: nuptk,
      name: name,
      position: position,
      status: statusValidation.value,
      subject: subject,
      qrCodeId: qrCodeId
    }
  };
}

function updateTeacher(data) {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  const teacherId = normalizeString(data.teacherId);
  if (!teacherId) {
    return {
      success: false,
      message: "teacherId tidak boleh kosong."
    };
  }

  const sheet = sheetResult.sheet;
  const teacherRow = findTeacherRowById(sheet, teacherId);

  if (!teacherRow) {
    return {
      success: false,
      message: "Data guru tidak ditemukan."
    };
  }

  const headers = teacherRow.headers;
  const headerMap = teacherRow.headerMap;
  const rowValues = teacherRow.rowValues.slice();

  const name = data.name !== undefined ? normalizeString(data.name) : normalizeString(rowValues[headerMap["name"]]);
  if (!name) {
    return {
      success: false,
      message: "name wajib diisi."
    };
  }

  const statusValue = data.status !== undefined ? data.status : rowValues[headerMap["status"]];
  const statusValidation = validateTeacherStatus(statusValue);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const nip = data.nip !== undefined ? normalizeString(data.nip) : normalizeString(rowValues[headerMap["nip"]]);
  const nuptk = data.nuptk !== undefined ? normalizeString(data.nuptk) : normalizeString(rowValues[headerMap["nuptk"]]);
  const position = data.position !== undefined ? normalizeString(data.position) : normalizeString(rowValues[headerMap["position"]]);
  const subject = data.subject !== undefined ? normalizeString(data.subject) : normalizeString(rowValues[headerMap["subject"]]);
  const qrCodeId = data.qrCodeId !== undefined ? normalizeString(data.qrCodeId) : normalizeString(rowValues[headerMap["qrCodeId"]]);

  if (qrCodeId && isQrCodeIdExists(sheet, qrCodeId, teacherId)) {
    return {
      success: false,
      message: "qrCodeId sudah digunakan oleh guru lain."
    };
  }

  rowValues[headerMap["nip"]] = nip;
  rowValues[headerMap["nuptk"]] = nuptk;
  rowValues[headerMap["name"]] = name;
  rowValues[headerMap["position"]] = position;
  rowValues[headerMap["status"]] = statusValidation.value;
  rowValues[headerMap["subject"]] = subject;
  rowValues[headerMap["qrCodeId"]] = qrCodeId;

  sheet.getRange(teacherRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Data guru berhasil diperbarui.",
    teacher: buildTeacherObject(headers, rowValues)
  };
}

function setTeacherStatus(teacherId, status) {
  const sheetResult = getTeachersSheet();
  if (!sheetResult.success) {
    return sheetResult;
  }

  if (!normalizeString(teacherId)) {
    return {
      success: false,
      message: "teacherId tidak boleh kosong."
    };
  }

  if (status === undefined || status === null || normalizeString(status) === "") {
    return {
      success: false,
      message: "status wajib diisi dan harus Active atau Inactive."
    };
  }

  const statusValidation = validateTeacherStatus(status);
  if (!statusValidation.success) {
    return statusValidation;
  }

  const teacherRow = findTeacherRowById(sheetResult.sheet, teacherId);
  if (!teacherRow) {
    return {
      success: false,
      message: "Data guru tidak ditemukan."
    };
  }

  const rowValues = teacherRow.rowValues.slice();
  rowValues[teacherRow.headerMap["status"]] = statusValidation.value;

  sheetResult.sheet.getRange(teacherRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return {
    success: true,
    message: "Status guru berhasil diperbarui.",
    teacher: buildTeacherObject(teacherRow.headers, rowValues)
  };
}
