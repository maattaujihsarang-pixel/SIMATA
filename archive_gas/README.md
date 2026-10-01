# Arsip Kode Sumber Google Apps Script (Legacy SIMATA)

Folder ini berisi seluruh file kode sumber lama SIMATA versi 1 yang berbasis **Google Apps Script (GAS)** dan **Google Spreadsheet**.

## Status: Diarsipkan (Deprecated / Archived)
Sistem informasi SIMATA kini **100% menggunakan arsitektur modern mandiri**:
- **Backend:** Node.js + Express + PostgreSQL / SQLite (di folder `../backend/`)
- **Frontend:** HTML5, CSS3, Vanilla JS Standalone (di folder `../public/`)
- **REST API:** `/api/v1/...`

## Isi Arsip Ini:
1. **Konfigurasi Clasp:** `.clasp.json`, `.claspignore`, `appsscript.json`
2. **Template Tampilan GAS:** `Index.html`, `DashboardView.html`, `DashboardScript.html`, `ChatbotView.html`, `ChatbotScript.html`, `LoginResponsive.html`, `MobileResponsive.html`, `style.html`, `assets.html`
3. **Backend Script GAS (SpreadsheetApp):** `Code.js`, `Config.js`, `Database.js`, `Student.js`, `Teachers.js`, `Classes.js`, `Session.js`, `ResponderSession.js`, `TeacherAttendance.js`, `StudentAttendance.js`, `AttendanceEvidence.js`, `Attendance.js`, `Auth.js`, `Chatbot.js`, `ChatbotData.js`, `ChatbotKnowledge.js`, `GeminiApi.js`, `Grades.js`, `Journal.js`, `Report.js`, `IdGenerator.js`, `Utils.js`

> **Catatan:** File-file di folder ini tidak lagi dieksekusi oleh server SIMATA. Jika sewaktu-waktu membutuhkan referensi logika Google Sheets lama, seluruh kode tetap tersimpan utuh di sini.
