/**
 * SIMATA ID & QR Code Generator
 * Centralized Server-Side Generator for Master Identities
 * 
 * Provides atomic, sequence-safe identity generation:
 * - Student: studentId (STD-K<level><seq 3-digit>) & qrCodeId (SQR-K<level><seq 3-digit>)
 * - Teacher: teacherId (TCH-<seq 4-digit>)
 * - Class:   classId   (CLS-<yearShort>-<level/rombel>)
 */

/**
 * Resolve class level from classId by querying Classes sheet
 * @param {string} classId
 * @returns {{success: boolean, level?: string, message?: string}}
 */
function resolveClassLevel(classId) {
  const normClassId = normalizeString(classId);
  if (!normClassId) {
    return { success: false, message: "classId tidak boleh kosong." };
  }

  const classSheetResult = getClassesSheet();
  if (classSheetResult.success) {
    const classRow = findClassRowById(classSheetResult.sheet, normClassId);
    if (classRow) {
      const level = normalizeString(classRow.rowValues[classRow.headerMap["level"]]);
      if (level) {
        return { success: true, level: level };
      }
    }
  }

  // Fallback: extract numeric level from pattern CLS-xxxx-10 or similar
  const match = normClassId.match(/CLS-\d{4}-(\d+)/i) || normClassId.match(/(\d+)/);
  if (match && match[1]) {
    return { success: true, level: match[1] };
  }

  return {
    success: false,
    message: "Level kelas tidak dapat ditentukan dari classId: " + classId
  };
}

/**
 * Generate next Student Identity (studentId & qrCodeId)
 * Format:
 *   studentId: STD-K<level><seq 3-digit> (e.g. STD-K10020)
 *   qrCodeId:  SQR-K<level><seq 3-digit> (e.g. SQR-K10020)
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Students sheet
 * @param {string} classId - Target class ID
 * @returns {{success: boolean, studentId?: string, qrCodeId?: string, message?: string}}
 */
function generateStudentIdentity(sheet, classId) {
  const levelResult = resolveClassLevel(classId);
  if (!levelResult.success) {
    return levelResult;
  }

  const level = levelResult.level;
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["studentId"];

  let maxSeq = 0;
  const lastRow = sheet.getLastRow();

  if (lastRow > 1 && idIndex !== undefined && idIndex !== -1) {
    const values = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
    const regex = new RegExp("^STD-K" + level + "(\\d+)$", "i");

    for (let i = 0; i < values.length; i++) {
      const rawVal = normalizeString(values[i][0]);
      if (!rawVal) continue;
      const match = rawVal.match(regex);
      if (match && match[1]) {
        const seqNum = parseInt(match[1], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }
  }

  let nextSeq = maxSeq + 1;
  let seqStr = String(nextSeq).padStart(3, "0");
  let candidateStudentId = "STD-K" + level + seqStr;
  let candidateQrCodeId = "SQR-K" + level + seqStr;

  // Collision safeguard: loop until both studentId and qrCodeId are completely unique
  while (isStudentIdExists(sheet, candidateStudentId) || isStudentQrCodeIdExists(sheet, candidateQrCodeId)) {
    nextSeq++;
    seqStr = String(nextSeq).padStart(3, "0");
    candidateStudentId = "STD-K" + level + seqStr;
    candidateQrCodeId = "SQR-K" + level + seqStr;
  }

  return {
    success: true,
    studentId: candidateStudentId,
    qrCodeId: candidateQrCodeId
  };
}

/**
 * Generate next Teacher ID
 * Format:
 *   teacherId: TCH-<seq 4-digit> (e.g. TCH-0001)
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Teachers sheet
 * @returns {{success: boolean, teacherId?: string, message?: string}}
 */
function generateTeacherId(sheet) {
  const headers = getSheetHeaders(sheet);
  const headerMap = getHeaderMap(headers);
  const idIndex = headerMap["teacherId"];

  let maxSeq = 0;
  const lastRow = sheet.getLastRow();

  if (lastRow > 1 && idIndex !== undefined && idIndex !== -1) {
    const values = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
    const regex = /^TCH-(\d+)$/i;

    for (let i = 0; i < values.length; i++) {
      const rawVal = normalizeString(values[i][0]);
      if (!rawVal) continue;
      const match = rawVal.match(regex);
      if (match && match[1]) {
        const seqNum = parseInt(match[1], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }
  }

  let nextSeq = maxSeq + 1;
  let seqStr = String(nextSeq).padStart(4, "0");
  let candidateTeacherId = "TCH-" + seqStr;

  // Collision safeguard: loop until teacherId is unique
  while (isTeacherIdExists(sheet, candidateTeacherId)) {
    nextSeq++;
    seqStr = String(nextSeq).padStart(4, "0");
    candidateTeacherId = "TCH-" + seqStr;
  }

  return {
    success: true,
    teacherId: candidateTeacherId
  };
}

/**
 * Generate Class ID
 * Format:
 *   CLS-<yearShort>-<level/rombel> (e.g. CLS-2627-10, CLS-2627-10A)
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Classes sheet
 * @param {string} academicYear - e.g. "2026/2027"
 * @param {string} className - e.g. "Kelas 10" or "Kelas 10 A"
 * @param {string} level - e.g. "10"
 * @returns {{success: boolean, classId?: string, message?: string}}
 */
function generateClassId(sheet, academicYear, className, level) {
  const rawYear = normalizeString(academicYear);
  if (!rawYear) {
    return { success: false, message: "academicYear wajib diisi." };
  }

  let yearShort = "";
  const ym = rawYear.match(/(?:20)?(\d{2})[\/\-](?:20)?(\d{2})/);
  if (ym && ym[1] && ym[2]) {
    yearShort = ym[1] + ym[2];
  } else {
    return { success: false, message: "Format academicYear tidak valid. Gunakan format seperti 2026/2027." };
  }

  const normLevel = normalizeString(level);
  if (!normLevel) {
    return { success: false, message: "Level kelas wajib diisi." };
  }

  let baseClassId = "CLS-" + yearShort + "-" + normLevel;

  // Check parallel class indicator from className (e.g. "Kelas 10 A" -> "10A", "10-1" -> "10-1")
  const normName = normalizeString(className);
  const parallelMatch = normName.match(/(?:kelas\s*\d+\s*([a-zA-Z]|\d+))/i);

  if (parallelMatch && parallelMatch[1]) {
    const rombel = parallelMatch[1].toUpperCase();
    if (rombel !== normLevel) {
      baseClassId = "CLS-" + yearShort + "-" + normLevel + rombel;
    }
  }

  let candidateClassId = baseClassId;
  let suffixIndex = 1;

  while (isClassIdExists(sheet, candidateClassId)) {
    candidateClassId = baseClassId + "-" + suffixIndex;
    suffixIndex++;
  }

  return {
    success: true,
    classId: candidateClassId
  };
}