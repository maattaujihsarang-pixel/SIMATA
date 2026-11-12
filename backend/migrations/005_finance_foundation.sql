-- ============================================================================
-- FEATURE 005-A: FONDASI DATABASE, MASTER DATA KEUANGAN, & RBAC EXTENSION
-- Sistem Informasi MA At-Taujih (SIMATA)
-- ============================================================================

-- 1. Ekstensi check constraint users.role untuk mendukung BENDAHARA dan ORANG_TUA
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check 
    CHECK (role IN ('ADMIN', 'GURU', 'BENDAHARA', 'ORANG_TUA'));

-- 2. Tabel Pemetaan Siswa & Orang Tua (parent_student_mappings)
-- Menghubungkan akun orang tua (users.role = 'ORANG_TUA') ke satu atau lebih siswa
CREATE TABLE IF NOT EXISTS parent_student_mappings (
    parent_user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    student_id          VARCHAR(20) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    relationship_type   VARCHAR(30) NOT NULL DEFAULT 'ORANG_TUA' 
                        CHECK (relationship_type IN ('AYAH', 'IBU', 'WALI', 'ORANG_TUA')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_psm_student_id ON parent_student_mappings(student_id);
CREATE INDEX IF NOT EXISTS idx_psm_parent_user_id ON parent_student_mappings(parent_user_id);

COMMENT ON TABLE parent_student_mappings IS 'Pemetaan relasi akun orang tua/wali ke siswa binaan untuk otorisasi portal orang tua.';

-- 3. Tabel Konfigurasi Sistem Keuangan (finance_settings)
CREATE TABLE IF NOT EXISTS finance_settings (
    setting_key         VARCHAR(50) PRIMARY KEY,
    setting_value       TEXT NOT NULL,
    description         TEXT NULL,
    updated_by_user_id  INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE finance_settings IS 'Pengaturan parameter operasional keuangan madrasah (nama bank, no rekening, nama bendahara, dll).';

-- Initial seed konfigurasi keuangan baku
INSERT INTO finance_settings (setting_key, setting_value, description)
VALUES 
    ('school_name', 'MA At-Taujih', 'Nama resmi lembaga/madrasah'),
    ('treasurer_name', 'Bendahara Madrasah', 'Nama pejabat bendahara madrasah'),
    ('bank_name', 'BSI (Bank Syariah Indonesia)', 'Nama bank penampung resmi pembayaran'),
    ('bank_account_number', '1234567890', 'Nomor rekening bank penerima tagihan'),
    ('bank_account_holder', 'MA At-Taujih Keuangan', 'Nama pemilik rekening bank resmi'),
    ('receipt_footer_note', 'Bukti pembayaran sah diterbitkan oleh Sistem Informasi MA At-Taujih (SIMATA).', 'Catatan kaki cetak bukti kuitansi')
ON CONFLICT (setting_key) DO NOTHING;
