const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const VIDEOS_DIR = path.join(__dirname, 'videos');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const fileName = path.basename(decodeURIComponent(req.url.split('?')[0]));
  const filePath = path.join(VIDEOS_DIR, fileName);

  if (!fileName.endsWith('.mp4') || !fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Video not found');
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
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Streaming local videos on port ${PORT}...`);
});
