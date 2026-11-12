const { query } = require('../config/database');
const { ForbiddenError } = require('../errors');

class FinanceDashboardService {
  /**
   * Mengambil statistik ringkasan dan grafik untuk Finance Dashboard
   * Menyesuaikan konteks berdasarkan peran:
   * - ADMIN / BENDAHARA: Agregat seluruh madrasah
   * - ORANG_TUA: Hanya data anak binaan (Anti-IDOR)
   * - GURU: Akses ditolak
   */
  async getOverviewStats(user) {
    if (!user) {
      throw new ForbiddenError('Pengguna belum terautentikasi.');
    }

    const role = (user.role || '').toUpperCase();
    if (role === 'GURU') {
      throw new ForbiddenError('Peran GURU tidak memiliki wewenang untuk modul keuangan.');
    }

    const isParent = (role === 'ORANG_TUA');

    if (isParent) {
      return this._getParentOverview(user.user_id);
    }

    return this._getStaffOverview();
  }

  /**
   * Statistik untuk Staff Keuangan (ADMIN & BENDAHARA)
   */
  async _getStaffOverview() {
    // 1. KPI Metrik Utama
    const kpiSql = `
      SELECT
        COALESCE((
          SELECT SUM(total_amount) 
          FROM student_invoices 
          WHERE status <> 'CANCELLED'
        ), 0.00) AS total_invoiced,
        COALESCE((
          SELECT SUM(amount) 
          FROM student_payments 
          WHERE status = 'ACTIVE'
        ), 0.00) AS total_payment_recorded,
        COALESCE((
          SELECT SUM(pa.amount) 
          FROM payment_allocations pa
          JOIN student_payments sp ON sp.payment_id = pa.payment_id
          WHERE sp.status = 'ACTIVE'
        ), 0.00) AS total_allocated,
        COALESCE((
          SELECT SUM(total_amount - amount_paid) 
          FROM student_invoices 
          WHERE status IN ('UNPAID', 'PARTIAL')
        ), 0.00) AS total_arrears,
        (SELECT COUNT(*) FROM student_invoices WHERE status IN ('UNPAID', 'PARTIAL')) AS unpaid_invoices_count,
        (SELECT COUNT(*) FROM student_invoices WHERE status = 'PAID') AS paid_invoices_count,
        (SELECT COUNT(*) FROM student_invoices WHERE status <> 'CANCELLED') AS total_active_invoices_count,
        (SELECT COUNT(*) FROM student_payments WHERE status = 'ACTIVE') AS total_active_payments_count,
        (SELECT COUNT(*) FROM student_payments WHERE status = 'VOID') AS void_payments_count,
        (SELECT COUNT(*) FROM student_invoices WHERE status = 'CANCELLED') AS cancelled_invoices_count
    `;
    const kpiRes = await query(kpiSql);
    const kpi = kpiRes.rows[0];

    const totalInvoiced = Number(kpi.total_invoiced);
    const totalPaymentRecorded = Number(kpi.total_payment_recorded);
    const totalAllocated = Number(kpi.total_allocated);
    const totalUnallocated = Math.max(0, totalPaymentRecorded - totalAllocated);
    const totalArrears = Number(kpi.total_arrears);

    // 2. Tren Bulanan (6 Bulan Terakhir)
    const invTrendSql = `
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') AS month_key,
        SUM(total_amount) AS amount
      FROM student_invoices
      WHERE status <> 'CANCELLED'
        AND created_at >= (CURRENT_DATE - INTERVAL '6 months')
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month_key ASC
    `;
    const payTrendSql = `
      SELECT 
        TO_CHAR(receipt_issued_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month_key,
        SUM(amount) AS amount
      FROM student_payments
      WHERE status = 'ACTIVE'
        AND receipt_issued_at >= (CURRENT_DATE - INTERVAL '6 months')
      GROUP BY TO_CHAR(receipt_issued_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')
      ORDER BY month_key ASC
    `;
    const [invTrendRes, payTrendRes] = await Promise.all([
      query(invTrendSql),
      query(payTrendSql)
    ]);

    // Satukan daftar bulan
    const monthsSet = new Set();
    invTrendRes.rows.forEach(r => monthsSet.add(r.month_key));
    payTrendRes.rows.forEach(r => monthsSet.add(r.month_key));
    const sortedMonths = Array.from(monthsSet).sort();

    const monthlyTrends = sortedMonths.map(m => {
      const invRow = invTrendRes.rows.find(r => r.month_key === m);
      const payRow = payTrendRes.rows.find(r => r.month_key === m);
      return {
        month: m,
        invoiced: Number(invRow ? invRow.amount : 0),
        paid: Number(payRow ? payRow.amount : 0)
      };
    });

    // 3. Komposisi Status Tagihan
    const statusSql = `
      SELECT 
        status, 
        COUNT(*) AS count, 
        SUM(total_amount) AS total_amount, 
        SUM(amount_paid) AS total_paid
      FROM student_invoices
      WHERE status <> 'CANCELLED'
      GROUP BY status
    `;
    const statusRes = await query(statusSql);
    const invoiceStatus = statusRes.rows.map(r => ({
      status: r.status,
      count: parseInt(r.count, 10),
      total_amount: Number(r.total_amount),
      total_paid: Number(r.total_paid)
    }));

    // 4. Tunggakan per Kategori Biaya
    const arrearsCatSql = `
      SELECT 
        fc.fee_category_id,
        fc.name AS category_name,
        SUM(si.total_amount - si.amount_paid) AS remaining_debt,
        COUNT(*) AS unpaid_count
      FROM student_invoices si
      JOIN fee_categories fc ON fc.fee_category_id = si.fee_category_id
      WHERE si.status IN ('UNPAID', 'PARTIAL')
      GROUP BY fc.fee_category_id, fc.name
      ORDER BY remaining_debt DESC
      LIMIT 8
    `;
    const arrearsCatRes = await query(arrearsCatSql);
    const arrearsByCategory = arrearsCatRes.rows.map(r => ({
      category_id: r.fee_category_id,
      category_name: r.category_name,
      remaining_debt: Number(r.remaining_debt),
      unpaid_count: parseInt(r.unpaid_count, 10)
    }));

    // 5. Metode Pembayaran (CASH vs BANK_TRANSFER)
    const methodSql = `
      SELECT 
        payment_method, 
        COUNT(*) AS count, 
        SUM(amount) AS total_amount
      FROM student_payments
      WHERE status = 'ACTIVE'
      GROUP BY payment_method
    `;
    const methodRes = await query(methodSql);
    const paymentMethods = methodRes.rows.map(r => ({
      payment_method: r.payment_method,
      count: parseInt(r.count, 10),
      total_amount: Number(r.total_amount)
    }));

    // 6. Aktivitas Keuangan Terbaru (10 Record)
    const activitiesSql = `
      SELECT 
        pal.audit_id,
        pal.payment_id,
        pal.action_type,
        pal.reason,
        pal.created_at,
        u.name AS actor_name,
        sp.receipt_number,
        s.name AS student_name,
        s.nisn AS student_nisn,
        sp.amount AS payment_amount
      FROM payment_audit_logs pal
      JOIN student_payments sp ON sp.payment_id = pal.payment_id
      JOIN students s ON s.student_id = sp.student_id
      LEFT JOIN users u ON u.user_id = pal.changed_by_user_id
      ORDER BY pal.created_at DESC
      LIMIT 10
    `;
    const activitiesRes = await query(activitiesSql);
    const recentActivities = activitiesRes.rows.map(r => ({
      id: r.audit_id,
      type: 'PAYMENT_' + r.action_type,
      title: r.receipt_number + ' - ' + r.student_name,
      reason: r.reason,
      actor: r.actor_name || 'Sistem',
      amount: Number(r.payment_amount),
      created_at: r.created_at
    }));

    return {
      scope: 'ALL_INSTITUTION',
      kpi: {
        total_invoiced: totalInvoiced,
        total_payment_recorded: totalPaymentRecorded,
        total_allocated: totalAllocated,
        total_unallocated: totalUnallocated,
        total_arrears: totalArrears,
        unpaid_invoices_count: parseInt(kpi.unpaid_invoices_count, 10),
        paid_invoices_count: parseInt(kpi.paid_invoices_count, 10),
        total_active_invoices_count: parseInt(kpi.total_active_invoices_count, 10),
        total_active_payments_count: parseInt(kpi.total_active_payments_count, 10),
        void_payments_count: parseInt(kpi.void_payments_count, 10),
        cancelled_invoices_count: parseInt(kpi.cancelled_invoices_count, 10)
      },
      charts: {
        monthly_trends: monthlyTrends,
        invoice_status: invoiceStatus,
        arrears_by_category: arrearsByCategory,
        payment_methods: paymentMethods
      },
      recent_activities: recentActivities
    };
  }

