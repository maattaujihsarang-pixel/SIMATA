const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const {
  ACTIVE_DAYS,
  DEFAULT_PERIODS,
  DEFAULT_SUBJECTS,
  TEACHER_CODE_CATALOG_2026,
  SCHEDULE_GRID_2026_GANJIL,
  normalizeSubjectCode,
  matchTeacherRow
} = require('../src/services/schedule-seed.service');

function createScheduleAwareMockHandler() {
  const store = {
    subjects: DEFAULT_SUBJECTS.map((s) => ({ ...s, is_active: true })),
    periods: [],
    teacherCodes: [],
    slots: []
  };

  return {
    store,
    async handler(text, params = []) {
      const q = String(text || '').trim();

      if (q.includes('FROM subjects') && q.includes('WHERE subject_id = $1')) {
        const s = store.subjects.find((x) => x.subject_id === params[0]);
        return { rows: s ? [{ ...s }] : [], rowCount: s ? 1 : 0 };
      }
      if (q.includes('FROM subjects')) {
        return { rows: store.subjects.map((s) => ({ ...s })), rowCount: store.subjects.length };
      }
      if (q.includes('INSERT INTO subjects')) {
        const idx = store.subjects.findIndex((s) => s.code === params[1]);
        const row = { subject_id: params[0], code: params[1], name: params[2], category: params[3], color_tone: params[4], is_active: true };
        if (idx >= 0) {
          if (!q.includes('DO NOTHING')) store.subjects[idx] = row;
        } else {
          store.subjects.push(row);
        }
        return { rows: [row], rowCount: 1 };
      }
      if (q.includes('DELETE FROM subjects WHERE subject_id = $1')) {
        const len = store.subjects.length;
        store.subjects = store.subjects.filter((s) => s.subject_id !== params[0]);
        return { rows: [], rowCount: len - store.subjects.length };
      }

      if (q.includes('SELECT COUNT(*)::int AS cnt FROM schedule_periods')) {
        const cnt = store.periods.filter((p) => p.academic_year_id === params[0] && p.semester === params[1]).length;
        return { rows: [{ cnt }], rowCount: 1 };
      }
      if (q.includes('INSERT INTO schedule_periods')) {
        const row = {
          period_config_id: params[0], academic_year_id: params[1], semester: params[2],
          sort_order: Number(params[3]), period_number: params[4] !== null ? Number(params[4]) : null,
          label: params[5], start_time: params[6], end_time: params[7], is_break: Boolean(params[8])
        };
        const dup = store.periods.some((p) => p.academic_year_id === row.academic_year_id && p.semester === row.semester && p.sort_order === row.sort_order);
        if (!dup) store.periods.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (q.includes('DELETE FROM schedule_periods WHERE academic_year_id = $1 AND semester = $2')) {
        store.periods = store.periods.filter((p) => !(p.academic_year_id === params[0] && p.semester === params[1]));
        return { rows: [], rowCount: 1 };
      }
      if (q.includes('FROM schedule_periods')) {
        const rows = store.periods
          .filter((p) => p.academic_year_id === params[0] && p.semester === params[1])
          .sort((a, b) => a.sort_order - b.sort_order);
        return { rows, rowCount: rows.length };
      }

      if (q.includes('SELECT semester, COUNT(*)::int AS cnt') && q.includes('FROM class_schedules')) {
        const map = new Map();
        store.slots.filter((s) => s.academic_year_id === params[0]).forEach((s) => {
          map.set(s.semester, (map.get(s.semester) || 0) + 1);
        });
        const rows = Array.from(map.entries()).map(([semester, cnt]) => ({ semester, cnt })).sort((a, b) => b.cnt - a.cnt);
        return { rows, rowCount: rows.length };
      }
      if (q.includes('FROM class_schedules cs') && q.includes('AND cs.teacher_id = $5')) {
        const hit = store.slots.find((s) =>
          s.academic_year_id === params[0] && s.semester === params[1] &&
          Number(s.day_of_week) === Number(params[2]) && Number(s.period_number) === Number(params[3]) &&
          s.teacher_id === params[4] && s.class_id !== params[5]
        );
        if (!hit) return { rows: [], rowCount: 0 };
        const cls = testDbEngine.classes.find((c) => c.class_id === hit.class_id) || {};
        const sub = store.subjects.find((x) => x.subject_id === hit.subject_id) || {};
        const tch = testDbEngine.teachers.find((t) => t.teacher_id === hit.teacher_id) || {};
        return {
          rows: [{
            schedule_id: hit.schedule_id,
            class_id: hit.class_id,
            class_name: cls.class_name || hit.class_id,
            subject_name: sub.name || 'Mapel',
            subject_code: sub.code || 'MPL',
            teacher_name: tch.name || 'Guru'
          }],
          rowCount: 1
        };
      }
      if (q.includes('INSERT INTO class_schedules')) {
        const row = {
          schedule_id: params[0],
          academic_year_id: params[1],
          semester: params[2],
          day_of_week: Number(params[3]),
          period_number: Number(params[4]),
          class_id: params[5],
          subject_id: params[6],
          teacher_id: params[7] || null,
          note: params[8] || null
        };
        if (row.teacher_id) {
          const tDup = store.slots.find((s) =>
            s.academic_year_id === row.academic_year_id && s.semester === row.semester &&
            s.day_of_week === row.day_of_week && s.period_number === row.period_number &&
            s.teacher_id === row.teacher_id && s.class_id !== row.class_id
          );
          if (tDup) {
            const err = new Error('duplicate teacher slot');
            err.code = '23505';
            throw err;
          }
        }
        const idx = store.slots.findIndex((s) =>
          s.academic_year_id === row.academic_year_id && s.semester === row.semester &&
          s.day_of_week === row.day_of_week && s.period_number === row.period_number &&
          s.class_id === row.class_id
        );
        if (idx >= 0) {
          if (!q.includes('DO NOTHING')) store.slots[idx] = row;
          return { rows: [store.slots[idx]], rowCount: q.includes('DO NOTHING') ? 0 : 1 };
        }
        store.slots.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (q.includes('FROM class_schedules cs') && q.includes('WHERE cs.academic_year_id = $1 AND cs.semester = $2') && !q.includes('JOIN subjects')) {
        const rows = store.slots
          .filter((s) => s.academic_year_id === params[0] && s.semester === params[1])
          .map((s) => {
            const cls = testDbEngine.classes.find((c) => c.class_id === s.class_id) || {};
            return { ...s, class_name: cls.class_name, class_level: cls.level };
          });
        return { rows, rowCount: rows.length };
      }
      if (q.includes('FROM class_schedules cs')) {
        const rows = store.slots
          .filter((s) => {
            if (s.academic_year_id !== params[0] || s.semester !== params[1]) return false;
            if (q.includes('AND cs.day_of_week = $3') && Number(s.day_of_week) !== Number(params[2])) return false;
            if (q.includes('AND cs.teacher_id = $4') && s.teacher_id !== params[3]) return false;
            return true;
          })
          .map((s) => {
            const cls = testDbEngine.classes.find((c) => c.class_id === s.class_id) || {};
            const sub = store.subjects.find((x) => x.subject_id === s.subject_id) || {};
            const tch = testDbEngine.teachers.find((t) => t.teacher_id === s.teacher_id) || null;
            const tc = store.teacherCodes.find((x) => x.teacher_id === s.teacher_id && x.academic_year_id === s.academic_year_id && x.semester === s.semester);
            return {
              ...s,
              class_name: cls.class_name || s.class_id,
              class_level: Number(cls.level || 10),
              subject_code: sub.code || 'MPL',
              subject_name: sub.name || 'Mapel',
              subject_category: sub.category || 'KBM',
              color_tone: sub.color_tone || 'emerald',
              teacher_name: tch ? tch.name : null,
              teacher_short_code: tc ? tc.short_code : null
            };
          })
          .sort((a, b) => a.day_of_week - b.day_of_week || a.period_number - b.period_number);
        return { rows, rowCount: rows.length };
      }
      if (q.includes('FROM teacher_schedule_codes WHERE academic_year_id = $1 AND semester = $2')) {
        const rows = store.teacherCodes.filter((x) => x.academic_year_id === params[0] && x.semester === params[1]);
        return { rows, rowCount: rows.length };
      }
      if (q.includes('FROM teachers t') && q.includes('scheduled_weekly_jp')) {
        const rows = testDbEngine.teachers
          .filter((t) => t.status === 'Active')
          .map((t) => {
            const mySlots = store.slots.filter((s) => s.academic_year_id === params[0] && s.semester === params[1] && s.teacher_id === t.teacher_id);
            const kbmCount = mySlots.filter((s) => {
              const sub = store.subjects.find((x) => x.subject_id === s.subject_id);
              return !sub || sub.category === 'KBM';
            }).length;
            const tc = store.teacherCodes.find((x) => x.teacher_id === t.teacher_id && x.academic_year_id === params[0] && x.semester === params[1]);
            return {
              teacher_id: t.teacher_id,
              name: t.name,
              position: t.position,
              subject: t.subject,
              target_weekly_hours: Number(t.teaching_hours || 0),
              short_code: tc ? tc.short_code : null,
              scheduled_weekly_jp: kbmCount,
              scheduled_total_slots: mySlots.length,
              scheduled_classes_count: new Set(mySlots.map((s) => s.class_id)).size,
              scheduled_subjects: t.subject
            };
          });
        return { rows, rowCount: rows.length };
      }
      if (q.includes('SELECT academic_year_id FROM academic_years WHERE academic_year_id = $1')) {
        const y = testDbEngine.academic_years.find((a) => a.academic_year_id === params[0]);
        return { rows: y ? [y] : [], rowCount: y ? 1 : 0 };
      }
      if (q.includes('SELECT class_id, class_name, level FROM classes WHERE class_id = $1')) {
        const c = testDbEngine.classes.find((x) => x.class_id === params[0]);
        return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
      }
      if (q.includes('SELECT teacher_id, name FROM teachers WHERE teacher_id = $1')) {
        const t = testDbEngine.teachers.find((x) => x.teacher_id === params[0]);
        return { rows: t ? [t] : [], rowCount: t ? 1 : 0 };
      }
      if (q.includes('SELECT COUNT(*)::int AS cnt FROM class_schedules WHERE subject_id = $1')) {
        const cnt = store.slots.filter((s) => s.subject_id === params[0]).length;
        return { rows: [{ cnt }], rowCount: 1 };
      }

      return testDbEngine.handleQuery(text, params);
    }
  };
}

function assertSeedDatasetIntegrity() {
  assert.strictEqual(ACTIVE_DAYS.length, 6, 'MA At-Taujih active schedule must span 6 days (Sabtu-Kamis)');
  assert.ok(!ACTIVE_DAYS.some((d) => d.day_of_week === 5), 'Jumat (5) must be off');
  assert.strictEqual(DEFAULT_PERIODS.filter((p) => !p.is_break).length, 10, 'Default schedule must define Jam ke-1 s.d. 10');
  assert.strictEqual(DEFAULT_PERIODS[0].start_time, '07:00');
  assert.strictEqual(DEFAULT_PERIODS[DEFAULT_PERIODS.length - 1].end_time, '12:50');

  let totalSlots = 0;
  let kbmSlots = 0;
  let pbSlots = 0;
  let upacaraSlots = 0;
  const teacherWeeklyCounts = new Map();

  for (const [dayKey, periodsObj] of Object.entries(SCHEDULE_GRID_2026_GANJIL)) {
    for (const [periodKey, classesObj] of Object.entries(periodsObj)) {
      const seenTeachersInPeriod = new Set();
      for (const level of [10, 11, 12]) {
        const tuple = classesObj[level];
        assert.ok(tuple, `Missing tuple at day=${dayKey} period=${periodKey} level=${level}`);
        const [subjCode, teacherCode] = tuple;
        totalSlots += 1;
        if (subjCode === 'PB') {
          pbSlots += 1;
          assert.strictEqual(teacherCode, null, 'PB must not require a subject teacher code');
        } else if (subjCode === 'UPACARA') {
          upacaraSlots += 1;
          assert.strictEqual(teacherCode, null, 'UPACARA must not require a subject teacher code');
        } else {
          kbmSlots += 1;
          assert.ok(teacherCode, `KBM slot ${subjCode} at day=${dayKey} p=${periodKey} must have teacher code`);
          assert.ok(!seenTeachersInPeriod.has(teacherCode), `Seed conflict! Teacher ${teacherCode} double-booked on day=${dayKey} period=${periodKey}`);
          seenTeachersInPeriod.add(teacherCode);
          teacherWeeklyCounts.set(teacherCode, (teacherWeeklyCounts.get(teacherCode) || 0) + 1);
        }
      }
    }
  }

  assert.strictEqual(totalSlots, 180, 'Full week 6x10x3 must contain 180 slots');
  assert.strictEqual(kbmSlots, 159, 'Seeded KBM slots must equal exact 159 JP');
  assert.strictEqual(pbSlots, 18, 'Seeded PB slots must equal 18 (incl. Senin Jam 2 Kelas XI)');
  assert.strictEqual(upacaraSlots, 3, 'Seeded UPACARA slots must equal 3');
  assert.deepStrictEqual(SCHEDULE_GRID_2026_GANJIL[1][2][11], ['PB', null], 'Senin Jam ke-2 Kelas XI must be filled with PB');

  for (const tCat of TEACHER_CODE_CATALOG_2026) {
    assert.strictEqual(
      teacherWeeklyCounts.get(tCat.code) || 0,
      tCat.weekly_jp,
      `Teacher ${tCat.code} scheduled JP count must match Excel weekly target (${tCat.weekly_jp})`
    );
  }

  assert.strictEqual(normalizeSubjectCode('F.Q'), 'FQ');
  assert.strictEqual(normalizeSubjectCode('Q.H'), 'QH');
  assert.strictEqual(normalizeSubjectCode('B.I'), 'B.INDO');

  const matchedUmi = matchTeacherRow([{ teacher_id: 'T1', name: 'UMI ASROH, S.Pd' }], ['UMI ASROH']);
  assert.strictEqual(matchedUmi.teacher_id, 'T1');
  const matchedH = matchTeacherRow([{ teacher_id: 'T2', name: 'TSURRAYYA ROCHMANIA, S.E' }], ['TSUROYAH ROCHMANIA']);
  assert.strictEqual(matchedH.teacher_id, 'T2');
  console.log('1. PASS: Official 2026/2027 Ganjil seed (159 KBM JP, 18 PB, 3 Upacara, 0 conflicts, A-S exact counts) verified.');
}

function assertFrontendSchedulesIntegrity() {
  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'public/css/dashboard.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  assert.ok(html.includes('id="menu-schedules"'), 'Desktop sidebar must include #menu-schedules under DATA & AKADEMIK');
  assert.ok(html.includes('id="sheetMenuSchedules"'), 'Mobile More sheet must include #sheetMenuSchedules');
  assert.ok(html.includes('<section id="schedulesContent"'), 'Dashboard must include #schedulesContent view section');
  assert.ok(html.includes('id="rg_scheduleAssistBanner"'), 'Responder form must include live schedule auto-fill banner');
  assert.ok(html.includes('id="t_viewScheduleBtn"'), 'Teacher detail modal must include Lihat Jadwal Mengajar button');
  assert.ok(html.includes('id="schedPrintSheet"'), 'Dashboard body must include dedicated #schedPrintSheet print container');

  const dialogIds = ['schedSlotDialog', 'schedCopyDialog', 'schedMasterDialog', 'schedImportDialog'];
  for (const dId of dialogIds) {
    assert.ok(html.includes(`<dialog id="${dId}"`), `Dashboard must include native <dialog id="${dId}">`);
    assert.ok(html.includes(`id="${dId}" class="sched-dialog${dId === 'schedMasterDialog' ? ' sched-dialog-wide' : ''}" closedby="any"`), `${dId} must support closedby="any"`);
    assert.ok(!new RegExp(`id="${dId}"[^>]*\\brole=["']dialog["']`).test(html), `${dId} must not add redundant role="dialog"`);
  }

  assert.ok(css.includes('.sched-workspace') && css.includes('.sched-timeline-card'), 'dashboard.css must define desktop matrix & mobile timeline schedule styles');
  assert.ok(css.includes('body.simata-printing-schedule > *:not(#schedPrintSheet)'), 'Print media styles must isolate schedule print sheet');

  let braceDepth = 0;
  for (const ch of css) {
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
    assert.ok(braceDepth >= 0, 'dashboard.css unexpected closing brace');
  }
  assert.strictEqual(braceDepth, 0, 'dashboard.css braces must remain balanced');

  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let compiled = 0;
  while ((m = scriptRegex.exec(html)) !== null) {
    if (!m[1].trim()) continue;
    new vm.Script(m[1], { filename: `dashboard.sched.${compiled + 1}.js` });
    compiled += 1;
  }
  assert.ok(compiled >= 2, 'All inline scripts in dashboard.html must compile without syntax errors');

  for (const methodName of ['getScheduleOverview', 'getScheduleActiveNow', 'upsertScheduleSlot', 'copyScheduleSemester', 'importScheduleRows']) {
    assert.ok(clientJs.includes(methodName), `simata-client.js must expose ${methodName}`);
  }
  console.log('2. PASS: Frontend HTML/dialogs/mobile/print CSS & REST client contract verified.');
}

async function runBug59SchedulesTests() {
  console.log('\n===============================================================');
  console.log('BUG 59: JADWAL PELAJARAN FULL-STACK & INTEGRATIONS SUITE');
  console.log('===============================================================');

  assertSeedDatasetIntegrity();
  assertFrontendSchedulesIntegrity();

  await testDbEngine.reset();
  const mockHandler = createScheduleAwareMockHandler();
  setMockQueryHandler((text, params) => mockHandler.handler(text, params));
  setMockTransactionHandler((cb) => cb({ query: (text, params) => mockHandler.handler(text, params) }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = async (username, password) => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await res.json();
      assert.strictEqual(res.status, 200);
      return json.data.token;
    };

    const adminToken = await login('Admin1', '12345');
    const guruToken = await login('Guru_001', 'Guru001');

    // 3. Guru read access vs mutation RBAC block (403)
    const guruGetRes = await fetch(`${baseUrl}/api/v1/schedules/overview`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    const guruGetJson = await guruGetRes.json();
    assert.strictEqual(guruGetRes.status, 200);
    assert.strictEqual(guruGetJson.data.periods.length, 11, 'Overview auto-initializes 11 period rows (10 JP + Istirahat)');

    const guruWriteRes = await fetch(`${baseUrl}/api/v1/schedules/slots/upsert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guruToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academic_year_id: '2026/2027',
        semester: 'GANJIL',
        day_of_week: 6,
        period_number: 2,
        class_id: 'CLS-2627-10',
        subject_id: 'SUBJ-FQ',
        teacher_id: 'TCH-0001'
      })
    });
    assert.strictEqual(guruWriteRes.status, 403, 'GURU must be forbidden (403) from editing schedules');

    // 4. Admin multi-period upsert + 409 Teacher Conflict Detection
    const upsertOk = await fetch(`${baseUrl}/api/v1/schedules/slots/upsert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academic_year_id: '2026/2027',
        semester: 'GANJIL',
        day_of_week: 6,
        period_numbers: [2, 3],
        class_id: 'CLS-2627-10',
        subject_id: 'SUBJ-FQ',
        teacher_id: 'TCH-0001'
      })
    });
    assert.strictEqual(upsertOk.status, 200);

    const conflictRes = await fetch(`${baseUrl}/api/v1/schedules/slots/upsert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academic_year_id: '2026/2027',
        semester: 'GANJIL',
        day_of_week: 6,
        period_number: 3,
        class_id: 'CLS-2627-11',
        subject_id: 'SUBJ-SKI',
        teacher_id: 'TCH-0001'
      })
    });
    const conflictJson = await conflictRes.json();
    assert.strictEqual(conflictRes.status, 409, 'Double-booking same teacher in same day+period across classes must fail with 409');
    assert.ok(String(conflictJson.message).includes('Bentrok Jadwal Guru'), '409 response must explain teacher conflict clearly');

    // 5. Non-KBM (PB) slot allows null teacher_id
    const pbRes = await fetch(`${baseUrl}/api/v1/schedules/slots/upsert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academic_year_id: '2026/2027',
        semester: 'GANJIL',
        day_of_week: 1,
        period_number: 2,
        class_id: 'CLS-2627-11',
        subject_id: 'SUBJ-PB',
        teacher_id: null
      })
    });
    assert.strictEqual(pbRes.status, 200);

    // 6. Responder Live Assist endpoint detects ongoing block (Jam 2-3 Sabtu 07:50 WIB)
    const nowRes = await fetch(`${baseUrl}/api/v1/schedules/now?teacher_id=TCH-0001&day_of_week=6&time_wib=07:50`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    const nowJson = await nowRes.json();
    assert.strictEqual(nowRes.status, 200);
    assert.strictEqual(nowJson.data.current_period.period_number, 2);
    assert.ok(nowJson.data.suggested_fill, 'Responder /now must suggest active block');
    assert.deepStrictEqual(nowJson.data.suggested_fill.periods, [2, 3], 'Consecutive periods must group cleanly into [2, 3]');
    assert.strictEqual(nowJson.data.suggested_fill.class_id, 'CLS-2627-10');

    // 7. Chatbot schedule response reflects 12.50 WIB (never stale 14.30)
    const chatRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guruToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'jadwal pelajaran selesai jam berapa?' })
    });
    const chatJson = await chatRes.json();
    assert.strictEqual(chatRes.status, 200);
    const chatReply = (chatJson.data && chatJson.data.reply) || chatJson.reply || '';
    assert.ok(chatReply.includes('12.50 WIB'), 'Chatbot must quote 12.50 WIB end time');
    assert.ok(!chatReply.includes('14.30'), 'Chatbot must no longer quote outdated 14.30 WIB');

    // 8. Copy semester endpoint copies slots cleanly
    const copyRes = await fetch(`${baseUrl}/api/v1/schedules/copy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_academic_year_id: '2026/2027',
        from_semester: 'GANJIL',
        to_academic_year_id: '2026/2027',
        to_semester: 'GENAP',
        overwrite: true
      })
    });
    const copyJson = await copyRes.json();
    assert.strictEqual(copyRes.status, 200);
    assert.strictEqual(copyJson.data.copied_slots, 3, 'Copy semester must copy all 3 created slots');

    console.log('3. PASS: RBAC (Guru read/403 write), 409 conflict prevention, Non-KBM null teacher, Responder live /now grouping, Chatbot 12.50 WIB & Copy Semester verified.');
    console.log('===============================================================');
    console.log('BUG 59 SCHEDULES & INTEGRATIONS: ALL TESTS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  runBug59SchedulesTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 59 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug59SchedulesTests;
