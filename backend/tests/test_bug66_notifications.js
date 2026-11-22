const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const app = require('../src/app');
const testDbEngine = require('./test_db_engine');
const { setMockQueryHandler, setMockTransactionHandler } = require('../src/config/database');
const authService = require('../src/services/auth.service');
const { getTodayISODate } = require('../src/utils/date.util');

function assertFrontendNotificationsIntegrity() {
  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const notifCss = fs.readFileSync(path.join(rootDir, 'public/css/notifications.css'), 'utf8');
  const clientJs = fs.readFileSync(path.join(rootDir, 'public/js/simata-client.js'), 'utf8');

  let openBraces = 0;
  for (const ch of notifCss) {
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    assert.ok(openBraces >= 0, 'notifications.css has unexpected closing brace');
  }
  assert.strictEqual(openBraces, 0, 'notifications.css must have balanced curly braces');

  for (const cssToken of [
    '.notif-bell-btn',
    '.notif-red-dot',
    '.notif-unread-badge',
    '.notif-center-panel',
    '.notif-card.is-resolved',
    '.notif-settings-tabs',
    '.notif-holiday-chip'
  ]) {
    assert.ok(notifCss.includes(cssToken), `notifications.css must define ${cssToken}`);
  }

  for (const htmlToken of [
    'id="notifBellWrapper"',
    'id="notifBellBtn"',
    'id="notifRedDot"',
    'id="notifUnreadBadge"',
    'id="notifCenterPanel"',
    'id="notifListContainer"',
    'id="notifSettingsModal"',
    'id="notifHolidayDateInput"',
    'id="notifSendBroadcastBtn"',
    'initSimataNotificationsEngine',
    'refreshSimataNotifications',
    'logSimataNotifEvent',
    '/css/notifications.css?v=bug66_notif1'
  ]) {
    assert.ok(html.includes(htmlToken), `dashboard.html must contain ${htmlToken}`);
  }

  assert.ok(!/\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(html), 'dashboard.html must use simataConfirm/simataPrompt instead of native confirm/prompt');

  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptCount = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].trim()) {
      new vm.Script(match[1], { filename: 'dashboard-inline-bug66.js' });
      scriptCount++;
    }
  }
  assert.ok(scriptCount >= 2, 'dashboard.html inline scripts must compile cleanly');
  new vm.Script(clientJs, { filename: 'simata-client-bug66.js' });

  for (const clientMethod of [
    'getNotificationsFeed',
    'getNotificationSettings',
    'updateNotificationSettings',
    'createNotificationBroadcast',
    'deleteNotificationBroadcast',
    'logNotificationEvent'
  ]) {
    assert.ok(clientJs.includes(clientMethod), `simata-client.js must expose ${clientMethod}`);
  }
}

