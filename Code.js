function validateSession(token) {
  try {
    if (!token || typeof token !== "string" || token.trim() === "") {
      return {
        valid: false,
        message: "Token sesi tidak boleh kosong."
      };
    }

    const session = SessionManager.validate(token.trim());

    if (session && session.valid) {
      return {
        valid: true,
        username: session.username
      };
    }

    return {
      valid: false,
      message: "Session tidak valid atau telah berakhir."
    };
  } catch (error) {
    Logger.log("validateSession error: " + (error && error.message ? error.message : String(error)));
    return {
      valid: false,
      message: "Terjadi kesalahan saat memverifikasi sesi."
    };
  }
}

function doGet(e) {

  const page = e && e.parameter.page
    ? e.parameter.page
    : "login";

  Logger.log("PAGE = " + page);

  switch (page) {

    case "dashboard":
      Logger.log("MEMBUKA DASHBOARD");
      return HtmlService
        .createTemplateFromFile("DashboardView")
        .evaluate()
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');

    default:
      Logger.log("MEMBUKA LOGIN");
      return HtmlService
        .createTemplateFromFile("Index")
        .evaluate()
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  }

}  // tutup doGet

function include(filename) {
  return HtmlService
    .createTemplateFromFile(filename)
    .evaluate()
    .getContent();
}
