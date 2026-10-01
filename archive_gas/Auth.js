function checkLogin(username, password){

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  const data = sheet.getDataRange().getValues();

  Logger.log(data);

  for(let i = 1; i < data.length; i++){

    const row = data[i];

    Logger.log("Spreadsheet:");
    Logger.log(row);

    Logger.log("Input username = " + username);
    Logger.log("Input password = " + password);

    Logger.log("DB username = " + row[0]);
    Logger.log("DB password = " + row[1]);

    if(row[0] === username){

      Logger.log("Username ditemukan");

      if(String(row[1]) === password){

        Logger.log("Password cocok");

        const token = SessionManager.generateToken();
        
        SessionManager.create(
          token,
          username
        );
        
        Logger.log("Session berhasil dibuat: " + token);

        return {
          success: true,
          nama: row[2],
          role: row[3],
          token: token
        };

      }

    }

  }

  return {
    success: false
  };

}

function logout(token) {
  if (!token) {
    return false;
  }

  return SessionManager.destroy(token);
}

/**
 * Normalizes role to either 'ADMIN' or 'GURU'.
 * Rejects any other roles (including 'Administrator', 'Teacher', 'Siswa').
 */
function normalizeRole(role) {
  if (!role || typeof role !== "string") {
    return null;
  }
  const clean = role.trim().toUpperCase();
  if (clean === "ADMIN") {
    return "ADMIN";
  }
  if (clean === "GURU") {
    return "GURU";
  }
  return null;
}

/**
 * Validates session token and ensures caller has role ADMIN.
 * Returns { valid: true, username, name, role: 'ADMIN' } or { valid: false, message: ... }.
 */
function validateAdminSession(token) {
  if (!token || typeof token !== "string" || token.trim() === "") {
    return {
      valid: false,
      message: "Token sesi tidak boleh kosong."
    };
  }

  const session = SessionManager.validate(token.trim());
  if (!session || !session.valid || !session.username) {
    return {
      valid: false,
      message: "Sesi tidak valid atau telah berakhir."
    };
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!sheet) {
    return {
      valid: false,
      message: "Sheet Users tidak ditemukan."
    };
  }

  const data = sheet.getDataRange().getValues();
  const targetUsername = String(session.username).trim().toLowerCase();
  let userRole = null;
  let userName = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === targetUsername) {
      userName = data[i][2];
      userRole = data[i][3];
      break;
    }
  }

  const normalized = normalizeRole(userRole);
  if (normalized !== "ADMIN") {
    return {
      valid: false,
      message: "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  return {
    valid: true,
    username: session.username,
    name: userName,
    role: "ADMIN"
  };
}

/**
 * Creates a new user account in sheet Users.
 * Requires valid ADMIN session token.
 * Allowed roles: ADMIN and GURU only.
 */
function createAccount(token, data) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  if (!data || typeof data !== "object") {
    return {
      success: false,
      message: "Data akun tidak valid."
    };
  }

  const username = String(data.username || "").trim();
  const password = String(data.password || "").trim();
  const name = String(data.name || "").trim();
  const roleRaw = String(data.role || "").trim();

  if (!username) {
    return {
      success: false,
      message: "Username wajib diisi."
    };
  }
  if (!password) {
    return {
      success: false,
      message: "Password wajib diisi."
    };
  }
  if (!name) {
    return {
      success: false,
      message: "Nama pengguna wajib diisi."
    };
  }

  const normalizedRole = normalizeRole(roleRaw);
  if (!normalizedRole) {
    return {
      success: false,
      message: "Role tidak valid. Hanya role Admin atau Guru yang diperbolehkan."
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

  const sheetData = sheet.getDataRange().getValues();
  for (let i = 1; i < sheetData.length; i++) {
    if (String(sheetData[i][0]).trim().toLowerCase() === username.toLowerCase()) {
      return {
        success: false,
        message: "Username '" + username + "' sudah digunakan."
      };
    }
  }

  // Canonical storage in sheet
  const storedRole = (normalizedRole === "ADMIN") ? "Admin" : "Guru";
  sheet.appendRow([username, password, name, storedRole]);

  return {
    success: true,
    message: "Akun berhasil ditambahkan.",
    user: {
      username: username,
      name: name,
      role: storedRole
    }
  };
}

/**
 * Retrieves all registered accounts for Admin view (passwords excluded).
 * Requires valid ADMIN session token.
 */
function getAccounts(token) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
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
  const accounts = [];
  for (let i = 1; i < data.length; i++) {
    const u = String(data[i][0] || "").trim();
    if (u) {
      accounts.push({
        username: u,
        name: data[i][2] || "-",
        role: data[i][3] || "-"
      });
    }
  }

  return {
    success: true,
    accounts: accounts,
    currentUsername: auth.username
  };
}

/**
 * Invalidates all active sessions for a given username in sheet Sessions.
 */
function invalidateUserSessions(username) {
  if (!username) return;
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_SESSIONS);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const normalizedTarget = String(username).trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const sessionUser = String(data[i][1] || "").trim().toLowerCase();
    const status = String(data[i][4] || "").trim();

    if (sessionUser === normalizedTarget && status === "Active") {
      sheet.getRange(i + 1, 5).setValue("Inactive");
    }
  }
}

/**
 * Updates an existing user account in sheet Users.
 * Requires valid ADMIN session token.
 * If username changed, invalidates active sessions of oldUsername.
 * If caller changed their own username, returns requiresRelogin: true.
 */
