# SIMATA
Sistem Informasi MA At-Taujih Sarang

## Arsitektur & Teknologi (100% Standalone Server)
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL / SQLite Relasional
- **Frontend:** HTML5, CSS3, Modern JavaScript (SPA di folder `public/`)
- **API:** REST API (`/api/v1`)
- **Keamanan:** Bcrypt Hashing, Session Token, Helmet, CORS Guard

## Struktur Direktori
- `backend/` : Server Node.js, controllers, services, database migrations, dan REST API.
- `public/` : Antarmuka web statis (Dashboard, Login, Assets, CSS, JS Client).
- `archive_gas/` : Arsip kode sumber lama Google Apps Script (versi terdahulu).

## Menjalankan SIMATA Lokal
```bash
cd backend
npm install
npm run start
# Akses aplikasi di http://localhost:3000
```