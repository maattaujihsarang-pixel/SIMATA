-- =============================================================================
-- SIMATA (Sistem Informasi MA At-Taujih Sarang)
-- Migration 004: Student Documents Schema (FEATURE 004 - Kartu Pelajar)
-- =============================================================================

CREATE TABLE IF NOT EXISTS student_documents (
    document_id         VARCHAR(50) PRIMARY KEY,
    student_id          VARCHAR(20) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    document_type       VARCHAR(50) NOT NULL, -- e.g. 'KARTU_PELAJAR'
    file_name           VARCHAR(255) NOT NULL, -- Storage physical filename: doc_<uuid>.<ext>
    original_name       VARCHAR(255) NOT NULL, -- Original uploaded filename
    storage_path        VARCHAR(255) NOT NULL, -- Subfolder or relative storage path
    mime_type           VARCHAR(50) NOT NULL,
    file_size           INTEGER NOT NULL,
    uploaded_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_student_document_type UNIQUE (student_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_student_documents_student_id ON student_documents(student_id);
CREATE INDEX IF NOT EXISTS idx_student_documents_type ON student_documents(document_type);

COMMENT ON TABLE student_documents IS 'Student official documents including Kartu Pelajar (FEATURE 004).';
COMMENT ON COLUMN student_documents.document_type IS 'Document type identifier (e.g. KARTU_PELAJAR)';
