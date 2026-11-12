-- ============================================================================
-- FEATURE 005-C: PENCATATAN PEMBAYARAN, PENOMORAN KUITANSI, & ALOKASI TAGIHAN
-- Sistem Informasi MA At-Taujih (SIMATA)
-- ============================================================================

-- 1. TABEL finance_receipt_sequences (Transactional Counter Kuitansi Kasir - Q.1)
CREATE TABLE IF NOT EXISTS finance_receipt_sequences (
    period_key      VARCHAR(6) PRIMARY KEY, -- Format YYYYMM (zona waktu Asia/Jakarta)
    last_sequence   INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE finance_receipt_sequences IS 'Transactional counter untuk penomoran kuitansi kasir KWT/YYYYMM/SEQ5 yang direset tiap bulan.';

-- 2. TABEL finance_documents (Dokumen & Bukti Pembayaran Privat - Q.2 & Q.3)
CREATE TABLE IF NOT EXISTS finance_documents (
    document_id         VARCHAR(50) PRIMARY KEY,
    document_type       VARCHAR(50) NOT NULL, -- 'BUKTI_PEMBAYARAN_SISWA', 'BUKTI_PEMASUKAN', 'BUKTI_PENGELUARAN'
    file_name           VARCHAR(255) NOT NULL,
    original_name       VARCHAR(255) NOT NULL,
    storage_path        VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(50) NOT NULL,
    file_size           INTEGER NOT NULL,
    uploaded_by_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_documents_uploader ON finance_documents(uploaded_by_user_id);

COMMENT ON TABLE finance_documents IS 'Metadata berkas bukti fisik keuangan privat (slip transfer, kwitansi fisik, nota belanja).';

-- 3. TABEL student_payments (Pencatatan Pembayaran Siswa)
CREATE TABLE IF NOT EXISTS student_payments (
    payment_id          VARCHAR(50) PRIMARY KEY,
    receipt_number      VARCHAR(40) NOT NULL UNIQUE,
    receipt_issued_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    student_id          VARCHAR(20) NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    academic_year_id    VARCHAR(9) NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE RESTRICT,
    payment_date        DATE NOT NULL,
    amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_method      VARCHAR(20) NOT NULL DEFAULT 'CASH'
                        CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'TUNAI', 'TRANSFER')),
    reference_number    VARCHAR(100) NULL,
    notes               TEXT NULL,
    document_id         VARCHAR(50) NULL REFERENCES finance_documents(document_id) ON DELETE SET NULL,
    recorded_by_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'VOID')),
    void_at             TIMESTAMPTZ NULL,
    void_by_user_id     INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    void_reason         TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_student_date ON student_payments(student_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_academic_year ON student_payments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON student_payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_receipt_number ON student_payments(receipt_number);
CREATE INDEX IF NOT EXISTS idx_payments_doc_id ON student_payments(document_id);

COMMENT ON TABLE student_payments IS 'Transaksi pencatatan uang masuk pembayaran siswa di loket madrasah.';

-- 4. TABEL payment_allocations (Alokasi Pembayaran ke Tagihan Siswa - Q.4)
CREATE TABLE IF NOT EXISTS payment_allocations (
    allocation_id       VARCHAR(50) PRIMARY KEY,
    payment_id          VARCHAR(50) NOT NULL REFERENCES student_payments(payment_id) ON DELETE RESTRICT,
    invoice_id          VARCHAR(50) NOT NULL REFERENCES student_invoices(invoice_id) ON DELETE RESTRICT,
    amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    allocated_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_payment_invoice UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice_id ON payment_allocations(invoice_id);

COMMENT ON TABLE payment_allocations IS 'Relasi pemecahan pembayaran ke satu atau beberapa tagihan siswa (SSOT Pembayaran Aktif).';

-- 5. TABEL payment_audit_logs (Append-Only Audit Log Perubahan Pembayaran)
CREATE TABLE IF NOT EXISTS payment_audit_logs (
    audit_id            BIGSERIAL PRIMARY KEY,
    payment_id          VARCHAR(50) NOT NULL REFERENCES student_payments(payment_id) ON DELETE RESTRICT,
    action_type         VARCHAR(20) NOT NULL
                        CHECK (action_type IN ('INSERT', 'UPDATE', 'ALLOCATE', 'VOID')),
    changed_by_user_id  INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    reason              TEXT NOT NULL,
    old_values          JSONB NULL,
    new_values          JSONB NOT NULL,
    old_allocations     JSONB NULL,
    new_allocations     JSONB NOT NULL,
    ip_address          VARCHAR(45) NULL,
    user_agent          TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_payment_id ON payment_audit_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_created_at ON payment_audit_logs(created_at DESC);

COMMENT ON TABLE payment_audit_logs IS 'Append-only audit trail untuk pencatatan, koreksi, alokasi lanjutan, dan VOID pembayaran.';

-- ============================================================================
-- 6. TRIGGERS & STORED FUNCTIONS (INTEGRITAS & INVARIANT KEUANGAN)
-- ============================================================================

-- A. Pembangkit Nomor Bukti Kuitansi Kasir (Q.1)
CREATE OR REPLACE FUNCTION fn_generate_next_receipt_number(p_issued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
RETURNS VARCHAR(40) AS $$
DECLARE
    v_period VARCHAR(6);
    v_seq INT;
BEGIN
    v_period := TO_CHAR(p_issued_at AT TIME ZONE 'Asia/Jakarta', 'YYYYMM');

    INSERT INTO finance_receipt_sequences (period_key, last_sequence, updated_at)
    VALUES (v_period, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (period_key) DO UPDATE
    SET last_sequence = finance_receipt_sequences.last_sequence + 1,
        updated_at = CURRENT_TIMESTAMP
    RETURNING last_sequence INTO v_seq;

    RETURN 'KWT/' || v_period || '/' || LPAD(v_seq::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- B. Validasi Alokasi Siswa & Plafon Kapasitas Pembayaran
CREATE OR REPLACE FUNCTION trg_validate_allocation_student_match()
RETURNS TRIGGER AS $$
DECLARE
    v_pay_student_id VARCHAR(20);
    v_inv_student_id VARCHAR(20);
    v_inv_status VARCHAR(20);
    v_pay_status VARCHAR(20);
    v_pay_total NUMERIC(14,2);
    v_allocated_total NUMERIC(14,2);
BEGIN
    -- Validasi status tagihan
    SELECT student_id, status INTO v_inv_student_id, v_inv_status 
    FROM student_invoices WHERE invoice_id = NEW.invoice_id;

    IF v_inv_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'ALLOCATION_CANCELLED_INVOICE: Tagihan % berstatus CANCELLED dan tidak dapat menerima alokasi.', NEW.invoice_id
            USING ERRCODE = '22000';
    END IF;

    -- Validasi status pembayaran & siswa pembayar
    SELECT status, student_id, amount INTO v_pay_status, v_pay_student_id, v_pay_total
    FROM student_payments WHERE payment_id = NEW.payment_id;

    IF v_pay_status = 'VOID' THEN
        RAISE EXCEPTION 'ALLOCATION_VOID_PAYMENT: Pembayaran % berstatus VOID dan tidak dapat menerima alokasi.', NEW.payment_id
            USING ERRCODE = '22000';
    END IF;

    IF v_pay_student_id IS DISTINCT FROM v_inv_student_id THEN
        RAISE EXCEPTION 'CROSS_STUDENT_ALLOCATION_FORBIDDEN: Siswa pembayaran (%) tidak cocok dengan pemilik tagihan (%)', v_pay_student_id, v_inv_student_id
            USING ERRCODE = '23514';
    END IF;

    -- Validasi Invariant Partial Allocation: Total alokasi aktif tidak boleh melampaui nominal pembayaran
    SELECT COALESCE(SUM(amount), 0.00) INTO v_allocated_total
    FROM payment_allocations
    WHERE payment_id = NEW.payment_id AND allocation_id <> COALESCE(NEW.allocation_id, '');

    IF (v_allocated_total + NEW.amount) > v_pay_total THEN
        RAISE EXCEPTION 'EXCEEDED_PAYMENT_CAPACITY: Total alokasi (%) melampaui kapasitas nominal pembayaran (%)', (v_allocated_total + NEW.amount), v_pay_total
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_before_allocation_validate
BEFORE INSERT OR UPDATE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION trg_validate_allocation_student_match();

-- C. Penegakan Status Terminal VOID pada student_payments
CREATE OR REPLACE FUNCTION trg_enforce_terminal_payment_status()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'VOID' AND NEW.status <> 'VOID' THEN
        RAISE EXCEPTION 'TERMINAL_STATUS_VOID: Pembayaran % berstatus VOID bersifat terminal dan dilarang keras diubah kembali menjadi %', OLD.payment_id, NEW.status
            USING ERRCODE = '22000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_before_payment_status_check
BEFORE UPDATE OF status ON student_payments
FOR EACH ROW EXECUTE FUNCTION trg_enforce_terminal_payment_status();

-- D. Penegakan Immutabilitas student_id pada student_payments (Wajib VOID & RE-RECORD)
CREATE OR REPLACE FUNCTION trg_enforce_payment_student_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.student_id IS DISTINCT FROM NEW.student_id THEN
        RAISE EXCEPTION 'STUDENT_ID_IMMUTABLE: Koreksi siswa dilarang mengubah student_id. Gunakan mekanisme VOID & RE-RECORD.'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_before_payment_student_immutable
BEFORE UPDATE OF student_id ON student_payments
FOR EACH ROW EXECUTE FUNCTION trg_enforce_payment_student_immutable();

-- E. Penegakan Immutabilitas Nomor & Tanggal Terbit Kuitansi Kasir
CREATE OR REPLACE FUNCTION trg_enforce_receipt_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.receipt_number IS DISTINCT FROM NEW.receipt_number THEN
        RAISE EXCEPTION 'RECEIPT_NUMBER_IMMUTABLE: Nomor kuitansi bersifat permanen dan tidak dapat diubah.'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.receipt_issued_at IS DISTINCT FROM NEW.receipt_issued_at THEN
        RAISE EXCEPTION 'RECEIPT_ISSUED_AT_IMMUTABLE: Waktu penerbitan kuitansi bersifat permanen dan tidak dapat diubah.'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_before_payment_receipt_immutable
BEFORE UPDATE OF receipt_number, receipt_issued_at ON student_payments
FOR EACH ROW EXECUTE FUNCTION trg_enforce_receipt_immutability();

-- F. Penegakan Invariant Koreksi Nominal Pembayaran
CREATE OR REPLACE FUNCTION trg_enforce_payment_nominal_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_active_alloc_total NUMERIC(14,2);
BEGIN
    IF (NEW.amount < OLD.amount) THEN
        SELECT COALESCE(SUM(amount), 0.00) INTO v_active_alloc_total
        FROM payment_allocations
        WHERE payment_id = NEW.payment_id;

        IF NEW.amount < v_active_alloc_total THEN
            RAISE EXCEPTION 'EXCEEDED_ACTIVE_ALLOCATIONS: Nominal pembayaran baru (%) tidak boleh lebih kecil dari akumulasi alokasi aktif (%)',
                NEW.amount, v_active_alloc_total
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_before_payment_nominal_update
BEFORE UPDATE OF amount ON student_payments
FOR EACH ROW EXECUTE FUNCTION trg_enforce_payment_nominal_invariant();

-- G. Sinkronisasi amount_paid & status student_invoices pada Mutasi payment_allocations
CREATE OR REPLACE FUNCTION trg_sync_invoice_amount_paid()
RETURNS TRIGGER AS $$
DECLARE
    v_inv_ids VARCHAR(50)[];
    v_id VARCHAR(50);
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_inv_ids := ARRAY[NEW.invoice_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_inv_ids := ARRAY[OLD.invoice_id];
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
            v_inv_ids := ARRAY[OLD.invoice_id, NEW.invoice_id];
        ELSE
            v_inv_ids := ARRAY[NEW.invoice_id];
        END IF;
    END IF;

    FOREACH v_id IN ARRAY v_inv_ids LOOP
        UPDATE student_invoices i
        SET amount_paid = COALESCE((
                SELECT SUM(pa.amount)
                FROM payment_allocations pa
                JOIN student_payments sp ON sp.payment_id = pa.payment_id
                WHERE pa.invoice_id = v_id AND sp.status = 'ACTIVE'
            ), 0.00),
            status = CASE
                WHEN i.status = 'CANCELLED' THEN 'CANCELLED'
                WHEN COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN student_payments sp ON sp.payment_id = pa.payment_id WHERE pa.invoice_id = v_id AND sp.status = 'ACTIVE'), 0.00) = 0 THEN 'UNPAID'
                WHEN COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN student_payments sp ON sp.payment_id = pa.payment_id WHERE pa.invoice_id = v_id AND sp.status = 'ACTIVE'), 0.00) < i.total_amount THEN 'PARTIAL'
                ELSE 'PAID'
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE i.invoice_id = v_id;
    END LOOP;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_after_allocation_sync
AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION trg_sync_invoice_amount_paid();

-- H. Sinkronisasi amount_paid & status student_invoices saat Perubahan Status Pembayaran (ACTIVE <-> VOID)
CREATE OR REPLACE FUNCTION trg_sync_invoices_on_payment_status_change()
RETURNS TRIGGER AS $$
DECLARE
    r RECORD;
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        FOR r IN (
            SELECT DISTINCT invoice_id 
            FROM payment_allocations 
            WHERE payment_id = NEW.payment_id
            ORDER BY invoice_id ASC
        ) LOOP
            UPDATE student_invoices i
            SET amount_paid = COALESCE((
                    SELECT SUM(pa.amount)
                    FROM payment_allocations pa
                    JOIN student_payments sp ON sp.payment_id = pa.payment_id
                    WHERE pa.invoice_id = r.invoice_id AND sp.status = 'ACTIVE'
                ), 0.00),
                status = CASE
                    WHEN i.status = 'CANCELLED' THEN 'CANCELLED'
                    WHEN COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN student_payments sp ON sp.payment_id = pa.payment_id WHERE pa.invoice_id = r.invoice_id AND sp.status = 'ACTIVE'), 0.00) = 0 THEN 'UNPAID'
                    WHEN COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN student_payments sp ON sp.payment_id = pa.payment_id WHERE pa.invoice_id = r.invoice_id AND sp.status = 'ACTIVE'), 0.00) < i.total_amount THEN 'PARTIAL'
                    ELSE 'PAID'
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE i.invoice_id = r.invoice_id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_after_payment_status_change
AFTER UPDATE OF status ON student_payments
FOR EACH ROW EXECUTE FUNCTION trg_sync_invoices_on_payment_status_change();

-- I. Immutabilitas Append-Only pada payment_audit_logs
CREATE OR REPLACE FUNCTION trg_prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'PAYMENT_AUDIT_LOG_IMMUTABLE: Audit logs are append-only. UPDATE and DELETE operations are forbidden.'
        USING ERRCODE = '22000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_no_update_delete_audit_log
BEFORE UPDATE OR DELETE ON payment_audit_logs
FOR EACH ROW EXECUTE FUNCTION trg_prevent_audit_log_modification();
