/**
 * ===================================================
 * SIMATA Session Manager
 * Sprint 2 - Commit S2-C008
 * ===================================================
 */

class SessionManager {

  static generateToken() {
    return Utilities.getUuid();
  }

  static create(token, username) {

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_SESSIONS);

    const loginTime = new Date();

    const expiredTime = new Date(
      loginTime.getTime() + (6 * 60 * 60 * 1000)
    );

    sheet.appendRow([
      token,
      username,
      loginTime,
      expiredTime,
      "Active"
    ]);

  }

  static validate(token) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_SESSIONS);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const sessionToken = data[i][0];
      const username = data[i][1];
      const expired = data[i][3];
      const status = data[i][4];

      if (
        sessionToken === token &&
        status === "Active" &&
        new Date() < new Date(expired)
      ) {
        return {
          valid: true,
          username: username
        };
      }
    }

    return {
      valid: false
    };
  }

  static destroy(token) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_SESSIONS);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === token) {
        sheet.getRange(i + 1, 5).setValue("Inactive");
        return true;
      }
    }

    return false;
  }

}