-- =============================================================================
-- SIMATA (Sistem Informasi MA At-Taujih Sarang)
-- Migration 001: Initial PostgreSQL Schema (V1.2)
-- Architecture Target: Node.js (Express) + PostgreSQL (v14+)
-- =============================================================================

-- 1. ACADEMIC MASTER: ACADEMIC YEARS
CREATE TABLE IF NOT EXISTS academic_years (
    academic_year_id VARCHAR(9) PRIMARY KEY
                     CHECK (academic_year_id ~ '^\d{4}/\d{4}$'),
    name             VARCHAR(50) NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    start_date       DATE NULL,
    end_date         DATE NULL
);

COMMENT ON TABLE academic_years IS 'Master academic year definitions.';

-- 2. ACADEMIC MASTER: TEACHERS
CREATE TABLE IF NOT EXISTS teachers (
    teacher_id       VARCHAR(20) PRIMARY KEY,
    name             VARCHAR(150) NOT NULL,
    position         VARCHAR(50) NOT NULL DEFAULT 'Guru Mapel',
    status           VARCHAR(20) NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive')),
    subject          TEXT NOT NULL,
    gender           VARCHAR(10) NULL
                     CHECK (gender IS NULL OR gender IN ('L', 'P')),
    nip              VARCHAR(30) NULL,
    nuptk            VARCHAR(30) NULL,
    nik              VARCHAR(30) NULL,
    qr_code_id       VARCHAR(50) NULL,
    birth_place      VARCHAR(100) NULL,
    birth_date       DATE NULL,
    village          VARCHAR(100) NULL,
    district         VARCHAR(100) NULL,
    regency          VARCHAR(100) NULL,
    phone            VARCHAR(30) NULL,
    email            VARCHAR(100) NULL,
    education        VARCHAR(50) NULL,
    major            VARCHAR(100) NULL,
    graduation_year  VARCHAR(10) NULL,
    teaching_hours   INTEGER NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE teachers IS 'Master faculty registry. 19 active teacher records in production.';

-- 3. AUTH DOMAIN: USERS
CREATE TABLE IF NOT EXISTS users (
    user_id          SERIAL PRIMARY KEY,
    username         VARCHAR(50) NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    full_name        VARCHAR(150) NOT NULL,
    role             VARCHAR(20) NOT NULL
                     CHECK (role IN ('ADMIN', 'GURU')),
    status           VARCHAR(20) NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive')),
    teacher_id       VARCHAR(20) NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_users_teacher_id UNIQUE (teacher_id),
    CONSTRAINT fk_users_teacher_id FOREIGN KEY (teacher_id)
        REFERENCES teachers(teacher_id) ON DELETE SET NULL
);

COMMENT ON TABLE users IS 'User authentication and access control accounts.';

-- 4. AUTH DOMAIN: AUTHENTICATION SESSIONS
CREATE TABLE IF NOT EXISTS authentication_sessions (
    session_id       VARCHAR(64) PRIMARY KEY,
    user_id          INTEGER NOT NULL
                     REFERENCES users(user_id) ON DELETE CASCADE,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ NULL,
    ip_address       VARCHAR(45) NULL,
    user_agent       TEXT NULL
);

COMMENT ON TABLE authentication_sessions IS 'Runtime web login session records for the Node.js server.';

-- 5. ACADEMIC MASTER: CLASSES
CREATE TABLE IF NOT EXISTS classes (
    class_id            VARCHAR(20) PRIMARY KEY,
    class_name          VARCHAR(50) NOT NULL,
    level               INTEGER NOT NULL
                        CHECK (level IN (10, 11, 12)),
    academic_year_id    VARCHAR(9) NOT NULL
                        REFERENCES academic_years(academic_year_id) ON DELETE RESTRICT,
    homeroom_teacher_id VARCHAR(20) NULL
                        REFERENCES teachers(teacher_id) ON DELETE SET NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Active', 'Inactive')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE classes IS 'Master classroom / rombel registry. 3 classes active in 2026/2027.';

-- 6. ACADEMIC MASTER: STUDENTS
CREATE TABLE IF NOT EXISTS students (
    student_id       VARCHAR(20) PRIMARY KEY,
    class_id         VARCHAR(20) NOT NULL
                     REFERENCES classes(class_id) ON DELETE RESTRICT,
    name             VARCHAR(150) NOT NULL,
    gender           VARCHAR(10) NULL
                     CHECK (gender IS NULL OR gender IN ('L', 'P')),
    nis              VARCHAR(30) NULL,
    nisn             VARCHAR(30) NULL,
    birth_date       DATE NULL,
    qr_code_id       VARCHAR(50) NOT NULL UNIQUE,
    status           VARCHAR(20) NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE students IS 'Master student registry. 47 active students enrolled in 2026/2027.';

-- 7. ATTENDANCE TRANSACTIONS: STUDENT ATTENDANCE
CREATE TABLE IF NOT EXISTS student_attendance (
    attendance_id       VARCHAR(50) PRIMARY KEY,
    student_id          VARCHAR(20) NOT NULL
                        REFERENCES students(student_id) ON DELETE RESTRICT,
    class_id            VARCHAR(20) NOT NULL
                        REFERENCES classes(class_id) ON DELETE RESTRICT,
    academic_year_id    VARCHAR(9) NOT NULL
                        REFERENCES academic_years(academic_year_id) ON DELETE RESTRICT,
    attendance_date     DATE NOT NULL,
    period              SMALLINT NOT NULL
                        CHECK (period >= 1 AND period <= 10),
    status              VARCHAR(20) NOT NULL
                        CHECK (status IN ('Hadir', 'Izin', 'Sakit', 'Alpa')),
    method              VARCHAR(30) NOT NULL DEFAULT 'QR_BATCH',
    recorded_at         TIMESTAMPTZ NOT NULL,
    note                TEXT NULL,
    recorded_by_user_id INTEGER NULL
                        REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_student_daily_period UNIQUE (student_id, attendance_date, period)
);

COMMENT ON TABLE student_attendance IS 'Per-period student attendance transaction records.';

-- 8. ATTENDANCE TRANSACTIONS: TEACHER ATTENDANCE
CREATE TABLE IF NOT EXISTS teacher_attendance (
    attendance_id       VARCHAR(50) PRIMARY KEY,
    teacher_id          VARCHAR(20) NOT NULL
                        REFERENCES teachers(teacher_id) ON DELETE RESTRICT,
    class_id            VARCHAR(20) NOT NULL
                        REFERENCES classes(class_id) ON DELETE RESTRICT,
    academic_year_id    VARCHAR(9) NOT NULL
                        REFERENCES academic_years(academic_year_id) ON DELETE RESTRICT,
    attendance_date     DATE NOT NULL,
    period              SMALLINT NOT NULL
                        CHECK (period >= 1 AND period <= 10),
    subject             VARCHAR(100) NOT NULL,
    materi              TEXT NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'Hadir'
                        CHECK (status IN ('Hadir', 'Izin', 'Sakit', 'TugasLuar')),
    method              VARCHAR(30) NOT NULL DEFAULT 'Camera',
    recorded_at         TIMESTAMPTZ NOT NULL,
    note                TEXT NULL,
    recorded_by_user_id INTEGER NULL
                        REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_teacher_daily_period UNIQUE (teacher_id, attendance_date, period)
);

COMMENT ON TABLE teacher_attendance IS 'Teacher instructional presence logs verified via camera.';

-- 9. DEVICE / OPERATIONS: RESPONDER SESSIONS
CREATE TABLE IF NOT EXISTS responder_sessions (
    session_id          VARCHAR(50) PRIMARY KEY,
    operator_user_id    INTEGER NOT NULL
                        REFERENCES users(user_id) ON DELETE RESTRICT,
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'FINISHED', 'CANCELLED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE responder_sessions IS 'Operational scanning / camera sessions opened by Admin/Guru operators.';

-- 10. FILE / STORAGE: ATTENDANCE EVIDENCES
CREATE TABLE IF NOT EXISTS attendance_evidences (
    evidence_id         VARCHAR(50) PRIMARY KEY,
    session_id          VARCHAR(50) NOT NULL
                        REFERENCES responder_sessions(session_id) ON DELETE CASCADE,
    operator_user_id    INTEGER NOT NULL
                        REFERENCES users(user_id) ON DELETE RESTRICT,
    captured_at         TIMESTAMPTZ NOT NULL,
    file_id             VARCHAR(100) NOT NULL,
    file_url            TEXT NOT NULL,
    attendance_id       VARCHAR(50) NULL,
    storage_provider    VARCHAR(30) NOT NULL DEFAULT 'LOCAL',
    mime_type           VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_attendance_evidences_attendance UNIQUE (attendance_id),
    CONSTRAINT fk_attendance_evidences_attendance FOREIGN KEY (attendance_id)
        REFERENCES teacher_attendance(attendance_id) ON DELETE SET NULL
);

COMMENT ON TABLE attendance_evidences IS 'Audit verification photo metadata linked to teacher attendance and responder sessions.';

-- 11. ASSESSMENT: GRADES (FUTURE FEATURE BOUNDARY)
CREATE TABLE IF NOT EXISTS grades (
    grade_id            VARCHAR(50) PRIMARY KEY,
    student_id          VARCHAR(20) NOT NULL
                        REFERENCES students(student_id) ON DELETE RESTRICT,
    class_id            VARCHAR(20) NOT NULL
                        REFERENCES classes(class_id) ON DELETE RESTRICT,
    academic_year_id    VARCHAR(9) NOT NULL
                        REFERENCES academic_years(academic_year_id) ON DELETE RESTRICT,
    subject             VARCHAR(100) NOT NULL,
    assessment_type     VARCHAR(50) NOT NULL,
    score               NUMERIC(5,2) NOT NULL
                        CHECK (score >= 0.00 AND score <= 100.00),
    semester            VARCHAR(20) NOT NULL
                        CHECK (semester IN ('Ganjil', 'Genap')),
    assessment_date     DATE NULL,
    remarks             TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE grades IS 'Student academic grades and assessments.';

-- 12. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_student_attendance_date ON student_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_student_attendance_class_date ON student_attendance(class_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_student_attendance_student_date ON student_attendance(student_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_date ON teacher_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_teacher_date ON teacher_attendance(teacher_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_responder_sessions_operator_status ON responder_sessions(operator_user_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_evidences_session ON attendance_evidences(session_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires ON authentication_sessions(user_id, expires_at);