  /**
   * Statistik Terisolasi untuk Orang Tua (Hanya Anak Terhubung)
   */
  async _getParentOverview(parentUserId) {
    const parentSql = `
      SELECT
        COALESCE(SUM(si.total_amount), 0.00) AS total_invoiced,
        COALESCE(SUM(si.amount_paid), 0.00) AS total_paid,
        COALESCE(SUM(si.total_amount - si.amount_paid), 0.00) AS total_arrears,
        COUNT(si.invoice_id) FILTER (WHERE si.status IN ('UNPAID', 'PARTIAL')) AS unpaid_count,
        COUNT(si.invoice_id) FILTER (WHERE si.status = 'PAID') AS paid_count
      FROM student_invoices si
      JOIN parent_student_mappings psm ON psm.student_id = si.student_id
      WHERE psm.parent_user_id = $1 AND si.status <> 'CANCELLED'
    `;
    const res = await query(parentSql, [parentUserId]);
    const d = res.rows[0];

    // Daftar anak
    const childSql = `
      SELECT s.student_id, s.name, s.nisn, c.class_name
      FROM students s
      JOIN parent_student_mappings psm ON psm.student_id = s.student_id
      LEFT JOIN classes c ON c.class_id = s.class_id
      WHERE psm.parent_user_id = $1
      ORDER BY s.name ASC
    `;
    const childRes = await query(childSql, [parentUserId]);

    return {
      scope: 'PARENT_PORTAL',
      children: childRes.rows,
      kpi: {
        total_invoiced: Number(d.total_invoiced),
        total_allocated: Number(d.total_paid),
        total_payment_recorded: Number(d.total_paid),
        total_unallocated: 0.00,
        total_arrears: Number(d.total_arrears),
        unpaid_invoices_count: parseInt(d.unpaid_count, 10),
        paid_invoices_count: parseInt(d.paid_count, 10)
      },
      charts: {
        monthly_trends: [],
        invoice_status: [],
        arrears_by_category: [],
        payment_methods: []
      },
      recent_activities: []
    };
  }

