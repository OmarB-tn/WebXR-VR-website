const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const SLOT_TIMEOUT_MS = 45000;

const videos = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'videos.json'), 'utf8'));

const slots = [
  { slot: 1, sessionId: null, videoId: null, startedAt: null, lastSeen: null },
  { slot: 2, sessionId: null, videoId: null, startedAt: null, lastSeen: null },
  { slot: 3, sessionId: null, videoId: null, startedAt: null, lastSeen: null }
];

app.use(express.json());
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/qr-codes', express.static(path.join(__dirname, 'qr-codes')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

function cleanupExpiredSlots() {
  const now = Date.now();
  for (const s of slots) {
    if (s.sessionId && now - s.lastSeen > SLOT_TIMEOUT_MS) {
      s.sessionId = null;
      s.videoId = null;
      s.startedAt = null;
      s.lastSeen = null;
    }
  }
}
setInterval(cleanupExpiredSlots, 5000);

app.get('/video/:id', (req, res) => {
  if (!videos[req.params.id]) return res.status(404).send('Video not found.');
  res.sendFile(path.join(__dirname, 'public', 'video.html'));
});

app.post('/api/session/claim', (req, res) => {
  cleanupExpiredSlots();
  const { sessionId, videoId } = req.body;
  const video = videos[videoId];
  if (!video || !sessionId) return res.status(400).json({ error: 'Invalid request' });

  let assigned = slots.find(s => s.sessionId === sessionId) || slots.find(s => s.sessionId === null);
  if (!assigned) {
    return res.status(429).json({
      full: true,
      message: 'All 3 viewing stations are currently occupied. Please wait for the operator.'
    });
  }

  const now = Date.now();
  assigned.sessionId = sessionId;
  assigned.videoId = videoId;
  assigned.startedAt = assigned.startedAt || now;
  assigned.lastSeen = now;

  res.json({
    full: false,
    slot: assigned.slot,
    video: {
      id: videoId,
      title: video.title,
      projection: video.projection,
      stereo: video.stereo,
      streamUrl: `/stream/${videoId}`
    }
  });
});

app.post('/api/session/heartbeat', (req, res) => {
  const slot = slots.find(s => s.sessionId === req.body.sessionId);
  if (slot) slot.lastSeen = Date.now();
  res.json({ active: Boolean(slot) });
});

app.post('/api/session/release', (req, res) => {
  const slot = slots.find(s => s.sessionId === req.body.sessionId);
  if (slot) {
    slot.sessionId = null;
    slot.videoId = null;
    slot.startedAt = null;
    slot.lastSeen = null;
  }
  res.json({ released: true });
});

app.get('/stream/:id', (req, res) => {
  const video = videos[req.params.id];
  if (!video) return res.status(404).end();

  const filePath = path.join(__dirname, 'videos', video.file);
  if (!fs.existsSync(filePath)) return res.status(404).send('MP4 file missing on server.');

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 2 * 1024 * 1024 - 1, fileSize - 1);
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/api/admin/slots', (req, res) => {
  cleanupExpiredSlots();
  res.json({ slots, videos });
});
app.post('/api/admin/release/:slotNum', (req, res) => {
  const s = slots.find(item => item.slot === Number(req.params.slotNum));
  if (s) {
    s.sessionId = null;
    s.videoId = null;
    s.startedAt = null;
    s.lastSeen = null;
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VR WebXR Server listening on http://localhost:${PORT}`);
});