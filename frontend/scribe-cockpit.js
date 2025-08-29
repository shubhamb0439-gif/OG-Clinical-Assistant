// --------------------------------------------------SCribe-cockpit.js ----------------duplicate id working version ----29-08-25------------------------------------

/* Scribe Cockpit (local⇄public aware + CDN socket.io fallback)
   Local env (localhost/LAN/file):    PREFER NGROK → fallback AZURE
   Public env (non-local host):       PREFER AZURE → fallback NGROK
   If /socket.io/socket.io.js isn't served by the endpoint, load client from CDN
   and still connect to the preferred endpoint. If connect fails, auto-failover.
*/

console.log('[SCRIBE] Booting Scribe Cockpit');

// ---------- DOM ----------
const statusPill = document.getElementById('statusPill');
const deviceListEl = document.getElementById('deviceList');
const transcriptEl = document.getElementById('liveTranscript');

const PLACEHOLDER_ID = 'scribe-transcript-placeholder';
const MAX_TRANSCRIPT_LINES = 300;

// ---------- Endpoints & env ----------
const NGROK_URL = 'https://76c4ffa27855.ngrok-free.app'; // ← update when tunnel rotates
const AZURE_URL = 'https://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';

const OVERRIDES = Array.isArray(window.SCRIBE_PUBLIC_ENDPOINTS) ? window.SCRIBE_PUBLIC_ENDPOINTS : null;
const NGROK = (OVERRIDES?.[0] || NGROK_URL).replace(/\/$/, '');
const AZURE = (OVERRIDES?.[1] || AZURE_URL).replace(/\/$/, '');

const host = location.hostname;
const isLocal =
  location.protocol === 'file:' ||
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host.endsWith('.local') ||
  /^192\.168\./.test(host) ||
  /^10\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

const preferred = isLocal ? NGROK : AZURE;
const fallback = isLocal ? AZURE : NGROK;

let SERVER_URL = null;
let socket = null;

// ---------- Helpers (UI) ----------
function ensureTranscriptPlaceholder() {
  if (!transcriptEl) return;
  if (!document.getElementById(PLACEHOLDER_ID)) {
    const ph = document.createElement('p');
    ph.id = PLACEHOLDER_ID;
    ph.className = 'text-gray-400 italic';
    ph.textContent = 'No transcript yet…';
    transcriptEl.appendChild(ph);
  }
}
function removeTranscriptPlaceholder() {
  const ph = document.getElementById(PLACEHOLDER_ID);
  if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
}
function setStatus(status) {
  if (!statusPill) return;
  statusPill.textContent = status;
  statusPill.setAttribute('aria-label', `Connection status: ${status}`);
  statusPill.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
  switch ((status || '').toLowerCase()) {
    case 'connected': statusPill.classList.add('bg-green-500'); break;
    case 'disconnected': statusPill.classList.add('bg-red-600'); break;
    default: statusPill.classList.add('bg-yellow-500');
  }
}

// --- Empty-state helper for devices list (blackout) ---
let forceNoDevices = true; // start in blackout until we connect

function showNoDevices() {
  if (!deviceListEl) return;
  deviceListEl.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'text-gray-400';
  li.textContent = 'No devices online';
  deviceListEl.appendChild(li);
}

// ---------- Script loaders ----------
function loadScript(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      s.remove();
      reject(new Error(`Timeout loading ${src}`));
    }, timeoutMs);

    s.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    s.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error(`Failed to load ${src}`)); } };

    document.head.appendChild(s);
  });
}

// Try to load the endpoint’s built-in client; on failure load CDN client.
async function loadSocketIoClientFor(endpointBase) {
  if (window.io) return; // already present
  const endpointClient = `${endpointBase}/socket.io/socket.io.js`;
  try {
    console.log('[SCRIBE] Trying Socket.IO client from:', endpointClient);
    await loadScript(endpointClient);
    if (window.io) return;
  } catch (e) {
    console.warn('[SCRIBE] Load failed:', String(e));
  }
  // Fallback to CDN
  const CDN = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
  console.log('[SCRIBE] Falling back to Socket.IO CDN:', CDN);
  await loadScript(CDN);
  if (!window.io) throw new Error('Socket.IO client not available after CDN load.');
}

// ---------- Presence mirroring (optional read-only) ----------
let presenceChan = null;
let lastPresenceState = null;
function openPresenceChannel() {
  try {
    presenceChan = new BroadcastChannel('xr-presence');
    presenceChan.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'presence') {
        lastPresenceState = msg.state || 'idle';
        setStatus(lastPresenceState === 'connected' ? 'Connected' : 'Disconnected');

        // Mirror blackout based on presence state
        if (lastPresenceState === 'connected') {
          forceNoDevices = false;
        } else {
          forceNoDevices = true;
          showNoDevices();
        }
      }
    };
  } catch (e) {
    console.warn('[SCRIBE] BroadcastChannel unavailable:', e);
  }
}

// ---------- Devices & transcript rendering ----------
function updateDeviceList(devices) {
  if (!Array.isArray(devices)) return;

  // 🔒 If we’re in blackout (disconnected / duplicate), keep "No devices online"
  if (forceNoDevices) {
    showNoDevices();
    return;
  }

  deviceListEl.innerHTML = '';
  devices.forEach((d) => {
    const name = d.deviceName || d.name || (d.xrId ? `Device (${d.xrId})` : 'Unknown');
    const li = document.createElement('li');
    li.className = 'text-gray-300';
    li.textContent = d.xrId ? `${name} (${d.xrId})` : name;
    deviceListEl.appendChild(li);
  });
  if (devices.length === 0) {
    const li = document.createElement('li');
    li.className = 'text-gray-400';
    li.textContent = 'No devices online';
    deviceListEl.appendChild(li);
  }
}

