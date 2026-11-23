const SLOT_TIMEOUT_MS = 45000;
const TOKEN_CACHE_TTL_SEC = 2700; // Reuse signed B2 URL for 45 mins (token valid for 60 mins)

function defaultSlots() {
  return [
    { slot: 1, sessionId: null, videoId: null, title: null, startedAt: null, lastSeen: null },
    { slot: 2, sessionId: null, videoId: null, title: null, startedAt: null, lastSeen: null },
    { slot: 3, sessionId: null, videoId: null, title: null, startedAt: null, lastSeen: null }
  ];
}

function cleanup(slots) {
  const now = Date.now();
  for (const s of slots) {
    if (s.sessionId && now - s.lastSeen > SLOT_TIMEOUT_MS) {
      s.sessionId = null;
      s.videoId = null;
      s.title = null;
      s.startedAt = null;
      s.lastSeen = null;
    }
  }
  return slots;
}

async function getSignedB2Url(env, fileName) {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY) {
    throw new Error('Missing B2_KEY_ID or B2_APP_KEY secret in Cloudflare Pages.');
  }

  // Return cached signed URL if available so browser disk cache hits on identical URL
  const cacheKey = `b2_url_${fileName}`;
  if (env.VR_SESSIONS) {
    const cachedUrl = await env.VR_SESSIONS.get(cacheKey);
    if (cachedUrl) return cachedUrl;
  }

  const basicAuth = btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`);
  const authRes = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${basicAuth}` }
  });
  if (!authRes.ok) {
    const errText = await authRes.text();
    throw new Error(`Backblaze B2 auth failed (${authRes.status}): ${errText}`);
  }

  const authData = await authRes.json();
  const storageApi = authData.apiInfo?.storageApi || {};
  const bucket = storageApi.allowed?.buckets?.[0];
  const bucketId = bucket?.id || storageApi.bucketId;
  const bucketName = bucket?.name || storageApi.bucketName;

  if (!bucketId || !bucketName) {
    throw new Error('B2 Application Key must be restricted to your single video bucket.');
  }

  const dlRes = await fetch(`${storageApi.apiUrl}/b2api/v4/b2_get_download_authorization`, {
    method: 'POST',
    headers: {
      Authorization: authData.authorizationToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucketId,
      fileNamePrefix: fileName,
      validDurationInSeconds: 3600
    })
  });
  if (!dlRes.ok) {
    const errText = await dlRes.text();
    throw new Error(`Failed to sign B2 download URL (${dlRes.status}): ${errText}`);
  }

  const dlData = await dlRes.json();
  const signedUrl = `${storageApi.downloadUrl}/file/${bucketName}/${encodeURIComponent(fileName)}?Authorization=${dlData.authorizationToken}`;

  if (env.VR_SESSIONS) {
    await env.VR_SESSIONS.put(cacheKey, signedUrl, { expirationTtl: TOKEN_CACHE_TTL_SEC });
  }

  return signedUrl;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api/, '');
  const kv = env.VR_SESSIONS;

  if (route === '/session/claim' && request.method === 'POST') {
    const { sessionId, videoId, title, file, skipUrl } = await request.json();

    if (kv) {
      let slots = cleanup((await kv.get('slots', 'json')) || defaultSlots());
      let assigned = slots.find(s => s.sessionId === sessionId) || slots.find(s => s.sessionId === null);

      if (!assigned) {
        await kv.put('slots', JSON.stringify(slots));
        return Response.json(
          { full: true, message: 'All 3 viewing stations are currently occupied. Please wait for the operator.' },
          { status: 429 }
        );
      }

      const now = Date.now();
      assigned.sessionId = sessionId;
      assigned.videoId = videoId;
      assigned.title = title;
      assigned.startedAt = assigned.startedAt || now;
      assigned.lastSeen = now;
      await kv.put('slots', JSON.stringify(slots));
    }

    if (skipUrl) {
      return Response.json({ full: false });
    }

    try {
      const streamUrl = await getSignedB2Url(env, file);
      return Response.json({ full: false, streamUrl });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  if (!kv) {
    if (route === '/admin/slots') return Response.json({ slots: defaultSlots(), kvBound: false });
    return Response.json({ ok: true });
  }

  let slots = cleanup((await kv.get('slots', 'json')) || defaultSlots());

  if (route === '/session/heartbeat' && request.method === 'POST') {
    const { sessionId } = await request.json();
    const slot = slots.find(s => s.sessionId === sessionId);
    if (slot) {
      slot.lastSeen = Date.now();
      await kv.put('slots', JSON.stringify(slots));
    }
    return Response.json({ active: Boolean(slot) });
  }

  if (route === '/session/release' && request.method === 'POST') {
    const { sessionId } = await request.json();
    const slot = slots.find(s => s.sessionId === sessionId);
    if (slot) {
      slot.sessionId = null;
      slot.videoId = null;
      slot.title = null;
      slot.startedAt = null;
      slot.lastSeen = null;
      await kv.put('slots', JSON.stringify(slots));
    }
    return Response.json({ released: true });
  }

  if (route === '/admin/slots') {
    return Response.json({ slots, kvBound: true });
  }

  if (route.startsWith('/admin/release/') && request.method === 'POST') {
    const slotNum = Number(route.split('/').pop());
    const s = slots.find(item => item.slot === slotNum);
    if (s) {
      s.sessionId = null;
      s.videoId = null;
      s.title = null;
      s.startedAt = null;
      s.lastSeen = null;
      await kv.put('slots', JSON.stringify(slots));
    }
    return Response.json({ ok: true });
  }

  return new Response('Not found', { status: 404 });
}
