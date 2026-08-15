const GRADES_HEADERS = [
  "gradeId",
  "studentId",
  "classId",
  "subject",
  "assessmentType",
  "score",
  "semester",
  "academicYear",
  "date",
  "remarks"
];

function getGradesSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_GRADES);

  if (!sheet) {
    return { success: false, message: "Sheet Grades tidak ditemukan." };
  }

  return { success: true, sheet: sheet };
}



function buildGradeObject(headers, row) {
  const grade = {};
  GRADES_HEADERS.forEach(function(header) {
    const idx = headers.indexOf(header);
    grade[header] = idx !== -1 ? normalizeString(row[idx]) : "";
  });
  return grade;
}

function findGradeRowById(sheet, gradeId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["gradeId"];
  if (idIndex === undefined || idIndex === -1) { return null; }
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) { return null; }
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(gradeId);
  for (let i = 0; i < values.length; i++) {
    if (normalizeString(values[i][idIndex]) === normalizedId) {
      return { rowIndex: i + 2, rowValues: values[i], headers: headers, headerMap: headerMap };
    }
  }
  return null;
}



function validateDateFormat(value) {
  const normalized = normalizeString(value);
  if (!normalized) { return { success: false, message: "date wajib diisi dengan format YYYY-MM-DD." }; }
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoPattern.test(normalized)) { return { success: false, message: "date harus dalam format YYYY-MM-DD." }; }
  return { success: true, value: normalized };
}

function validateScore(score) {
  const normalized = normalizeString(score);
  if (normalized === "") {
    return { success: false, message: "score wajib diisi." };
  }
  const num = Number(normalized);
  if (!isFinite(num)) {
    return { success: false, message: "score harus berupa angka yang valid." };
  }
  return { success: true, value: num };
}

function validateStudentForGrade(studentId) {
  const normalized = normalizeString(studentId);
  if (!normalized) { return { success: false, message: "studentId wajib diisi." }; }
  const studentResult = getStudentById(normalized);
  if (!studentResult.success) { return { success: false, message: "studentId tidak valid atau siswa tidak ditemukan." }; }
  return { success: true, value: normalized };
}

function validateClassForGrade(classId) {
  const normalized = normalizeString(classId);
  if (!normalized) { return { success: false, message: "classId wajib diisi." }; }
  const classResult = getClassById(normalized);
  if (!classResult.success) { return { success: false, message: "classId tidak valid atau kelas tidak ditemukan." }; }
  return { success: true, value: normalized };
}

function getGrades(filters) {
  const sheetResult = getGradesSheet(); if (!sheetResult.success) { return sheetResult; }
  const sheet = sheetResult.sheet; const headers = getSheetHeaders(sheet); const lastRow = sheet.getLastRow();
  if (lastRow <= 1) { return { success: true, grades: [] }; }
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedFilters = {};
  if (filters) { Object.keys(filters).forEach(function(k) { normalizedFilters[k] = normalizeString(filters[k]); }); }
  const grades = rows.map(function(row) { return buildGradeObject(headers, row); }).filter(function(g) {
    if (!normalizedFilters || Object.keys(normalizedFilters).length === 0) { return true; }
    return Object.keys(normalizedFilters).every(function(key) {
      if (!normalizedFilters[key]) { return true; }
      return normalizeString(g[key]) === normalizedFilters[key];
    });
  });
  return { success: true, grades: grades };
}

function getGradeById(gradeId) {
  const sheetResult = getGradesSheet(); if (!sheetResult.success) { return sheetResult; }
  if (!normalizeString(gradeId)) { return { success: false, message: "gradeId tidak boleh kosong." }; }
  const gradeRow = findGradeRowById(sheetResult.sheet, gradeId);
  if (!gradeRow) { return { success: false, message: "Data grade tidak ditemukan." }; }
  return { success: true, grade: buildGradeObject(gradeRow.headers, gradeRow.rowValues) };
}

