const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const schedulesRepo = require('../src/repositories/schedules.repository');
const schedulesService = require('../src/services/schedules.service');

async function runBug64ResponderScheduleGuardTests() {
  console.log('\n===============================================================');
  console.log('BUG 64: RESPONDER SCHEDULE SOFT-GUARD & GURU AUTO-SELECT SUITE');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'public/css/dashboard.css'), 'utf8');

  // 1. Validate HTML & CSS elements and inline JS compilation
  assert.ok(html.includes('id="rg_scheduleMatchStatus"'), 'Responder form must include live #rg_scheduleMatchStatus pill');
  assert.ok(html.includes('<dialog id="rgScheduleConfirmDialog" class="sched-dialog" closedby="any"'), 'Responder must define #rgScheduleConfirmDialog with closedby="any"');
  assert.ok(html.includes('id="rgScheduleSubstituteCheck"'), 'Soft-guard dialog must allow marking substitute teacher note');
  assert.ok(css.includes('.rg-sched-match-status.is-match') && css.includes('.rg-sched-match-status.is-warn'), 'CSS must style match and warn states');
  assert.ok(html.includes("String(currentResponderUser.role || '').toLowerCase() === 'guru'"), 'populateResponderTeachers must auto-default logged-in Guru');

  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let compiled = 0;
  while ((m = scriptRegex.exec(html)) !== null) {
    if (!m[1].trim()) continue;
    new vm.Script(m[1], { filename: `dashboard.inline.${++compiled}.js` });
  }
  assert.ok(compiled >= 2, 'dashboard.html inline scripts must compile');

  // 2. Test evaluateResponderScheduleMatch() directly from dashboard.html inside VM sandbox
  const startIdx = html.indexOf('let responderScheduleGuardState = {');
  const endIdx = html.indexOf('function updateResponderScheduleMatchIndicator()', startIdx);
  assert.ok(startIdx > 0 && endIdx > startIdx, 'Must locate evaluateResponderScheduleMatch block in dashboard.html');
  const matchCode = html.slice(startIdx, endIdx);

  const mockEls = {
    rg_teacherId: {
      value: 'TCH-A',
      selectedIndex: 0,
      options: [{ textContent: 'A. MUAFAQ, S.Pd', getAttribute: () => 'A. MUAFAQ, S.Pd' }]
    },
    rg_classId: {
      value: 'CLS-10',
      selectedIndex: 0,
      options: [{ textContent: 'Kelas 10', getAttribute: () => 'Kelas 10' }]
    },
    rg_subject: { value: 'Geografi' }
  };
  let mockCheckedPeriods = ['2', '3'];

  const sandbox = {
    document: {
      getElementById: (id) => mockEls[id] || null,
      querySelectorAll: () => mockCheckedPeriods.map((v) => ({ value: v }))
    },
    Array, Set, Number, String, Boolean, console
  };
  vm.createContext(sandbox);
  sandbox.__setGuardState = null;
  vm.runInContext(
    `${matchCode}\nfunction __setGuardState(next) { responderScheduleGuardState = next; }`,
    sandbox
  );

  const daySlots = [
    { period_number: 2, class_id: 'CLS-10', class_name: 'Kelas 10', teacher_id: 'TCH-A', teacher_name: 'A. MUAFAQ, S.Pd', subject_name: 'Geografi', subject_code: 'GEO' },
    { period_number: 3, class_id: 'CLS-10', class_name: 'Kelas 10', teacher_id: 'TCH-A', teacher_name: 'A. MUAFAQ, S.Pd', subject_name: 'Geografi', subject_code: 'GEO' },
    { period_number: 2, class_id: 'CLS-11', class_name: 'Kelas 11', teacher_id: 'TCH-B', teacher_name: 'YUYUN YULIANINGSIH, S.Sos', subject_name: 'Sosiologi', subject_code: 'SOS' },
    { period_number: 3, class_id: 'CLS-11', class_name: 'Kelas 11', teacher_id: 'TCH-B', teacher_name: 'YUYUN YULIANINGSIH, S.Sos', subject_name: 'Sosiologi', subject_code: 'SOS' }
  ];

  const baseGuardState = {
    loaded: true,
    isSchoolDay: true,
    dayLabel: 'Selasa',
    timeWib: '07:50',
    teacherId: 'TCH-A',
    todayTeacherBlocks: [
      { periods: [2, 3], class_id: 'CLS-10', class_name: 'Kelas 10', subject_name: 'Geografi' }
    ],
    daySlots
  };
  sandbox.__setGuardState(baseGuardState);

  // Case A: Exact match
  const matchRes = sandbox.evaluateResponderScheduleMatch();
  assert.strictEqual(matchRes.status, 'match', 'Exact scheduled teacher+class+periods+subject must report match');
  assert.strictEqual(matchRes.warnings.length, 0);

  // Case B: Wrong class picked by TCH-A (CLS-11 instead of CLS-10 on period 2-3 -> occupied by TCH-B & TCH-A belongs in CLS-10!)
  mockEls.rg_classId.value = 'CLS-11';
  mockEls.rg_classId.options[0].getAttribute = () => 'Kelas 11';
  const wrongClassRes = sandbox.evaluateResponderScheduleMatch();
  assert.strictEqual(wrongClassRes.status, 'mismatch', 'Selecting another class occupied at that period must report mismatch');
  assert.ok(wrongClassRes.warnings.some((w) => w.includes('YUYUN YULIANINGSIH')), 'Must tell operator who officially teaches that slot');
  assert.ok(wrongClassRes.warnings.some((w) => w.includes('terjadwal di Kelas 10')), 'Must remind teacher of their own scheduled class');

  // Case C: Wrong subject on right class & period
  mockEls.rg_classId.value = 'CLS-10';
  mockEls.rg_classId.options[0].getAttribute = () => 'Kelas 10';
  mockEls.rg_subject.value = 'Matematika';
  const wrongSubjRes = sandbox.evaluateResponderScheduleMatch();
  assert.strictEqual(wrongSubjRes.status, 'mismatch', 'Different subject must warn operator cleanly');
  assert.ok(wrongSubjRes.warnings.some((w) => w.includes('Geografi')));

  // Case D: Unscheduled period (Jam ke-6)
  mockEls.rg_subject.value = 'Geografi';
  mockCheckedPeriods = ['6'];
  const unscheduledRes = sandbox.evaluateResponderScheduleMatch();
  assert.strictEqual(unscheduledRes.status, 'mismatch', 'Unscheduled period must warn without blocking');

  // Case E: Non-school day (Jumat)
  sandbox.__setGuardState({ ...baseGuardState, isSchoolDay: false, dayLabel: 'Jumat' });
  const holidayRes = sandbox.evaluateResponderScheduleMatch();
  assert.strictEqual(holidayRes.status, 'holiday', 'Non-school day must return holiday info rather than mismatch');

  console.log('1. PASS: Frontend Soft-Guard UI, dialog, Guru auto-select & evaluateResponderScheduleMatch scenarios verified.');

  // 3. Verify backend schedulesService.getActiveNowForResponder includes day_slots without error
  const origGetYears = schedulesRepo.getAcademicYears;
  const origDetectSem = schedulesRepo.detectBestSemesterForYear;
  const origGetPeriods = schedulesRepo.getPeriods;
  const origGetSlots = schedulesRepo.getSlotsForDay;
  try {
    schedulesRepo.getAcademicYears = async () => [{ academic_year_id: '2026/2027', name: '2026/2027', is_active: true }];
    schedulesRepo.detectBestSemesterForYear = async () => 'Ganjil';
    schedulesRepo.getPeriods = async () => [{ period_number: 2, label: 'Jam ke-2', start_time: '07:40', end_time: '08:10', is_break: false }];
    schedulesRepo.getSlotsForDay = async () => daySlots;

    const nowSchoolDay = await schedulesService.getActiveNowForResponder({ teacher_id: 'TCH-A', day_of_week: 2, time_wib: '07:50' });
    assert.strictEqual(nowSchoolDay.is_school_day, true);
    assert.strictEqual(nowSchoolDay.day_slots.length, 4, 'getActiveNowForResponder must return all day_slots for Soft-Guard cross-checking');
    assert.strictEqual(nowSchoolDay.today_teacher_blocks.length, 1, 'today_teacher_blocks must still filter to selected teacher_id');

    const nowFriday = await schedulesService.getActiveNowForResponder({ teacher_id: 'TCH-A', day_of_week: 5, time_wib: '08:00' });
    assert.strictEqual(nowFriday.is_school_day, false);
    assert.deepStrictEqual(nowFriday.day_slots, []);
  } finally {
    schedulesRepo.getAcademicYears = origGetYears;
    schedulesRepo.detectBestSemesterForYear = origDetectSem;
    schedulesRepo.getPeriods = origGetPeriods;
    schedulesRepo.getSlotsForDay = origGetSlots;
  }

  console.log('2. PASS: Backend getActiveNowForResponder day_slots contract verified.');
  console.log('===============================================================');
  console.log('BUG 64 RESPONDER SCHEDULE GUARD: ALL TESTS PASSED (GREEN)');
  console.log('===============================================================');
  return true;
}

if (require.main === module) {
  runBug64ResponderScheduleGuardTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 64 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug64ResponderScheduleGuardTests;
