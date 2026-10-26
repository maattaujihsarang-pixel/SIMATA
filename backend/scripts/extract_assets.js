const fs = require('fs');
const path = require('path');

// Extract CSS from style.html
const stylePath = path.join(__dirname, '..', '..', 'style.html');
const cssOutputPath = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');

if (fs.existsSync(stylePath)) {
  let styleContent = fs.readFileSync(stylePath, 'utf8');
  styleContent = styleContent.replace(/<\/?style>/gi, '').trim();
  fs.writeFileSync(cssOutputPath, styleContent);
  console.log('CSS extracted successfully. Size:', styleContent.length, 'bytes');
}

// Ensure favicon exists in public/
const faviconPath = path.join(__dirname, '..', '..', 'public', 'favicon.ico');
const logoPath = path.join(__dirname, '..', '..', 'public', 'assets', 'logo.png');
if (fs.existsSync(logoPath) && !fs.existsSync(faviconPath)) {
  fs.copyFileSync(logoPath, faviconPath);
  console.log('Favicon created from logo.');
}