function updateAccount(token, data) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  if (!data || typeof data !== "object") {
    return {
      success: false,
      message: "Data akun tidak valid."
    };
  }

  const originalUsername = String(data.originalUsername || "").trim();
  const newUsername = String(data.username || "").trim();
  const newPassword = String(data.password || "").trim();
  const name = String(data.name || "").trim();
  const roleRaw = String(data.role || "").trim();

  if (!originalUsername) {
    return {
      success: false,
      message: "Username awal (originalUsername) wajib disertakan."
    };
  }
  if (!newUsername) {
    return {
      success: false,
      message: "Username wajib diisi."
    };
  }
  if (!name) {
    return {
      success: false,
      message: "Nama pengguna wajib diisi."
    };
  }

  const normalizedRole = normalizeRole(roleRaw);
  if (!normalizedRole) {
    return {
      success: false,
      message: "Role tidak valid. Hanya role Admin atau Guru yang diperbolehkan."
    };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return {
      success: false,
      message: "Sistem sedang sibuk, silakan coba lagi beberapa saat."
    };
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
    if (!sheet) {
      return {
        success: false,
        message: "Sheet Users tidak ditemukan."
      };
    }

    const sheetData = sheet.getDataRange().getValues();
    let targetRowIndex = -1;
    let existingPassword = "";

    const normOrig = originalUsername.toLowerCase();
    const normNew = newUsername.toLowerCase();

    for (let i = 1; i < sheetData.length; i++) {
      const rowUser = String(sheetData[i][0] || "").trim().toLowerCase();
      if (rowUser === normOrig) {
        targetRowIndex = i + 1; // 1-based index in Sheet
        existingPassword = String(sheetData[i][1] || "");
      }
    }

    if (targetRowIndex < 2) {
      return {
        success: false,
        message: "Akun dengan username '" + originalUsername + "' tidak ditemukan."
      };
    }

    // Check if new username conflicts with another existing user
    if (normNew !== normOrig) {
      for (let i = 1; i < sheetData.length; i++) {
        const rowUser = String(sheetData[i][0] || "").trim().toLowerCase();
        if (rowUser === normNew) {
          return {
            success: false,
            message: "Username '" + newUsername + "' sudah digunakan oleh akun lain."
          };
        }
      }
    }

    // Password retention: if newPassword is empty, keep existingPassword
    const finalPassword = newPassword !== "" ? newPassword : existingPassword;
    const storedRole = (normalizedRole === "ADMIN") ? "Admin" : "Guru";

    // Update row in Users sheet: [username, password, name, role]
    sheet.getRange(targetRowIndex, 1, 1, 4).setValues([[newUsername, finalPassword, name, storedRole]]);

    let requiresRelogin = false;
    // If username changed: invalidate active sessions of old username
    if (normNew !== normOrig) {
      invalidateUserSessions(originalUsername);
      // If caller modified their own username, they must re-login
      if (normOrig === String(auth.username).trim().toLowerCase()) {
        requiresRelogin = true;
      }
    }

    return {
      success: true,
      message: "Akun berhasil diperbarui." + (requiresRelogin ? " Sesi Anda telah diakhiri karena username berubah, silakan login kembali." : ""),
      requiresRelogin: requiresRelogin,
      user: {
        username: newUsername,
        name: name,
        role: storedRole
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deletes a user account from sheet Users.
 * Requires valid ADMIN session token.
 * Enforces server-side Self-Delete Guard (cannot delete active login account).
 * Never deletes row 1 (header).
 * Invalidates all active sessions for deleted user in sheet Sessions.
 */
function deleteAccount(token, targetUsername) {
  const auth = validateAdminSession(token);
  if (!auth || !auth.valid) {
    return {
      success: false,
      message: auth ? auth.message : "Akses ditolak: Hanya Admin yang memiliki izin untuk operasi ini."
    };
  }

  const usernameToDelete = String(targetUsername || "").trim();
  if (!usernameToDelete) {
    return {
      success: false,
      message: "Username yang akan dihapus wajib ditentukan."
    };
  }

  const callerUsername = String(auth.username).trim().toLowerCase();
  const normTarget = usernameToDelete.toLowerCase();

  // CRITICAL: Self-Delete Guard (Server-Side)
  if (normTarget === callerUsername) {
    return {
      success: false,
      message: "Akun yang sedang digunakan tidak dapat dihapus."
    };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return {
      success: false,
      message: "Sistem sedang sibuk, silakan coba lagi beberapa saat."
    };
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
    if (!sheet) {
      return {
        success: false,
        message: "Sheet Users tidak ditemukan."
      };
    }

    const sheetData = sheet.getDataRange().getValues();
    let targetRowIndex = -1;

    for (let i = 1; i < sheetData.length; i++) {
      const rowUser = String(sheetData[i][0] || "").trim().toLowerCase();
      if (rowUser === normTarget) {
        targetRowIndex = i + 1; // 1-based index in Sheet
        break;
      }
    }

    // Strict protection: targetRowIndex must be >= 2 (never row 1 header)
    if (targetRowIndex < 2) {
      return {
        success: false,
        message: "Akun dengan username '" + usernameToDelete + "' tidak ditemukan."
      };
    }

    // Delete the row from Users sheet
    sheet.deleteRow(targetRowIndex);

    // Invalidate all active sessions belonging to the deleted account
    invalidateUserSessions(usernameToDelete);

    return {
      success: true,
      message: "Akun '" + usernameToDelete + "' berhasil dihapus."
    };
  } finally {
    lock.releaseLock();
  }
}