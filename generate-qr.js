const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const baseUrl = (process.argv[2] || '').replace(/\/$/, '');
if (!baseUrl.startsWith('https://')) {
  console.error('Usage: node generate-qr.js https://<your-project>.pages.dev');
  process.exit(1);
}

const outDir = path.join(__dirname, 'qr-codes');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

(async () => {
  for (let i = 1; i <= 10; i++) {
    const url = `${baseUrl}/video/${i}`;
    const file = path.join(outDir, `video-${String(i).padStart(2, '0')}.png`);
    await QRCode.toFile(file, url, { width: 400, margin: 2 });
    console.log(`Generated ${file} -> ${url}`);
  }
})();