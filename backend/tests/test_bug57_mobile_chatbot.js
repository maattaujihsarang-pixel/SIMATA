const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assertBalancedBraces(cssText, label) {
  let depth = 0;
  for (const ch of cssText) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    assert.ok(depth >= 0, `${label}: unexpected closing brace`);
  }
  assert.strictEqual(depth, 0, `${label}: curly braces must balance`);
}

async function runBug57MobileChatbotTests() {
  console.log('\n===============================================================');
  console.log('BUG 57: MOBILE CHATBOT VIEWPORT, HEADER & SAFE-AREA REGRESSION');
  console.log('===============================================================');

  const rootDir = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(rootDir, 'public/dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'public/css/dashboard.css'), 'utf8');

  // 1. Validate CSS brace balance in dashboard.css and chatbot inline style
  assertBalancedBraces(css, 'public/css/dashboard.css');
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  let styleCount = 0;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    styleCount += 1;
    assertBalancedBraces(styleMatch[1], `public/dashboard.html <style> #${styleCount}`);
  }
  assert.ok(styleCount >= 2, 'dashboard.html must contain mobile & chatbot <style> blocks');

  // 2. Cache-buster updated
  assert.ok(
    html.includes('/css/dashboard.css?v=bug57a'),
    'dashboard.html must reference /css/dashboard.css?v=bug57a'
  );

  // 3. Stale top-clipping rules removed
  assert.ok(
    !html.includes('height: calc(100vh - 100px);'),
    'dashboard.html must not contain fixed height: calc(100vh - 100px) that clipped mobile header'
  );
  assert.ok(
    !css.includes('bottom: calc(134px + env(safe-area-inset-bottom, 0px)) !important;'),
    'dashboard.css must not pin unbounded bottom: 134px !important above bottom nav on mobile'
  );

  // 4. Positive viewport & safe-area rules present in both files
  assert.ok(html.includes('height: min(540px, calc(100dvh - 116px));'), 'Desktop chatbot height must use 100dvh cap');
  assert.ok(html.includes('height: 100dvh;'), 'Mobile <=640px chatbot sheet must use full 100dvh height');
  assert.ok(css.includes('height: 100dvh;'), 'dashboard.css mobile <=640px chatbot sheet must align with 100dvh');
  assert.ok(
    html.includes('env(safe-area-inset-top, 0px)') && html.includes('env(safe-area-inset-bottom, 0px)'),
    'Mobile chatbot header and form must pad for notch/home-indicator safe areas'
  );
  assert.ok(html.includes('overscroll-behavior: contain;'), 'Chatbot window/messages must isolate scroll chaining');
  assert.ok(html.includes('@media (pointer: coarse)'), 'Chatbot header & send buttons must define coarse touch target size');

  // 5. Compile all inline scripts cleanly & verify SimataChatbot Escape/open/close hooks
  const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  let compiledScripts = 0;
  let chatbotScript = '';
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const code = scriptMatch[1];
    if (!code.trim()) continue;
    new vm.Script(code, { filename: `dashboard.inline.${compiledScripts + 1}.js` });
    compiledScripts += 1;
    if (code.includes('window.SimataChatbot')) chatbotScript = code;
  }
  assert.ok(compiledScripts >= 2, 'dashboard.html inline scripts must compile');
  assert.ok(chatbotScript.includes("document.body.classList.add('simata-chatbot-open')"), 'openChat must mark body.simata-chatbot-open');
  assert.ok(chatbotScript.includes("document.body.classList.remove('simata-chatbot-open')"), 'closeChat must clear body.simata-chatbot-open');
  assert.ok(chatbotScript.includes("ev.key === 'Escape'"), 'Chatbot dialog must support Escape dismissal');

  console.log('1. PASS: Chatbot mobile CSS (100dvh sheet <=640px, bounded tablet, safe areas) verified.');
  console.log('2. PASS: CSS braces & inline JS scripts verified cleanly.');
  return true;
}

if (require.main === module) {
  runBug57MobileChatbotTests()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error('BUG 57 test failed:', err);
      process.exit(1);
    });
}

module.exports = runBug57MobileChatbotTests;
