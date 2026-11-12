-- ============================================================================
-- FEATURE 005-B: MASTER KATEGORI BIAYA, TAGIHAN SISWA (INVOICING), & STATUS INVARIANT
-- Sistem Informasi MA At-Taujih (SIMATA)
-- ============================================================================

-- 1. TABEL fee_categories (Master Jenis Biaya Madrasah)
CREATE TABLE IF NOT EXISTS fee_categories (
    fee_category_id VARCHAR(30) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT NULL,
    default_amount  NUMERIC(14,2) NOT NULL DEFAULT 0.00
                    CHECK (default_amount >= 0),
    billing_cycle   VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'
                    CHECK (billing_cycle IN ('MONTHLY', 'SEMESTER', 'ANNUAL', 'ONCE', 'CUSTOM')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE fee_categories IS 'Master data konfigurasi jenis biaya madrasah (SPP, Gedung, Seragam, Ujian, dll).';

-- Seed default fee categories
INSERT INTO fee_categories (fee_category_id, name, description, default_amount, billing_cycle, is_active)
VALUES 
    ('FEE-SPP', 'SPP Bulanan', 'Biaya SPP bulanan madrasah', 150000.00, 'MONTHLY', TRUE),
    ('FEE-GEDUNG', 'Uang Gedung', 'Infaq pembangunan gedung madrasah', 1500000.00, 'ONCE', TRUE),
    ('FEE-SERAGAM', 'Seragam & Atribut', 'Biaya seragam dan atribut madrasah', 500000.00, 'ONCE', TRUE),
    ('FEE-PTS', 'Ujian Tengah Semester (PTS)', 'Biaya pelaksanaan PTS', 100000.00, 'SEMESTER', TRUE),
    ('FEE-PAS-PAT', 'Ujian Semester (PAS/PAT)', 'Biaya pelaksanaan PAS / PAT', 125000.00, 'SEMESTER', TRUE),
    ('FEE-KEGIATAN', 'Iuran Kegiatan Tahunan', 'Biaya kegiatan kesiswaan tahunan', 250000.00, 'ANNUAL', TRUE)
ON CONFLICT (fee_category_id) DO NOTHING;

-- 2. TABEL student_invoices (Tagihan Siswa)
CREATE TABLE IF NOT EXISTS student_invoices (
    invoice_id          VARCHAR(50) PRIMARY KEY,
    student_id          VARCHAR(20) NOT NULL
                        REFERENCES students(student_id) ON DELETE RESTRICT,
    academic_year_id    VARCHAR(9) NOT NULL
                        REFERENCES academic_years(academic_year_id) ON DELETE RESTRICT,
    fee_category_id     VARCHAR(30) NOT NULL
                        REFERENCES fee_categories(fee_category_id) ON DELETE RESTRICT,
    period_key          VARCHAR(20) NOT NULL,
    title               VARCHAR(150) NOT NULL,
    total_amount        NUMERIC(14,2) NOT NULL
                        CHECK (total_amount > 0),
    amount_paid         NUMERIC(14,2) NOT NULL DEFAULT 0.00
                        CHECK (amount_paid >= 0),
    status              VARCHAR(20) NOT NULL DEFAULT 'UNPAID'
                        CHECK (status IN ('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED')),
    due_date            DATE NULL,
    notes               TEXT NULL,
    cancellation_reason TEXT NULL,
    cancelled_at        TIMESTAMPTZ NULL,
    created_by_user_id  INTEGER NOT NULL
                        REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Invariant: Pembayaran tidak boleh melampaui total kewajiban
    CONSTRAINT chk_invoice_paid_not_exceed CHECK (amount_paid <= total_amount),

    -- Invariant: Tagihan CANCELLED wajib memiliki amount_paid = 0
    CONSTRAINT chk_invoice_cancelled_zero_paid CHECK (status <> 'CANCELLED' OR amount_paid = 0),

    -- Invariant: Validasi Format Kanonikal Baku period_key (Keputusan Final Owner Q.5)
    CONSTRAINT chk_invoice_period_key_format CHECK (
        period_key ~ '^\d{4}-(0[1-9]|1[0-2])$' OR
        period_key ~ '^\d{4}-SMT[1-2]$' OR
        period_key ~ '^\d{4}-ANNUAL$' OR
        period_key ~ '^\d{4}-ONCE$' OR
        period_key ~ '^\d{4}-PTS[1-2]$' OR
        period_key ~ '^\d{4}-(PAS1|PAT2)$'
    )
);

COMMENT ON TABLE student_invoices IS 'Tabel transaksi tagihan siswa per periode/termin kanonikal.';

-- 3. PARTIAL UNIQUE INDEX (Pencegahan Duplikasi Tagihan Aktif - Q.5)
-- Tagihan berstatus CANCELLED dikecualikan sehingga tagihan baru dapat diterbitkan jika tagihan lama dibatalkan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_student_category_period
ON student_invoices(student_id, academic_year_id, fee_category_id, period_key)
WHERE status <> 'CANCELLED';

-- 4. RECOMMENDED INDEXES UNTUK PERFORMANCE QUERY
CREATE INDEX IF NOT EXISTS idx_invoices_student_ay ON student_invoices(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON student_invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON student_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_category ON student_invoices(fee_category_id);
