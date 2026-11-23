import * as THREE from 'three';

const VIDEOS = {
  '1':  { title: '3D 360 Skydiving (Vuze 4K)', file: 'video-01.mp4', projection: '360',  stereo: 'ou' },
  '2':  { title: '3D Drone FPV Freestyle',     file: 'video-02.mp4', projection: 'flat', stereo: 'sbs' },
  '3':  { title: '3D SBS FPV Freestyle',       file: 'video-03.mp4', projection: 'flat', stereo: 'sbs' },
  '4':  { title: '360 Solar System VR',        file: 'video-04.mp4', projection: '360',  stereo: 'mono' },
  '5':  { title: 'Eagle POV: Disney Castle',   file: 'video-05.mp4', projection: '360',  stereo: 'mono' },
  '6':  { title: 'Explore Mars in 360 VR',     file: 'video-06.mp4', projection: '360',  stereo: 'mono' },
  '7':  { title: 'Fly Around the World 360',   file: 'video-07.mp4', projection: '360',  stereo: 'mono' },
  '8':  { title: 'Ground to Space Hyperlapse', file: 'video-08.mp4', projection: '360',  stereo: 'mono' },
  '9':  { title: 'Total Solar Eclipse 360',    file: 'video-09.mp4', projection: '360',  stereo: 'mono' },
  '10': { title: 'Solar System Experience',    file: 'video-10.mp4', projection: 'flat', stereo: 'mono' }
};

const videoId = window.location.pathname.split('/').pop();
const videoConfig = VIDEOS[videoId];

let sessionId = sessionStorage.getItem('vr_session_id');
if (!sessionId) {
  sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem('vr_session_id', sessionId);
}

const titleEl = document.getElementById('video-title');
const statusEl = document.getElementById('status-text');
const cardboardBtn = document.getElementById('cardboard-btn');
const startOverlay = document.getElementById('start-overlay');
const endOverlay = document.getElementById('end-overlay');
const canvas = document.getElementById('vr-canvas');

let renderer, scene, camera, videoEl, videoTexture;
let currentXrSession = null;
let heartbeatTimer = null;

async function init() {
  try {
    if (!videoConfig) {
      titleEl.textContent = 'Video Not Found';
      statusEl.textContent = 'Invalid QR code link.';
      return;
    }

    titleEl.textContent = videoConfig.title;
    statusEl.textContent = 'Authorizing video stream...';

    const res = await fetch('/api/session/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        videoId,
        title: videoConfig.title,
        file: videoConfig.file
      })
    });

    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`API returned non-JSON (${res.status}): ${rawText.slice(0, 120)}`);
    }

    if (data.full) {
      titleEl.textContent = 'Stations Full';
      statusEl.textContent = data.message;
      return;
    }

    if (!res.ok || data.error || !data.streamUrl) {
      throw new Error(data.error || `Server error (${res.status})`);
    }

    heartbeatTimer = setInterval(() => {
      fetch('/api/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      }).catch(() => {});
    }, 15000);

    statusEl.textContent = 'Checking WebXR headset support...';
    setupWebXRScene(videoConfig, data.streamUrl);

    if ('xr' in navigator && await navigator.xr.isSessionSupported('immersive-vr')) {
      statusEl.textContent = 'Tap the Cardboard icon below to launch VR mode.';
      cardboardBtn.classList.remove('hidden');
    } else {
      statusEl.textContent = 'WebXR immersive-vr is not supported on this browser/device. Open this link in Google Chrome on Android.';
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

function adjustUVs(geometry, uScale, uOffset, vScale, vOffset) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uScale + uOffset, uv.getY(i) * vScale + vOffset);
  }
  uv.needsUpdate = true;
}

function createGeometry(projection) {
  if (projection === '360') {
    const geo = new THREE.SphereGeometry(50, 64, 40);
    geo.scale(-1, 1, 1);
    return geo;
  }
  const geo = new THREE.PlaneGeometry(16, 9);
  geo.translate(0, 0, -10);
  return geo;
}

function setupWebXRScene(cfg, streamUrl) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.layers.enable(1);

  videoEl = document.createElement('video');
  videoEl.src = streamUrl;
  videoEl.crossOrigin = 'anonymous';
  videoEl.playsInline = true;
  videoEl.preload = 'metadata';

  videoEl.addEventListener('ended', async () => {
    clearInterval(heartbeatTimer);
    await fetch('/api/session/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    }).catch(() => {});

    if (currentXrSession) {
      await currentXrSession.end().catch(() => {});
    }
    startOverlay.classList.add('hidden');
    endOverlay.classList.remove('hidden');
  });

  videoEl.addEventListener('error', () => {
    const code = videoEl.error ? videoEl.error.code : 'unknown';
    statusEl.textContent = `Video stream error (code ${code}). Check Backblaze B2 CORS rules and filename (${cfg.file}).`;
  });

  videoTexture = new THREE.VideoTexture(videoEl);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({ map: videoTexture });

  if (cfg.stereo === 'mono') {
    scene.add(new THREE.Mesh(createGeometry(cfg.projection), material));
  } else if (cfg.stereo === 'sbs') {
    const geoL = createGeometry(cfg.projection);
    adjustUVs(geoL, 0.5, 0.0, 1.0, 0.0);
    const meshL = new THREE.Mesh(geoL, material);
    meshL.layers.set(1);

    const geoR = createGeometry(cfg.projection);
    adjustUVs(geoR, 0.5, 0.5, 1.0, 0.0);
    const meshR = new THREE.Mesh(geoR, material);
    meshR.layers.set(2);

    scene.add(meshL, meshR);
  } else if (cfg.stereo === 'ou') {
    const geoL = createGeometry(cfg.projection);
    adjustUVs(geoL, 1.0, 0.0, 0.5, 0.5);
    const meshL = new THREE.Mesh(geoL, material);
    meshL.layers.set(1);

    const geoR = createGeometry(cfg.projection);
    adjustUVs(geoR, 1.0, 0.0, 0.5, 0.0);
    const meshR = new THREE.Mesh(geoR, material);
    meshR.layers.set(2);

    scene.add(meshL, meshR);
  }

  renderer.xr.addEventListener('sessionstart', () => {
    startOverlay.classList.add('hidden');
  });

  renderer.xr.addEventListener('sessionend', () => {
    currentXrSession = null;
    if (!videoEl.ended) {
      videoEl.pause();
      startOverlay.classList.remove('hidden');
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
}

cardboardBtn.addEventListener('click', async () => {
  try {
    await videoEl.play();
    const session = await navigator.xr.requestSession('immersive-vr');
    currentXrSession = session;
    await renderer.xr.setSession(session);
  } catch (err) {
    statusEl.textContent = `Could not start VR session: ${err.message}`;
  }
});

init();