-- 011_students_kts_fields.sql
-- BUG 65: Add KTS fields (Tempat Lahir, Alamat Lengkap, Pondok/Asrama) to students and kts_settings table

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS birth_place VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS dormitory VARCHAR(150);

CREATE TABLE IF NOT EXISTS kts_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
