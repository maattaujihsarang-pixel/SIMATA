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