  /**
   * Log Audit Pembayaran Lengkap (Audit Trail Module)
   */
  async getAuditLogs(filters = {}) {
    const { action_type, search, page = 1, limit = 25 } = filters;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));

    let baseSql = `
      SELECT 
        pal.audit_id,
        pal.payment_id,
        pal.action_type,
        pal.reason,
        pal.old_values,
        pal.new_values,
        pal.old_allocations,
        pal.new_allocations,
        pal.ip_address,
        pal.user_agent,
        pal.created_at,
        u.name AS actor_name,
        sp.receipt_number,
        sp.status AS payment_status,
        s.name AS student_name,
        s.nisn AS student_nisn
      FROM payment_audit_logs pal
      JOIN student_payments sp ON sp.payment_id = pal.payment_id
      JOIN students s ON s.student_id = sp.student_id
      LEFT JOIN users u ON u.user_id = pal.changed_by_user_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (action_type) {
      baseSql += ` AND pal.action_type = $${idx}`;
      params.push(action_type.toUpperCase());
      idx++;
    }

    if (search) {
      baseSql += ` AND (
        sp.receipt_number ILIKE $${idx} OR
        s.name ILIKE $${idx} OR
        pal.reason ILIKE $${idx} OR
        u.name ILIKE $${idx}
      )`;
      params.push(`%${search}%`);
      idx++;
    }

    const countSql = `SELECT COUNT(*) AS total FROM (${baseSql}) sub`;
    const countRes = await query(countSql, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    baseSql += ` ORDER BY pal.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit, 10), offset);

    const rowsRes = await query(baseSql, params);

    return {
      data: rowsRes.rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / parseInt(limit, 10))
      }
    };
  }
}

module.exports = new FinanceDashboardService();
