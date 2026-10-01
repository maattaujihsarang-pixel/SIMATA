/**
 * Dashboard Backend
 * SIMATA v0.1.1-dev
 * Sprint 2 - Commit 006
 */

function getDashboardData(token) {

  const session = SessionManager.validate(token);

  if (!session || !session.valid) {
    return {
      success: false,
      message: "Session tidak valid."
    };
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);

  if (!sheet) {
    return {
      success: false,
      message: "Sheet Users tidak ditemukan."
    };
  }

  const data = sheet.getDataRange().getValues();

  let user = null;

  for (let i = 1; i < data.length; i++) {

    const row = data[i];

    if (String(row[0]).trim() === String(session.username).trim()) {

      user = {
        name: row[2] || session.username,
        role: row[3] || "User"
      };

      break;
    }
  }

  if (!user) {
    return {
      success: false,
      message: "Data pengguna tidak ditemukan."
    };
  }

  // Compute real statistics using existing read-only backend functions
  let studentsCount = 0;
  let teachersCount = 0;
  let classesCount = 0;
  let attendanceCount = 0;

  try {
    const studentsResult = getStudents();
    if (studentsResult && studentsResult.success && Array.isArray(studentsResult.students)) {
      studentsCount = studentsResult.students.length;
    }
  } catch (e) {
    // swallow — keep count 0
  }

  try {
    const teachersResult = getTeachers();
    if (teachersResult && teachersResult.success && Array.isArray(teachersResult.teachers)) {
      teachersCount = teachersResult.teachers.length;
    }
  } catch (e) {
    // swallow
  }

  try {
    const classesResult = getClasses();
    if (classesResult && classesResult.success && Array.isArray(classesResult.classes)) {
      classesCount = classesResult.classes.length;
    }
  } catch (e) {
    // swallow
  }

  try {
    // Today's date in YYYY-MM-DD according to script timezone
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const attendanceResult = getStudentAttendance({ date: today });
    if (attendanceResult && attendanceResult.success && Array.isArray(attendanceResult.attendances)) {
      attendanceCount = attendanceResult.attendances.length;
    }
  } catch (e) {
    // swallow
  }

  return {
    success: true,
    user: user,
    statistics: {
      students: studentsCount,
      teachers: teachersCount,
      attendance: attendanceCount,
      classes: classesCount
    }
  };
}