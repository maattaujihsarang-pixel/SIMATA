-- Migration 010: Integrated Jadwal Pelajaran (Timetable, Subjects, Bell Periods & Teacher Codes)
-- Supports flexible Academic Year + Semester scheduling, teacher conflict prevention,
-- MA At-Taujih Sarang active days (Sabtu=6, Ahad=0, Senin=1, Selasa=2, Rabu=3, Kamis=4),
-- and integration with Responder Guru, Laporan Kinerja Guru, & Chatbot SIMATA.

CREATE TABLE IF NOT EXISTS subjects (
    subject_id VARCHAR(30) PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'KBM' CHECK (category IN ('KBM', 'NON_KBM', 'BREAK')),
    color_tone VARCHAR(24) NOT NULL DEFAULT 'emerald',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule_periods (
    period_config_id VARCHAR(40) PRIMARY KEY,
    academic_year_id VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    semester VARCHAR(10) NOT NULL CHECK (semester IN ('GANJIL', 'GENAP')),
    sort_order SMALLINT NOT NULL,
    period_number SMALLINT,
    label VARCHAR(60) NOT NULL,
    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    is_break BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (academic_year_id, semester, sort_order)
);

CREATE TABLE IF NOT EXISTS teacher_schedule_codes (
    academic_year_id VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    semester VARCHAR(10) NOT NULL CHECK (semester IN ('GANJIL', 'GENAP')),
    teacher_id VARCHAR(20) NOT NULL REFERENCES teachers(teacher_id) ON DELETE CASCADE,
    short_code VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (academic_year_id, semester, teacher_id),
    UNIQUE (academic_year_id, semester, short_code)
);

CREATE TABLE IF NOT EXISTS class_schedules (
    schedule_id VARCHAR(40) PRIMARY KEY,
    academic_year_id VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    semester VARCHAR(10) NOT NULL CHECK (semester IN ('GANJIL', 'GENAP')),
    day_of_week SMALLINT NOT NULL CHECK (day_of_week IN (0, 1, 2, 3, 4, 6)),
    period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 12),
    class_id VARCHAR(20) NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
    subject_id VARCHAR(30) NOT NULL REFERENCES subjects(subject_id) ON DELETE RESTRICT,
    teacher_id VARCHAR(20) REFERENCES teachers(teacher_id) ON DELETE SET NULL,
    note TEXT,
    updated_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (academic_year_id, semester, day_of_week, period_number, class_id)
);

-- Prevent teacher double-booking in the exact same year/semester/day/period
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_schedule_slot
    ON class_schedules(academic_year_id, semester, day_of_week, period_number, teacher_id)
    WHERE teacher_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_periods_year_sem
    ON schedule_periods(academic_year_id, semester, sort_order);

CREATE INDEX IF NOT EXISTS idx_class_schedules_lookup
    ON class_schedules(academic_year_id, semester, day_of_week, class_id);

CREATE INDEX IF NOT EXISTS idx_class_schedules_teacher
    ON class_schedules(academic_year_id, semester, teacher_id);
