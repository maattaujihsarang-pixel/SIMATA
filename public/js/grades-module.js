/**
 * SIMATA — Menu Nilai Dua Jalur Controller (BUG 74)
 * - 2-Card Gateway: Nilai Akademik SIMATA (ASTS/ASAS) vs Portal RDM Kemenag
 * - 4 Official Periods: ASTS Ganjil, ASAS Ganjil, ASTS Genap, ASAS Genap
 * - Soft-Filter Teacher Assignments (connected to users.teacher_id & schedules)
 * - Flexible KKM per Mapel (default 75), Toggleable Class Ranking
 * - Live SVG Mastery Donut, Segmented Predicate Bar, Subject Horizontal Bars, & 4-Period Trend Chart
 * - Official Madrasah Excel Landscape Matrix Print & Portrait KHS Print
 */
(function initSimataGradesController(window) {
  'use strict';

  const state = {
    initialized: false,
    screen: 'gateway', // 'gateway' | 'workspace'
    activeTab: 'input', // 'input' | 'leger' | 'khs'
    academicYearId: '',
    periodCode: 'ASTS_GANJIL',
    classId: '',
    subjectCode: '',
    kkmDraft: 75,
    studentSearch: '',
    inputSortName: 'none', // 'none' | 'asc' | 'desc'
    inputPage: 1,
    inputPageSize: 10,
    legerViewMode: 'summary', // 'summary' | 'full'
    legerChartFilter: 'top', // 'top' | 'low' | 'all'
    legerSearch: '',
    legerPage: 1,
    legerPageSize: 10,
    khsFilter: 'all', // 'all' | 'tuntas' | 'belum'
    khsSearch: '',
    khsPage: 1,
    khsPageSize: 10,
    showRanking: true,
    rankingPrefLoaded: false,
    parentPreviewMode: false,
    selectedStudentId: '',
    draftScores: {}, // student_id -> { scoreStr, remarks }
    dirty: false,
    overview: null,
    khsData: null,
    reqSeq: 0
  };

  function esc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtScore(val, digits) {
    if (val === null || val === undefined || val === '' || Number.isNaN(Number(val))) return '-';
    const num = Number(val);
    if (digits !== undefined) {
      return num.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: digits });
    }
    return Number.isInteger(num)
      ? String(num)
      : num.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function parseInputScore(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim().replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
    return Math.round(n * 100) / 100;
  }

  function calcPredicate(score, kkm) {
    if (score === null || score === undefined || Number.isNaN(score)) {
      return { p: '-', label: 'Belum Diisi', tuntas: null };
    }
    const k = Number(kkm || 75);
    const step = Math.max(1, (100 - k) / 3);
    if (score >= k + step * 2) return { p: 'A', label: 'Sangat Baik', tuntas: true };
    if (score >= k + step) return { p: 'B', label: 'Baik', tuntas: true };
    if (score >= k) return { p: 'C', label: 'Cukup', tuntas: true };
    return { p: 'D', label: 'Perlu Remedial', tuntas: false };
  }

  function romanClassLevel(cls) {
    if (!cls) return '-';
    const lvl = Number(cls.level);
    if (lvl === 10) return 'X';
    if (lvl === 11) return 'XI';
    if (lvl === 12) return 'XII';
    return cls.class_name || '-';
  }

  function setScreen(mode) {
    const isParent = Boolean(state.overview && state.overview.viewer && state.overview.viewer.is_parent);
    state.screen = isParent ? 'workspace' : (mode === 'workspace' ? 'workspace' : 'gateway');
    const gw = document.getElementById('gradesGatewayView');
    const ws = document.getElementById('gradesWorkspaceView');
    if (gw) gw.style.display = state.screen === 'gateway' ? '' : 'none';
    if (ws) ws.style.display = state.screen === 'workspace' ? '' : 'none';

    if (state.screen === 'workspace') {
      if (isParent) setActiveTab('khs');
      renderWorkspace();
    } else {
      renderGateway();
    }
  }

  function setActiveTab(tabKey, opts) {
    const isParent = Boolean(state.overview && state.overview.viewer && state.overview.viewer.is_parent);
    const valid = isParent ? ['khs'] : ['input', 'leger', 'khs'];
    const next = valid.includes(tabKey) ? tabKey : valid[0];
    state.activeTab = next;

    const map = {
      input: 'grdPanelInput',
      leger: 'grdPanelLeger',
      khs: 'grdPanelKhs'
    };

    document.querySelectorAll('#grdSubTablist [role="tab"], #grdSubTablist button[data-grd-tab]').forEach(function (btn) {
      const key = btn.getAttribute('data-grd-tab');
      const selected = key === next;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.toggleAttribute('focusgroupstart', selected);
      if (isParent && key !== 'khs') {
        btn.style.display = 'none';
        btn.setAttribute('focusgroup', 'none');
      } else {
        btn.style.display = '';
        btn.removeAttribute('focusgroup');
      }
      if (selected) {
        if (opts && opts.focus) btn.focus();
        try {
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
        } catch (_) {
          try { btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (__) {}
        }
      }
    });

    Object.keys(map).forEach(function (k) {
      const panel = document.getElementById(map[k]);
      if (!panel) return;
      if (k === next) {
        panel.hidden = false;
      } else {
        panel.hidden = 'until-found';
      }
    });

    if (next === 'khs') {
      loadKhsForSelectedStudent();
    } else if (next === 'leger') {
      renderLegerPanel();
    } else {
      renderInputPanel();
    }
  }

  function syncDraftFromOverview() {
    state.draftScores = {};
    state.dirty = false;
    const ov = state.overview;
    if (!ov || !Array.isArray(ov.subjects) || ov.subjects.length === 0) return;

    // Soft-filter default subject: pick teacher's own scheduled subject first if current subject not valid
    const hasCurrent = ov.subjects.some(function (s) { return s.subject_code === state.subjectCode; });
    if (!hasCurrent) {
      const mySubj = ov.subjects.find(function (s) { return s.is_my_subject; });
      state.subjectCode = mySubj ? mySubj.subject_code : ov.subjects[0].subject_code;
    }

    const activeSubj = ov.subjects.find(function (s) { return s.subject_code === state.subjectCode; }) || ov.subjects[0];
    state.kkmDraft = activeSubj ? Number(activeSubj.kkm || 75) : 75;

    (ov.matrix || []).forEach(function (row) {
      const cell = row.scores && row.scores[state.subjectCode];
      state.draftScores[row.student_id] = {
        scoreStr: cell && cell.score !== null && cell.score !== undefined ? fmtScore(cell.score, 2) : '',
        remarks: (cell && cell.remarks) || ''
      };
    });

    if (!state.selectedStudentId || !(ov.matrix || []).some(function (r) { return r.student_id === state.selectedStudentId; })) {
      state.selectedStudentId = ov.matrix && ov.matrix[0] ? ov.matrix[0].student_id : '';
    }
  }

  function loadGradesOverview(options) {
    const opts = options || {};
    const seq = ++state.reqSeq;
    const statusEl = document.getElementById('grdGwSimataStatus');
    if (statusEl && !state.overview) {
      statusEl.innerHTML = 'Memuat ringkasan penilaian tahun ajaran aktif...';
    }

    simataClient
      .withSuccessHandler(function (res) {
        if (seq !== state.reqSeq) return;
        if (!res || !res.success || !res.data) return;
        state.overview = res.data;
        const ov = res.data;

        if (!state.rankingPrefLoaded && ov.portal_settings) {
          state.showRanking = ov.portal_settings.show_ranking_default !== false;
          state.rankingPrefLoaded = true;
        }
        state.academicYearId = ov.active_academic_year ? ov.active_academic_year.academic_year_id : '';
        state.periodCode = ov.selected_period ? ov.selected_period.code : 'ASTS_GANJIL';
        state.classId = ov.selected_class ? ov.selected_class.class_id : '';

        syncDraftFromOverview();

        if (ov.viewer && ov.viewer.is_parent) {
          setScreen('workspace');
          return;
        }
        if (opts.stayOnScreen) {
          if (state.screen === 'workspace') renderWorkspace();
          else renderGateway();
        } else {
          renderGateway();
          if (state.screen === 'workspace') renderWorkspace();
        }
      })
      .withFailureHandler(function (err) {
        console.error('[SIMATA GRADES] Failed loading overview:', err);
        if (statusEl) {
          statusEl.textContent = 'Gagal memuat data nilai: ' + (err && err.message ? err.message : err);
        }
      })
      .getGradesOverview({
        academic_year_id: state.academicYearId || undefined,
        assessment_type: state.periodCode || undefined,
        class_id: state.classId || undefined
      });
  }

  function renderGateway() {
    const ov = state.overview;
    if (!ov) return;

    const rdmCard = document.getElementById('grdGatewayRdmCard');
    const rdmSettingsBtn = document.getElementById('grdOpenRdmSettingsBtn');
    const rdmStatusText = document.getElementById('grdGwRdmStatusText');
    const simataStatusEl = document.getElementById('grdGwSimataStatus');
    const yearPillEl = document.getElementById('grdGwYearPill');

    const isAdmin = Boolean(ov.viewer && ov.viewer.is_admin);
    const isParent = Boolean(ov.viewer && ov.viewer.is_parent);

    if (rdmCard) rdmCard.style.display = isParent ? 'none' : '';
    if (rdmSettingsBtn) rdmSettingsBtn.style.display = isAdmin ? 'inline-flex' : 'none';

    const yr = ov.active_academic_year ? ov.active_academic_year.academic_year_id : '2026/2027';
    const p = ov.selected_period || { short_label: 'ASTS Ganjil' };
    if (yearPillEl) {
      const archTag = ov.is_year_archived ? ' (Arsip)' : '';
      yearPillEl.innerHTML =
        '<span class="grd-gw-dot" style="' + (ov.is_year_archived ? 'background:#f59e0b;' : '') + '"></span>' +
        '<span>' + esc(yr) + ' &bull; ' + esc(p.short_label) + archTag + '</span>';
    }

    const ps = ov.portal_settings || {};
    if (rdmStatusText) {
      if (ps.rdm_url) {
        let hostText = ps.rdm_url;
        try { hostText = new URL(ps.rdm_url).host || ps.rdm_url; } catch (_) {}
        rdmStatusText.innerHTML =
          '<span class="grd-gw-dot" style="background:#0f766e;"></span>' +
          '<span>Terhubung: <strong>' + esc(hostText) + '</strong></span>';
      } else {
        rdmStatusText.innerHTML =
          '<span class="grd-gw-dot" style="background:#f59e0b;"></span>' +
          '<span>' + (isAdmin ? 'Link RDM belum diatur' : 'Link RDM belum diatur Admin') + '</span>';
      }
    }

    if (simataStatusEl) {
      const ySum = ov.year_grade_summary || { total_grades: 0, total_classes: 0 };
      const detailText = ySum.total_grades > 0
        ? (esc(p.short_label) + ' ' + esc(yr) + ' &bull; ' + (ySum.total_classes || 3) + ' kelas terisi')
        : (esc(p.short_label) + ' ' + esc(yr) + ' &bull; Siap diisi');
      simataStatusEl.innerHTML =
        '<span class="grd-gw-dot"></span>' +
        '<span>' + detailText + '</span>';
    }
  }

  function renderWorkspace() {
    const ov = state.overview;
    if (!ov) return;

    const isAdmin = Boolean(ov.viewer && ov.viewer.is_admin);
    const isParent = Boolean(ov.viewer && ov.viewer.is_parent);
    const isArchived = Boolean(ov.is_year_archived);
    const backBtn = document.getElementById('grdBackToGatewayBtn');
    if (backBtn) backBtn.style.display = isParent ? 'none' : 'inline-flex';

    // Populate Academic Year Selector (Multi-Year & Archive Switcher)
    const yearSel = document.getElementById('grdAcademicYearSelect');
    const yearMgrBtn = document.getElementById('grdOpenYearManagerBtn');
    const printCfgBtn = document.getElementById('grdOpenPrintSettingsBtn');
    if (yearSel) {
      yearSel.innerHTML = (ov.academic_years || []).map(function (y) {
        const sel = y.academic_year_id === state.academicYearId ? ' selected' : '';
        const statusTxt = y.is_archived ? ' (Arsip Terkunci)' : (y.is_active ? ' (Aktif)' : '');
        return '<option value="' + esc(y.academic_year_id) + '"' + sel + '>' + esc(y.academic_year_id + statusTxt) + '</option>';
      }).join('');
    }
    if (yearMgrBtn) yearMgrBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (printCfgBtn) printCfgBtn.style.display = isAdmin ? 'inline-flex' : 'none';

    // Archive Lock Banner
    const archBanner = document.getElementById('grdArchiveLockBanner');
    const archText = document.getElementById('grdArchiveLockBannerText');
    const quickUnlockBtn = document.getElementById('grdQuickUnlockYearBtn');
    if (archBanner) {
      archBanner.style.display = isArchived ? 'flex' : 'none';
      if (isArchived && archText) {
        archText.innerHTML = '<strong>Mode Arsip &mdash; Tahun Ajaran ' + esc(state.academicYearId) + ' (Terkunci / Hanya Baca):</strong> Seluruh data nilai historis aman tersimpan; Anda tetap dapat melihat Leger, KHS, Grafik, Export CSV, dan Cetak.';
      }
      if (quickUnlockBtn) quickUnlockBtn.style.display = (isArchived && isAdmin) ? 'inline-flex' : 'none';
    }

    // Publish toggle switch ("Bagikan ke Wali") — Admin-only control
    const pubBtn = document.getElementById('grdTogglePublishBtn');
    const expBtn = document.getElementById('grdExportRdmCsvBtn');
    const prtLegerTopBtn = document.getElementById('grdTopPrintLegerBtn');
    if (pubBtn) {
      if (!isAdmin) {
        pubBtn.style.display = 'none';
      } else {
        pubBtn.style.display = 'inline-flex';
        pubBtn.disabled = isArchived;
        const isPub = Boolean(ov.selected_period && ov.selected_period.is_published);
        pubBtn.className = 'grd-pub-toggle';
        pubBtn.setAttribute('aria-pressed', isPub ? 'true' : 'false');
        pubBtn.title = isPub
          ? 'Nilai periode ini sedang dibagikan ke Wali Murid. Klik untuk menyembunyikan.'
          : 'Aktifkan untuk membagikan nilai periode ini ke akun Orang Tua / Wali Murid.';
        pubBtn.innerHTML =
          '<span class="grd-pub-toggle-label">Bagikan ke Wali</span>' +
          '<span class="grd-switch-track" aria-hidden="true"><span class="grd-switch-thumb"></span></span>';
      }
    }
    if (expBtn) expBtn.style.display = isParent ? 'none' : 'inline-flex';
    if (prtLegerTopBtn) prtLegerTopBtn.style.display = isParent ? 'none' : 'inline-flex';

    // Render 4 pure Period Pills inside unified navigation bar
    const periodStrip = document.getElementById('grdPeriodStrip');
    if (periodStrip) {
      periodStrip.innerHTML = (ov.periods || []).map(function (p) {
        const active = p.code === state.periodCode;
        const dotHtml = active
          ? '<span class="grd-period-active-dot" aria-hidden="true"></span>'
          : (p.is_published ? '<span class="grd-period-pub-dot" title="Sudah dibagikan ke Wali Murid"></span>' : '');
        const titleTxt = p.short_label + (p.is_published ? ' (Dibagikan ke Wali)' : '') +
          (!isParent ? (' \u2022 ' + p.completed_subjects + '/' + p.total_subjects + ' mapel terisi') : '');
        return '<button type="button" class="grd-period-pill' + (active ? ' is-active' : '') + '" data-period="' + esc(p.code) + '" title="' + esc(titleTxt) + '">' +
          dotHtml +
          '<span>' + esc(p.short_label) + '</span>' +
        '</button>';
      }).join('');
    }

    if (state.activeTab === 'leger') renderLegerPanel();
    else if (state.activeTab === 'khs') loadKhsForSelectedStudent();
    else renderInputPanel();
  }

  function renderInputPanel() {
    const ov = state.overview;
    if (!ov) return;

    const classSel = document.getElementById('grdInputClassSelect');
    const subjSel = document.getElementById('grdInputSubjectSelect');
    const subjListEl = document.getElementById('grdSubjectList');
    const activeTitleEl = document.getElementById('grdActiveSubjectTitle');
    const kkmInput = document.getElementById('grdInputKkm');
    const activeStudentCount = (ov.matrix || []).length;

    if (classSel) {
      const assignedClassIds = new Set(
        ((ov.viewer && ov.viewer.teacher_assignments) || []).map(function (a) { return a.class_id; }).filter(Boolean)
      );
      classSel.innerHTML = (ov.classes || []).map(function (c) {
        const star = assignedClassIds.has(c.class_id) ? ' \u2605' : '';
        const sel = c.class_id === state.classId ? ' selected' : '';
        const countSuffix = c.class_id === state.classId
          ? (' (' + activeStudentCount + ' Siswa)')
          : (c.student_count ? (' (' + c.student_count + ' Siswa)') : '');
        return '<option value="' + esc(c.class_id) + '"' + sel + '>' + esc(c.class_name + countSuffix + star) + '</option>';
      }).join('');
    }

    const allSubjects = ov.subjects || [];
    const mySubjects = allSubjects.filter(function (s) { return s.is_my_subject; });
    const otherSubjects = allSubjects.filter(function (s) { return !s.is_my_subject; });
    const orderedSubjects = mySubjects.concat(otherSubjects);

    const isAdmin = Boolean(ov.viewer && ov.viewer.is_admin);
    const isParent = Boolean(ov.viewer && ov.viewer.is_parent);
    const lockSvg = '<span class="grd-subject-lock" title="Hanya baca (bukan jadwal mengajar Anda)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>';

    if (subjSel) {
      const renderOpt = function (s) {
        const sel = s.subject_code === state.subjectCode ? ' selected' : '';
        const statusMark = s.is_complete ? ' \u2713' : ' (' + s.filled_count + '/' + s.student_count + ')';
        const canEditSubj = isAdmin || Boolean(s.can_edit);
        const prefix = s.is_my_subject ? '\u2605 ' : (!canEditSubj ? '\uD83D\uDD12 ' : '');
        return '<option value="' + esc(s.subject_code) + '"' + sel + '>' +
          esc(prefix + s.subject_name + statusMark) +
        '</option>';
      };

      if (mySubjects.length > 0 && otherSubjects.length > 0) {
        subjSel.innerHTML =
          '<optgroup label="Mapel Jadwal Saya">' + mySubjects.map(renderOpt).join('') + '</optgroup>' +
          '<optgroup label="Mapel Lain (Hanya Baca)">' + otherSubjects.map(renderOpt).join('') + '</optgroup>';
      } else {
        subjSel.innerHTML = orderedSubjects.map(renderOpt).join('');
      }
    }

    if (subjListEl) {
      subjListEl.innerHTML = orderedSubjects.map(function (s) {
        const isActive = s.subject_code === state.subjectCode;
        const canEditSubj = isAdmin || Boolean(s.can_edit);
        const filled = Number(s.filled_count || 0);
        const total = Number(s.student_count || activeStudentCount || 0);
        const isComplete = Boolean(s.is_complete && total > 0);
        const pillCls = isComplete ? 'is-complete' : (filled > 0 ? 'is-partial' : 'is-empty');
        const pillTxt = filled + '/' + total + (isComplete ? ' \u2713' : '');
        const prefixHtml = s.is_my_subject
          ? '<span class="grd-subject-star" title="Jadwal mengajar Anda">\u2605</span>'
          : (!canEditSubj ? lockSvg : '');
        const roCls = !canEditSubj ? ' is-readonly' : '';
        const tipTxt = s.subject_name + (!canEditSubj ? ' (Hanya Baca)' : '');
        return '<button type="button" role="option" aria-selected="' + (isActive ? 'true' : 'false') + '" class="grd-subject-item' + (isActive ? ' is-active' : '') + roCls + '" data-select-subject="' + esc(s.subject_code) + '" title="' + esc(tipTxt) + '">' +
          '<span class="grd-subject-name">' + prefixHtml + esc(s.subject_name) + '</span>' +
          '<span class="grd-subject-pill ' + pillCls + '">' + esc(pillTxt) + '</span>' +
        '</button>';
      }).join('');
    }

    const activeSubjObj = allSubjects.find(function (s) { return s.subject_code === state.subjectCode; }) || allSubjects[0];
    if (activeTitleEl) {
      const titleName = activeSubjObj ? activeSubjObj.subject_name : 'Pilih Mata Pelajaran';
      activeTitleEl.textContent = titleName;
      activeTitleEl.title = titleName;
    }

    const isArchived = Boolean(ov.is_year_archived);
    const canEditActiveSubj = !isParent && (isAdmin || Boolean(activeSubjObj && activeSubjObj.can_edit));
    const isLocked = isArchived || !canEditActiveSubj;

    const roBanner = document.getElementById('grdReadonlySubjectBanner');
    if (roBanner) {
      roBanner.style.display = (!isArchived && !isParent && !canEditActiveSubj) ? 'flex' : 'none';
    }

    if (kkmInput) {
      kkmInput.value = state.kkmDraft;
      kkmInput.disabled = isLocked;
    }
    const pasteBtn = document.getElementById('grdOpenPasteModalBtn');
    const saveBtn = document.getElementById('grdSaveBatchBtn');
    const mobSaveBtn = document.querySelector('[data-trigger-save-grades]');
    if (pasteBtn) pasteBtn.disabled = isLocked;
    if (saveBtn) saveBtn.disabled = isLocked;
    if (mobSaveBtn) mobSaveBtn.disabled = isLocked;

    renderInputMasteryStrip();
    renderInputGridRows();
  }

  function renderInputMasteryStrip() {
    const host = document.getElementById('grdInputMasteryStrip');
    if (!host || !state.overview) return;

    const ov = state.overview;
    const rows = ov.matrix || [];
    const kkm = Number(state.kkmDraft || 75);
    let filled = 0;
    let sum = 0;
    let tuntas = 0;
    let remedial = 0;

    rows.forEach(function (r) {
      const d = state.draftScores[r.student_id];
      const num = d ? parseInputScore(d.scoreStr) : null;
      if (num !== null && !Number.isNaN(num)) {
        filled++;
        sum += num;
        const pr = calcPredicate(num, kkm);
        if (pr.tuntas) tuntas++;
        else remedial++;
      }
    });

    const totalStudents = rows.length;
    const avg = filled > 0 ? (sum / filled) : 0;
    const activeSubj = (ov.subjects || []).find(function (s) { return s.subject_code === state.subjectCode; });
    const subjName = activeSubj ? activeSubj.subject_name : '-';
    const clsName = ov.selected_class ? ov.selected_class.class_name : '';
    const periodObj = ov.selected_period || {};
    const completedSubjects = (ov.subjects || []).filter(function (s) { return s.is_complete; }).length;
    const totalSubjects = (ov.subjects || []).length;
    const classDoneSub = totalSubjects > 0 && completedSubjects >= totalSubjects
      ? esc(periodObj.short_label || 'Periode') + ' lengkap \u2713'
      : (completedSubjects > 0 ? (completedSubjects + ' mapel selesai diisi') : 'Belum ada mapel selesai');
    const belumSub = filled === 0
      ? 'Belum ada nilai terisi'
      : (remedial === 0 ? 'Semua siswa tuntas \u2713' : 'Perlu pendampingan');

    host.innerHTML =
      '<div class="grd-kpi-grid">' +
        '<div class="grd-kpi-card">' +
          '<div class="grd-kpi-icon grd-kpi-icon--emerald" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="8" y1="16" x2="8" y2="11"/><line x1="12" y1="16" x2="12" y2="8"/><line x1="16" y1="16" x2="16" y2="13"/></svg>' +
          '</div>' +
          '<div class="grd-kpi-body">' +
            '<div class="grd-kpi-label">Rata-rata Mapel</div>' +
            '<div class="grd-kpi-value">' + (filled > 0 ? fmtScore(avg, 1) : '-') + '</div>' +
            '<div class="grd-kpi-sub" title="' + esc(subjName + ' • ' + clsName) + '">' + esc(subjName) + (clsName ? ' &bull; ' + esc(clsName) : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="grd-kpi-card">' +
          '<div class="grd-kpi-icon grd-kpi-icon--teal" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></svg>' +
          '</div>' +
          '<div class="grd-kpi-body">' +
            '<div class="grd-kpi-label">Tuntas (&ge; ' + fmtScore(kkm, 1) + ')</div>' +
            '<div class="grd-kpi-value">' + tuntas + ' Siswa</div>' +
            '<div class="grd-kpi-sub">Dari ' + totalStudents + ' siswa</div>' +
          '</div>' +
        '</div>' +
        '<div class="grd-kpi-card">' +
          '<div class="grd-kpi-icon grd-kpi-icon--amber" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 17 15 14"/></svg>' +
          '</div>' +
          '<div class="grd-kpi-body">' +
            '<div class="grd-kpi-label">Belum Tuntas</div>' +
            '<div class="grd-kpi-value">' + remedial + ' Siswa</div>' +
            '<div class="grd-kpi-sub">' + belumSub + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="grd-kpi-card">' +
          '<div class="grd-kpi-icon grd-kpi-icon--sky" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>' +
          '</div>' +
          '<div class="grd-kpi-body">' +
            '<div class="grd-kpi-label">Kelengkapan Kelas</div>' +
            '<div class="grd-kpi-value">' + completedSubjects + ' / ' + totalSubjects + ' Mapel</div>' +
            '<div class="grd-kpi-sub">' + classDoneSub + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function updateSaveButtonLabels() {
    const labelText = state.dirty ? 'Simpan Nilai *' : 'Simpan Nilai';
    const saveCountEl = document.getElementById('grdSaveBtnLabel');
    if (saveCountEl) saveCountEl.textContent = labelText;
    const mobLbl = document.querySelector('.grd-mobile-save-label');
    if (mobLbl) mobLbl.textContent = labelText;
  }

  function renderInputGridRows() {
    const tbody = document.getElementById('grdInputTbody');
    if (!tbody || !state.overview) return;

    const kkm = Number(state.kkmDraft || 75);
    const q = String(state.studentSearch || '').trim().toLowerCase();
    const allRows = state.overview.matrix || [];
    let filtered = q
      ? allRows.filter(function (r) {
          return (String(r.name) + ' ' + String(r.nis) + ' ' + String(r.nisn)).toLowerCase().indexOf(q) !== -1;
        })
      : allRows.slice();

    if (state.inputSortName === 'asc') {
      filtered.sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'id', { sensitivity: 'base' });
      });
    } else if (state.inputSortName === 'desc') {
      filtered.sort(function (a, b) {
        return String(b.name || '').localeCompare(String(a.name || ''), 'id', { sensitivity: 'base' });
      });
    }

    const sortBtn = document.getElementById('grdSortNameBtn');
    const sortIcon = document.getElementById('grdSortNameIcon');
    if (sortBtn) {
      sortBtn.classList.toggle('is-sorted', state.inputSortName !== 'none');
      sortBtn.title = state.inputSortName === 'asc'
        ? 'Urutan: Nama A–Z (klik untuk Z–A)'
        : (state.inputSortName === 'desc' ? 'Urutan: Nama Z–A (klik untuk urutan awal)' : 'Klik untuk mengurutkan Nama Siswa A–Z / Z–A');
    }
    if (sortIcon) {
      sortIcon.textContent = '';
    }

    const total = filtered.length;
    const pageSize = state.inputPageSize || 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.inputPage > totalPages) state.inputPage = totalPages;
    if (state.inputPage < 1) state.inputPage = 1;
    const curPage = state.inputPage;

    const counterEl = document.getElementById('grdInputCounter');
    if (counterEl) {
      if (total === 0) {
        counterEl.textContent = 'Menampilkan 0\u20130 dari 0 data';
      } else {
        const start = (curPage - 1) * pageSize + 1;
        const end = Math.min(curPage * pageSize, total);
        counterEl.textContent = 'Menampilkan ' + start + '\u2013' + end + ' dari ' + total + ' data';
      }
    }
    if (typeof window.renderPaginationControl === 'function') {
      window.renderPaginationControl('grdInputPagination', curPage, totalPages, pageSize, 'goToGradesInputPage');
    }

    updateSaveButtonLabels();

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:#64748b;">Tidak ada siswa yang cocok dengan pencarian.</td></tr>';
      return;
    }

    const pageRows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize);
    const isArchived = Boolean(state.overview && state.overview.is_year_archived);
    const isAdmin = Boolean(state.overview && state.overview.viewer && state.overview.viewer.is_admin);
    const isParent = Boolean(state.overview && state.overview.viewer && state.overview.viewer.is_parent);
    const activeSubjObj = (state.overview.subjects || []).find(function (s) { return s.subject_code === state.subjectCode; });
    const isLocked = isArchived || isParent || (!isAdmin && !(activeSubjObj && activeSubjObj.can_edit));
    const disAttr = isLocked ? ' disabled' : '';

    tbody.innerHTML = pageRows.map(function (r) {
      const d = state.draftScores[r.student_id] || { scoreStr: '', remarks: '' };
      const num = parseInputScore(d.scoreStr);
      const pr = (num !== null && !Number.isNaN(num)) ? calcPredicate(num, kkm) : { p: '-', label: 'Belum Diisi', tuntas: null };
      const inpCls = pr.tuntas === true ? ' is-tuntas' : (pr.tuntas === false ? ' is-remedial' : '');
      const statusBadge = pr.tuntas === true
        ? '<span class="grd-chip grd-chip--emerald">' + pr.p + ' &bull; Tuntas</span>'
        : (pr.tuntas === false
            ? '<span class="grd-chip grd-chip--amber">' + pr.p + ' &bull; Belum Tuntas</span>'
            : '<span class="grd-chip grd-chip--slate">Kosong</span>');

      return '<tr class="grd-input-row" data-student-id="' + esc(r.student_id) + '">' +
        '<td class="grd-td-no" style="width:48px;text-align:center;color:#475569;font-variant-numeric:tabular-nums;">' + r.row_no + '</td>' +
        '<td class="grd-td-nis" style="font-family:\'Roboto Mono\',monospace;font-size:12.5px;color:#334155;">' + esc(r.nis) + '</td>' +
        '<td class="grd-td-student"><div class="grd-student-name-main">' + esc(r.name) + '</div><div class="grd-mobile-nis-sub">#' + r.row_no + ' &bull; NIS: ' + esc(r.nis) + '</div></td>' +
        '<td class="grd-td-score"><input type="text" inputmode="decimal" class="grd-score-input' + inpCls + '" data-score-for="' + esc(r.student_id) + '" value="' + esc(d.scoreStr) + '" placeholder="0-100" aria-label="Nilai ' + esc(r.name) + '"' + disAttr + ' /></td>' +
        '<td class="grd-td-status" data-status-cell="' + esc(r.student_id) + '">' + statusBadge + '</td>' +
        '<td class="grd-td-remark"><input type="text" class="grd-remark-input" data-remark-for="' + esc(r.student_id) + '" value="' + esc(d.remarks) + '" placeholder="Opsional..." aria-label="Catatan untuk ' + esc(r.name) + '"' + disAttr + ' /></td>' +
      '</tr>';
    }).join('');
  }

  function updateSingleRowVisuals(studentId) {
    const kkm = Number(state.kkmDraft || 75);
    const d = state.draftScores[studentId] || { scoreStr: '' };
    const num = parseInputScore(d.scoreStr);
    const pr = (num !== null && !Number.isNaN(num)) ? calcPredicate(num, kkm) : { p: '-', label: 'Belum Diisi', tuntas: null };

    const inp = document.querySelector('#grdInputTbody input[data-score-for="' + studentId + '"]');
    if (inp) {
      inp.classList.toggle('is-tuntas', pr.tuntas === true);
      inp.classList.toggle('is-remedial', pr.tuntas === false);
    }
    const stCell = document.querySelector('#grdInputTbody [data-status-cell="' + studentId + '"]');
    if (stCell) {
      stCell.innerHTML = pr.tuntas === true
        ? '<span class="grd-chip grd-chip--emerald">' + pr.p + ' &bull; Tuntas</span>'
        : (pr.tuntas === false
            ? '<span class="grd-chip grd-chip--amber">' + pr.p + ' &bull; Belum Tuntas</span>'
            : '<span class="grd-chip grd-chip--slate">Kosong</span>');
    }
    renderInputMasteryStrip();
    updateSaveButtonLabels();
  }

  function saveCurrentSubjectBatch() {
    if (!state.overview || !state.classId || !state.subjectCode) return;
    const isAdmin = Boolean(state.overview.viewer && state.overview.viewer.is_admin);
    const subjCheck = (state.overview.subjects || []).find(function (s) { return s.subject_code === state.subjectCode; });
    if (state.overview.is_year_archived) {
      alert('Tahun ajaran ini dalam mode Arsip Terkunci.');
      return;
    }
    if (!isAdmin && !(subjCheck && subjCheck.can_edit)) {
      alert('Mode Hanya Baca: Anda hanya dapat menyimpan nilai pada mata pelajaran sesuai jadwal mengajar Anda.');
      return;
    }
    const rows = state.overview.matrix || [];
    const kkmVal = parseInputScore(document.getElementById('grdInputKkm') ? document.getElementById('grdInputKkm').value : state.kkmDraft);
    if (kkmVal === null || Number.isNaN(kkmVal)) {
      alert('Angka KKM harus bernilai antara 0 sampai 100.');
      return;
    }

    const entries = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const d = state.draftScores[r.student_id] || { scoreStr: '', remarks: '' };
      const trimmed = String(d.scoreStr || '').trim();
      if (trimmed !== '') {
        const parsed = parseInputScore(trimmed);
        if (Number.isNaN(parsed)) {
          alert('Nilai untuk ' + r.name + ' ("' + trimmed + '") tidak valid. Masukkan angka 0 s.d. 100.');
          const badInput = document.querySelector('#grdInputTbody input[data-score-for="' + r.student_id + '"]');
          if (badInput) badInput.focus();
          return;
        }
        entries.push({ student_id: r.student_id, score: parsed, remarks: d.remarks || '' });
      } else {
        entries.push({ student_id: r.student_id, score: null, remarks: '' });
      }
    }

    const btn = document.getElementById('grdSaveBatchBtn');
    if (btn) btn.disabled = true;

    const subjObj = (state.overview.subjects || []).find(function (s) { return s.subject_code === state.subjectCode; });

    simataClient
      .withSuccessHandler(function (res) {
        if (btn) btn.disabled = false;
        state.dirty = false;
        alert((res && res.message) || 'Nilai kelas berhasil disimpan.');
        loadGradesOverview({ stayOnScreen: true });
      })
      .withFailureHandler(function (err) {
        if (btn) btn.disabled = false;
        alert('Gagal menyimpan nilai: ' + (err && err.message ? err.message : err));
      })
      .saveBatchGrades({
        academic_year_id: state.academicYearId,
        class_id: state.classId,
        assessment_type: state.periodCode,
        subject_code: state.subjectCode,
        subject_name: subjObj ? subjObj.subject_name : state.subjectCode,
        kkm: kkmVal,
        entries: entries
      });
  }

  function shortChartSubjectLabel(s) {
    const code = String(s.subject_code || '').toUpperCase();
    const map = {
      QH: 'QH', AA: 'AA', FQ: 'Fiqih', SKI: 'SKI', PPKN: 'PPKn',
      'B.INDO': 'B.Indo', 'B.ARAB': 'B.Arab', MTK: 'MTK', 'B.JAWA': 'B.Jawa',
      'B.ING': 'B.Ing', SBK: 'SBK', PJOK: 'PJOK', PKWU: 'PKWU',
      GEO: 'Geo', EKO: 'Eko', SOSI: 'Sosi', SEJ: 'Sej', SEJARAH: 'Sej', IPA: 'IPA',
      BIO: 'Bio', INF: 'Info', TFS: 'Tafsir', TAFSIR: 'Tafsir',
      NHW: 'Nahwu', NAHWU: 'Nahwu', SHF: 'Shorof', SHOROF: 'Shorof'
    };
    return map[code] || code || String(s.subject_name || '').slice(0, 7);
  }

  function renderLegerPanel() {
    const ov = state.overview;
    if (!ov) return;

    const classSel = document.getElementById('grdLegerClassSelect');
    if (classSel) {
      classSel.innerHTML = (ov.classes || []).map(function (c) {
        const sel = c.class_id === state.classId ? ' selected' : '';
        return '<option value="' + esc(c.class_id) + '"' + sel + '>' + esc(c.class_name + ' \u2014 Wali: ' + (c.homeroom_teacher_name || '-')) + '</option>';
      }).join('');
    }

    const rankBtn = document.getElementById('grdToggleRankingBtn');
    if (rankBtn) {
      rankBtn.className = 'grd-pub-toggle';
      rankBtn.setAttribute('aria-pressed', state.showRanking ? 'true' : 'false');
      rankBtn.innerHTML =
        '<span class="grd-pub-toggle-label">Tampilkan Peringkat</span>' +
        '<span class="grd-switch-track" aria-hidden="true"><span class="grd-switch-thumb"></span></span>';
    }

    const sum = ov.class_summary || {};
    const subjects = ov.subjects || [];
    const matrix = ov.matrix || [];
    const clsName = ov.selected_class ? ov.selected_class.class_name : 'Kelas';
    const periodObj = ov.selected_period || {};

    const tblTitleEl = document.getElementById('grdLegerTableTitle');
    if (tblTitleEl) tblTitleEl.textContent = 'Rekap Nilai ' + clsName;
    const fullModeBtn = document.getElementById('grdLegerFullModeBtn');
    if (fullModeBtn) fullModeBtn.textContent = 'Semua Mapel (' + subjects.length + ')';
    document.querySelectorAll('[data-leger-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-leger-view') === state.legerViewMode);
    });

    const rankedAll = matrix.slice()
      .filter(function (r) { return r.total_score > 0; })
      .sort(function (a, b) { return b.total_score - a.total_score; });
    const top1 = rankedAll[0] || null;

    // ROW 2: 4 SLEEK KPI SUMMARY CARDS
    const kpiHost = document.getElementById('grdLegerKpiHost');
    if (kpiHost) {
      const doneAll = sum.total_subjects > 0 && sum.completed_subjects >= sum.total_subjects;
      const doneSub = doneAll
        ? esc(periodObj.short_label || 'Periode') + ' lengkap \u2713'
        : (sum.completed_subjects > 0 ? (sum.completed_subjects + ' mapel selesai') : 'Belum ada mapel selesai');
      kpiHost.innerHTML =
        '<div class="grd-kpi-grid">' +
          '<div class="grd-kpi-card">' +
            '<div class="grd-kpi-icon grd-kpi-icon--sky" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
            '</div>' +
            '<div class="grd-kpi-body">' +
              '<div class="grd-kpi-label">Jumlah Siswa</div>' +
              '<div class="grd-kpi-value">' + (sum.student_count || 0) + ' Siswa</div>' +
              '<div class="grd-kpi-sub">' + esc(clsName) + ' aktif</div>' +
            '</div>' +
          '</div>' +
          '<div class="grd-kpi-card">' +
            '<div class="grd-kpi-icon grd-kpi-icon--emerald" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="8" y1="16" x2="8" y2="11"/><line x1="12" y1="16" x2="12" y2="8"/><line x1="16" y1="16" x2="16" y2="13"/></svg>' +
            '</div>' +
            '<div class="grd-kpi-body">' +
              '<div class="grd-kpi-label">Rata-rata Kelas</div>' +
              '<div class="grd-kpi-value">' + (sum.any_scores ? fmtScore(sum.class_average, 1) : '-') + '</div>' +
              '<div class="grd-kpi-sub">Seluruh ' + (sum.total_subjects || 0) + ' mapel</div>' +
            '</div>' +
          '</div>' +
          '<div class="grd-kpi-card">' +
            '<div class="grd-kpi-icon grd-kpi-icon--amber" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>' +
            '</div>' +
            '<div class="grd-kpi-body">' +
              '<div class="grd-kpi-label">Nilai Tertinggi</div>' +
              '<div class="grd-kpi-value">' + (sum.any_scores ? fmtScore(sum.highest_average, 1) : '-') + '</div>' +
              '<div class="grd-kpi-sub" title="' + esc(top1 ? top1.name : '-') + '">' + esc(top1 && state.showRanking ? top1.name : (sum.any_scores ? 'Rata-rata tertinggi' : 'Belum ada nilai')) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="grd-kpi-card">' +
            '<div class="grd-kpi-icon grd-kpi-icon--teal" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></svg>' +
            '</div>' +
            '<div class="grd-kpi-body">' +
              '<div class="grd-kpi-label">Kelengkapan Nilai</div>' +
              '<div class="grd-kpi-value">' + (sum.completed_subjects || 0) + ' / ' + (sum.total_subjects || 0) + ' Mapel</div>' +
              '<div class="grd-kpi-sub">' + doneSub + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    // ROW 3: 2-COLUMN ANALYTICS (3 NILAI TERTINGGI + VERTICAL BAR CHART WITH KKM LINE)
    const analyticsHost = document.getElementById('grdLegerAnalyticsHost');
    if (analyticsHost) {
      const top3 = rankedAll.slice(0, 3);
      let podiumBodyHtml = '';
      if (!state.showRanking) {
        podiumBodyHtml = '<div style="padding:26px 12px;text-align:center;color:#64748b;font-size:12.5px;">Peringkat sedang disembunyikan. Aktifkan saklar <strong>Tampilkan Peringkat</strong> di atas untuk melihat 3 nilai tertinggi.</div>';
      } else if (top3.length === 0) {
        podiumBodyHtml = '<div style="padding:26px 12px;text-align:center;color:#64748b;font-size:12.5px;">Belum ada nilai yang masuk pada periode ini.</div>';
      } else {
        podiumBodyHtml = '<div class="grd-podium-list">' + top3.map(function (t, i) {
          const rankNo = i + 1;
          return '<button type="button" class="grd-podium-item" data-open-khs="' + esc(t.student_id) + '" title="Klik untuk melihat Rapor ' + esc(t.name) + '">' +
            '<div class="grd-podium-left">' +
              '<span class="grd-podium-medal grd-podium-medal--' + rankNo + '">#' + rankNo + '</span>' +
              '<span class="grd-podium-name">' + esc(t.name) + '</span>' +
            '</div>' +
            '<div class="grd-podium-score">' +
              '<div class="grd-podium-avg">' + fmtScore(t.average_score, 1) + '</div>' +
              '<div class="grd-podium-total">Total ' + fmtScore(t.total_score, 1) + '</div>' +
            '</div>' +
          '</button>';
        }).join('') + '</div>';
      }

      const scoredSubjects = subjects.map(function (s) {
        return {
          code: s.subject_code,
          name: s.subject_name,
          shortLabel: shortChartSubjectLabel(s),
          avg: (s.avg_score !== null && s.avg_score !== undefined) ? Number(s.avg_score) : 0,
          hasScore: s.avg_score !== null && s.avg_score !== undefined,
          kkm: Number(s.kkm || 75)
        };
      });

      let chartSubjects = scoredSubjects.slice();
      if (state.legerChartFilter === 'top') {
        chartSubjects.sort(function (a, b) { return b.avg - a.avg; });
        chartSubjects = chartSubjects.slice(0, 10);
      } else if (state.legerChartFilter === 'low') {
        chartSubjects.sort(function (a, b) { return a.avg - b.avg; });
        chartSubjects = chartSubjects.slice(0, 10);
      }

      const defaultKkmRef = 75;
      // .grd-vchart-plot has height 176px with 26px top & 26px bottom padding => 124px usable bar height
      const kkmBottomPx = Math.round(26 + (defaultKkmRef / 100) * 124);
      const barsHtml = chartSubjects.length > 0
        ? chartSubjects.map(function (item) {
            const pct = Math.min(100, Math.max(0, item.avg));
            const below = item.avg < item.kkm;
            const barPx = item.hasScore ? Math.max(4, Math.round((pct / 100) * 124)) : 3;
            const tip = item.name + ' \u2022 Rata-rata: ' + (item.hasScore ? fmtScore(item.avg, 1) : '-') + ' (KKM ' + fmtScore(item.kkm, 0) + ')';
            return '<div class="grd-vchart-col" title="' + esc(tip) + '">' +
              '<span class="grd-vchart-val">' + (item.hasScore ? fmtScore(Math.round(item.avg), 0) : '-') + '</span>' +
              '<div class="grd-vchart-bar' + (below ? ' is-below' : '') + '" style="height:' + barPx + 'px;"></div>' +
              '<span class="grd-vchart-label">' + esc(item.shortLabel) + '</span>' +
            '</div>';
          }).join('')
        : '<div style="width:100%;text-align:center;color:#64748b;font-size:12.5px;padding-bottom:46px;">Belum ada data mata pelajaran.</div>';

      const f = state.legerChartFilter;
      analyticsHost.innerHTML =
        '<div class="grd-card grd-podium-card">' +
          '<div class="grd-card-head-row">' +
            '<h4 class="grd-card-heading">3 Nilai Tertinggi</h4>' +
          '</div>' +
          podiumBodyHtml +
        '</div>' +
        '<div class="grd-card grd-vchart-card">' +
          '<div class="grd-card-head-row">' +
            '<h4 class="grd-card-heading">Grafik Rata-rata per Mata Pelajaran</h4>' +
            '<div class="grd-chart-controls">' +
              '<div class="grd-chart-pills" role="group" aria-label="Filter grafik mata pelajaran">' +
                '<button type="button" class="grd-chart-pill' + (f === 'top' ? ' is-active' : '') + '" data-leger-chart-filter="top">Tertinggi</button>' +
                '<button type="button" class="grd-chart-pill' + (f === 'low' ? ' is-active' : '') + '" data-leger-chart-filter="low">Perlu Perhatian</button>' +
                '<button type="button" class="grd-chart-pill' + (f === 'all' ? ' is-active' : '') + '" data-leger-chart-filter="all">Semua</button>' +
              '</div>' +
              '<div class="grd-vchart-legend">' +
                '<span><i class="grd-vchart-legend-dot" style="background:#16a34a;"></i>&ge; 75</span>' +
                '<span><i class="grd-vchart-legend-dot" style="background:#f59e0b;"></i>&lt; 75</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="grd-vchart-scroll">' +
            '<div class="grd-vchart-plot">' +
              '<div class="grd-vchart-kkm-line" style="bottom:' + kkmBottomPx + 'px;"><span class="grd-vchart-kkm-tag">KKM 75</span></div>' +
              barsHtml +
            '</div>' +
          '</div>' +
        '</div>';
    }

    renderLegerTable();
  }

  function renderLegerTable() {
    const ov = state.overview;
    const tableEl = document.getElementById('grdLegerTable');
    if (!ov || !tableEl) return;

    const sum = ov.class_summary || {};
    const subjects = ov.subjects || [];
    const matrix = ov.matrix || [];
    const q = String(state.legerSearch || '').trim().toLowerCase();

    let rows = q
      ? matrix.filter(function (r) {
          return (String(r.name) + ' ' + String(r.nis) + ' ' + String(r.nisn)).toLowerCase().indexOf(q) !== -1;
        })
      : matrix.slice();

    if (state.legerViewMode === 'summary' && state.showRanking) {
      rows.sort(function (a, b) {
        const ra = a.rank || 9999;
        const rb = b.rank || 9999;
        if (ra !== rb) return ra - rb;
        return (a.row_no || 0) - (b.row_no || 0);
      });
    }

    const total = rows.length;
    const pageSize = state.legerPageSize || 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.legerPage > totalPages) state.legerPage = totalPages;
    if (state.legerPage < 1) state.legerPage = 1;
    const curPage = state.legerPage;

    const counterEl = document.getElementById('grdLegerCounter');
    if (counterEl) {
      if (total === 0) {
        counterEl.textContent = 'Menampilkan 0\u20130 dari 0 data';
      } else {
        const start = (curPage - 1) * pageSize + 1;
        const end = Math.min(curPage * pageSize, total);
        counterEl.textContent = 'Menampilkan ' + start + '\u2013' + end + ' dari ' + total + ' data';
      }
    }
    if (typeof window.renderPaginationControl === 'function') {
      window.renderPaginationControl('grdLegerPagination', curPage, totalPages, pageSize, 'goToGradesLegerPage');
    }

    const pageRows = rows.slice((curPage - 1) * pageSize, curPage * pageSize);

    if (state.legerViewMode === 'summary') {
      const rankTh = state.showRanking ? '<th scope="col" style="width:92px;">Peringkat</th>' : '<th scope="col" style="width:52px;">No</th>';
      const theadHtml =
        '<thead><tr>' +
          rankTh +
          '<th scope="col" style="text-align:left;">NIS</th>' +
          '<th scope="col" style="text-align:left;">Nama Siswa</th>' +
          '<th scope="col" style="width:160px;">Mapel Tuntas</th>' +
          '<th scope="col" style="width:120px;">Jumlah Nilai</th>' +
          '<th scope="col" class="grd-col-avg-mint" style="width:110px;">Rata-rata</th>' +
          '<th scope="col" style="width:130px;">Aksi</th>' +
        '</tr></thead>';

      const tbodyHtml = total === 0
        ? '<tbody><tr><td colspan="7" style="text-align:center;padding:28px;color:#64748b;">Tidak ada siswa yang cocok dengan pencarian.</td></tr></tbody>'
        : '<tbody>' + pageRows.map(function (r) {
            const totalSubj = subjects.length || 1;
            let tuntasCount = 0;
            subjects.forEach(function (s) {
              const c = r.scores && r.scores[s.subject_code];
              if (c && c.is_tuntas === true) tuntasCount++;
            });
            const pctTuntas = Math.round((tuntasCount / totalSubj) * 100);
            const warnBar = pctTuntas < 50 ? ' is-warn' : '';

            let firstColHtml = '<td style="color:#64748b;">' + r.row_no + '</td>';
            if (state.showRanking) {
              const rk = r.rank || '-';
              const rkCls = rk === 1 ? ' grd-rank-badge--top1' : (rk === 2 ? ' grd-rank-badge--top2' : (rk === 3 ? ' grd-rank-badge--top3' : ''));
              firstColHtml = '<td><span class="grd-rank-badge' + rkCls + '">' + (rk !== '-' ? '#' + rk : '-') + '</span></td>';
            }

            return '<tr>' +
              firstColHtml +
              '<td style="text-align:left;font-family:\'Roboto Mono\',monospace;font-size:12px;color:#475569;">' + esc(r.nis) + '</td>' +
              '<td style="text-align:left;font-weight:600;color:#0f172a;">' + esc(r.name) + '</td>' +
              '<td><div class="grd-tuntas-cell"><span class="grd-tuntas-txt">' + tuntasCount + '/' + subjects.length + '</span><div class="grd-mini-bar-track"><div class="grd-mini-bar-fill' + warnBar + '" style="width:' + pctTuntas + '%"></div></div></div></td>' +
              '<td style="font-weight:700;color:#0f172a;">' + fmtScore(r.total_score, 1) + '</td>' +
              '<td class="grd-col-avg-mint">' + fmtScore(r.average_score, 1) + '</td>' +
              '<td><button type="button" class="grd-btn grd-btn--secondary grd-rapor-link-btn" data-open-khs="' + esc(r.student_id) + '">Lihat Rapor &rarr;</button></td>' +
            '</tr>';
          }).join('') + '</tbody>';

      tableEl.innerHTML = theadHtml + tbodyHtml;
      return;
    }

    // FULL MATRIX MODE (All 21-23 Subjects + Sticky Left Name & Sticky Right Average)
    const rankHeadHtml = state.showRanking ? '<th scope="col">Peringkat</th>' : '';
    const theadHtml =
      '<thead><tr>' +
        '<th scope="col" class="grd-sticky-no">No</th>' +
        '<th scope="col" class="grd-sticky-name">Nama Siswa</th>' +
        subjects.map(function (s) {
          return '<th scope="col" title="' + esc(s.subject_name + ' (KKM ' + s.kkm + ')') + '">' + esc(s.subject_code) + '</th>';
        }).join('') +
        '<th scope="col">Jumlah</th>' +
        '<th scope="col" class="grd-col-avg-mint grd-sticky-right-avg">Rata-rata</th>' +
        rankHeadHtml +
        '<th scope="col">Rapor</th>' +
      '</tr></thead>';

    const colCount = subjects.length + (state.showRanking ? 6 : 5);
    const tbodyHtml = total === 0
      ? '<tbody><tr><td colspan="' + colCount + '" style="text-align:center;padding:28px;color:#64748b;">Tidak ada siswa yang cocok dengan pencarian.</td></tr></tbody>'
      : '<tbody>' + pageRows.map(function (r) {
          const subjCells = subjects.map(function (s) {
            const c = r.scores && r.scores[s.subject_code];
            if (!c || c.score === null || c.score === undefined) return '<td class="grd-cell-zero">-</td>';
            const cls = c.score === 0 ? 'grd-cell-zero' : (c.is_tuntas === false ? 'grd-cell-remedial' : '');
            return '<td class="' + cls + '">' + fmtScore(c.score, 2) + '</td>';
          }).join('');

          let rankCellHtml = '';
          if (state.showRanking) {
            const rk = r.rank || '-';
            const rkCls = rk === 1 ? ' grd-rank-badge--top1' : (rk === 2 ? ' grd-rank-badge--top2' : (rk === 3 ? ' grd-rank-badge--top3' : ''));
            rankCellHtml = '<td><span class="grd-rank-badge' + rkCls + '">' + (rk !== '-' ? '#' + rk : '-') + '</span></td>';
          }

          return '<tr>' +
            '<td class="grd-sticky-no">' + r.row_no + '</td>' +
            '<th scope="row" class="grd-sticky-name">' + esc(r.name) + '</th>' +
            subjCells +
            '<td style="font-weight:700;color:#0f172a;">' + fmtScore(r.total_score, 1) + '</td>' +
            '<td class="grd-col-avg-mint grd-sticky-right-avg">' + fmtScore(r.average_score, 1) + '</td>' +
            rankCellHtml +
            '<td><button type="button" class="grd-btn grd-btn--secondary grd-rapor-link-btn" data-open-khs="' + esc(r.student_id) + '">Rapor</button></td>' +
          '</tr>';
        }).join('') + '</tbody>';

    const tfootHtml =
      '<tfoot><tr>' +
        '<th scope="row" colspan="2" class="grd-sticky-avg-label">Rata-rata Kelas</th>' +
        subjects.map(function (s) {
          const v = ov.subject_averages ? ov.subject_averages[s.subject_code] : null;
          return '<td>' + (v !== null && v !== undefined ? fmtScore(v, 1) : '-') + '</td>';
        }).join('') +
        '<td>' + fmtScore(sum.class_total_average, 1) + '</td>' +
        '<td class="grd-col-avg-mint grd-sticky-right-avg">' + fmtScore(sum.class_average, 1) + '</td>' +
        (state.showRanking ? '<td></td>' : '') +
        '<td></td>' +
      '</tr></tfoot>';

    tableEl.innerHTML = theadHtml + tbodyHtml + tfootHtml;
  }

  function loadKhsForSelectedStudent() {
    const ov = state.overview;
    if (!ov) return;

    const classWrap = document.getElementById('grdKhsClassWrap');
    const classSel = document.getElementById('grdKhsClassSelect');
    const stSel = document.getElementById('grdKhsStudentSelect');
    const navBtns = document.getElementById('grdKhsNavBtns');
    const prevBtn = document.getElementById('grdKhsPrevStudentBtn');
    const nextBtn = document.getElementById('grdKhsNextStudentBtn');
    const isParent = Boolean(ov.viewer && ov.viewer.is_parent);

    if (classWrap) classWrap.style.display = isParent ? 'none' : '';
    if (classSel) {
      classSel.innerHTML = (ov.classes || []).map(function (c) {
        const sel = c.class_id === state.classId ? ' selected' : '';
        return '<option value="' + esc(c.class_id) + '"' + sel + '>' + esc(c.class_name) + '</option>';
      }).join('');
    }

    const matrix = ov.matrix || [];
    if (!state.selectedStudentId || !matrix.some(function (r) { return r.student_id === state.selectedStudentId; })) {
      state.selectedStudentId = matrix[0] ? matrix[0].student_id : '';
    }

    const curIdx = matrix.findIndex(function (r) { return r.student_id === state.selectedStudentId; });

    if (stSel) {
      stSel.innerHTML = matrix.map(function (r) {
        const sel = r.student_id === state.selectedStudentId ? ' selected' : '';
        return '<option value="' + esc(r.student_id) + '"' + sel + '>' + esc(r.name) + '</option>';
      }).join('');
    }

    if (navBtns) navBtns.style.display = matrix.length > 1 ? 'inline-flex' : 'none';
    if (prevBtn) prevBtn.disabled = curIdx <= 0;
    if (nextBtn) nextBtn.disabled = curIdx === -1 || curIdx >= matrix.length - 1;

    const previewBtn = document.getElementById('grdToggleParentPreviewBtn');
    if (previewBtn) {
      previewBtn.style.display = isParent ? 'none' : 'inline-flex';
      previewBtn.className = 'grd-btn grd-btn--compact ' + (state.parentPreviewMode ? 'grd-btn--soft' : 'grd-btn--secondary');
      previewBtn.innerHTML = '<span>' + (state.parentPreviewMode ? '\u2713 Tampilan Wali Aktif' : 'Lihat Tampilan Wali') + '</span>';
    }

    const rankKhsBtn = document.getElementById('grdKhsToggleRankingBtn');
    if (rankKhsBtn) {
      rankKhsBtn.style.display = isParent ? 'none' : 'inline-flex';
      rankKhsBtn.className = 'grd-pub-toggle';
      rankKhsBtn.setAttribute('aria-pressed', state.showRanking ? 'true' : 'false');
      rankKhsBtn.innerHTML =
        '<span class="grd-pub-toggle-label">Tampilkan Peringkat</span>' +
        '<span class="grd-switch-track" aria-hidden="true"><span class="grd-switch-thumb"></span></span>';
    }

    state.khsPage = 1;

    const bodyHost = document.getElementById('grdKhsBodyHost');
    if (!state.selectedStudentId) {
      if (bodyHost) {
        bodyHost.innerHTML = '<div class="grd-card" style="text-align:center;color:#64748b;padding:30px;">' +
          (ov.parent_unpublished_notice
            ? 'Nilai periode <strong>' + esc(ov.selected_period ? ov.selected_period.short_label : '') + '</strong> belum dibagikan oleh pihak madrasah.'
            : 'Belum ada data siswa pada kelas ini.') +
        '</div>';
      }
      return;
    }

    simataClient
      .withSuccessHandler(function (res) {
        if (!res || !res.success || !res.data) return;
        state.khsData = res.data;
        renderKhsContent();
      })
      .withFailureHandler(function (err) {
        if (bodyHost) {
          bodyHost.innerHTML = '<div class="grd-card" style="color:#dc2626;">Gagal memuat rapor siswa: ' + esc(err && err.message ? err.message : err) + '</div>';
        }
      })
      .getStudentKhs(state.selectedStudentId, {
        academic_year_id: state.academicYearId,
        assessment_type: state.periodCode
      });
  }

  function renderKhsContent() {
    const host = document.getElementById('grdKhsBodyHost');
    const khs = state.khsData;
    if (!host || !khs) return;

    const isParent = Boolean(state.overview && state.overview.viewer && state.overview.viewer.is_parent);
    const isArchived = Boolean(state.overview && state.overview.is_year_archived);
    const readOnlyParentView = isParent || state.parentPreviewMode || isArchived;

    const rankKhsBtn = document.getElementById('grdKhsToggleRankingBtn');
    if (rankKhsBtn && !isParent) {
      rankKhsBtn.setAttribute('aria-pressed', state.showRanking ? 'true' : 'false');
    }

    if ((isParent || state.parentPreviewMode) && !khs.selected_period.is_published) {
      host.innerHTML =
        '<div class="grd-card" style="text-align:center;padding:36px 20px;">' +
          '<span class="grd-chip grd-chip--amber" style="margin-bottom:10px;">Belum Dibagikan</span>' +
          '<h3 style="margin:6px 0;color:#0f172a;">Rapor ' + esc(khs.selected_period.short_label) + ' Masih Dalam Proses Rekap Guru</h3>' +
          '<p style="color:#64748b;font-size:13.5px;max-width:520px;margin:0 auto;">Pada tampilan Wali Murid, nilai hanya muncul setelah periode ini diaktifkan melalui tombol <strong>Bagikan ke Wali</strong>.</p>' +
        '</div>';
      return;
    }

    const st = khs.student;
    const row = khs.student_row || { scores: {}, total_score: 0, average_score: 0, rank: '-', attendance: {} };
    const initials = String(st.name || 'S').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase();
    const subjects = khs.subjects || [];

    let tuntasCount = 0;
    let belumCount = 0;
    subjects.forEach(function (s) {
      const c = row.scores && row.scores[s.subject_code];
      if (c && c.is_tuntas === true) tuntasCount++;
      else if (c && c.is_tuntas === false) belumCount++;
    });

    const pubPillHtml = khs.selected_period.is_published
      ? '<span class="grd-chip grd-chip--emerald">Dibagikan \u2713</span>'
      : '<span class="grd-chip grd-chip--amber">Belum Dibagikan</span>';

    const rankMetricHtml = (state.showRanking && row.rank)
      ? '<div class="grd-khs-metric">' +
          '<div class="grd-khs-metric-label">Peringkat</div>' +
          '<div class="grd-khs-metric-val"><span class="grd-rank-badge' +
            (row.rank === 1 ? ' grd-rank-badge--top1' : (row.rank === 2 ? ' grd-rank-badge--top2' : (row.rank === 3 ? ' grd-rank-badge--top3' : ''))) +
            '">#' + row.rank + ' / ' + khs.class_student_count + '</span></div>' +
        '</div>'
      : '';

    // Attendance donut ring + 3 clean tiles
    const att = row.attendance || {};
    const hadirPct = att.total_days > 0 ? Math.round(Number(att.hadir_pct || 0)) : 100;
    const rRing = 25;
    const circRing = 2 * Math.PI * rRing;
    const dashRing = (Math.min(100, Math.max(0, hadirPct)) / 100) * circRing;

    // 4-Period Trend Bar Chart (dedicated left KKM 75 gutter + uniform tracks)
    const trend = khs.trend || [];
    const trackH = 116;
    const kkmBottomPx = Math.round(26 + (75 / 100) * trackH);
    const trendBarsHtml = trend.map(function (t) {
      const val = t.average_score;
      const hasVal = val !== null && val !== undefined && t.filled_subjects > 0;
      const pct = hasVal ? Math.min(100, Math.max(0, Number(val))) : 0;
      const fillPx = hasVal ? Math.max(5, Math.round((pct / 100) * trackH)) : 0;
      const below = hasVal && Number(val) < 75;
      const valBottomPx = hasVal ? (fillPx + 4) : 6;
      const tip = t.short_label + (hasVal ? (' \u2022 Rata-rata: ' + fmtScore(val, 1)) : ' \u2022 Belum ada nilai');
      return '<div class="grd-khs-trend-col" title="' + esc(tip) + '">' +
        '<div class="grd-khs-trend-track">' +
          (hasVal ? '<span class="grd-khs-trend-val" style="bottom:' + valBottomPx + 'px;">' + fmtScore(val, 1) + '</span>' : '') +
          (hasVal ? '<div class="grd-khs-trend-fill' + (below ? ' is-below' : '') + '" style="height:' + fillPx + 'px;"></div>' : '') +
        '</div>' +
        '<span class="grd-khs-trend-lbl">' + esc(t.short_label) + '</span>' +
      '</div>';
    }).join('');

    const noteCardHtml = readOnlyParentView
      ? '<div class="grd-khs-note-readonly">' +
          esc(row.homeroom_note || 'Terus tingkatkan semangat belajar, ibadah, dan kedisiplinan di madrasah.') +
        '</div>'
      : '<p class="grd-khs-note-subtext">Catatan pembinaan atau apresiasi untuk siswa dan orang tua.</p>' +
        '<textarea id="grdHomeroomNoteInput" class="grd-khs-note-textarea" rows="4" placeholder="Tulis catatan wali kelas...">' + esc(row.homeroom_note || '') + '</textarea>' +
        '<div class="grd-khs-note-actions">' +
          '<button type="button" class="grd-btn grd-btn--primary grd-btn--compact" id="grdSaveHomeroomNoteBtn">Simpan Catatan</button>' +
        '</div>';

    const f = state.khsFilter || 'all';

    host.innerHTML =
      '<div class="grd-khs-grid">' +
        // LEFT 66%: DIGITAL REPORT CARD
        '<div class="grd-card grd-khs-report-card">' +
          '<div class="grd-khs-hero-band">' +
            '<div class="grd-khs-identity">' +
              '<div class="grd-khs-avatar">' + esc(initials) + '</div>' +
              '<div style="min-width:0;">' +
                '<div class="grd-khs-name-row">' +
                  '<h3 class="grd-khs-name">' + esc(st.name) + '</h3>' +
                  pubPillHtml +
                '</div>' +
                '<div class="grd-khs-meta">NIS: ' + esc(st.nis || '-') + ' &bull; ' + esc(st.class_name) + ' &bull; Wali: ' + esc(st.homeroom_teacher_name) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="grd-khs-hero-metrics">' +
              '<div class="grd-khs-metric">' +
                '<div class="grd-khs-metric-label">Rata-rata</div>' +
                '<div class="grd-khs-metric-val grd-khs-metric-val--emerald">' + fmtScore(row.average_score, 1) + '</div>' +
              '</div>' +
              '<div class="grd-khs-metric">' +
                '<div class="grd-khs-metric-label">Tuntas</div>' +
                '<div class="grd-khs-metric-val">' + tuntasCount + '/' + subjects.length + '</div>' +
              '</div>' +
              rankMetricHtml +
            '</div>' +
          '</div>' +
          '<div class="grd-khs-toolbar">' +
            '<div class="grd-mode-switch" role="group" aria-label="Filter mata pelajaran rapor">' +
              '<button type="button" class="grd-mode-btn' + (f === 'all' ? ' is-active' : '') + '" data-khs-filter="all">Semua (' + subjects.length + ')</button>' +
              '<button type="button" class="grd-mode-btn' + (f === 'tuntas' ? ' is-active' : '') + '" data-khs-filter="tuntas">Tuntas (' + tuntasCount + ')</button>' +
              '<button type="button" class="grd-mode-btn' + (f === 'belum' ? ' is-active' : '') + '" data-khs-filter="belum">Belum Tuntas (' + belumCount + ')</button>' +
            '</div>' +
            '<div class="grd-search-wrap">' +
              '<input id="grdKhsSearchInput" type="search" class="grd-input grd-search-input" value="' + esc(state.khsSearch || '') + '" placeholder="Cari mapel..." aria-label="Cari mata pelajaran pada rapor" />' +
              '<svg class="grd-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '</div>' +
          '</div>' +
          '<div class="grd-table-wrap grd-khs-table-wrap">' +
            '<table class="grd-table grd-table--khs">' +
              '<thead><tr>' +
                '<th scope="col" style="width:46px;text-align:center;">No</th>' +
                '<th scope="col">Mata Pelajaran</th>' +
                '<th scope="col" style="width:66px;text-align:center;">KKM</th>' +
                '<th scope="col" style="width:74px;text-align:center;">Nilai</th>' +
                '<th scope="col" style="width:94px;text-align:center;">Rata Kelas</th>' +
                '<th scope="col" style="width:154px;text-align:center;">Status</th>' +
              '</tr></thead>' +
              '<tbody id="grdKhsTbody"></tbody>' +
            '</table>' +
          '</div>' +
          '<div class="grd-khs-summary-bar">' +
            '<span>Jumlah Nilai: <strong>' + fmtScore(row.total_score, 1) + '</strong></span>' +
            '<span>Rata-rata: <strong>' + fmtScore(row.average_score, 1) + '</strong></span>' +
          '</div>' +
          '<div class="attendance-table-footer grd-input-pagination-bar">' +
            '<div class="table-footer-counter" id="grdKhsCounter">Menampilkan 0\u20130 dari 0 mapel</div>' +
            '<div class="table-footer-pagination" id="grdKhsPagination"></div>' +
          '</div>' +
        '</div>' +
        // RIGHT 34%: 3 STACKED EVALUATION CARDS
        '<div class="grd-khs-side-stack">' +
          '<div class="grd-card grd-att-card">' +
            '<h4 class="grd-card-heading" style="margin-bottom:12px;">Kehadiran Siswa</h4>' +
            '<div class="grd-att-body">' +
              '<div class="grd-att-ring-wrap" aria-label="Persentase kehadiran ' + hadirPct + '%">' +
                '<svg viewBox="0 0 64 64">' +
                  '<circle cx="32" cy="32" r="' + rRing + '" stroke="#e2e8f0" stroke-width="6.5" fill="none"></circle>' +
                  '<circle cx="32" cy="32" r="' + rRing + '" stroke="#166534" stroke-width="6.5" fill="none" stroke-linecap="round" stroke-dasharray="' + dashRing.toFixed(1) + ' ' + circRing.toFixed(1) + '"></circle>' +
                '</svg>' +
                '<span class="grd-att-ring-label">' + hadirPct + '%</span>' +
              '</div>' +
              '<div class="grd-att-tiles">' +
                '<div class="grd-att-tile"><div class="grd-att-tile-label">Sakit</div><div class="grd-att-tile-val">' + (att.sakit || 0) + '</div></div>' +
                '<div class="grd-att-tile"><div class="grd-att-tile-label">Izin</div><div class="grd-att-tile-val">' + (att.izin || 0) + '</div></div>' +
                '<div class="grd-att-tile"><div class="grd-att-tile-label">Alpa</div><div class="grd-att-tile-val">' + (att.alpa || 0) + '</div></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="grd-card grd-khs-trend-card">' +
            '<h4 class="grd-card-heading" style="margin-bottom:8px;">Perkembangan Nilai</h4>' +
            '<div class="grd-khs-trend-plot">' +
              '<div class="grd-vchart-kkm-line" style="bottom:' + kkmBottomPx + 'px;"><span class="grd-vchart-kkm-tag">KKM 75</span></div>' +
              trendBarsHtml +
            '</div>' +
          '</div>' +
          '<div class="grd-card grd-khs-note-card">' +
            '<h4 class="grd-card-heading" style="margin-bottom:2px;">Catatan Wali Kelas</h4>' +
            noteCardHtml +
          '</div>' +
        '</div>' +
      '</div>';

    renderKhsTableRows();
  }

  function renderKhsTableRows() {
    const khs = state.khsData;
    const tbody = document.getElementById('grdKhsTbody');
    if (!khs || !tbody) return;

    const row = khs.student_row || { scores: {} };
    const allSubjects = (khs.subjects || []).map(function (s, idx) {
      const c = (row.scores && row.scores[s.subject_code]) || { score: null, kkm: s.kkm, predicate: '-', is_tuntas: null, remarks: '' };
      return { idx: idx + 1, subject: s, cell: c };
    });

    const f = state.khsFilter || 'all';
    const q = String(state.khsSearch || '').trim().toLowerCase();
    const filtered = allSubjects.filter(function (item) {
      if (f === 'tuntas' && item.cell.is_tuntas !== true) return false;
      if (f === 'belum' && item.cell.is_tuntas !== false) return false;
      if (q) {
        const hay = (String(item.subject.subject_name) + ' ' + String(item.subject.subject_code)).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    const total = filtered.length;
    const pageSize = state.khsPageSize || 10;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.khsPage > totalPages) state.khsPage = totalPages;
    if (state.khsPage < 1) state.khsPage = 1;
    const curPage = state.khsPage;

    const counterEl = document.getElementById('grdKhsCounter');
    if (counterEl) {
      if (total === 0) {
        counterEl.textContent = 'Menampilkan 0\u20130 dari 0 mapel';
      } else {
        const start = (curPage - 1) * pageSize + 1;
        const end = Math.min(curPage * pageSize, total);
        counterEl.textContent = 'Menampilkan ' + start + '\u2013' + end + ' dari ' + total + ' mapel';
      }
    }
    if (typeof window.renderPaginationControl === 'function') {
      window.renderPaginationControl('grdKhsPagination', curPage, totalPages, pageSize, 'goToGradesKhsPage');
    }

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:#64748b;">Tidak ada mata pelajaran yang cocok dengan filter.</td></tr>';
      return;
    }

    const pageItems = filtered.slice((curPage - 1) * pageSize, curPage * pageSize);
    tbody.innerHTML = pageItems.map(function (item) {
      const s = item.subject;
      const c = item.cell;
      const clsAvg = khs.subject_averages ? khs.subject_averages[s.subject_code] : null;
      const predLetter = c.predicate && c.predicate !== '-' ? c.predicate : '';
      const statusBadge = c.is_tuntas === true
        ? '<span class="grd-chip grd-chip--emerald">' + (predLetter ? predLetter + ' &bull; ' : '') + 'Tuntas</span>'
        : (c.is_tuntas === false
            ? '<span class="grd-chip grd-chip--amber">' + (predLetter ? predLetter + ' &bull; ' : '') + 'Belum Tuntas</span>'
            : '<span class="grd-chip grd-chip--slate">Kosong</span>');
      const remarkSub = c.remarks
        ? '<div class="grd-khs-note-sub">Catatan: ' + esc(c.remarks) + '</div>'
        : '';

      return '<tr>' +
        '<td style="text-align:center;color:#64748b;font-variant-numeric:tabular-nums;">' + item.idx + '</td>' +
        '<td><div style="font-weight:600;color:#0f172a;">' + esc(s.subject_name) + '</div>' + remarkSub + '</td>' +
        '<td style="text-align:center;color:#475569;font-variant-numeric:tabular-nums;">' + fmtScore(c.kkm || s.kkm, 1) + '</td>' +
        '<td style="text-align:center;font-weight:800;font-size:13.5px;color:#0f172a;font-variant-numeric:tabular-nums;">' + (c.score !== null ? fmtScore(c.score, 2) : '-') + '</td>' +
        '<td style="text-align:center;color:#64748b;font-variant-numeric:tabular-nums;">' + (clsAvg !== null && clsAvg !== undefined ? fmtScore(clsAvg, 1) : '-') + '</td>' +
        '<td style="text-align:center;">' + statusBadge + '</td>' +
      '</tr>';
    }).join('');
  }

  function triggerPrintSheet(htmlContent, pageOrientation) {
    let sheet = document.getElementById('gradesPrintSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'gradesPrintSheet';
      document.body.appendChild(sheet);
    }
    let pageStyle = document.getElementById('gradesDynamicPrintPageStyle');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'gradesDynamicPrintPageStyle';
      document.head.appendChild(pageStyle);
    }
    const prt = window.SimataPrint;
    const pageRule = (prt && typeof prt.getPageCss === 'function')
      ? prt.getPageCss(pageOrientation)
      : (pageOrientation === 'landscape'
        ? '@page { size: landscape; margin: 8mm; }'
        : '@page { size: portrait; margin: 10mm; }');
    const sharedPrintCss = (prt && typeof prt.getSharedPrintCss === 'function')
      ? prt.getSharedPrintCss()
      : '';
    pageStyle.textContent = sharedPrintCss + '\n@media print { ' + pageRule + ' }';

    sheet.innerHTML = htmlContent;
    document.body.classList.add('printing-grades-sheet');

    const cleanup = function () {
      document.body.classList.remove('printing-grades-sheet');
      pageStyle.textContent = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(function () {
      window.print();
      setTimeout(cleanup, 800);
    }, 80);
  }

  // Official Madrasah Excel Matrix Print (matches attached Excel layout 100%)
  function printMadrasahLegerMatrix() {
    const ov = state.overview;
    if (!ov || !ov.selected_class) return;

    const prt = window.SimataPrint;
    const cls = ov.selected_class;
    const p = ov.selected_period || { print_heading: 'HASIL NILAI ASTS GANJIL' };
    const yr = (ov.active_academic_year ? ov.active_academic_year.academic_year_id : '2026/2027').replace('/', ' - ');
    const subjects = ov.subjects || [];
    const matrix = ov.matrix || [];
    const sum = ov.class_summary || {};
    const principalFallback = (ov.portal_settings && ov.portal_settings.principal_name) || 'Moch. Iqnaul Badril Falah, S.Ag';
    const wali = cls.homeroom_teacher_name || '-';
    const legerTitle = p.print_heading || ('HASIL NILAI ' + (p.short_label || '').toUpperCase());

    const kopHtml = (prt && typeof prt.renderKopHtml === 'function')
      ? prt.renderKopHtml({
          title: legerTitle,
          subtitle: 'MADRASAH ALIYAH AT-TAUJIH \u2022 Tahun Ajaran ' + yr,
          compact: true
        })
      : '<div class="grd-print-leger-head">' +
          '<h1>' + esc(legerTitle) + '</h1>' +
          '<h2>MADRASAH ALIYAH AT-TAUJIH</h2>' +
          '<p>Ds. Bajingjowo Kec. Sarang Kab. Rembang</p>' +
          '<p>Tahun Ajaran ' + esc(yr) + '</p>' +
        '</div>';

    const prtCfgPrincipal = (prt && prt.getSettings && prt.getSettings().principal_name)
      ? {}
      : { principal_name: principalFallback };
    const principalSigCol = (prt && typeof prt.renderPrincipalSigHtml === 'function')
      ? prt.renderPrincipalSigHtml({
          docTitle: 'Leger ' + legerTitle + ' - Kelas ' + romanClassLevel(cls),
          showMengetahui: false,
          roleLabel: 'Kepala Madrasah MA. At-Taujih',
          compact: true,
          cfg: prtCfgPrincipal
        })
      : '<div class="grd-print-sig-col">' +
          '<div>Kepala Madrasah</div>' +
          '<div>MA. At-Taujih</div>' +
          '<div class="grd-print-sig-space"></div>' +
          '<div><strong>' + esc(principalFallback) + '</strong></div>' +
        '</div>';

    const footerHtml = (prt && typeof prt.renderPrintFooterHtml === 'function')
      ? prt.renderPrintFooterHtml()
      : '';

    const html =
      '<div class="grd-print-leger">' +
        kopHtml +
        '<div class="grd-print-leger-meta">' +
          '<div>Kelas : ' + esc(romanClassLevel(cls)) + '</div>' +
          '<div>Wali Kelas : ' + esc(wali) + '</div>' +
        '</div>' +
        '<table class="grd-print-leger-table">' +
          '<thead><tr>' +
            '<th>No</th>' +
            '<th>Nama</th>' +
            subjects.map(function (s) { return '<th>' + esc(s.subject_code) + '</th>'; }).join('') +
            '<th>Jumlah</th>' +
            '<th>Rata-Rata</th>' +
            (state.showRanking ? '<th>Rangking</th>' : '') +
          '</tr></thead>' +
          '<tbody>' +
            matrix.map(function (r) {
              return '<tr>' +
                '<td>' + r.row_no + '</td>' +
                '<td class="p-name">' + esc(r.name) + '</td>' +
                subjects.map(function (s) {
                  const c = r.scores && r.scores[s.subject_code];
                  return '<td>' + (c && c.score !== null && c.score !== undefined ? fmtScore(c.score, 2) : '') + '</td>';
                }).join('') +
                '<td><strong>' + fmtScore(r.total_score, 2) + '</strong></td>' +
                '<td>' + fmtScore(r.average_score, 2) + '</td>' +
                (state.showRanking ? '<td><strong>' + (r.rank || '') + '</strong></td>' : '') +
              '</tr>';
            }).join('') +
            '<tr class="p-avg-row">' +
              '<td colspan="2" style="text-align:left;padding-left:5px;">NILAI RATA-RATA SATU KELAS / MAPEL</td>' +
              subjects.map(function (s) {
                const v = ov.subject_averages ? ov.subject_averages[s.subject_code] : null;
                return '<td>' + (v !== null && v !== undefined ? fmtScore(v, 2) : '') + '</td>';
              }).join('') +
              '<td>' + fmtScore(sum.class_total_average, 2) + '</td>' +
              '<td>' + fmtScore(sum.class_average, 2) + '</td>' +
              (state.showRanking ? '<td></td>' : '') +
            '</tr>' +
          '</tbody>' +
        '</table>' +
        '<div class="grd-print-signatures" style="align-items:flex-end;">' +
          '<div class="grd-print-sig-col">' +
            '<div>Mengetahui,</div>' +
            '<div>Wali Kelas</div>' +
            '<div class="grd-print-sig-space"></div>' +
            '<div><strong>' + esc(wali) + '</strong></div>' +
          '</div>' +
          principalSigCol +
        '</div>' +
        footerHtml +
      '</div>';

    triggerPrintSheet(html, 'landscape');
  }

  function printStudentKhsSheet() {
    const khs = state.khsData;
    if (!khs || !khs.student_row) return;
    const prt = window.SimataPrint;
    const st = khs.student;
    const row = khs.student_row;
    const principalFallback = (khs.portal_settings && khs.portal_settings.principal_name) || 'Moch. Iqnaul Badril Falah, S.Ag';
    const att = row.attendance || { sakit: 0, izin: 0, alpa: 0 };

    const kopHtml = (prt && typeof prt.renderKopHtml === 'function')
      ? prt.renderKopHtml({
          title: 'LAPORAN HASIL BELAJAR — ' + (khs.selected_period.short_label || ''),
          subtitle: 'Tahun Ajaran ' + (khs.academic_year ? khs.academic_year.academic_year_id : ''),
          compact: true
        })
      : '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;">' +
          '<div style="font-size:13pt;font-weight:700;">MADRASAH ALIYAH AT-TAUJIH SARANG</div>' +
          '<div style="font-size:9.5pt;">Ds. Bajingjowo Kec. Sarang Kab. Rembang &bull; NPSN: 70033117</div>' +
          '<div style="font-size:11pt;font-weight:700;margin-top:6px;text-transform:uppercase;">LAPORAN HASIL BELAJAR — ' + esc(khs.selected_period.short_label) + '</div>' +
        '</div>';

    const prtCfgPrincipal = (prt && prt.getSettings && prt.getSettings().principal_name)
      ? {}
      : { principal_name: principalFallback };
    const principalSigCol = (prt && typeof prt.renderPrincipalSigHtml === 'function')
      ? prt.renderPrincipalSigHtml({
          docTitle: 'KHS Rapor ' + (st.name || '') + ' (' + (khs.selected_period.short_label || '') + ')',
          showMengetahui: false,
          showCityDate: true,
          compact: true,
          cfg: prtCfgPrincipal
        })
      : '<div class="grd-print-sig-col"><div>Kepala Madrasah</div><div class="grd-print-sig-space"></div><div><strong>' + esc(principalFallback) + '</strong></div></div>';

    const footerHtml = (prt && typeof prt.renderPrintFooterHtml === 'function')
      ? prt.renderPrintFooterHtml()
      : '';

    const html =
      '<div class="grd-print-khs">' +
        kopHtml +
        '<table style="width:100%;font-size:9.5pt;margin-bottom:8px;">' +
          '<tr>' +
            '<td style="width:16%;">Nama Siswa</td><td style="width:42%;">: <strong>' + esc(st.name) + '</strong></td>' +
            '<td style="width:18%;">Tahun Ajaran</td><td>: ' + esc(khs.academic_year.academic_year_id) + '</td>' +
          '</tr>' +
          '<tr>' +
            '<td>NIS / NISN</td><td>: ' + esc(st.nis || '-') + ' / ' + esc(st.nisn || '-') + '</td>' +
            '<td>Kelas</td><td>: ' + esc(romanClassLevel(st)) + ' (' + esc(st.class_name) + ')</td>' +
          '</tr>' +
        '</table>' +
        '<table class="grd-print-khs-table">' +
          '<thead><tr><th style="width:32px;">No</th><th>Mata Pelajaran</th><th style="width:50px;">KKM</th><th style="width:62px;">Nilai</th><th style="width:62px;">Predikat</th><th style="width:85px;">Ketuntasan</th><th>Keterangan</th></tr></thead>' +
          '<tbody>' +
            (khs.subjects || []).map(function (s, idx) {
              const c = (row.scores && row.scores[s.subject_code]) || {};
              return '<tr>' +
                '<td style="text-align:center;">' + (idx + 1) + '</td>' +
                '<td>' + esc(s.subject_name) + '</td>' +
                '<td style="text-align:center;">' + fmtScore(c.kkm || s.kkm, 1) + '</td>' +
                '<td style="text-align:center;font-weight:700;">' + (c.score !== null && c.score !== undefined ? fmtScore(c.score, 2) : '-') + '</td>' +
                '<td style="text-align:center;">' + esc(c.predicate || '-') + '</td>' +
                '<td style="text-align:center;">' + (c.is_tuntas === true ? 'Tuntas' : (c.is_tuntas === false ? 'Belum Tuntas' : '-')) + '</td>' +
                '<td>' + esc(c.remarks || '') + '</td>' +
              '</tr>';
            }).join('') +
            '<tr style="font-weight:700;background:#f8fafc;">' +
              '<td colspan="3" style="text-align:right;">Jumlah Nilai / Rata-Rata' + (state.showRanking && row.rank ? ' / Peringkat Kelas' : '') + '</td>' +
              '<td colspan="4">' + fmtScore(row.total_score, 2) + ' &bull; Rata-rata: ' + fmtScore(row.average_score, 2) + (state.showRanking && row.rank ? (' &bull; Peringkat #' + row.rank + ' dari ' + khs.class_student_count) : '') + '</td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +
        '<div style="display:flex;gap:16px;margin-top:10px;font-size:9.5pt;">' +
          '<div style="flex:1;border:1px solid #000;padding:6px 8px;"><strong>Ketidakhadiran (SIMATA):</strong> Sakit: ' + (att.sakit || 0) + ' hari &bull; Izin: ' + (att.izin || 0) + ' hari &bull; Tanpa Keterangan: ' + (att.alpa || 0) + ' hari</div>' +
          '<div style="flex:1.4;border:1px solid #000;padding:6px 8px;"><strong>Catatan Wali Kelas:</strong> ' + esc(row.homeroom_note || '-') + '</div>' +
        '</div>' +
        '<div class="grd-print-signatures" style="padding:0 12px;margin-top:16px;align-items:flex-end;">' +
          '<div class="grd-print-sig-col"><div>Orang Tua / Wali</div><div class="grd-print-sig-space"></div><div>( ............................ )</div></div>' +
          '<div class="grd-print-sig-col"><div>Wali Kelas</div><div class="grd-print-sig-space"></div><div><strong>' + esc(st.homeroom_teacher_name) + '</strong></div></div>' +
          principalSigCol +
        '</div>' +
        footerHtml +
      '</div>';

    triggerPrintSheet(html, 'portrait');
  }

  function exportLegerCsv() {
    const ov = state.overview;
    if (!ov || !ov.selected_class) return;
    const cls = ov.selected_class;
    const p = ov.selected_period || { print_heading: 'HASIL NILAI ASTS GANJIL' };
    const yr = (ov.active_academic_year ? ov.active_academic_year.academic_year_id : '2026/2027').replace('/', ' - ');
    const wali = cls.homeroom_teacher_name || '-';
    const legerTitle = p.print_heading || ('HASIL NILAI ' + (p.short_label || '').toUpperCase());
    const subjects = ov.subjects || [];
    const matrix = ov.matrix || [];
    const sum = ov.class_summary || {};
    const headers = ['No', 'NIS', 'Nama Siswa'].concat(subjects.map(function (s) { return s.subject_code; }), ['Jumlah', 'Rata-Rata']);
    if (state.showRanking) headers.push('Rangking');

    const columns = [
      { align: 'center', type: 'int', width: 5.5 },
      { align: 'center', type: 'text', width: 20 },
      { align: 'left', type: 'text', width: 28 }
    ];
    subjects.forEach(function () {
      columns.push({ align: 'center', type: 'decimal', width: 7.5 });
    });
    columns.push({ align: 'center', type: 'decimal', width: 10.5, bold: true });
    columns.push({ align: 'center', type: 'decimal2', width: 10.5 });
    if (state.showRanking) columns.push({ align: 'center', type: 'int', width: 10.5, bold: true });

    const rows = matrix.map(function (r) {
      const rowArr = [r.row_no, r.nis || '', r.name || ''];
      subjects.forEach(function (s) {
        const c = r.scores && r.scores[s.subject_code];
        rowArr.push(c && c.score !== null && c.score !== undefined ? c.score : '');
      });
      rowArr.push(r.total_score !== null && r.total_score !== undefined ? r.total_score : '');
      rowArr.push(r.average_score !== null && r.average_score !== undefined ? Number(Number(r.average_score).toFixed(2)) : '');
      if (state.showRanking) rowArr.push(r.rank || '');
      return rowArr;
    });

    const summaryValues = subjects.map(function (s) {
      const v = ov.subject_averages ? ov.subject_averages[s.subject_code] : null;
      return v !== null && v !== undefined ? Number(Number(v).toFixed(2)) : '';
    });
    summaryValues.push(sum.class_total_average !== null && sum.class_total_average !== undefined ? Number(Number(sum.class_total_average).toFixed(2)) : '');
    summaryValues.push(sum.class_average !== null && sum.class_average !== undefined ? Number(Number(sum.class_average).toFixed(2)) : '');
    if (state.showRanking) summaryValues.push('');

    const fileBase = 'Leger_' + (cls.class_name || 'Kelas').replace(/\s+/g, '_') + '_' + state.periodCode;
    const prt = window.SimataPrint;
    if (prt && typeof prt.exportFormattedExcel === 'function') {
      prt.exportFormattedExcel({
        filename: fileBase + '.xlsx',
        sheet_name: 'Leger ' + romanClassLevel(cls),
        title: legerTitle,
        subtitle: 'MADRASAH ALIYAH AT-TAUJIH \u2022 Tahun Ajaran ' + yr,
        orientation: 'landscape',
        meta_rows: [['Kelas : ' + romanClassLevel(cls), 'Wali Kelas : ' + wali]],
        headers: headers,
        columns: columns,
        rows: rows,
        summary_row: {
          label: 'NILAI RATA-RATA SATU KELAS / MAPEL',
          colspan: 3,
          values: summaryValues
        },
        left_signer: {
          top: 'Mengetahui,',
          role: 'Wali Kelas',
          name: wali
        },
        include_principal_sig: true
      }).catch(function () {});
      return;
    }

    const csvEscape = function (v) {
      const s = String(v === null || v === undefined ? '' : v);
      if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.map(csvEscape).join(',')];
    rows.forEach(function (rowArr) {
      lines.push(rowArr.map(csvEscape).join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileBase + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function bindEventsOnce() {
    if (state.initialized) return;
    state.initialized = true;

    const root = document.getElementById('gradesContent');
    if (!root) return;

    root.addEventListener('click', function (e) {
      const openWsBtn = e.target.closest('#grdOpenSimataWorkspaceBtn');
      if (openWsBtn) {
        setScreen('workspace');
        return;
      }

      const backGwBtn = e.target.closest('#grdBackToGatewayBtn');
      if (backGwBtn) {
        setScreen('gateway');
        return;
      }

      const openRdmBtn = e.target.closest('#grdOpenRdmPortalBtn');
      if (openRdmBtn) {
        const url = state.overview && state.overview.portal_settings && state.overview.portal_settings.rdm_url;
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          const isAdmin = Boolean(state.overview && state.overview.viewer && state.overview.viewer.is_admin);
          if (isAdmin) openRdmSettingsModal();
          else alert('Link Portal RDM belum dikonfigurasi oleh Admin SIMATA.');
        }
        return;
      }

      const rdmCfgBtn = e.target.closest('#grdOpenRdmSettingsBtn');
      if (rdmCfgBtn) {
        openRdmSettingsModal();
        return;
      }

      const periodBtn = e.target.closest('.grd-period-pill[data-period]');
      if (periodBtn) {
        const nextPeriod = periodBtn.getAttribute('data-period');
        if (nextPeriod && nextPeriod !== state.periodCode) {
          state.periodCode = nextPeriod;
          state.inputPage = 1;
          state.legerPage = 1;
          loadGradesOverview({ stayOnScreen: true });
        }
        return;
      }

      const legerFilterBtn = e.target.closest('[data-leger-chart-filter]');
      if (legerFilterBtn) {
        const nextFilter = legerFilterBtn.getAttribute('data-leger-chart-filter');
        if (nextFilter && nextFilter !== state.legerChartFilter) {
          state.legerChartFilter = nextFilter;
          renderLegerPanel();
        }
        return;
      }

      const legerViewBtn = e.target.closest('[data-leger-view]');
      if (legerViewBtn) {
        const nextView = legerViewBtn.getAttribute('data-leger-view');
        if (nextView && nextView !== state.legerViewMode) {
          state.legerViewMode = nextView;
          state.legerPage = 1;
          document.querySelectorAll('[data-leger-view]').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-leger-view') === nextView);
          });
          renderLegerTable();
        }
        return;
      }

      const khsFilterBtn = e.target.closest('[data-khs-filter]');
      if (khsFilterBtn) {
        const nextF = khsFilterBtn.getAttribute('data-khs-filter');
        if (nextF && nextF !== state.khsFilter) {
          state.khsFilter = nextF;
          state.khsPage = 1;
          document.querySelectorAll('[data-khs-filter]').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-khs-filter') === nextF);
          });
          renderKhsTableRows();
        }
        return;
      }

      const prevStBtn = e.target.closest('#grdKhsPrevStudentBtn');
      const nextStBtn = e.target.closest('#grdKhsNextStudentBtn');
      if ((prevStBtn || nextStBtn) && state.overview && Array.isArray(state.overview.matrix)) {
        const list = state.overview.matrix;
        const idx = list.findIndex(function (r) { return r.student_id === state.selectedStudentId; });
        const targetIdx = prevStBtn ? idx - 1 : idx + 1;
        if (targetIdx >= 0 && targetIdx < list.length) {
          state.selectedStudentId = list[targetIdx].student_id;
          loadKhsForSelectedStudent();
        }
        return;
      }

      const tabBtn = e.target.closest('#grdSubTablist button[data-grd-tab]');
      if (tabBtn) {
        setActiveTab(tabBtn.getAttribute('data-grd-tab'));
        return;
      }

      const sortNameBtn = e.target.closest('#grdSortNameBtn');
      if (sortNameBtn) {
        state.inputSortName = state.inputSortName === 'none'
          ? 'asc'
          : (state.inputSortName === 'asc' ? 'desc' : 'none');
        state.inputPage = 1;
        renderInputGridRows();
        return;
      }

      const subjItemBtn = e.target.closest('.grd-subject-item[data-select-subject]');
      if (subjItemBtn) {
        const nextSubj = subjItemBtn.getAttribute('data-select-subject');
        if (nextSubj && nextSubj !== state.subjectCode) {
          state.subjectCode = nextSubj;
          state.inputPage = 1;
          syncDraftFromOverview();
          renderInputPanel();
        }
        return;
      }

      const saveBtn = e.target.closest('#grdSaveBatchBtn, [data-trigger-save-grades]');
      if (saveBtn) {
        saveCurrentSubjectBatch();
        return;
      }

      const pasteBtn = e.target.closest('#grdOpenPasteModalBtn');
      if (pasteBtn) {
        const modal = document.getElementById('gradesPasteModal');
        const ta = document.getElementById('grdPasteTextarea');
        if (ta) ta.value = '';
        if (modal) modal.style.display = 'flex';
        if (ta) ta.focus();
        return;
      }

      const pubBtn = e.target.closest('#grdTogglePublishBtn');
      if (pubBtn && state.overview && state.overview.selected_period) {
        const currentlyPub = Boolean(state.overview.selected_period.is_published);
        const nextPub = !currentlyPub;
        const msg = nextPub
          ? 'Bagikan nilai ' + state.overview.selected_period.short_label + ' agar dapat dilihat oleh Orang Tua / Wali Murid?'
          : 'Sembunyikan kembali nilai ' + state.overview.selected_period.short_label + ' dari tampilan Orang Tua / Wali Murid?';
        if (!confirm(msg)) return;
        simataClient
          .withSuccessHandler(function (res) {
            alert((res && res.message) || 'Status publikasi diperbarui.');
            loadGradesOverview({ stayOnScreen: true });
          })
          .withFailureHandler(function (err) {
            alert('Gagal memperbarui status publikasi: ' + (err && err.message ? err.message : err));
          })
          .updateGradesPublication({
            academic_year_id: state.academicYearId,
            assessment_type: state.periodCode,
            is_published: nextPub
          });
        return;
      }

      const rankToggleBtn = e.target.closest('#grdToggleRankingBtn, #grdKhsToggleRankingBtn');
      if (rankToggleBtn) {
        state.showRanking = !state.showRanking;
        if (state.activeTab === 'khs') renderKhsContent();
        else renderLegerPanel();
        return;
      }

      const prtLegerBtn = e.target.closest('#grdPrintLegerMatrixBtn, #grdTopPrintLegerBtn');
      if (prtLegerBtn) {
        printMadrasahLegerMatrix();
        return;
      }

      const expCsvBtn = e.target.closest('#grdExportRdmCsvBtn, #grdExportLegerCsvBtn');
      if (expCsvBtn) {
        exportLegerCsv();
        return;
      }

      const openKhsRowBtn = e.target.closest('[data-open-khs]');
      if (openKhsRowBtn) {
        state.selectedStudentId = openKhsRowBtn.getAttribute('data-open-khs');
        setActiveTab('khs');
        return;
      }

      const parentPrevBtn = e.target.closest('#grdToggleParentPreviewBtn');
      if (parentPrevBtn) {
        state.parentPreviewMode = !state.parentPreviewMode;
        loadKhsForSelectedStudent();
        return;
      }

      const printKhsBtn = e.target.closest('#grdPrintKhsBtn');
      if (printKhsBtn) {
        printStudentKhsSheet();
        return;
      }

      const yearMgrBtn = e.target.closest('#grdOpenYearManagerBtn');
      if (yearMgrBtn) {
        openGradesYearManagerModal();
        return;
      }

      const printCfgBtn = e.target.closest('#grdOpenPrintSettingsBtn');
      if (printCfgBtn) {
        openGradesPrintSettingsModal();
        return;
      }

      const quickUnlockBtn = e.target.closest('#grdQuickUnlockYearBtn');
      if (quickUnlockBtn && state.academicYearId) {
        toggleGradesYearArchive(state.academicYearId, false);
        return;
      }

      const saveNoteBtn = e.target.closest('#grdSaveHomeroomNoteBtn');
      if (saveNoteBtn && state.selectedStudentId) {
        const noteEl = document.getElementById('grdHomeroomNoteInput');
        const val = noteEl ? noteEl.value : '';
        simataClient
          .withSuccessHandler(function (res) {
            alert((res && res.message) || 'Catatan Wali Kelas disimpan.');
            loadKhsForSelectedStudent();
          })
          .withFailureHandler(function (err) {
            alert('Gagal menyimpan catatan: ' + (err && err.message ? err.message : err));
          })
          .updateStudentGradeNote({
            academic_year_id: state.academicYearId,
            assessment_type: state.periodCode,
            student_id: state.selectedStudentId,
            homeroom_note: val
          });
      }
    });

    // Sync selection follow focus / beforematch for hidden=until-found panels
    ['grdPanelInput', 'grdPanelLeger', 'grdPanelKhs'].forEach(function (panelId) {
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.addEventListener('beforematch', function () {
          const key = panelId === 'grdPanelLeger' ? 'leger' : (panelId === 'grdPanelKhs' ? 'khs' : 'input');
          setActiveTab(key);
        });
      }
    });

    root.addEventListener('change', function (e) {
      if (e.target.id === 'grdAcademicYearSelect') {
        state.academicYearId = e.target.value;
        state.selectedStudentId = '';
        state.inputPage = 1;
        state.legerPage = 1;
        loadGradesOverview({ stayOnScreen: true });
      } else if (e.target.id === 'grdInputClassSelect' || e.target.id === 'grdLegerClassSelect' || e.target.id === 'grdKhsClassSelect') {
        state.classId = e.target.value;
        state.selectedStudentId = '';
        state.inputPage = 1;
        state.legerPage = 1;
        loadGradesOverview({ stayOnScreen: true });
      } else if (e.target.id === 'grdInputSubjectSelect') {
        state.subjectCode = e.target.value;
        state.inputPage = 1;
        syncDraftFromOverview();
        renderInputPanel();
      } else if (e.target.id === 'grdInputKkm') {
        const v = parseInputScore(e.target.value);
        if (v !== null && !Number.isNaN(v)) {
          state.kkmDraft = v;
          state.dirty = true;
          renderInputMasteryStrip();
          renderInputGridRows();
        }
      } else if (e.target.id === 'grdKhsStudentSelect') {
        state.selectedStudentId = e.target.value;
        loadKhsForSelectedStudent();
      }
    });

    root.addEventListener('input', function (e) {
      if (e.target.matches('input[data-score-for]')) {
        const sid = e.target.getAttribute('data-score-for');
        if (!state.draftScores[sid]) state.draftScores[sid] = { scoreStr: '', remarks: '' };
        state.draftScores[sid].scoreStr = e.target.value;
        state.dirty = true;
        updateSingleRowVisuals(sid);
      } else if (e.target.matches('input[data-remark-for]')) {
        const sid2 = e.target.getAttribute('data-remark-for');
        if (!state.draftScores[sid2]) state.draftScores[sid2] = { scoreStr: '', remarks: '' };
        state.draftScores[sid2].remarks = e.target.value;
        state.dirty = true;
        updateSaveButtonLabels();
      } else if (e.target.id === 'grdStudentSearchInput') {
        state.studentSearch = e.target.value;
        state.inputPage = 1;
        renderInputGridRows();
      } else if (e.target.id === 'grdLegerSearchInput') {
        state.legerSearch = e.target.value;
        state.legerPage = 1;
        renderLegerTable();
      } else if (e.target.id === 'grdKhsSearchInput') {
        state.khsSearch = e.target.value;
        state.khsPage = 1;
        renderKhsTableRows();
      }
    });

    window.goToGradesInputPage = function (page) {
      const next = Number(page) || 1;
      if (next < 1) return;
      state.inputPage = next;
      renderInputGridRows();
    };

    window.goToGradesLegerPage = function (page) {
      const next = Number(page) || 1;
      if (next < 1) return;
      state.legerPage = next;
      renderLegerTable();
    };

    window.goToGradesKhsPage = function (page) {
      const next = Number(page) || 1;
      if (next < 1) return;
      state.khsPage = next;
      renderKhsTableRows();
    };

    // Spreadsheet Enter / ArrowDown / ArrowUp navigation across score inputs (auto-advances page at boundary)
    root.addEventListener('keydown', function (e) {
      if (!e.target.matches('input[data-score-for]')) return;
      if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll('#grdInputTbody input[data-score-for]'));
      const idx = inputs.indexOf(e.target);
      if (idx === -1) return;
      const nextIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
      if (inputs[nextIdx]) {
        inputs[nextIdx].focus();
        inputs[nextIdx].select();
      } else if (e.key !== 'ArrowUp' && nextIdx >= inputs.length) {
        const allRows = (state.overview && state.overview.matrix) || [];
        const q = String(state.studentSearch || '').trim().toLowerCase();
        const total = q
          ? allRows.filter(function (r) { return (String(r.name) + ' ' + String(r.nis) + ' ' + String(r.nisn)).toLowerCase().indexOf(q) !== -1; }).length
          : allRows.length;
        const totalPages = Math.max(1, Math.ceil(total / (state.inputPageSize || 10)));
        if (state.inputPage < totalPages) {
          state.inputPage += 1;
          renderInputGridRows();
          const firstNext = document.querySelector('#grdInputTbody input[data-score-for]');
          if (firstNext) { firstNext.focus(); firstNext.select(); }
        }
      }
    });
  }

  function openRdmSettingsModal() {
    const ov = state.overview;
    if (!ov || !ov.viewer || !ov.viewer.is_admin) return;
    const modal = document.getElementById('gradesRdmSettingsModal');
    const ps = ov.portal_settings || {};
    const urlEl = document.getElementById('grdCfgRdmUrl');
    if (urlEl) urlEl.value = ps.rdm_url || '';
    if (modal) modal.style.display = 'flex';
  }

  window.closeGradesRdmSettingsModal = function () {
    const modal = document.getElementById('gradesRdmSettingsModal');
    if (modal) modal.style.display = 'none';
  };

  window.testGradesRdmUrl = function () {
    const urlEl = document.getElementById('grdCfgRdmUrl');
    let raw = urlEl ? urlEl.value.trim() : '';
    if (!raw) {
      alert('Masukkan alamat URL / Domain Portal RDM terlebih dahulu untuk diuji.');
      if (urlEl) urlEl.focus();
      return;
    }
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    window.open(raw, '_blank', 'noopener,noreferrer');
  };

  window.saveGradesRdmSettings = function () {
    const urlEl = document.getElementById('grdCfgRdmUrl');

    simataClient
      .withSuccessHandler(function (res) {
        window.closeGradesRdmSettingsModal();
        alert((res && res.message) || 'Tautan Portal RDM berhasil disimpan.');
        loadGradesOverview({ stayOnScreen: true });
      })
      .withFailureHandler(function (err) {
        alert('Gagal menyimpan tautan RDM: ' + (err && err.message ? err.message : err));
      })
      .updateGradesPortalSettings({
        rdm_url: urlEl ? urlEl.value.trim() : ''
      });
  };

  function openGradesPrintSettingsModal() {
    const ov = state.overview;
    if (!ov || !ov.viewer || !ov.viewer.is_admin) return;
    const modal = document.getElementById('gradesPrintSettingsModal');
    const ps = ov.portal_settings || {};
    const prinEl = document.getElementById('grdCfgPrincipalName');
    if (prinEl) prinEl.value = ps.principal_name || 'Moch. Iqnaul Badril Falah, S.Ag';
    if (modal) modal.style.display = 'flex';
  }

  window.closeGradesPrintSettingsModal = function () {
    const modal = document.getElementById('gradesPrintSettingsModal');
    if (modal) modal.style.display = 'none';
  };

  window.saveGradesPrintSettings = function () {
    const prinEl = document.getElementById('grdCfgPrincipalName');
    simataClient
      .withSuccessHandler(function (res) {
        window.closeGradesPrintSettingsModal();
        alert((res && res.message) || 'Pengaturan kop cetak berhasil disimpan.');
        loadGradesOverview({ stayOnScreen: true });
      })
      .withFailureHandler(function (err) {
        alert('Gagal menyimpan pengaturan cetak: ' + (err && err.message ? err.message : err));
      })
      .updateGradesPortalSettings({
        principal_name: prinEl ? prinEl.value.trim() : 'Moch. Iqnaul Badril Falah, S.Ag'
      });
  };

  function renderYearArchiveList(years) {
    const host = document.getElementById('grdYearArchiveListHost');
    if (!host) return;
    if (!Array.isArray(years) || years.length === 0) {
      host.innerHTML = '<div style="color:#64748b;font-size:13px;">Belum ada data tahun ajaran.</div>';
      return;
    }
    host.innerHTML = years.map(function (y) {
      const itemCls = y.is_archived ? ' grd-year-item--archived' : (y.is_active ? ' grd-year-item--active' : '');
      const statusChip = y.is_archived
        ? '<span class="grd-chip grd-chip--amber">Arsip Terkunci</span>'
        : (y.is_active
            ? '<span class="grd-chip grd-chip--emerald">Tahun Aktif</span>'
            : '<span class="grd-chip grd-chip--slate">Non-Aktif</span>');
      const openBtn = '<button type="button" class="grd-btn grd-btn--secondary" style="min-height:32px;padding:0 10px;font-size:12px;" onclick="selectGradesAcademicYear(\'' + esc(y.academic_year_id) + '\')">Buka</button>';
      const archBtn = y.is_archived
        ? '<button type="button" class="grd-btn grd-btn--secondary" style="min-height:32px;padding:0 10px;font-size:12px;" onclick="toggleGradesYearArchive(\'' + esc(y.academic_year_id) + '\', false)">Buka Kunci</button>'
        : '<button type="button" class="grd-btn grd-btn--amber" style="min-height:32px;padding:0 10px;font-size:12px;" onclick="toggleGradesYearArchive(\'' + esc(y.academic_year_id) + '\', true)">Arsipkan &amp; Kunci</button>';
      const actBtn = !y.is_active
        ? '<button type="button" class="grd-btn grd-btn--soft" style="min-height:32px;padding:0 10px;font-size:12px;" onclick="activateGradesAcademicYear(\'' + esc(y.academic_year_id) + '\')">Jadikan Aktif</button>'
        : '';
      return '<div class="grd-year-item' + itemCls + '">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<strong style="font-size:14px;color:#0f172a;">' + esc(y.academic_year_id) + '</strong>' +
            statusChip +
          '</div>' +
          '<div style="font-size:12px;color:#475569;margin-top:3px;">' +
            esc(y.name || ('Tahun Ajaran ' + y.academic_year_id)) + ' &bull; ' +
            Number(y.total_students || 0) + ' siswa &bull; ' +
            Number(y.total_grades || 0).toLocaleString('id-ID') + ' nilai tersimpan' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + openBtn + actBtn + archBtn + '</div>' +
      '</div>';
    }).join('');
  }

  function openGradesYearManagerModal() {
    const ov = state.overview;
    if (!ov || !ov.viewer || !ov.viewer.is_admin) return;
    const modal = document.getElementById('gradesYearArchiveModal');
    const idEl = document.getElementById('grdNewYearId');
    const nameEl = document.getElementById('grdNewYearName');

    // Suggest next sequential academic year (e.g., 2026/2027 -> 2027/2028)
    const years = ov.academic_years || [];
    if (idEl && years.length > 0) {
      const maxStart = Math.max.apply(null, years.map(function (y) { return parseInt(String(y.academic_year_id).split('/')[0], 10) || 2026; }));
      const nextId = (maxStart + 1) + '/' + (maxStart + 2);
      idEl.value = nextId;
      if (nameEl) nameEl.value = 'Tahun Ajaran ' + nextId;
    }

    renderYearArchiveList(years);
    if (modal) modal.style.display = 'flex';
  }

  window.closeGradesYearManagerModal = function () {
    const modal = document.getElementById('gradesYearArchiveModal');
    if (modal) modal.style.display = 'none';
  };

  window.selectGradesAcademicYear = function (yearId) {
    window.closeGradesYearManagerModal();
    state.academicYearId = yearId;
    state.selectedStudentId = '';
    loadGradesOverview({ stayOnScreen: true });
  };

  window.createNewGradesAcademicYear = function () {
    const idEl = document.getElementById('grdNewYearId');
    const nameEl = document.getElementById('grdNewYearName');
    const setActiveEl = document.getElementById('grdNewYearSetActive');
    const archPrevEl = document.getElementById('grdNewYearArchivePrev');
    const copySubjEl = document.getElementById('grdNewYearCopySubjects');
    const btn = document.getElementById('grdCreateYearBtn');

    const newYearId = idEl ? idEl.value.trim() : '';
    if (!/^\d{4}\/\d{4}$/.test(newYearId)) {
      alert('Format Tahun Ajaran harus YYYY/YYYY, contoh: 2027/2028.');
      if (idEl) idEl.focus();
      return;
    }

    if (btn) btn.disabled = true;
    const activeYr = state.overview && state.overview.active_academic_year ? state.overview.active_academic_year.academic_year_id : '';
    simataClient
      .withSuccessHandler(function (res) {
        if (btn) btn.disabled = false;
        alert((res && res.message) || ('Tahun Ajaran ' + newYearId + ' berhasil ditambahkan.'));
        if (res && res.data && Array.isArray(res.data.academic_years)) {
          renderYearArchiveList(res.data.academic_years);
        }
        state.academicYearId = newYearId;
        loadGradesOverview({ stayOnScreen: true });
      })
      .withFailureHandler(function (err) {
        if (btn) btn.disabled = false;
        alert('Gagal menambah tahun ajaran: ' + (err && err.message ? err.message : err));
      })
      .createGradesAcademicYear({
        academic_year_id: newYearId,
        name: nameEl ? nameEl.value.trim() : ('Tahun Ajaran ' + newYearId),
        set_active: setActiveEl ? setActiveEl.checked : true,
        archive_previous: archPrevEl ? archPrevEl.checked : false,
        copy_subjects_from_year: (copySubjEl && copySubjEl.checked) ? activeYr : ''
      });
  };

  window.toggleGradesYearArchive = function (yearId, shouldArchive) {
    const msg = shouldArchive
      ? 'Arsipkan dan kunci Tahun Ajaran ' + yearId + '? Nilai lama tetap bisa dilihat, diekspor, dan dicetak tetapi tidak dapat diubah sembarangan.'
      : 'Buka kunci arsip Tahun Ajaran ' + yearId + ' sementara agar nilai dapat direvisi?';
    if (!confirm(msg)) return;
    simataClient
      .withSuccessHandler(function (res) {
        alert((res && res.message) || 'Status arsip diperbarui.');
        if (res && res.data && Array.isArray(res.data.academic_years)) {
          renderYearArchiveList(res.data.academic_years);
        }
        loadGradesOverview({ stayOnScreen: true });
      })
      .withFailureHandler(function (err) {
        alert('Gagal memperbarui status arsip: ' + (err && err.message ? err.message : err));
      })
      .setGradesYearArchive({
        academic_year_id: yearId,
        is_archived: Boolean(shouldArchive)
      });
  };

  window.activateGradesAcademicYear = function (yearId) {
    if (!confirm('Jadikan Tahun Ajaran ' + yearId + ' sebagai Tahun Ajaran Aktif di SIMATA?')) return;
    simataClient
      .withSuccessHandler(function (res) {
        alert((res && res.message) || ('Tahun Ajaran ' + yearId + ' diaktifkan.'));
        if (res && res.data && Array.isArray(res.data.academic_years)) {
          renderYearArchiveList(res.data.academic_years);
        }
        state.academicYearId = yearId;
        loadGradesOverview({ stayOnScreen: true });
      })
      .withFailureHandler(function (err) {
        alert('Gagal mengaktifkan tahun ajaran: ' + (err && err.message ? err.message : err));
      })
      .activateGradesAcademicYear({ academic_year_id: yearId });
  };

  window.closeGradesPasteModal = function () {
    const modal = document.getElementById('gradesPasteModal');
    if (modal) modal.style.display = 'none';
  };

  window.applyGradesExcelPaste = function () {
    const ta = document.getElementById('grdPasteTextarea');
    if (!ta || !state.overview) return;
    const lines = String(ta.value || '').replace(/\r\n/g, '\n').split('\n').map(function (l) { return l.trim(); });
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length === 0) {
      window.closeGradesPasteModal();
      return;
    }

    const matrix = state.overview.matrix || [];
    let applied = 0;
    for (let i = 0; i < Math.min(lines.length, matrix.length); i++) {
      const cellVal = lines[i].split('\t')[0].trim();
      const sid = matrix[i].student_id;
      if (!state.draftScores[sid]) state.draftScores[sid] = { scoreStr: '', remarks: '' };
      if (cellVal !== '') {
        const parsed = parseInputScore(cellVal);
        if (!Number.isNaN(parsed) && parsed !== null) {
          state.draftScores[sid].scoreStr = fmtScore(parsed, 2);
          applied++;
        }
      }
    }
    state.dirty = true;
    window.closeGradesPasteModal();
    renderInputMasteryStrip();
    renderInputGridRows();
    alert('Berhasil menempelkan ' + applied + ' baris nilai dari Excel. Klik "Simpan Nilai Kelas" untuk menyimpan ke database.');
  };

  window.__simataOpenGradesModule = function () {
    bindEventsOnce();
    loadGradesOverview();
  };
})(window);
