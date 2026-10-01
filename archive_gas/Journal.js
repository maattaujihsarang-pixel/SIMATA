const JOURNAL_HEADERS = [
  "journalId",
  "date",
  "academicYear",
  "teacherId",
  "classId",
  "period",
  "subject",
  "content",
  "note",
  "status"
];

function ensureJournalHeaders(sheet) {
  const headers = getSheetHeaders(sheet);
  if (headers.indexOf("period") === -1) {
    const classIdIdx = headers.indexOf("classId");
    if (classIdIdx !== -1) {
      sheet.insertColumnAfter(classIdIdx + 1);
      sheet.getRange(1, classIdIdx + 2).setValue("period");
    } else {
      const lastCol = sheet.getLastColumn();
      sheet.getRange(1, lastCol + 1).setValue("period");
    }
  }
}

function getJournalSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_JOURNAL);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet Journal tidak ditemukan."
    };
  }

  return {
    success: true,
    sheet: sheet
  };
}



function buildJournalObject(headers, row) {
  const journal = {};
  JOURNAL_HEADERS.forEach(function(header) {
    const index = headers.indexOf(header);
    journal[header] = index !== -1 ? normalizeString(row[index]) : "";
  });
  return journal;
}

function findJournalRowById(sheet, journalId) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["journalId"];

  if (idIndex === undefined || idIndex === -1) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedId = normalizeString(journalId);

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



function validateDateFormat(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return { success: false, message: "date wajib diisi dengan format YYYY-MM-DD." };
  }
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoPattern.test(normalized)) {
    return { success: false, message: "date harus dalam format YYYY-MM-DD." };
  }
  return { success: true, value: normalized };
}

function validateJournalStatus(status) {
  const normalized = normalizeString(status);
  if (!normalized) {
    return { success: true, value: "" };
  }
  return { success: true, value: normalized };
}

function validateTeacherIdForJournal(teacherId) {
  const normalized = normalizeString(teacherId);
  if (!normalized) {
    return { success: false, message: "teacherId wajib diisi." };
  }
  const teacherResult = getTeacherById(normalized);
  if (!teacherResult.success) {
    return { success: false, message: "teacherId tidak valid atau guru tidak ditemukan." };
  }
  return { success: true, value: normalized };
}

function validateClassIdForJournal(classId) {
  const normalized = normalizeString(classId);
  if (!normalized) {
    return { success: false, message: "classId wajib diisi." };
  }
  const classResult = getClassById(normalized);
  if (!classResult.success) {
    return { success: false, message: "classId tidak valid atau kelas tidak ditemukan." };
  }
  return { success: true, value: normalized };
}

function validateStudentIdForJournal(studentId) {
  const normalized = normalizeString(studentId);
  if (!normalized) {
    return { success: false, message: "studentId wajib diisi." };
  }
  const studentResult = getStudentById(normalized);
  if (!studentResult.success) {
    return { success: false, message: "studentId tidak valid atau siswa tidak ditemukan." };
  }
  return { success: true, value: normalized };
}

function getJournal(filters) {
  const sheetResult = getJournalSheet();
  if (!sheetResult.success) { return sheetResult; }
  const sheet = sheetResult.sheet;
  const headers = getSheetHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) { return { success: true, journals: [] }; }
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const normalizedFilters = {};
  if (filters) { Object.keys(filters).forEach(function(key) { normalizedFilters[key] = normalizeString(filters[key]); }); }
  const journals = rows.map(function(row) { return buildJournalObject(headers, row); }).filter(function(journal) {
    if (!normalizedFilters || Object.keys(normalizedFilters).length === 0) { return true; }
    return Object.keys(normalizedFilters).every(function(key) {
      if (!normalizedFilters[key]) { return true; }
      return normalizeString(journal[key]) === normalizedFilters[key];
    });
  });
  return { success: true, journals: journals };
}

