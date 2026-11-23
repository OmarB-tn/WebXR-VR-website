const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const PORT = 4000;
const VIDEOS_DIR = path.join(__dirname, 'videos');

if (!fs.existsSync(VIDEOS_DIR)) {
  console.warn(`Warning: "${VIDEOS_DIR}" folder not found. Create it and add video-01.mp4 .. video-10.mp4.`);
}

http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // 1. Serve the 2x5 (10-video) preview grid page
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/preview.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'preview.html')).pipe(res);
  }

  // 2. Generate crisp SVG QR codes locally
  if (reqUrl.pathname === '/api/qr') {
    const target = reqUrl.searchParams.get('url') || 'https://vr-cardboard-player.pages.dev/video/1';
    try {
      const svg = await QRCode.toString(target, { type: 'svg', margin: 1, width: 260 });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end(svg);
    } catch (err) {
      res.writeHead(500);
      return res.end('QR generation failed');
    }
  }

  // 3. Stream local MP4 files with byte-range support for fast snippet seeking
  if (reqUrl.pathname.startsWith('/videos/')) {
    const fileName = path.basename(decodeURIComponent(reqUrl.pathname));
    const filePath = path.join(VIDEOS_DIR, fileName);

    if (!fileName.endsWith('.mp4') || !fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Video file not found in ./videos/');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 2 * 1024 * 1024 - 1, fileSize - 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4'
      });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4'
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Local VR Preview Kiosk running at: http://localhost:${PORT}`);
});
