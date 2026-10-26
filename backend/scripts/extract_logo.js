const fs = require('fs');
const path = require('path');

const assetsPath = path.join(__dirname, '..', '..', 'assets.html');
const outputPath = path.join(__dirname, '..', '..', 'public', 'assets', 'logo.png');

const content = fs.readFileSync(assetsPath, 'utf8');
const match = content.match(/data:image\/png;base64,([^\s"']+)/);

if (match && match[1]) {
  const buf = Buffer.from(match[1], 'base64');
  fs.writeFileSync(outputPath, buf);
  console.log('Logo extracted successfully. Size:', buf.length, 'bytes');
} else {
  console.error('Failed to find base64 logo in assets.html');
  process.exit(1);
}