function getJournalById(journalId) {
  const sheetResult = getJournalSheet();
  if (!sheetResult.success) { return sheetResult; }
  if (!normalizeString(journalId)) { return { success: false, message: "journalId tidak boleh kosong." }; }
  const journalRow = findJournalRowById(sheetResult.sheet, journalId);
  if (!journalRow) { return { success: false, message: "Data journal tidak ditemukan." }; }
  return { success: true, journal: buildJournalObject(journalRow.headers, journalRow.rowValues) };
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

function createJournal(data) {
  const sheetResult = getJournalSheet();
  if (!sheetResult.success) { return sheetResult; }
  const sheet = sheetResult.sheet;

  // Validate periods input: accepts array `periods` or single `period`/`jamKe`
  const periodsValidation = normalizeAndValidatePeriods(data.periods || data.period || data.jamKe);
  if (!periodsValidation.success) { return periodsValidation; }
  const periods = periodsValidation.periods;

  const dateValidation = validateDateFormat(data.date);
  if (!dateValidation.success) { return dateValidation; }

  const academicYear = normalizeString(data.academicYear);
  if (!academicYear) { return { success: false, message: "academicYear wajib diisi." }; }

  const teacherValidation = validateTeacherIdForJournal(data.teacherId);
  if (!teacherValidation.success) { return teacherValidation; }

  const classValidation = validateClassIdForJournal(data.classId);
  if (!classValidation.success) { return classValidation; }

  const statusValidation = validateJournalStatus(data.status);
  if (!statusValidation.success) { return statusValidation; }

  const subject = normalizeString(data.subject);
  const content = normalizeString(data.content);
  if (!content) { return { success: false, message: "content wajib diisi." }; }

  const note = normalizeString(data.note);

  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(5000);
  if (!lockAcquired) {
    return {
      success: false,
      message: "Server sedang sibuk memproses jurnal. Silakan coba lagi."
    };
  }

  try {
    ensureJournalHeaders(sheet);

    // If single period with provided journalId, check uniqueness
    if (periods.length === 1 && data.journalId) {
      const singleId = normalizeString(data.journalId);
      if (findJournalRowById(sheet, singleId)) {
        return { success: false, message: "journalId sudah digunakan." };
      }
    }

    const now = new Date();
    const createdJournals = [];

    periods.forEach(function(p) {
      const rowJournalId = (periods.length === 1 && data.journalId)
        ? normalizeString(data.journalId)
        : ("J-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "-P" + p + "-" + Utilities.getUuid().substring(0, 6));

      const row = [
        rowJournalId,
        dateValidation.value,
        academicYear,
        teacherValidation.value,
        classValidation.value,
        p,
        subject,
        content,
        note,
        statusValidation.value
      ];

      sheet.appendRow(row);

      createdJournals.push({
        journalId: rowJournalId,
        date: dateValidation.value,
        academicYear: academicYear,
        teacherId: teacherValidation.value,
        classId: classValidation.value,
        period: p,
        subject: subject,
        content: content,
        note: note,
        status: statusValidation.value
      });
    });

    return {
      success: true,
      message: "Journal berhasil ditambahkan untuk " + periods.length + " jam pelajaran.",
      count: periods.length,
      periods: periods,
      journals: createdJournals,
      journal: createdJournals[0]
    };
  } finally {
    lock.releaseLock();
  }
}

function updateJournal(data) {
  const sheetResult = getJournalSheet();
  if (!sheetResult.success) { return sheetResult; }

  const journalId = normalizeString(data.journalId);
  if (!journalId) { return { success: false, message: "journalId tidak boleh kosong." }; }

  const sheet = sheetResult.sheet;
  ensureJournalHeaders(sheet);

  const journalRow = findJournalRowById(sheet, journalId);
  if (!journalRow) { return { success: false, message: "Data journal tidak ditemukan." }; }

  const headers = journalRow.headers;
  const headerMap = journalRow.headerMap;
  const rowValues = journalRow.rowValues.slice();

  if (data.journalId !== undefined && normalizeString(data.journalId) !== normalizeString(journalId)) {
    return { success: false, message: "journalId tidak boleh diubah." };
  }

  if (data.teacherId !== undefined && normalizeString(data.teacherId) !== normalizeString(rowValues[headerMap["teacherId"]])) {
    return { success: false, message: "teacherId tidak boleh diubah." };
  }

  if (data.classId !== undefined && normalizeString(data.classId) !== normalizeString(rowValues[headerMap["classId"]])) {
    return { success: false, message: "classId tidak boleh diubah." };
  }

  if (data.period !== undefined) {
    const periodValidation = validateSinglePeriod(data.period);
    if (!periodValidation.success) { return periodValidation; }
    if (headerMap["period"] !== undefined) {
      rowValues[headerMap["period"]] = periodValidation.value;
    }
  }

  const dateInput = data.date !== undefined ? data.date : rowValues[headerMap["date"]];
  const dateValidation = validateDateFormat(dateInput);
  if (!dateValidation.success) { return dateValidation; }

  const academicYear = data.academicYear !== undefined ? normalizeString(data.academicYear) : normalizeString(rowValues[headerMap["academicYear"]]);
  if (!academicYear) { return { success: false, message: "academicYear wajib diisi." }; }

  const subject = data.subject !== undefined ? normalizeString(data.subject) : normalizeString(rowValues[headerMap["subject"]]);
  const content = data.content !== undefined ? normalizeString(data.content) : normalizeString(rowValues[headerMap["content"]]);
  if (!content) { return { success: false, message: "content wajib diisi." }; }

  const note = data.note !== undefined ? normalizeString(data.note) : normalizeString(rowValues[headerMap["note"]]);
  const statusValue = data.status !== undefined ? data.status : rowValues[headerMap["status"]];
  const statusValidation = validateJournalStatus(statusValue);
  if (!statusValidation.success) { return statusValidation; }

  rowValues[headerMap["date"]] = dateValidation.value;
  rowValues[headerMap["academicYear"]] = academicYear;
  rowValues[headerMap["subject"]] = subject;
  rowValues[headerMap["content"]] = content;
  rowValues[headerMap["note"]] = note;
  rowValues[headerMap["status"]] = statusValidation.value;

  sheet.getRange(journalRow.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  return { success: true, message: "Data journal berhasil diperbarui.", journal: buildJournalObject(headers, rowValues) };
}
function myFunction() {
  
}
