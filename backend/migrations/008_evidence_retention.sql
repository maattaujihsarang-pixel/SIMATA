-- ============================================================================
-- MIGRATION 008: EVIDENCE PHOTO RETENTION & SYSTEM SETTINGS (BUG 53)
-- ============================================================================

-- 1. General system settings key-value store (for retention policy, cleanup telemetry, etc.)
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key         VARCHAR(80) PRIMARY KEY,
    setting_value       TEXT NOT NULL,
    description         TEXT NULL,
    updated_by_user_id  INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE system_settings IS 'Pengaturan sistem operasional SIMATA (retensi bukti foto, histori pembersihan, dll).';

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
    ('evidence_retention_days', '30', 'Masa simpan otomatis bukti foto Responder Guru dalam hari (0 = nonaktif)'),
    ('evidence_last_cleanup_at', '', 'Timestamp ISO pembersihan bukti foto terakhir'),
    ('evidence_last_cleanup_summary', '', 'Ringkasan JSON hasil pembersihan bukti foto terakhir')
ON CONFLICT (setting_key) DO NOTHING;

-- 2. Marker on teacher_attendance to distinguish purged photo evidence from never-captured attendance
ALTER TABLE teacher_attendance
    ADD COLUMN IF NOT EXISTS evidence_purged_at TIMESTAMPTZ NULL;

-- 3. Speed up retention cutoff scans on attendance_evidences
CREATE INDEX IF NOT EXISTS idx_attendance_evidences_captured_at
    ON attendance_evidences(captured_at);
