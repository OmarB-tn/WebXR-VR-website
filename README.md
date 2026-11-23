# WebXR Multi-Format VR Video Platform & Station Manager

A serverless, browser-based virtual reality video platform built for **Google Cardboard** headsets on Android Chrome. Users scan one of 10 dedicated QR codes to launch an isolated VR experience—automatically configured for its specific projection and 3D stereo layout—while an edge API manages a 3-concurrent-viewer capacity limit, caches signed media tokens, and supports zero-bandwidth in-tab VR replays.

## Key Features

* **Multi-Format WebXR Rendering:** Dynamically adapts Three.js scene geometries and eye-layer UV mappings (`Layer 1` Left Eye / `Layer 2` Right Eye) to support four distinct media formats:
  * **360° Over-Under (3D):** Inverted sphere with top/bottom vertical eye separation.
  * **360° Monoscopic:** Inverted sphere rendered to both eyes.
  * **Flat / Wide-Angle Side-by-Side (3D):** Virtual cinema plane with left/right horizontal eye separation.
  * **Flat Monoscopic:** Virtual cinema plane centered at eye level.
* **Native WebXR Cardboard Integration:** Uses `navigator.xr.requestSession('immersive-vr')` over HTTPS for hardware-accelerated head tracking, IPD eye separation, and lens distortion calibration without requiring native app installations.
* **Bandwidth-Optimized Streaming & In-Tab Replay:**
  * Integrates with the **Backblaze B2 v4 API** via Cloudflare Pages Functions to issue temporary signed download tokens while keeping the storage bucket private.
  * Caches active signed URLs in **Cloudflare KV** (45-minute TTL) alongside `Cache-Control` bucket headers so repeat visits hit browser disk cache.
  * Rewinds the buffered `<video>` element in place (`videoEl.currentTime = 0`) when users tap **Replay in VR**, replaying directly from browser memory without re-downloading from cloud storage.
* **3-Station Concurrency Control & Admin Panel:** Uses **Cloudflare KV** to enforce a maximum of 3 simultaneous viewers with automatic 15-second heartbeats, 45-second stale-session cleanup, and a live operator dashboard (`/admin.html`) for manual slot releases.
* **Local Preview & QR Kiosk:** Includes a local Node.js preview server (`preview-server.js` + `preview.html`) that loops 8-second snippets of all 10 local videos in a 2×5 grid without VR distortion and reveals scannable SVG QR codes on click.
* **Event Fallback & Diagnostics:** Includes a standalone Backblaze/CORS diagnostic page (`/test.html`) and a lightweight local HTTP byte-range server (`local-video-server.js`) for pairing with a Cloudflare Quick Tunnel if cloud free-tier daily bandwidth caps are reached during live events.

## System Architecture

```text
┌─────────────────────────┐         1. POST /api/session/claim          ┌──────────────────────────────────┐
│   Android Chrome        │ ──────────────────────────────────────────► │  Cloudflare Pages Functions      │
│   (WebXR + Three.js)    │                                             │  (/api/* & /video/* routing)     │
│                         │ ◄────────────────────────────────────────── │                                  │
│   • Scans QR (/video/N) │         2. Slot Confirmed + Cached URL      └────────┬────────────────┬────────┘
│   • Renders Stereo VR   │                                                      │                │
│   • Replays from Cache  │                                          3a. Reserve │                │ 3b. Sign & Cache
└────────────┬────────────┘                                          Slot (1-3)  │                │ URL (B2 v4 API)
             │                                                                   ▼                ▼
             │ 4. Direct HTTPS Stream (206 Byte-Range + CORS)          ┌─────────────────┐ ┌────────────────────┐
             ▼                                                         │  Cloudflare KV  │ │  Backblaze B2 API  │
┌─────────────────────────┐                                            │  (VR_SESSIONS)  │ │  (Auth & Token)    │
│  Backblaze B2 Storage   │                                            └─────────────────┘ └────────────────────┘
│  (Private MP4 Bucket)   │
└─────────────────────────┘
```

## Project Structure

```text
vr-cloudflare-pages/
├── package.json
├── generate-qr.js              # CLI script to batch-generate PNG QR codes for /video/1..10
├── preview-server.js           # Local server for 2x5 video snippet previews & SVG QR codes
├── preview.html                # Local 10-video preview grid (tap any card to reveal QR)
├── local-video-server.js       # Optional local HTTP 206 range server for live event fallback
├── functions/
│   ├── api/
│   │   └── [[path]].js         # Edge API: session slots, heartbeats, admin & B2 URL signing
│   └── video/
│       └── [[id]].js           # Edge rewrite routing /video/1..10 to /video.html
├── public/
│   ├── video.html              # WebXR player entry page with Cardboard & Replay UI
│   ├── admin.html              # Operator dashboard for monitoring/releasing 3 viewer slots
│   ├── test.html               # Standalone Backblaze B2 & CORS stream diagnostic tool
│   ├── css/
│   │   └── style.css           # Fullscreen viewport, overlay, and cache badge styling
│   ├── js/
│   │   └── player.js           # Three.js WebXR renderer, stereo UV mapper & replay client
│   └── vendor/
│       └── three/              # Self-hosted Three.js ES module bundle (three.module.js + core)
└── videos/                     # Local MP4 source files (excluded from Git via .gitignore)
```

