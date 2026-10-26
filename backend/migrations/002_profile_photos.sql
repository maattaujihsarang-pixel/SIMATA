-- =============================================================================
-- SIMATA (Sistem Informasi MA At-Taujih Sarang)
-- Migration 002: Profile Photos Schema (Students & Teachers)
-- =============================================================================

CREATE TABLE IF NOT EXISTS profile_photos (
    photo_id            VARCHAR(50) PRIMARY KEY,
    student_id          VARCHAR(20) NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    teacher_id          VARCHAR(20) NULL REFERENCES teachers(teacher_id) ON DELETE RESTRICT,
    file_name           VARCHAR(255) NOT NULL,
    storage_path        VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(50) NOT NULL,
    file_size           INTEGER NOT NULL,
    width               INTEGER NULL,
    height              INTEGER NULL,
    uploaded_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_profile_photos_single_owner CHECK (
        (student_id IS NOT NULL AND teacher_id IS NULL) OR
        (student_id IS NULL AND teacher_id IS NOT NULL)
    ),
    CONSTRAINT uq_profile_photos_student UNIQUE (student_id),
    CONSTRAINT uq_profile_photos_teacher UNIQUE (teacher_id)
);

COMMENT ON TABLE profile_photos IS 'Profile pasfoto metadata for students and teachers.';