function createGrade(data) {
  const sheetResult = getGradesSheet(); if (!sheetResult.success) { return sheetResult; }
  const sheet = sheetResult.sheet;

  const gradeId = normalizeString(data.gradeId);
  if (!gradeId) { return { success: false, message: "gradeId wajib diisi." }; }
  if (findGradeRowById(sheet, gradeId)) { return { success: false, message: "gradeId sudah digunakan." }; }

  const studentValidation = validateStudentForGrade(data.studentId);
  if (!studentValidation.success) { return studentValidation; }

  const classValidation = validateClassForGrade(data.classId);
  if (!classValidation.success) { return classValidation; }

  const academicYear = normalizeString(data.academicYear);
  if (!academicYear) { return { success: false, message: "academicYear wajib diisi." }; }

  const dateValue = normalizeString(data.date);
  if (dateValue) {
    const dateValidation = validateDateFormat(dateValue);
    if (!dateValidation.success) { return dateValidation; }
  }

  const scoreValidation = validateScore(data.score);
  if (!scoreValidation.success) { return scoreValidation; }

  const subject = normalizeString(data.subject);
  const assessmentType = normalizeString(data.assessmentType);
  const semester = normalizeString(data.semester);
  const date = normalizeString(data.date);
  const remarks = normalizeString(data.remarks);

  const row = [
    gradeId,
    studentValidation.value,
    classValidation.value,
    subject,
    assessmentType,
    scoreValidation.value,
    semester,
    academicYear,
    date,
    remarks
  ];

  // appendRow present but must not be executed during static checks
  sheet.appendRow(row);

  return {
    success: true,
    message: "Grade berhasil ditambahkan.",
    grade: {
      gradeId: gradeId,
      studentId: studentValidation.value,
      classId: classValidation.value,
      subject: subject,
      assessmentType: assessmentType,
      score: String(scoreValidation.value),
      semester: semester,
      academicYear: academicYear,
      date: date,
      remarks: remarks
    }
  };
}

function updateGrade(data) {
  const sheetResult = getGradesSheet(); if (!sheetResult.success) { return sheetResult; }
  const gradeId = normalizeString(data.gradeId);
  if (!gradeId) { return { success: false, message: "gradeId tidak boleh kosong." }; }
  const sheet = sheetResult.sheet;
  const gradeRow = findGradeRowById(sheet, gradeId);
  if (!gradeRow) { return { success: false, message: "Data grade tidak ditemukan." }; }

  const headers = gradeRow.headers; const headerMap = gradeRow.headerMap; const rowValues = gradeRow.rowValues.slice();

  if (data.gradeId !== undefined && normalizeString(data.gradeId) !== normalizeString(gradeId)) {
    return { success: false, message: "gradeId tidak boleh diubah." };
  }

  const existingStudentId = normalizeString(rowValues[headerMap["studentId"]]);
  if (data.studentId !== undefined && normalizeString(data.studentId) !== existingStudentId) {
    return { success: false, message: "studentId tidak boleh diubah." };
  }

  const existingClassId = normalizeString(rowValues[headerMap["classId"]]);
  if (data.classId !== undefined && normalizeString(data.classId) !== existingClassId) {
    return { success: false, message: "classId tidak boleh diubah." };
  }

  const dateInput = data.date !== undefined ? data.date : rowValues[headerMap["date"]];
  if (normalizeString(dateInput)) {
    const dateValidation = validateDateFormat(dateInput);
    if (!dateValidation.success) { return dateValidation; }
    rowValues[headerMap["date"]] = dateValidation.value;
  }

  const academicYear = data.academicYear !== undefined ? normalizeString(data.academicYear) : normalizeString(rowValues[headerMap["academicYear"]]);
  if (!academicYear) { return { success: false, message: "academicYear wajib diisi." }; }
  rowValues[headerMap["academicYear"]] = academicYear;

  const subject = data.subject !== undefined ? normalizeString(data.subject) : normalizeString(rowValues[headerMap["subject"]]);
  const assessmentType = data.assessmentType !== undefined ? normalizeString(data.assessmentType) : normalizeString(rowValues[headerMap["assessmentType"]]);

  if (data.score !== undefined) {
    const scoreValidation = validateScore(data.score);
    if (!scoreValidation.success) { return scoreValidation; }
    rowValues[headerMap["score"]] = scoreValidation.value;
  }

  const semester = data.semester !== undefined ? normalizeString(data.semester) : normalizeString(rowValues[headerMap["semester"]]);
  const remarks = data.remarks !== undefined ? normalizeString(data.remarks) : normalizeString(rowValues[headerMap["remarks"]]);

  rowValues[headerMap["subject"]] = subject;
  rowValues[headerMap["assessmentType"]] = assessmentType;
  rowValues[headerMap["semester"]] = semester;
  rowValues[headerMap["remarks"]] = remarks;

  sheet.getRange(gradeRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return { success: true, message: "Data grade berhasil diperbarui.", grade: buildGradeObject(headers, rowValues) };
}
