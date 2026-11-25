-- =============================================================================
-- Migration 013: Menu Nilai Dua Jalur (ASTS / ASAS SIMATA & Portal RDM) - BUG 74
-- Enhances grades table with canonical subject_code + unique upsert index,
-- adds per-class flexible KKM & subject ordering (grade_subject_configs),
-- parent publication state (grade_period_publications), homeroom KHS notes,
-- and ensures IPA exists in master subjects for Kelas X.
-- =============================================================================

-- 1. Ensure 'IPA' exists in master subjects (used in Kelas X ASTS/ASAS matrix)
INSERT INTO subjects (subject_id, code, name, category, color_tone, is_active)
SELECT 'SUBJ-IPA', 'IPA', 'Ilmu Pengetahuan Alam (IPA)', 'KBM', 'teal', TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM subjects WHERE subject_id = 'SUBJ-IPA' OR UPPER(code) = 'IPA'
);

-- 2. Enhance grades table for atomic batch upsert & audit tracking
ALTER TABLE grades ADD COLUMN IF NOT EXISTS subject_code VARCHAR(30);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS recorded_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

UPDATE grades
SET subject_code = UPPER(TRIM(subject))
WHERE subject_code IS NULL;

ALTER TABLE grades ALTER COLUMN subject_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_grades_student_period_subject
    ON grades(academic_year_id, assessment_type, student_id, subject_code);

CREATE INDEX IF NOT EXISTS idx_grades_year_class_period
    ON grades(academic_year_id, class_id, assessment_type);

CREATE INDEX IF NOT EXISTS idx_grades_student_year
    ON grades(student_id, academic_year_id);

-- 3. Per-class subject configuration & flexible KKM (default 75.00)
CREATE TABLE IF NOT EXISTS grade_subject_configs (
    config_id        VARCHAR(60) PRIMARY KEY,
    academic_year_id VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    class_id         VARCHAR(20) NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
    subject_code     VARCHAR(30) NOT NULL,
    subject_name     VARCHAR(120) NOT NULL,
    kkm              NUMERIC(5,2) NOT NULL DEFAULT 75.00 CHECK (kkm >= 0.00 AND kkm <= 100.00),
    sort_order       SMALLINT NOT NULL DEFAULT 100,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (academic_year_id, class_id, subject_code)
);

CREATE INDEX IF NOT EXISTS idx_grade_subject_configs_lookup
    ON grade_subject_configs(academic_year_id, class_id, is_active, sort_order);

-- 4. Period publication state (controls Parent / Wali Murid visibility per assessment)
CREATE TABLE IF NOT EXISTS grade_period_publications (
    academic_year_id   VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    assessment_type    VARCHAR(50) NOT NULL,
    is_published       BOOLEAN NOT NULL DEFAULT FALSE,
    published_at       TIMESTAMPTZ NULL,
    updated_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (academic_year_id, assessment_type)
);

-- 5. Homeroom teacher notes per student & assessment period (for KHS & Parent Portal)
CREATE TABLE IF NOT EXISTS grade_student_notes (
    academic_year_id   VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    assessment_type    VARCHAR(50) NOT NULL,
    student_id         VARCHAR(20) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    homeroom_note      TEXT NOT NULL DEFAULT '',
    updated_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (academic_year_id, assessment_type, student_id)
);
