const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const schedulesRepo = require('../src/repositories/schedules.repository');
const schedulesService = require('../src/services/schedules.service');
const notificationsService = require('../src/services/notifications.service');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');

function assertCssBalanced(cssText, name) {
  let depth = 0;
  for (const ch of cssText) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    assert.ok(depth >= 0, `${name} has unexpected closing brace`);
  }
  assert.strictEqual(depth, 0, `${name} must have balanced curly braces`);
}

async function runBug67PbNonKbmTests() {
  console.log('\n===============================================================');
  console.log('BUG 67: PEMBELAJARAN BAHASA (PB) & NON-KBM HIGHLIGHT SUITE');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(rootDir, 'public/css/style.css'), 'utf8');
  const dashCss = fs.readFileSync(path.join(rootDir, 'public/css/dashboard.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  assertCssBalanced(styleCss, 'style.css');
  assertCssBalanced(dashCss, 'dashboard.css');

  for (const token of [
    '.period-checkbox-label.is-nonkbm-period',
    '.period-checkbox-label.is-nonkbm-period.is-pb-period',
    '.period-nonkbm-badge',
    '.simata-nonkbm-notice-bar'
  ]) {
    assert.ok(styleCss.includes(token), `style.css must define ${token}`);
  }
  for (const token of ['.rpt-nonkbm-cell', '.rpt-nonkbm-badge', '.rpt-nonkbm-th-tag', '.rpt-nonkbm-legend-note']) {
    assert.ok(dashCss.includes(token), `dashboard.css must define ${token}`);
  }
  for (const token of [
    '/css/style.css?v=bug67pb',
    '/css/dashboard.css?v=bug67pb',
    'window.simataNonKbmHelper',
    'col-status-nonkbm',
    'rpt-nonkbm-legend-note'
  ]) {
    assert.ok(html.includes(token), `dashboard.html must contain ${token}`);
  }
  assert.ok(clientJs.includes("qs.set('date', params.date)"), 'simata-client.js getScheduleActiveNow must forward date param');

  // Compile all inline scripts + simata-client.js
  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let compiled = 0;
  while ((m = scriptRegex.exec(html)) !== null) {
    if (!m[1].trim()) continue;
    new vm.Script(m[1], { filename: `dashboard.bug67.${++compiled}.js` });
  }
  new vm.Script(clientJs, { filename: 'simata-client.bug67.js' });
  console.log(`1. PASS: CSS braces, cache-bust tags, and ${compiled} inline scripts compiled cleanly.`);

  // 2. Test simataNonKbmHelper in VM sandbox
  const helperStart = html.indexOf('(function initSimataNonKbmHelperModule() {');
  const helperEnd = html.indexOf('</script>', helperStart);
  assert.ok(helperStart > 0 && helperEnd > helperStart, 'Must locate simataNonKbmHelper block');
  const helperCode = html.slice(helperStart, helperEnd);
  const helperSandbox = {
    window: {},
    document: { querySelector: () => null, getElementById: () => null },
    Map, Set, Array, Object, Number, String, Boolean, Date, Promise, console
  };
  helperSandbox.window = helperSandbox;
  vm.createContext(helperSandbox);
  vm.runInContext(helperCode, helperSandbox);

  assert.ok(helperSandbox.simataNonKbmHelper, 'simataNonKbmHelper must register on window');
  helperSandbox.simataNonKbmHelper.hydrateFromDayPayload('2026-11-23', {
    is_school_day: true,
    day_label: 'Senin',
    current_period: { period_number: 2, match_state: 'ACTIVE' },
    non_kbm_by_class: {
      'CLS-10': {
        1: { subject_code: 'UPACARA', subject_name: 'Upacara Bendera', short_badge: 'UP' },
        2: { subject_code: 'PB', subject_name: 'Pembelajaran Bahasa (Pembina)', short_badge: 'PB' }
      }
    },
    global_non_kbm_periods: {
      1: { subject_code: 'UPACARA', subject_name: 'Upacara Bendera', short_badge: 'UP' },
      2: { subject_code: 'PB', subject_name: 'Pembelajaran Bahasa (Pembina)', short_badge: 'PB' }
    }
  });
  const monP1 = helperSandbox.simataNonKbmHelper.getNonKbmInfo('2026-11-23', 1, 'CLS-10');
  const monP2 = helperSandbox.simataNonKbmHelper.getNonKbmInfo('2026-11-23', 2, 'CLS-10');
  const monP3 = helperSandbox.simataNonKbmHelper.getNonKbmInfo('2026-11-23', 3, 'CLS-10');
  assert.strictEqual(monP1.short_badge, 'UP');
  assert.strictEqual(monP1.isUpacara, true);
  assert.strictEqual(monP2.short_badge, 'PB');
  assert.strictEqual(monP2.isPb, true);
  assert.strictEqual(monP3, null);
  assert.strictEqual(
    helperSandbox.simataNonKbmHelper.getDefaultKbmPeriod('2026-11-23', 'CLS-10'),
    3,
    'getDefaultKbmPeriod must skip UP (1) and PB (2) and default to Jam ke-3 on Senin'
  );
  console.log('2. PASS: Frontend simataNonKbmHelper classification and default KBM period selection verified.');

  // 3. Test backend getActiveNowForResponder with date override & Non-KBM summary maps
  const mondaySlots = [
    { period_number: 1, class_id: 'CLS-10', class_name: 'Kelas 10', subject_id: 'SUBJ-UPACARA', subject_code: 'UPACARA', subject_name: 'Upacara Bendera', subject_category: 'NON_KBM', teacher_id: null },
    { period_number: 1, class_id: 'CLS-11', class_name: 'Kelas 11', subject_id: 'SUBJ-UPACARA', subject_code: 'UPACARA', subject_name: 'Upacara Bendera', subject_category: 'NON_KBM', teacher_id: null },
    { period_number: 2, class_id: 'CLS-10', class_name: 'Kelas 10', subject_id: 'SUBJ-PB', subject_code: 'PB', subject_name: 'Pembelajaran Bahasa (Pembina)', subject_category: 'NON_KBM', teacher_id: null },
    { period_number: 2, class_id: 'CLS-11', class_name: 'Kelas 11', subject_id: 'SUBJ-PB', subject_code: 'PB', subject_name: 'Pembelajaran Bahasa (Pembina)', subject_category: 'NON_KBM', teacher_id: null },
    { period_number: 3, class_id: 'CLS-10', class_name: 'Kelas 10', subject_id: 'SUBJ-KIMIA', subject_code: 'KIMIA', subject_name: 'Kimia', subject_category: 'KBM', teacher_id: 'TCH-E', teacher_name: 'UMI ASROH, S.Pd' }
  ];

  const origGetYears = schedulesRepo.getAcademicYears;
  const origDetectSem = schedulesRepo.detectBestSemesterForYear;
  const origGetPeriods = schedulesRepo.getPeriods;
  const origGetSlots = schedulesRepo.getSlotsForDay;
  try {
    schedulesRepo.getAcademicYears = async () => [{ academic_year_id: '2026/2027', name: '2026/2027', is_active: true }];
    schedulesRepo.detectBestSemesterForYear = async () => 'GANJIL';
    schedulesRepo.getPeriods = async () => [
      { period_number: 1, label: 'Jam ke-1', start_time: '07:00', end_time: '07:40', is_break: false },
      { period_number: 2, label: 'Jam ke-2', start_time: '07:40', end_time: '08:10', is_break: false },
      { period_number: 3, label: 'Jam ke-3', start_time: '08:10', end_time: '08:40', is_break: false }
    ];
    let capturedDayOfWeek = null;
    schedulesRepo.getSlotsForDay = async (_y, _s, dow) => {
      capturedDayOfWeek = dow;
      return mondaySlots;
    };

    const mondayRes = await schedulesService.getActiveNowForResponder({ date: '2026-11-23', time_wib: '07:50' });
    assert.strictEqual(capturedDayOfWeek, 1, '2026-11-23 must resolve to Senin (1)');
    assert.strictEqual(mondayRes.non_kbm_slots.length, 4);
    assert.strictEqual(mondayRes.global_non_kbm_periods[1].short_badge, 'UP');
    assert.strictEqual(mondayRes.global_non_kbm_periods[2].short_badge, 'PB');
    assert.strictEqual(mondayRes.global_non_kbm_periods[3], undefined, 'KBM period 3 must not be marked global non-kbm');
    assert.strictEqual(mondayRes.non_kbm_by_class['CLS-10'][2].subject_code, 'PB');
  } finally {
    schedulesRepo.getAcademicYears = origGetYears;
    schedulesRepo.detectBestSemesterForYear = origDetectSem;
    schedulesRepo.getPeriods = origGetPeriods;
    schedulesRepo.getSlotsForDay = origGetSlots;
  }
  console.log('3. PASS: Backend getActiveNowForResponder date derivation and Non-KBM summary maps verified.');

  // 4. Verify notification exemption when a class has ONLY NON_KBM slots (must not fallback to period 1!)
  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));
  const origGetSettings = notificationsService.getRawSettingsState;
  const origNotifSched = schedulesService.getActiveNowForResponder;
  const origNotifOverview = schedulesService.getOverview;
  try {
    notificationsService.getRawSettingsState = async () => ({
      rules: {
        school_end_time: '13:00',
        teacher_remind_time: '12:30',
        upcoming_class_lead_minutes: 15,
        enable_class_incomplete: true,
        enable_teacher_forgot: false,
        enable_schedule_conflict: false,
        enable_responder: false,
        enable_early_warning_alpha: false,
        enable_upcoming_teaching: false,
        enable_daily_digest: false,
        enable_academic_kts: false,
        enable_finance_grades: false,
        custom_holidays: []
      },
      broadcasts: [],
      events: []
    });
    schedulesService.getActiveNowForResponder = async () => ({
      is_school_day: true,
      day_label: 'Senin',
      day_slots: (testDbEngine.classes || []).map((c) => ({
        class_id: c.class_id,
        period_number: 1,
        subject_category: 'NON_KBM',
        subject_code: 'PB',
        teacher_id: null
      }))
    });
    schedulesService.getOverview = async () => ({ periods: [], summary: { conflict_count: 0 } });

    const feedRes = await notificationsService.getNotificationsFeed({
      user: { user_id: 'USR-ADMIN', role: 'ADMIN' },
      date: '2026-11-23',
      day_of_week: 1,
      time_wib: '13:15'
    });
    const clsNotif = (feedRes.feed || []).find((n) => String(n.id).startsWith('class-incomplete-'));
    assert.ok(clsNotif, 'Class completeness card must be generated');
    assert.strictEqual(clsNotif.resolved, true, 'Classes with only NON_KBM (PB) slots must auto-resolve as complete');
  } finally {
    notificationsService.getRawSettingsState = origGetSettings;
    schedulesService.getActiveNowForResponder = origNotifSched;
    schedulesService.getOverview = origNotifOverview;
  }
  console.log('4. PASS: Notifications auto-exempts NON_KBM / PB periods without false fallback to period 1.');

  console.log('===============================================================');
  console.log('BUG 67 PEMBELAJARAN BAHASA (PB) & NON-KBM: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug67PbNonKbmTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 67 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug67PbNonKbmTests;
