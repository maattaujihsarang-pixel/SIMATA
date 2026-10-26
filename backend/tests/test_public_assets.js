const assert = require('assert');
const http = require('http');
const app = require('../src/app');

function fetchStatic(server, path) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        // Explicitly NO Authorization header or session cookies!
      }
    }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          size: buffer.length,
          bodyText: buffer.toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runPublicAssetsTest() {
  console.log('\n--- Running BUG 26 Zero-Auth Public Assets Regression Test ---');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));

  try {
    // 1. Madrasah Logo
    console.log('1. Testing public access to Madrasah Logo (/assets/logo.png)...');
    const logoRes = await fetchStatic(server, '/assets/logo.png');
    assert.strictEqual(logoRes.status, 200, 'Logo must return HTTP 200 without authentication');
    assert.ok(logoRes.headers['content-type'].includes('image/png'), 'Must have image/png content-type');
    assert.ok(logoRes.size > 50000, `Logo must be non-empty (got ${logoRes.size} bytes)`);
    console.log(`   PASS: Logo served publicly (${logoRes.size} bytes, image/png).`);

    // 2. Favicon
    console.log('2. Testing public access to Favicon (/favicon.ico)...');
    const favRes = await fetchStatic(server, '/favicon.ico');
    assert.strictEqual(favRes.status, 200, 'Favicon must return HTTP 200 without authentication');
    assert.ok(favRes.size > 0, 'Favicon must be non-empty');
    console.log(`   PASS: Favicon served publicly (${favRes.size} bytes).`);

    // 3. Stylesheet CSS
    console.log('3. Testing public access to Stylesheet (/css/style.css)...');
    const cssRes = await fetchStatic(server, '/css/style.css');
    assert.strictEqual(cssRes.status, 200, 'CSS must return HTTP 200 without authentication');
    assert.ok(cssRes.headers['content-type'].includes('text/css'), 'Must have text/css content-type');
    assert.ok(cssRes.bodyText.includes('--primary:#166534'), 'CSS must contain SIMATA root color variables');
    console.log(`   PASS: CSS served publicly (${cssRes.size} bytes, verified variables).`);

    // 4. Client Adapter JS
    console.log('4. Testing public access to Client JS Adapter (/js/simata-client.js)...');
    const jsRes = await fetchStatic(server, '/js/simata-client.js');
    assert.strictEqual(jsRes.status, 200, 'JS must return HTTP 200 without authentication');
    assert.ok(jsRes.headers['content-type'].includes('javascript'), 'Must have javascript content-type');
    assert.ok(jsRes.bodyText.includes('google.script.run'), 'Must contain shim proxy definitions');
    console.log(`   PASS: Client JS served publicly (${jsRes.size} bytes, shim verified).`);

    // 4b. HTML5 QR Code Library
    console.log('4b. Testing public access to HTML5 QR Code Library (/js/html5-qrcode.min.js)...');
    const qrRes = await fetchStatic(server, '/js/html5-qrcode.min.js');
    assert.strictEqual(qrRes.status, 200, 'html5-qrcode must return HTTP 200 without authentication');
    assert.ok(qrRes.size > 100000, `html5-qrcode must be non-empty (got ${qrRes.size} bytes)`);
    console.log(`   PASS: html5-qrcode.min.js served publicly (${qrRes.size} bytes).`);

    // 5. Zero dependency on Google authentication
    console.log('5. Verifying zero dependency on authenticated Google resources...');
    const allResponses = [logoRes, favRes, cssRes, jsRes, qrRes];
    for (const res of allResponses) {
      assert.ok(!res.headers['location'] || !res.headers['location'].includes('google.com'), 'Must not redirect to Google');
      assert.ok(!res.bodyText.includes('accounts.google.com'), 'Must not require Google accounts');
    }
    console.log('   PASS: 100% zero-dependency on authenticated Google resources confirmed.');

    console.log('BUG 26 Public Assets Regression Test: ALL PASS');
    return true;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runPublicAssetsTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runPublicAssetsTest;

