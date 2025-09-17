// -------------------------------------------------- Scribe-cockpit.js --------------------------------------------------
// Scribe Cockpit (Beginner-Friendly)
// Mirrors transcript & SOAP note from app.js via BroadcastChannel
// Editable SOAP note panel with real-time updates
// Socket.IO connection for device presence
// Maintains latest transcript & SOAP note until replaced or saved
// -------------------------------------------------------------------------------------------------------------------

console.log('[SCRIBE] Booting Scribe Cockpit');

// ---------- DOM Elements ----------
const statusPill = document.getElementById('statusPill');
const deviceListEl = document.getElementById('deviceList');
const transcriptEl = document.getElementById('liveTranscript');
let soapNoteEl = document.getElementById('soapNotePanel');
if (!soapNoteEl) {
  console.warn('[SCRIBE] soapNotePanel not found, creating dynamically');
  soapNoteEl = document.createElement('div');
  soapNoteEl.id = 'soapNotePanel';
  soapNoteEl.className = 'w-full h-full overflow-y-auto';
  document.body.appendChild(soapNoteEl);
}

const PLACEHOLDER_ID = 'scribe-transcript-placeholder';
const MAX_TRANSCRIPT_LINES = 300;

// ---------- Server Endpoints ----------
const NGROK_URL = 'https://302745982b31.ngrok-free.app';
const AZURE_URL = 'https://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';
const OVERRIDES = Array.isArray(window.SCRIBE_PUBLIC_ENDPOINTS) ? window.SCRIBE_PUBLIC_ENDPOINTS : null;

const NGROK = (OVERRIDES?.[0] || NGROK_URL).replace(/\/$/, '');
const AZURE = (OVERRIDES?.[1] || AZURE_URL).replace(/\/$/, '');
const host = location.hostname;
const isLocal = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') ||
  /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
const preferred = isLocal ? NGROK : AZURE;
const fallback = isLocal ? AZURE : NGROK;

let SERVER_URL = null;
let socket = null;

// ---------- Persistent State ----------
let latestSoapNote = {}; // keeps latest SOAP note
const transcriptState = { byKey: {} }; // stores transcript lines keyed by "from->to"

// ---------- SOAP Note Timer ----------
let soapNoteTimer = null;
let soapNoteStartTime = null;

// ---------- BroadcastChannels ----------
const transcriptBC = new BroadcastChannel('scribe-transcript');
const soapBC = new BroadcastChannel('scribe-soap-note');

// ---------- Utility: Status ----------
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

// ---------- Transcript Placeholder ----------
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

// ---------- Devices List ----------
let forceNoDevices = true;
function showNoDevices() {
  if (!deviceListEl) return;
  deviceListEl.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'text-gray-400';
  li.textContent = 'No devices online';
  deviceListEl.appendChild(li);
}

function updateDeviceList(devices) {
  if (!Array.isArray(devices)) return;
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

// ---------- Transcript Handling ----------
function transcriptKey(from, to) { return `${from || 'unknown'}->${to || 'unknown'}`; }

function mergeIncremental(prev, next) {
  if (!prev) return next || '';
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  let k = Math.min(prev.length, next.length);
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

// ---------- SOAP Note Rendering ----------
function autoExpandTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function renderSoapNote(soap) {
  if (!soapNoteEl) return;
  soapNoteEl.innerHTML = '';

  const sections = [
    'Chief Complaints',
    'History of Present Illness',
    'Subjective',
    'Objective',
    'Assessment',
    'Plan',
    'Medication',
  ];

  sections.forEach(section => {
    const wrapper = document.createElement('div');
    wrapper.className = 'bg-gray-800 p-3 rounded-lg mb-3';

    const label = document.createElement('h3');
    label.className = 'text-base font-semibold mb-2';
    label.textContent = section;

    const box = document.createElement('textarea');
    box.className =
      'w-full bg-gray-900 text-white p-2 rounded-lg resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-primary';
    box.readOnly = false;
    const val = soap?.[section];
    box.value = Array.isArray(val) ? val.join('\n') : typeof val === 'string' ? val : '';

    autoExpandTextarea(box);
    box.addEventListener('input', () => autoExpandTextarea(box));

    wrapper.appendChild(label);
    wrapper.appendChild(box);
    soapNoteEl.appendChild(wrapper);
  });

  soapNoteEl.scrollTop = soapNoteEl.scrollHeight;

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save SOAP Note';
  saveBtn.className = 'mt-2 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700';
  saveBtn.onclick = () => {
    console.log('[DEBUG] Save SOAP Note clicked', latestSoapNote);
  };
  soapNoteEl.appendChild(saveBtn);

  console.log('[DEBUG] SOAP Note rendered in cockpit', soap);
}

function renderSoapNoteGenerating(elapsed) {
  if (!soapNoteEl) return;
  soapNoteEl.innerHTML = `
    <div class="bg-gray-800 p-3 rounded-lg text-center text-yellow-400">
      Please wait, AI is generating the SOAP note… ${elapsed}s
    </div>
  `;
}

// ---------- Handle Incoming Signals ----------
function handleSignalMessage(packet) {
  if (!packet?.type) return;

  if (packet.type === 'transcript_console') {
    const p = packet.data || {};
    const { from, to, text = '', final = false, timestamp } = p;
    const key = transcriptKey(from, to);
    const slot = (transcriptState.byKey[key] ||= { partial: '', paragraph: '', flushTimer: null });

    if (!final) {
      slot.partial = text;
      return;
    }

    const mergedFinal = mergeIncremental(slot.partial, text);
    slot.partial = '';
    slot.paragraph = mergeIncremental(slot.paragraph ? slot.paragraph + ' ' : '', mergedFinal);

    if (slot.flushTimer) clearTimeout(slot.flushTimer);
    slot.flushTimer = setTimeout(() => {
      if (slot.paragraph) {
        appendTranscriptLine({ from, to, text: slot.paragraph, timestamp });
        transcriptBC.postMessage({ type: 'transcript_console', data: { from, to, text: slot.paragraph, final: true, timestamp } });
        slot.paragraph = '';
      }
      slot.flushTimer = null;
    }, 800);

    if (!soapNoteTimer) {
      soapNoteStartTime = Date.now();
      renderSoapNoteGenerating(0);
      soapNoteTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - soapNoteStartTime) / 1000);
        renderSoapNoteGenerating(elapsed);
      }, 1000);
    }
  }

  else if (packet.type === 'soap_note_console') {
    const soap = packet.data || {};
    latestSoapNote = soap;
    const ts = packet.timestamp || Date.now();

    console.log('[DEBUG] SOAP_NOTE Received:', soap);

    // Broadcast for other listeners
    soapBC.postMessage({ type: 'soap_note_console', data: soap, timestamp: ts });

    if (soapNoteTimer) {
      clearInterval(soapNoteTimer);
      soapNoteTimer = null;
    }

    renderSoapNote(soap);
  }
}