async function runBug66NotificationsTests() {
  console.log('\n===============================================================');
  console.log('BUG 66: MENU LONCENG / PUSAT NOTIFIKASI CERDAS SUITE');
  console.log('===============================================================');

  assertFrontendNotificationsIntegrity();
  console.log('1. PASS: Frontend HTML, Bell Red Dot UI, CSS braces & JS compilation verified.');

  await testDbEngine.reset();
  setMockQueryHandler((text, params) => testDbEngine.handleQuery(text, params));
  setMockTransactionHandler((cb) => testDbEngine.handleTransaction(cb));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await authService.login({ username: 'Admin1', password: '12345' });
    const guruLogin = await authService.login({ username: 'Guru_001', password: 'Guru001' });
    const adminToken = adminLogin.token;
    const guruToken = guruLogin.token;
    const todayIso = getTodayISODate();

    // Use a guaranteed non-Friday school day (Monday = 1) for deterministic school-day assertions
    // 2. Incomplete class attendance at school end time (14:00 WIB) triggers urgent alert
    const res1 = await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=14:00`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res1.status, 200);
    const json1 = await res1.json();
    assert.strictEqual(json1.data.is_holiday, false);
    const classAlert1 = json1.data.feed.find((n) => n.id === `class-incomplete-${todayIso}`);
    assert.ok(classAlert1, 'Admin feed must emit class-incomplete alert when attendance is empty');
    assert.strictEqual(classAlert1.priority, 'urgent');
    assert.strictEqual(classAlert1.resolved, false);

    // 3. Guru gets personal forgot-attendance alert when scheduled/active without teacher_attendance
    const guruRes1 = await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=13:15`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    assert.strictEqual(guruRes1.status, 200);
    const guruJson1 = await guruRes1.json();
    const guruSelfAlert1 = guruJson1.data.feed.find((n) => n.id === `teacher-self-forgot-TCH-0001-${todayIso}`);
    assert.ok(guruSelfAlert1, 'Guru feed must emit personal teacher-self-forgot reminder');
    assert.strictEqual(guruSelfAlert1.resolved, false);

    // 4. Auto-Resolve check: record attendance for all active students + Guru TCH-0001 -> must auto-resolve!
    testDbEngine.student_attendance.push(
      { attendance_id: 'ATT-1', student_id: 'STD-K10001', class_id: 'CLS-2627-10', attendance_date: todayIso, period: 1, status: 'Hadir' },
      { attendance_id: 'ATT-2', student_id: 'STD-K10002', class_id: 'CLS-2627-10', attendance_date: todayIso, period: 1, status: 'Hadir' }
    );
    testDbEngine.teacher_attendance.push(
      { attendance_id: 'ATT-T1', teacher_id: 'TCH-0001', class_id: 'CLS-2627-10', attendance_date: todayIso, period: 1, status: 'Hadir', subject: 'Fiqih' }
    );

    const res2 = await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=14:00`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const json2 = await res2.json();
    const classAlert2 = json2.data.feed.find((n) => n.id === `class-incomplete-${todayIso}`);
    assert.ok(classAlert2, 'Auto-resolved class completion card must exist');
    assert.strictEqual(classAlert2.resolved, true, 'Class attendance alert must auto-resolve once all active classes are recorded');

    const guruRes2 = await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=13:15`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    });
    const guruJson2 = await guruRes2.json();
    const guruSelfAlert2 = guruJson2.data.feed.find((n) => n.id === `teacher-self-forgot-TCH-0001-${todayIso}`);
    assert.ok(guruSelfAlert2);
    assert.strictEqual(guruSelfAlert2.resolved, true, 'Guru personal reminder must auto-resolve after recording teacher attendance');

    // 5. Early Warning Siswa Alpa >= 3 consecutive days
    testDbEngine.student_attendance.push(
      { attendance_id: 'ALP-1', student_id: 'STD-K10001', class_id: 'CLS-2627-10', attendance_date: '2026-11-01', period: 1, status: 'Alpa' },
      { attendance_id: 'ALP-2', student_id: 'STD-K10001', class_id: 'CLS-2627-10', attendance_date: '2026-11-02', period: 1, status: 'Alpa' },
      { attendance_id: 'ALP-3', student_id: 'STD-K10001', class_id: 'CLS-2627-10', attendance_date: '2026-11-03', period: 1, status: 'Alpa' }
    );
    const resAlpha = await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=15:00`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const jsonAlpha = await resAlpha.json();
    const alphaAlert = jsonAlpha.data.feed.find((n) => n.id === `early-warning-alpha-${todayIso}`);
    assert.ok(alphaAlert, 'Early warning alert must fire when student has >= 3 Alpa dates');
    assert.strictEqual(alphaAlert.category, 'peringatan');
    const digestCard = jsonAlpha.data.feed.find((n) => n.id === `daily-digest-${todayIso}`);
    assert.ok(digestCard, 'Daily Closing Digest must appear at 15:00 WIB for Admin');

    // 6. RBAC & Smart Holiday Mute + Broadcasts
    const guruPutSet = await fetch(`${baseUrl}/api/v1/notifications/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${guruToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_end_time: '12:00' })
    });
    assert.strictEqual(guruPutSet.status, 403, 'Guru must be forbidden from modifying notification settings');

    const adminPutHol = await fetch(`${baseUrl}/api/v1/notifications/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_end_time: '13:30',
        custom_holidays: [{ date: todayIso, title: 'Harlah Madrasah' }]
      })
    });
    assert.strictEqual(adminPutHol.status, 200);

    const holRes = await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=14:00`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const holJson = await holRes.json();
    assert.strictEqual(holJson.data.is_holiday, true);
    assert.ok(holJson.data.feed.some((n) => n.id === `holiday-${todayIso}`), 'Holiday notice must appear');
    assert.ok(!holJson.data.feed.some((n) => n.id === `class-incomplete-${todayIso}`), 'Class attendance alert must be muted on holiday');

    // Broadcast CRUD + Log Event
    const bcRes = await fetch(`${baseUrl}/api/v1/notifications/broadcasts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Pengumuman Rapat Dewan Guru',
        message: 'Dimohon hadir pukul 14.30 di aula.',
        category: 'info',
        priority: 'urgent',
        target_role: 'GURU',
        action_menu: 'menu-schedules'
      })
    });
    assert.strictEqual(bcRes.status, 201);
    const bcJson = await bcRes.json();
    const bcId = bcJson.data.id;

    const evtRes = await fetch(`${baseUrl}/api/v1/notifications/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'jadwal',
        priority: 'warning',
        title: 'Pergantian Jam Mengajar Kelas 10',
        message: 'Jam ke-4 digantikan sementara.',
        action_menu: 'menu-schedules'
      })
    });
    assert.strictEqual(evtRes.status, 201);

    const guruBcFeed = await (await fetch(`${baseUrl}/api/v1/notifications?date=${todayIso}&day_of_week=1&time_wib=14:00`, {
      headers: { Authorization: `Bearer ${guruToken}` }
    })).json();
    assert.ok(guruBcFeed.data.feed.some((n) => n.id === bcId), 'Guru must receive broadcast targeted to GURU');
    assert.ok(guruBcFeed.data.feed.some((n) => n.title === 'Pergantian Jam Mengajar Kelas 10'), 'Logged schedule event must appear in feed');

    const delBcRes = await fetch(`${baseUrl}/api/v1/notifications/broadcasts/${encodeURIComponent(bcId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(delBcRes.status, 200);

    console.log('2. PASS: Smart Notifications API, Auto-Resolve, Early Warning, Holidays, Daily Digest & Broadcast RBAC verified.');
    console.log('===============================================================');
    console.log('BUG 66 PUSAT NOTIFIKASI CERDAS: ALL TESTS PASSED (GREEN)');
    console.log('===============================================================');
    return true;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  runBug66NotificationsTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 66 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug66NotificationsTests;
