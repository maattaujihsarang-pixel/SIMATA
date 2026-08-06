function doGet(e) {

  const page = e && e.parameter.page
    ? e.parameter.page
    : "login";

  switch (page) {

    case "dashboard":
      return HtmlService
        .createTemplateFromFile("DashboardView")
        .evaluate()
        .setTitle("SIMATA | Dashboard");

    case "login":
    default:
      return HtmlService
        .createTemplateFromFile("Index")
        .evaluate()
        .setTitle("SIMATA | Login");

  }

}

function include(filename) {
  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}

function include(filename){
  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}

function showLoading() {
    document.getElementById("loadingOverlay").classList.add("show");
}

function hideLoading() {
    document.getElementById("loadingOverlay").classList.remove("show");
}