## Video Projection Matrix

Each route (`/video/1` through `/video/10`) maps to a pre-configured rendering profile in `public/js/player.js`:

| Route | Experience | Projection | Stereo Layout |
| :--- | :--- | :--- | :--- |
| `/video/1` | 3D 360 Skydiving (Vuze 4K) | `360` Sphere | Over-Under (`ou`) |
| `/video/2` | 3D Drone FPV Freestyle | `flat` Plane | Side-by-Side (`sbs`) |
| `/video/3` | 3D SBS FPV Freestyle | `flat` Plane | Side-by-Side (`sbs`) |
| `/video/4` | 360 Solar System VR | `360` Sphere | Monoscopic (`mono`) |
| `/video/5` | Eagle POV: Disney Castle | `360` Sphere | Monoscopic (`mono`) |
| `/video/6` | Explore Mars in 360 VR | `360` Sphere | Monoscopic (`mono`) |
| `/video/7` | Fly Around the World 360 | `360` Sphere | Monoscopic (`mono`) |
| `/video/8` | Ground to Space Hyperlapse | `360` Sphere | Monoscopic (`mono`) |
| `/video/9` | Total Solar Eclipse 360 | `360` Sphere | Monoscopic (`mono`) |
| `/video/10` | Solar System Experience | `flat` Plane | Monoscopic (`mono`) |

## Setup & Deployment

### 1. Local Installation & Vendor Assets

Install dependencies and copy the complete Three.js build (including `three.core.js`) into `public/vendor/three/`:

```bash
npm install three qrcode wrangler
mkdir -p public/vendor/three qr-codes
cp node_modules/three/build/* public/vendor/three/
```

### 2. Configure Private Storage (Backblaze B2)

1. Create a **Private** bucket in Backblaze B2 and upload `video-01.mp4` through `video-10.mp4`.
2. Under **Bucket Settings → CORS Rules**, select **Share everything in this bucket with every origin** so WebGL `THREE.VideoTexture` can read cross-origin video frames.
3. Under **Bucket Settings → Bucket Info**, add the following JSON so browsers cache video chunks for in-tab replays:
   ```json
   {"cache-control": "public, max-age=86400"}
   ```
4. Create a **Read-Only** Application Key restricted to that single bucket and save the `keyID` and `applicationKey`.

### 3. Deploy to Cloudflare Pages

1. Authenticate Wrangler and deploy the project:
   ```bash
   npx wrangler login
   npx wrangler pages deploy public --project-name=vr-cardboard-player --branch=main
   ```
2. Add your Backblaze credentials as encrypted Pages secrets:
   ```bash
   npx wrangler pages secret put B2_KEY_ID --project-name=vr-cardboard-player
   npx wrangler pages secret put B2_APP_KEY --project-name=vr-cardboard-player
   ```
3. Create a KV namespace (`npx wrangler kv namespace create VR_SESSIONS`) and bind it in **Cloudflare Dashboard → Workers & Pages → Settings → Bindings** under the variable name `VR_SESSIONS` to enforce the 3-station limit and cache signed B2 URLs.
4. Redeploy once secrets and bindings are saved:
   ```bash
   npx wrangler pages deploy public --project-name=vr-cardboard-player --branch=main
   ```

### 4. Generate QR Codes & Run Local Previews

* **Generate PNG QR codes:**
  ```bash
  node generate-qr.js https://vr-cardboard-player.pages.dev
  ```
* **Run local 2×5 snippet preview & QR kiosk (`http://localhost:4000`):**
  ```bash
  node preview-server.js
  ```

### 5. High-Traffic Event Fallback (Bypassing Cloud Bandwidth Caps)

If free-tier cloud download limits are reached during a live event, stream the MP4 files directly from your local machine without changing your printed QR codes:

1. Start the local byte-range server: `node local-video-server.js`
2. Open a free public HTTPS tunnel: `npx --yes cloudflared tunnel --url http://localhost:3000`
3. Update `functions/api/[[path]].js` to return the generated `https://*.trycloudflare.com` base URL and run `npx wrangler pages deploy public --project-name=vr-cardboard-player --branch=main`.

## Operator & Diagnostic Routes

* **VR Experiences:** `https://<your-project>.pages.dev/video/1` through `/video/10`
* **Operator Admin Panel:** `https://<your-project>.pages.dev/admin.html` — displays active stations in real time and allows manual slot release.
* **Storage & CORS Diagnostic:** `https://<your-project>.pages.dev/test.html` — verifies Backblaze B2 token signing, CORS headers, and HTML5 video metadata loading independently of WebXR.