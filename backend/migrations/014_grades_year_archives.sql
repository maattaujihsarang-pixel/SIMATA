-- =============================================================================
-- Migration 014: Academic Year Grade Archive & Lock Registry (BUG 74 / BUG 60)
-- Tracks per-academic-year archive lock state so historical grade ledgers & KHS
-- remain immutable and intact even after students promote classes or graduate.
-- =============================================================================

CREATE TABLE IF NOT EXISTS grade_year_archives (
    academic_year_id     VARCHAR(9) PRIMARY KEY
                         REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    is_archived          BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at          TIMESTAMPTZ NULL,
    archived_by_user_id  INTEGER NULL
                         REFERENCES users(user_id) ON DELETE SET NULL,
    archive_note         TEXT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE grade_year_archives IS 'Per-academic-year archive lock state for SIMATA Grades (ASTS/ASAS).';