const transcriptState = { byKey: Object.create(null) };
function transcriptKey(from, to) { return `${from || 'unknown'}->${to || 'unknown'}`; }
function mergeIncremental(prev, next) {
  if (!prev) return next || '';
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  const max = Math.min(prev.length, next.length);
  let k = max;
  while (k > 0 && !prev.endsWith(next.slice(0, k))) k--;
  return prev + next.slice(k);
}
function trimTranscriptIfNeeded() {
  if (!transcriptEl) return;
  const lines = transcriptEl.querySelectorAll('p:not(#' + PLACEHOLDER_ID + ')');
  if (lines.length > MAX_TRANSCRIPT_LINES) {
    const excess = lines.length - MAX_TRANSCRIPT_LINES;
    for (let i = 0; i < excess; i++) {
      const first = transcriptEl.querySelector('p:not(#' + PLACEHOLDER_ID + ')');
      if (first) transcriptEl.removeChild(first);
    }
  }
}
function appendTranscriptLine({ from, to, text, timestamp }) {
  if (!transcriptEl) return;
  removeTranscriptPlaceholder();
  const row = document.createElement('p');
  row.className = 'bg-gray-800 p-2 rounded-lg';
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  row.innerHTML =
    `🗣️ <span class="font-bold">${from || 'Unknown'}</span> ` +
    `<span class="opacity-60">→ ${to || 'Unknown'}</span> ` +
    `<span class="opacity-60">(${time})</span><br>` +
    `${text || ''}`;
  transcriptEl.appendChild(row);
  trimTranscriptIfNeeded();
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
// === Mirror from local BroadcastChannel (main app tab) ===
try {
  const scribeBC = new BroadcastChannel('scribe-transcript');
  scribeBC.onmessage = (e) => {
    const payload = e.data;
    if (payload?.type === 'transcript_console') {
      // Reuse the same path the server would use
      handleSignalMessage(payload);
    }
  };
} catch (e) {
  console.warn('[SCRIBE] BroadcastChannel (scribe-transcript) unavailable:', e);
}

function handleSignalMessage(packet) {
  if (packet?.type !== 'transcript_console') return;
  const p = packet.data || {};
  const { from, to, text = '', final = false, timestamp } = p;

  const key = transcriptKey(from, to);
  const slot = (transcriptState.byKey[key] ||= { partial: '', paragraph: '', flushTimer: null, lastTs: 0 });

  if (!final) {
    slot.partial = text;
    slot.lastTs = Date.parse(timestamp) || Date.now();
    return;
  }

  const mergedFinal = mergeIncremental(slot.partial, text);
  slot.partial = '';
  slot.paragraph = mergeIncremental(slot.paragraph ? (slot.paragraph + ' ') : '', mergedFinal);

  if (slot.flushTimer) clearTimeout(slot.flushTimer);
  slot.flushTimer = setTimeout(() => {
    if (slot.paragraph) {
      appendTranscriptLine({ from, to, text: slot.paragraph, timestamp });
      slot.paragraph = '';
    }
    slot.flushTimer = null;
  }, 800);
}

// ---------- Socket connect with failover ----------
function connectTo(endpointBase, onFailover) {
  return new Promise((resolve) => {
    setStatus('Connecting');
    SERVER_URL = endpointBase;
    const opts = {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      secure: SERVER_URL.startsWith('https://'),
      autoConnect: true,
    };

    // Close any prior socket
    try { socket?.close(); } catch { }
    socket = window.io(SERVER_URL, opts);

    let connected = false;
    const failTimer = setTimeout(() => {
      if (!connected) {
        console.warn('[SCRIBE] Connect timeout, failing over from', endpointBase);
        try { socket.close(); } catch { }
        onFailover?.();
      }
    }, 4000); // 4s to connect before failing over

    socket.on('connect', () => {
      forceNoDevices = false;              // ✅ clear blackout on successful connect

      connected = true;
      clearTimeout(failTimer);
      console.log('[SCRIBE] socket connected →', SERVER_URL);
      if (!lastPresenceState) setStatus('Connected');
      socket.emit('request_device_list');
      // handlers
      socket.on('device_list', updateDeviceList);
      socket.on('signal', handleSignalMessage);
      resolve();
    });

    socket.on('connect_error', (err) => {
      console.warn('[SCRIBE] connect_error on', endpointBase, ':', err?.message || err);
      // let failTimer handle the switch unless it’s clearly dead immediately
    });

    socket.on('disconnect', (reason) => {
      console.log('[SCRIBE] socket disconnected:', reason);
      forceNoDevices = true;               // 🔒 engage blackout while offline
      showNoDevices();

      if (!lastPresenceState) setStatus('Disconnected');
    });
  });
}

// ---------- Boot ----------
(async function boot() {
  try {
    ensureTranscriptPlaceholder();
    openPresenceChannel();

    showNoDevices(); // start with "No devices online" until a connect clears it


    // Always load a client (endpoint client or CDN) for the PREFERRED endpoint.
    await loadSocketIoClientFor(preferred);

    // Try preferred first; on fail, auto-fallback.
    await connectTo(preferred, async () => {
      // If preferred fails (e.g., ngrok down), try loading client for fallback (if needed) and connect.
      if (!window.io) await loadSocketIoClientFor(fallback);
      await connectTo(fallback);
    });
  } catch (e) {
    console.error('[SCRIBE] Failed to initialize:', e);
    setStatus('Disconnected');
    deviceListEl.innerHTML = `
      <li class="text-red-400">
        Could not initialize cockpit. Ensure your signaling server is live:
        ${isLocal ? 'NGROK' : 'AZURE'}
      </li>
    `;
  }
})();
