-- ============================================================================
-- MIGRATION 009: STUDENT TA'ZIR EXECUTION & HISTORY (BUG 56 REVISION)
-- ============================================================================

CREATE TABLE IF NOT EXISTS student_tazir_actions (
    tazir_id            VARCHAR(50) PRIMARY KEY,
    student_id          VARCHAR(20) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    academic_year_id    VARCHAR(9) NULL REFERENCES academic_years(academic_year_id) ON DELETE SET NULL,
    tazir_type          VARCHAR(20) NOT NULL
                        CHECK (tazir_type IN ('HARIAN', 'JAM', 'GABUNGAN')),
    action_date         DATE NOT NULL,
    trigger_summary     VARCHAR(160) NULL,
    tazir_note          TEXT NULL,
    recorded_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_tazir_actions_student_date
    ON student_tazir_actions(student_id, action_date DESC);

COMMENT ON TABLE student_tazir_actions IS 'Riwayat pencatatan eksekusi pembinaan / Ta''zir disiplin absensi siswa.';