// ---------- Mirror BroadcastChannel ----------
try {
  transcriptBC.onmessage = (e) => handleSignalMessage(e.data);
  soapBC.onmessage = (e) => handleSignalMessage(e.data);
} catch (e) {
  console.warn('[SCRIBE] BroadcastChannel unavailable:', e);
}

// ---------- Socket.IO Connection ----------
async function loadScript(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; s.remove(); reject(new Error(`Timeout loading ${src}`)); } }, timeoutMs);
    s.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    s.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error(`Failed to load ${src}`)); } };
    document.head.appendChild(s);
  });
}

async function loadSocketIoClientFor(endpointBase) {
  if (window.io) return;
  const endpointClient = `${endpointBase}/socket.io/socket.io.js`;
  try { console.log('[SCRIBE] Trying Socket.IO client from:', endpointClient); await loadScript(endpointClient); if (window.io) return; }
  catch (e) { console.warn('[SCRIBE] Load failed:', String(e)); }
  const CDN = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
  console.log('[SCRIBE] Falling back to Socket.IO CDN:', CDN);
  await loadScript(CDN);
  if (!window.io) throw new Error('Socket.IO client not available after CDN load.');
}

function connectTo(endpointBase, onFailover) {
  return new Promise(resolve => {
    setStatus('Connecting');
    SERVER_URL = endpointBase;
    const opts = { path: '/socket.io', transports: ['websocket'], reconnection: true, secure: SERVER_URL.startsWith('https://') };
    try { socket?.close(); } catch {}
    socket = window.io(SERVER_URL, opts);

    let connected = false;
    const failTimer = setTimeout(() => { if (!connected) onFailover?.(); }, 4000);

    socket.on('connect', () => {
      forceNoDevices = false;
      connected = true;
      clearTimeout(failTimer);
      socket.emit('request_device_list');
      socket.on('device_list', updateDeviceList);
      socket.on('signal', handleSignalMessage);
      setStatus('Connected');
      resolve();
    });

    socket.on('connect_error', err => console.warn('[SCRIBE] connect_error:', err));
    socket.on('disconnect', () => { forceNoDevices = true; showNoDevices(); setStatus('Disconnected'); });
  });
}

// ---------- Presence Mirroring ----------
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
        forceNoDevices = lastPresenceState !== 'connected';
        if (forceNoDevices) showNoDevices();
      }
    };
  } catch (e) { console.warn('[SCRIBE] BroadcastChannel unavailable:', e); }
}

// ---------- Boot Cockpit ----------
(async function boot() {
  try {
    ensureTranscriptPlaceholder();
    openPresenceChannel();
    showNoDevices();

    await loadSocketIoClientFor(preferred);
    await connectTo(preferred, async () => {
      if (!window.io) await loadSocketIoClientFor(fallback);
      await connectTo(fallback);
    });

    console.log('[SCRIBE] Cockpit booted successfully');
    console.log('[DEBUG] Latest SOAP Note on boot:', latestSoapNote);
  } catch (e) {
    console.error('[SCRIBE] Failed to initialize:', e);
    setStatus('Disconnected');
    deviceListEl.innerHTML = `<li class="text-red-400">Could not initialize cockpit. Ensure your signaling server is live: ${isLocal ? 'NGROK' : 'AZURE'}</li>`;
  }
})();
