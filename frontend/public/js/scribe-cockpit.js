// ============================================================================
// SCRIBE COCKPIT (WebSocket-only) — FULL UPDATED FILE
// - NO BroadcastChannel / mirroring (websocket only)
// - Room-scoped persistence + strict room isolation for transcript/SOAP
// - Device status pill logic (2+ Connected / 1 Connecting / 0 Disconnected)
// - Accurate device list without refresh (watchdog poll + tab focus refresh)
// - Transcript rendering only for the active room; clears UI on room switch
// - SOAP default note binds to correct transcript via FIFO queue
// - Timer UI for BOTH:
//    (A) default SOAP generation (from transcript -> soap_note_console)
//    (B) template-generated note (/api/notes/generate)
// - Incremental edit tracking + persistence per section
// - Medication availability inline emojis + persistence; API called only on med box edit
// - EHR sidebar logic preserved (separate escapeHtml helper)
// ============================================================================

console.log('[SCRIBE] Booting Scribe Cockpit (WebSocket-only + room isolation + timers + templates + edit tracking)');

// ====
// DOM elements
// ====
const statusPill = document.getElementById('statusPill');
const deviceListEl = document.getElementById('deviceList');
const transcriptEl = document.getElementById('liveTranscript');
const templateSelectEl = document.getElementById('templateSelect');
let soapHost = document.getElementById('soapNotePanel');

// Action buttons (existing)
const clearBtnEl = document.getElementById('_scribe_clear');
const saveBtnEl = document.getElementById('_scribe_save');
const addEhrBtnEl = document.getElementById('_scribe_add_ehr');

if (!soapHost) {
  console.warn('[SCRIBE] soapNotePanel not found, creating dynamically');
  soapHost = document.createElement('div');
  soapHost.id = 'soapNotePanel';
  soapHost.className = 'flex-1 min-h-0';
  document.body.appendChild(soapHost);
}

// ====
// Constants & State
// ====
const PLACEHOLDER_ID = 'scribe-transcript-placeholder';
const MAX_TRANSCRIPT_LINES = 300;

/**
 * ROOM-SCOPED STORAGE
 * - When currentRoom is set (room_joined), transcript/SOAP state is isolated per room.
 * - When not paired (currentRoom = null), we fall back to legacy keys to preserve behavior.
 */
let currentRoom = null;              // set from room_joined
let COCKPIT_FOR_XR_ID = null;         // from /api/platform/me

function roomLS(base) {
  const r = currentRoom || '__noroom__';
  return `scribe:${r}:${base}`;
}

// Legacy keys (pre-room)
const LEGACY_KEYS = {
  HISTORY: 'scribe.history',
  LATEST_SOAP: 'scribe.latestSoap',
  ACTIVE_ITEM_ID: 'scribe.activeItem',
  MED_AVAIL: 'scribe.medAvailability',
};

const LS_KEYS = {
  HISTORY: () => (currentRoom ? roomLS('history') : LEGACY_KEYS.HISTORY),
  LATEST_SOAP: () => (currentRoom ? roomLS('latestSoap') : LEGACY_KEYS.LATEST_SOAP),
  ACTIVE_ITEM_ID: () => (currentRoom ? roomLS('activeItem') : LEGACY_KEYS.ACTIVE_ITEM_ID),
  MED_AVAIL: () => (currentRoom ? roomLS('medAvailability') : LEGACY_KEYS.MED_AVAIL),
};

// Endpoints
const local = 'http://localhost:8080';
const production = 'https://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';

// Optional override: window.SCRIBE_PUBLIC_ENDPOINTS = [localUrl, productionUrl]
const OVERRIDES = Array.isArray(window.SCRIBE_PUBLIC_ENDPOINTS) ? window.SCRIBE_PUBLIC_ENDPOINTS : null;
const LOCAL = (OVERRIDES?.[0] || local).replace(/\/$/, '');
const PRODUCTION = (OVERRIDES?.[1] || production).replace(/\/$/, '');

const host = location.hostname;
const isLocal =
  location.protocol === 'file:' ||
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host.endsWith('.local') ||
  /^192\.168\./.test(host) ||
  /^10\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

const preferred = isLocal ? LOCAL : PRODUCTION;
const fallback = isLocal ? PRODUCTION : LOCAL;

let SERVER_URL = null;
let socket = null;

// UI state
let latestSoapNote = {};                      // currently rendered note
const transcriptState = { byKey: {} };        // partial merge per (from->to)
let currentActiveItemId = null;

// SOAP generation timer (DEFAULT: transcript -> soap_note_console)
let soapGenerating = false;
let soapNoteTimer = null;
let soapNoteStartTime = null;

// FIFO binding: each transcript item appended -> push its id
const pendingSoapItemQueue = [];

// Total edits badge element
let totalEditsBadgeEl = null;

// Per-textarea incremental state (runtime), persisted into note._editMeta
const editStateMap = new WeakMap(); /* { ann: Array<{ch,tag}>, ins, del } */

// ============================================================================
// localStorage helpers
// ============================================================================
function lsSafeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveHistory(arr) {
  localStorage.setItem(LS_KEYS.HISTORY(), JSON.stringify(arr || []));
}
function loadHistory() {
  return lsSafeParse(LS_KEYS.HISTORY(), []);
}
function saveLatestSoap(soap) {
  localStorage.setItem(LS_KEYS.LATEST_SOAP(), JSON.stringify(soap || {}));
}
function loadLatestSoap() {
  return lsSafeParse(LS_KEYS.LATEST_SOAP(), {});
}
function saveActiveItemId(id) {
  localStorage.setItem(LS_KEYS.ACTIVE_ITEM_ID(), id || '');
}
function loadActiveItemId() {
  return localStorage.getItem(LS_KEYS.ACTIVE_ITEM_ID()) || '';
}
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ============================================================================
// UI Styles (dropdown + SOAP panel readability) — preserved from your update
// ============================================================================
function ensureUiStyles() {
  if (document.getElementById('scribe-ui-css')) return;

  const MAIN_BG = '#0b1220';
  const BOX_BG = '#111827';
  const TEXT = '#e5e7eb';
  const MUTED = '#94a3b8';
  const BORDER = 'rgba(148,163,184,0.25)';

  const s = document.createElement('style');
  s.id = 'scribe-ui-css';
  s.textContent = `
    #templateSelect {
      background: #0f1724 !important;
      color: #ffffff !important;
      border: 1px solid rgba(255,255,255,0.12) !important;
      border-radius: 8px;
      padding: 8px 10px;
      outline: none;
      width: 320px;
      max-width: 48vw;
      min-width: 220px;
      box-sizing: border-box;
      font-size: 14px;
      appearance: auto;
    }
    #templateSelect:hover { background: rgba(55, 65, 81, 0.75) !important; }
    #templateSelect:focus { box-shadow: 0 0 0 2px rgba(96,165,250,0.35); }
    #templateSelect option { background: ${MAIN_BG} !important; color: #fff !important; padding: 6px 10px; }

    select::-webkit-scrollbar, .scribe-soap-scroll::-webkit-scrollbar, .med-overlay::-webkit-scrollbar { width: 10px; height: 10px; }
    select::-webkit-scrollbar-thumb, .scribe-soap-scroll::-webkit-scrollbar-thumb, .med-overlay::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.08); border-radius: 8px; border: 2px solid rgba(0,0,0,0.0);
    }
    select::-webkit-scrollbar-track, .scribe-soap-scroll::-webkit-scrollbar-track, .med-overlay::-webkit-scrollbar-track {
      background: transparent; border-radius: 8px;
    }
    select { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }

    #soapNotePanel, #soapScroller { background: ${MAIN_BG} !important; color: ${TEXT} !important; }
    .scribe-soap-scroll {
      padding: 10px 12px;
      height: 100%;
      overflow: auto;
      background: ${MAIN_BG} !important;
      border-radius: 6px;
    }
    .scribe-section {
      margin: 10px 0;
      border: 1px solid ${BORDER};
      border-radius: 10px;
      overflow: hidden;
      background: ${BOX_BG} !important;
    }
    .scribe-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: ${MAIN_BG} !important;
      color: ${TEXT} !important;
      border-bottom: 1px solid ${BORDER};
    }
    .scribe-section-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: ${TEXT} !important; }
    .scribe-section-meta { font-size: 12px; color: ${MUTED} !important; white-space: nowrap; opacity: 0.95; }

    .scribe-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: none;
      outline: none;
      resize: none;
      background: ${BOX_BG} !important;
      color: ${TEXT} !important;
      font-size: 14px;
      line-height: 1.45;
      min-height: 80px;
    }

    .scribe-heading-flex { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    ._scribe_total_edits {
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:6px 10px;
      border-radius:999px;
      background: rgba(255,255,255,0.08);
      color: ${TEXT};
      font-weight: 700;
      font-size: 12px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(s);
}

// ============================================================================
// Status pill
// ============================================================================
function setStatus(status) {
  if (!statusPill) return;
  statusPill.textContent = status;
  statusPill.setAttribute('aria-label', `Connection status: ${status}`);

  statusPill.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
  switch ((status || '').toLowerCase()) {
    case 'connected':
      statusPill.classList.add('bg-green-500');
      break;
    case 'disconnected':
      statusPill.classList.add('bg-red-600');
      break;
    default:
      statusPill.classList.add('bg-yellow-500');
  }
}

/**
 * DEVICE STATUS PILL LOGIC (strict)
 * - 2+ devices => Connected (green)
 * - 1 device => Connecting (yellow)
 * - 0 devices => Disconnected (red)
 * Note: if socket disconnected, always Disconnected.
 */
function updateConnectionStatus(src = '', devices = []) {
  const connected = !!(socket && socket.connected);
  const count = Array.isArray(devices) ? devices.length : 0;

  if (!connected) {
    console.log('[COCKPIT][STATUS]', { src, connected, count, status: 'Disconnected' });
    setStatus('Disconnected');
    return;
  }

  const status = count === 0 ? 'Disconnected' : count === 1 ? 'Connecting' : 'Connected';
  console.log('[COCKPIT][STATUS]', { src, connected, count, status, currentRoom });
  setStatus(status);
}

// ============================================================================
// Devices list + watchdog poll (no refresh needed)
// ============================================================================
let _reqListTimer = null;
let _lastReqListAt = 0;
let _deviceListPollTimer = null;

function requestDeviceListThrottled(why) {
  const now = Date.now();
  const minGapMs = currentRoom ? 250 : 1200;

  if (now - _lastReqListAt < minGapMs) {
    console.debug('[COCKPIT][REQ_LIST] throttled', { why, currentRoom, sinceMs: now - _lastReqListAt });
    return;
  }
  if (_reqListTimer) return;

  _reqListTimer = setTimeout(() => {
    _reqListTimer = null;
    _lastReqListAt = Date.now();
    if (!socket?.connected) return;
    try {
      socket.emit('request_device_list');
      console.debug('[COCKPIT][REQ_LIST] sent', { why, currentRoom, socketId: socket.id });
    } catch (e) {
      console.warn('[COCKPIT][REQ_LIST] emit failed', { why, e });
    }
  }, 50);
}

function startDeviceListWatchdog() {
  stopDeviceListWatchdog();
  _deviceListPollTimer = setInterval(() => {
    if (!socket?.connected) return;
    if (document.visibilityState === 'hidden') return;
    requestDeviceListThrottled('watchdog_poll');
  }, 1500);
}
function stopDeviceListWatchdog() {
  if (_deviceListPollTimer) {
    clearInterval(_deviceListPollTimer);
    _deviceListPollTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestDeviceListThrottled('tab_visible');
  }
});

function showNoDevices() {
  if (!deviceListEl) return;
  deviceListEl.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'text-gray-400';
  li.textContent = 'No devices online';
  deviceListEl.appendChild(li);
}

function updateDeviceList(payload) {
  const devices = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.devices)
      ? payload.devices
      : [];

  if (!deviceListEl) return;

  deviceListEl.innerHTML = '';

  if (devices.length === 0) {
    showNoDevices();
    updateConnectionStatus('device_list', devices);
    return;
  }

  devices.forEach(d => {
    const name = d?.deviceName || d?.name || (d?.xrId ? `Device (${d.xrId})` : 'Unknown');
    const li = document.createElement('li');
    li.className = 'text-gray-300';
    li.textContent = d?.xrId ? `${name} (${d.xrId})` : name;
    deviceListEl.appendChild(li);
  });

  updateConnectionStatus('device_list', devices);
}


// ============================================================================
// Transcript helpers
// ============================================================================
function transcriptKey(from, to) {
  return `${from || 'unknown'}->${to || 'unknown'}`;
}

function mergeIncremental(prev, next) {
  if (!prev) return next || '';
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  let k = Math.min(prev.length, next.length);
  while (k > 0 && !prev.endsWith(next.slice(0, k))) k--;
  return prev + next.slice(k);
}

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

function applyClamp(el, collapse = true) {
  if (collapse) {
    el.dataset.collapsed = 'true';
    el.style.display = '-webkit-box';
    el.style.webkitBoxOrient = 'vertical';
    el.style.webkitLineClamp = '4';
    el.style.overflow = 'hidden';
    el.style.maxHeight = '';
  } else {
    el.dataset.collapsed = 'false';
    el.style.display = '';
    el.style.webkitBoxOrient = '';
    el.style.webkitLineClamp = '';
    el.style.overflow = '';
    el.style.maxHeight = 'none';
  }
}

function createTranscriptCard(item) {
  const { id, from, to, text, timestamp } = item;

  const card = document.createElement('div');
  card.className = 'scribe-card';
  card.dataset.id = id;

  const header = document.createElement('div');
  header.className = 'text-sm mb-1';

  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  header.innerHTML = `🗣️ <span class="font-bold">${escapeHtml(from || 'Unknown')}</span>
    <span class="opacity-60">→ ${escapeHtml(to || 'Unknown')}</span>
    <span class="opacity-60">(${time})</span>`;
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'text-sm leading-6 text-gray-100';
  body.style.textAlign = 'justify';
  body.textContent = text || '';
  applyClamp(body, true);
  card.appendChild(body);

  const del = document.createElement('button');
  del.setAttribute('data-action', 'delete');
  del.className = 'scribe-delete';
  del.title = 'Delete this transcript & linked notes';
  del.innerHTML = '🗑️';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTranscriptItem(id);
  });
  card.appendChild(del);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button[data-action="delete"]')) return;
    setActiveTranscriptId(id);
    const collapsed = body.dataset.collapsed === 'true';
    applyClamp(body, !collapsed);
  });

  if (id === loadActiveItemId()) card.classList.add('scribe-card-active');
  return card;
}

function highlightActiveCard() {
  if (!transcriptEl) return;
  transcriptEl.querySelectorAll('.scribe-card').forEach(c => c.classList.remove('scribe-card-active'));
  const active = transcriptEl.querySelector(`.scribe-card[data-id="${CSS.escape(loadActiveItemId())}"]`);
  if (active) active.classList.add('scribe-card-active');
}

// ============================================================================
// Per-transcript templates workflow
// ============================================================================
function normalizeHistoryItems(hist) {
  let changed = false;
  for (const item of hist) {
    if (!item.notes) {
      item.notes = { default: null, templates: {} };
      changed = true;
    }
    if (item.soap && !item.notes.default) {
      item.notes.default = item.soap;
      delete item.soap;
      changed = true;
    }
    if (!item.notes.templates) {
      item.notes.templates = {};
      changed = true;
    }
    if (!item.activeTemplateId) {
      item.activeTemplateId = 'default';
      changed = true;
    }
  }
  if (changed) saveHistory(hist);
  return hist;
}

function getActiveHistoryContext() {
  const hist = normalizeHistoryItems(loadHistory());
  const activeId = loadActiveItemId();
  const idx = activeId ? hist.findIndex(x => x.id === activeId) : -1;
  const i = idx !== -1 ? idx : (hist.length ? hist.length - 1 : -1);
  return { hist, index: i, item: i !== -1 ? hist[i] : null };
}

function getNoteForItem(item) {
  if (!item) return {};
  const t = String(item.activeTemplateId || 'default');
  if (t === 'default') return item.notes?.default || {};
  return item.notes?.templates?.[t] || item.notes?.default || {};
}

function setTemplateSelectValue(value) {
  if (!templateSelectEl) return;
  const v = String(value ?? 'default');
  const has = Array.from(templateSelectEl.options || []).some(o => o.value === v);
  templateSelectEl.value = has ? v : 'default';
}

function syncDropdownToActiveTranscript() {
  if (!templateSelectEl) return;
  const { item } = getActiveHistoryContext();
  setTemplateSelectValue(item?.activeTemplateId || 'default');
}

// ============================================================================
// SOAP generation timer helpers
// ============================================================================
function stopSoapGenerationTimer() {
  try {
    if (soapNoteTimer) {
      clearInterval(soapNoteTimer);
      soapNoteTimer = null;
    }
  } catch {}
  soapNoteStartTime = null;
}

function startSoapGenerationTimer(kind = 'default') {
  // kind is informational (default/template); UI text already generic below.
  stopSoapGenerationTimer();
  soapGenerating = true;
  soapNoteStartTime = Date.now();
  renderSoapNoteGenerating(0);
  soapNoteTimer = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - soapNoteStartTime) / 1000);
    renderSoapNoteGenerating(elapsedSec);
  }, 1000);
}

function maybeContinueSoapTimerForQueue() {
  // If more transcripts are still waiting for SOAP, keep timer running for next.
  if (pendingSoapItemQueue.length > 0) {
    startSoapGenerationTimer('default_next');
  } else {
    stopSoapGenerationTimer();
    soapGenerating = false;
  }
}

// ============================================================================
// Transcript list operations
// ============================================================================
function setActiveTranscriptId(id) {
  currentActiveItemId = id;
  saveActiveItemId(id);
  highlightActiveCard();

  const ctx = getActiveHistoryContext();
  latestSoapNote = getNoteForItem(ctx.item) || loadLatestSoap() || {};
  if (!soapGenerating) renderSoapNote(latestSoapNote);

  // Dropdown reflects THIS transcript's template selection
  syncDropdownToActiveTranscript();
}

function trimTranscriptIfNeeded() {
  if (!transcriptEl) return;
  const cards = transcriptEl.querySelectorAll('.scribe-card');
  if (cards.length > MAX_TRANSCRIPT_LINES) {
    const excess = cards.length - MAX_TRANSCRIPT_LINES;
    for (let i = 0; i < excess; i++) {
      const first = transcriptEl.querySelector('.scribe-card');
      if (first) transcriptEl.removeChild(first);
    }
  }
}

function appendTranscriptItem({ from, to, text, timestamp }) {
  if (!transcriptEl || !text) return;

  removeTranscriptPlaceholder();

  const item = {
    id: uid(),
    from: from || 'Unknown',
    to: to || 'Unknown',
    text: String(text || '').trim(),
    timestamp: timestamp || Date.now(),
    notes: { default: null, templates: {} },
    activeTemplateId: 'default',
  };

  const hist = normalizeHistoryItems(loadHistory());
  hist.push(item);
  saveHistory(hist);

  const card = createTranscriptCard(item);
  transcriptEl.appendChild(card);
  trimTranscriptIfNeeded();
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  // FIFO binding: this transcript is now awaiting SOAP
  pendingSoapItemQueue.push(item.id);

  // Set active transcript
  setActiveTranscriptId(item.id);

  // Start default SOAP generation timer (one per pending queue)
  // Start only if not already running (prevents flicker)
  if (!soapGenerating) startSoapGenerationTimer('default');
}

function deleteTranscriptItem(id) {
  const hist = normalizeHistoryItems(loadHistory());
  const idx = hist.findIndex(x => x.id === id);
  if (idx === -1) return;

  hist.splice(idx, 1);
  saveHistory(hist);

  const node = transcriptEl?.querySelector(`.scribe-card[data-id="${CSS.escape(id)}"]`);
  if (node) node.remove();

  // Remove from pending queue if present (prevents misbinding)
  const qIdx = pendingSoapItemQueue.indexOf(id);
  if (qIdx !== -1) pendingSoapItemQueue.splice(qIdx, 1);

  const remaining = transcriptEl?.querySelectorAll('.scribe-card') || [];
  if (remaining.length === 0) {
    ensureTranscriptPlaceholder();
    latestSoapNote = {};
    saveLatestSoap(latestSoapNote);
    saveActiveItemId('');
    if (!soapGenerating) renderSoapBlank();
    if (templateSelectEl) setTemplateSelectValue('default');
    return;
  }

  const activeId = loadActiveItemId();
  if (activeId === id) {
    const newActive = hist.length ? hist[hist.length - 1].id : '';
    if (newActive) setActiveTranscriptId(newActive);
  } else {
    highlightActiveCard();
  }
}

// ============================================================================
// SOAP sections ordering
// ============================================================================
function getSoapSections(soap) {
  const defaultSections = [
    'Chief Complaints',
    'History of Present Illness',
    'Subjective',
    'Objective',
    'Assessment',
    'Plan',
    'Medication',
  ];

  const comps = soap?._templateMeta?.components;
  if (Array.isArray(comps) && comps.length) {
    const ordered = comps
      .slice()
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map(x => String(x.name || '').trim())
      .filter(Boolean);
    if (ordered.length) return ordered;
  }

  const keys = Object.keys(soap || {}).filter(k => !k.startsWith('_'));
  if (keys.length) {
    const hasAnyDefault = defaultSections.some(s => keys.includes(s));
    if (!hasAnyDefault) return keys;
  }

  return defaultSections;
}

// ============================================================================
// INCREMENTAL EDIT TRACKING (persistent)
// ============================================================================
const MAX_DELTA_CELLS = 20000;

// RLE encode/decode tags ('B'/'U')
function rleEncodeTags(tags) {
  if (!tags || !tags.length) return [];
  const out = [];
  let last = tags[0], count = 1;
  for (let i = 1; i < tags.length; i++) {
    if (tags[i] === last) count++;
    else {
      out.push([last, count]);
      last = tags[i];
      count = 1;
    }
  }
  out.push([last, count]);
  return out;
}

function rleDecodeToTags(rle, targetLen) {
  if (!Array.isArray(rle) || rle.length === 0) return new Array(targetLen).fill('B');
  const tags = [];
  for (const [tag, cnt] of rle) {
    for (let i = 0; i < cnt && tags.length < targetLen; i++) tags.push(tag === 'U' ? 'U' : 'B');
    if (tags.length >= targetLen) break;
  }
  while (tags.length < targetLen) tags.push('B');
  if (tags.length > targetLen) tags.length = targetLen;
  return tags;
}

function buildLcsTable(prevArr, nextArr) {
  const n = prevArr.length, m = nextArr.length;
  const rows = n + 1, cols = m + 1;
  const table = new Array(rows);
  table[0] = new Uint16Array(cols);
  for (let i = 1; i < rows; i++) {
    const row = new Uint16Array(cols);
    const pi = prevArr[i - 1];
    for (let j = 1; j < cols; j++) {
      if (pi === nextArr[j - 1]) row[j] = table[i - 1][j - 1] + 1;
      else {
        const a = table[i - 1][j], b = row[j - 1];
        row[j] = a > b ? a : b;
      }
    }
    table[i] = row;
  }
  return table;
}

function fastGreedyDelta(prevAnn, nextText, state) {
  const prevChars = prevAnn.map(x => x.ch);
  const nextChars = Array.from(nextText);

  let p = 0;
  while (p < prevChars.length && p < nextChars.length && prevChars[p] === nextChars[p]) p++;

  let s = 0;
  while (
    s < prevChars.length - p &&
    s < nextChars.length - p &&
    prevChars[prevChars.length - 1 - s] === nextChars[nextChars.length - 1 - s]
  ) s++;

  // removals
  for (let i = p; i < prevChars.length - s; i++) {
    const removed = prevAnn[i];
    if (removed.tag === 'U') state.ins = Math.max(0, state.ins - 1);
    else state.del += 1;
  }

  // insertions
  const inserted = [];
  for (let j = p; j < nextChars.length - s; j++) {
    inserted.push({ ch: nextChars[j], tag: 'U' });
    state.ins += 1;
  }

  const prefix = prevAnn.slice(0, p);
  const suffix = prevAnn.slice(prevChars.length - s);
  return [...prefix, ...inserted, ...suffix];
}

function exactDeltaViaLcs(prevAnn, nextText, state) {
  const prevChars = prevAnn.map(x => x.ch);
  const nextChars = Array.from(nextText);
  const table = buildLcsTable(prevChars, nextChars);

  let i = prevChars.length, j = nextChars.length;
  const newAnnRev = [];

  while (i > 0 && j > 0) {
    if (prevChars[i - 1] === nextChars[j - 1]) {
      newAnnRev.push({ ch: nextChars[j - 1], tag: prevAnn[i - 1].tag });
      i--; j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      const removed = prevAnn[i - 1];
      if (removed.tag === 'U') state.ins = Math.max(0, state.ins - 1);
      else state.del += 1;
      i--;
    } else {
      newAnnRev.push({ ch: nextChars[j - 1], tag: 'U' });
      state.ins += 1;
      j--;
    }
  }

  while (i > 0) {
    const removed = prevAnn[i - 1];
    if (removed.tag === 'U') state.ins = Math.max(0, state.ins - 1);
    else state.del += 1;
    i--;
  }
  while (j > 0) {
    newAnnRev.push({ ch: nextChars[j - 1], tag: 'U' });
    state.ins += 1;
    j--;
  }

  newAnnRev.reverse();
  return newAnnRev;
}

function applyIncrementalDiff(box, newText) {
  let state = editStateMap.get(box);
  if (!state) {
    state = { ann: Array.from(newText).map(ch => ({ ch, tag: 'B' })), ins: 0, del: 0 };
    editStateMap.set(box, state);
    return 0;
  }

  const prevAnn = state.ann;
  const n = prevAnn.length, m = newText.length;

  let newAnn;
  if ((n + 1) * (m + 1) > MAX_DELTA_CELLS) newAnn = fastGreedyDelta(prevAnn, newText, state);
  else newAnn = exactDeltaViaLcs(prevAnn, newText, state);

  state.ann = newAnn;
  return Math.max(0, state.ins) + Math.max(0, state.del);
}

// Persist/Restore per-section incremental state into latestSoapNote._editMeta
function persistSectionState(section, state) {
  latestSoapNote._editMeta = latestSoapNote._editMeta || {};
  const tags = state.ann.map(x => x.tag);
  latestSoapNote._editMeta[section] = {
    edits: Math.max(0, state.ins) + Math.max(0, state.del),
    ins: state.ins,
    del: state.del,
    provRLE: rleEncodeTags(tags),
  };
  saveLatestSoap(latestSoapNote);
}

function restoreSectionState(section, contentText) {
  const meta = latestSoapNote?._editMeta?.[section];
  if (!meta) {
    return { ann: Array.from(contentText).map(ch => ({ ch, tag: 'B' })), ins: 0, del: 0, edits: 0 };
  }
  const tags = rleDecodeToTags(meta.provRLE, contentText.length);
  const ann = Array.from(contentText).map((ch, i) => ({ ch, tag: tags[i] === 'U' ? 'U' : 'B' }));
  const ins = Number.isFinite(meta.ins) ? meta.ins : 0;
  const del = Number.isFinite(meta.del) ? meta.del : 0;
  const edits = Number.isFinite(meta.edits) ? meta.edits : Math.max(0, ins) + Math.max(0, del);
  return { ann, ins, del, edits };
}

function rebaseBoxStateToCurrent(box) {
  const current = box.value || '';
  const state = editStateMap.get(box) || { ann: [], ins: 0, del: 0 };
  state.ann = Array.from(current).map(ch => ({ ch, tag: 'B' }));
  state.ins = 0;
  state.del = 0;
  editStateMap.set(box, state);
  persistSectionState(box.dataset.section, state);
}

// ============================================================================
// SOAP note rendering
// ============================================================================
function soapContainerEnsure() {
  let scroller = document.getElementById('soapScroller');
  if (!scroller) {
    scroller = document.createElement('div');
    scroller.id = 'soapScroller';
    scroller.className = 'scribe-soap-scroll scribe-scroll';
    soapHost.appendChild(scroller);
  }
  return scroller;
}

function renderSoapBlank() {
  soapContainerEnsure().innerHTML = '';
}

function autoExpandTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function ensureTopHeadingBadge() {
  // Prefer an existing slot if you have it in HTML:
  const slot = document.getElementById('totalEditsSlot');
  if (!slot) return null;

  if (!totalEditsBadgeEl || !slot.contains(totalEditsBadgeEl)) {
    totalEditsBadgeEl = document.createElement('span');
    totalEditsBadgeEl.id = '_scribe_total_edits';
    totalEditsBadgeEl.className = '_scribe_total_edits';
    totalEditsBadgeEl.textContent = 'Total Edits: 0';
    slot.replaceChildren(totalEditsBadgeEl);
  }
  return totalEditsBadgeEl;
}

function updateTotalsAndEhrState() {
  const scroller = soapContainerEnsure();
  const editors = scroller.querySelectorAll('textarea[data-section]');
  let total = 0;

  editors.forEach(t => {
    const n = Number(t.dataset.editCount || 0);
    total += n;
    const headMeta = scroller.querySelector(
      `.scribe-section[data-section="${CSS.escape(t.dataset.section)}"] .scribe-section-meta`
    );
    if (headMeta) headMeta.textContent = `Edits: ${n}`;
  });

  const badge = ensureTopHeadingBadge();
  if (badge) badge.textContent = `Total Edits: ${total}`;

  // Always disabled per your requirement
  if (addEhrBtnEl) {
    addEhrBtnEl.disabled = true;
    addEhrBtnEl.classList.add('scribe-add-ehr-disabled');
  }
}

function initializeEditMetaForSoap(soap) {
  soap._aiMeta = soap._aiMeta || {};
  soap._editMeta = soap._editMeta || {};
  const sections = getSoapSections(soap);
  sections.forEach(section => {
    const val = soap?.[section] || '';
    const textBlock = Array.isArray(val) ? val.join('\n') : String(val || '');
    soap._aiMeta[section] = { text: textBlock };
    soap._editMeta[section] = {
      edits: 0, ins: 0, del: 0,
      provRLE: rleEncodeTags(new Array(textBlock.length).fill('B')),
    };
  });
}

function isMedicationSectionName(section) {
  const s = String(section || '').trim().toLowerCase();
  return s === 'medication' || s === 'medications' || s.includes('medication');
}

function persistActiveNoteFromUI() {
  const ctx = getActiveHistoryContext();
  if (!ctx.item) return;

  const scroller = soapContainerEnsure();
  const editors = scroller.querySelectorAll('textarea[data-section]');
  const soap = {};

  editors.forEach(t => {
    soap[t.dataset.section] = t.value || '';
  });

  soap._aiMeta = latestSoapNote?._aiMeta || {};
  soap._editMeta = latestSoapNote?._editMeta || {};
  if (latestSoapNote?._templateMeta) soap._templateMeta = latestSoapNote._templateMeta;

  // store meds structured (optional)
  const medTextarea = getMedicationTextarea(scroller);
  if (medTextarea) {
    const medications = (medTextarea.value || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(name => ({
        name,
        available: medAvailability.has(normalizeDrugKey(name))
          ? medAvailability.get(normalizeDrugKey(name))
          : null,
      }));
    soap.medications = medications;
  }

  // Update currently active note slot (default OR selected template) for THIS transcript
  const item = ctx.item;
  const t = String(item.activeTemplateId || 'default');

  item.notes = item.notes || { default: null, templates: {} };
  item.notes.templates = item.notes.templates || {};

  if (t === 'default') item.notes.default = soap;
  else item.notes.templates[t] = soap;

  ctx.hist[ctx.index] = item;
  saveHistory(ctx.hist);

  latestSoapNote = soap;
  saveLatestSoap(latestSoapNote);
}

function resetAllEditCountersToZero() {
  const scroller = soapContainerEnsure();

  scroller.querySelectorAll('textarea[data-section]').forEach(textarea => {
    rebaseBoxStateToCurrent(textarea);
    textarea.dataset.editCount = '0';

    const headMeta = scroller.querySelector(
      `.scribe-section[data-section="${CSS.escape(textarea.dataset.section)}"] .scribe-section-meta`
    );
    if (headMeta) headMeta.textContent = 'Edits: 0';
  });

  if (latestSoapNote) latestSoapNote._editMeta = latestSoapNote._editMeta || {};
  Object.keys(latestSoapNote?._aiMeta || {}).forEach(section => {
    latestSoapNote._editMeta[section] = latestSoapNote._editMeta[section] || {};
    latestSoapNote._editMeta[section].edits = 0;
    latestSoapNote._editMeta[section].ins = 0;
    latestSoapNote._editMeta[section].del = 0;
  });

  saveLatestSoap(latestSoapNote);
  updateTotalsAndEhrState();
}

function attachEditTrackingToTextarea(box, aiText) {
  const section = box.dataset.section;
  const contentText = box.value || '';

  const restored = restoreSectionState(section, contentText);
  editStateMap.set(box, { ann: restored.ann, ins: restored.ins, del: restored.del });
  box.dataset.editCount = String(restored.edits);

  const scroller = soapContainerEnsure();
  const headMeta = scroller.querySelector(
    `.scribe-section[data-section="${CSS.escape(section)}"] .scribe-section-meta`
  );
  if (headMeta) headMeta.textContent = `Edits: ${restored.edits}`;

  box.dataset.aiText = aiText || '';

  let rafId = null;
  box.addEventListener('input', () => {
    autoExpandTextarea(box);
    if (rafId) cancelAnimationFrame(rafId);

    rafId = requestAnimationFrame(() => {
      try {
        const now = box.value || '';
        const totalEdits = applyIncrementalDiff(box, now);
        box.dataset.editCount = String(totalEdits);

        const state = editStateMap.get(box);
        persistSectionState(section, state);

        updateTotalsAndEhrState();
        persistActiveNoteFromUI();

        // Medication: validate only when user edits meds box
        if (isMedicationSectionName(section)) {
          medAvailability.clear();
          medicationValidationPending = true;
          renderMedicationInline();

          if (medicationDebounceTimer) clearTimeout(medicationDebounceTimer);
          medicationDebounceTimer = setTimeout(() => checkMedicationsFromTextarea(box), 600);
        }
      } catch (e) {
        console.warn('[SCRIBE] input handler error', e);
      }
      rafId = null;
    });
  });
}

function renderSoapNote(soap) {
  if (soapGenerating) return;

  const scroller = soapContainerEnsure();
  scroller.innerHTML = '';
  ensureTopHeadingBadge();

  if (soap && Object.keys(soap).length && !soap._aiMeta) {
    initializeEditMetaForSoap(soap);
  }

  latestSoapNote = soap || {};
  saveLatestSoap(latestSoapNote);

  const sections = getSoapSections(latestSoapNote);

  sections.forEach(section => {
    const wrap = document.createElement('div');
    wrap.className = 'scribe-section';
    wrap.dataset.section = section;

    const head = document.createElement('div');
    head.className = 'scribe-section-head';

    const h = document.createElement('h3');
    h.textContent = section;

    const metaSpan = document.createElement('div');
    metaSpan.className = 'scribe-section-meta';
    metaSpan.textContent = 'Edits: 0';

    head.appendChild(h);
    head.appendChild(metaSpan);
    wrap.appendChild(head);

    const box = document.createElement('textarea');
    box.className = 'scribe-textarea';
    box.readOnly = false;
    box.dataset.section = section;

    const rawVal = latestSoapNote?.[section];
    const contentText = Array.isArray(rawVal)
      ? rawVal.join('\n')
      : (typeof rawVal === 'string' ? rawVal : '');

    box.value = contentText;
    autoExpandTextarea(box);

    const aiText = latestSoapNote?._aiMeta?.[section]?.text ?? contentText;
    latestSoapNote._aiMeta = latestSoapNote._aiMeta || {};
    latestSoapNote._aiMeta[section] = latestSoapNote._aiMeta[section] || { text: aiText };

    attachEditTrackingToTextarea(box, aiText);

    if (isMedicationSectionName(section)) {
      const w = document.createElement('div');
      w.className = 'med-wrap';
      w.appendChild(box);
      wrap.appendChild(w);
    } else {
      wrap.appendChild(box);
    }

    scroller.appendChild(wrap);
  });

  updateTotalsAndEhrState();
  renderMedicationInline();
  scroller.scrollTop = 0;
}

function renderSoapNoteGenerating(elapsed) {
  const scroller = soapContainerEnsure();
  scroller.innerHTML = `
    <div class="scribe-section" style="text-align:center; color:#f59e0b; padding:16px;">
      Please wait, AI is generating the note… ${elapsed}s
    </div>
  `;
  ensureTopHeadingBadge();
}

function renderSoapNoteError(msg) {
  const scroller = soapContainerEnsure();
  scroller.innerHTML = `
    <div class="scribe-section" style="text-align:center; color:#f87171; padding:16px;">
      Error generating note: ${escapeHtml(String(msg || 'Unknown error'))}
    </div>
  `;
  ensureTopHeadingBadge();
}

// ============================================================================
// Template generation (per transcript)
// ============================================================================
async function applyTemplateToActiveTranscript(newTemplateId) {
  if (!SERVER_URL) return;

  const templateId = String(newTemplateId || 'default');
  const ctx = getActiveHistoryContext();
  if (!ctx.item) return;

  const item = ctx.item;
  item.activeTemplateId = templateId;

  // Save now so switching transcripts remembers selection
  saveHistory(ctx.hist);
  saveActiveItemId(item.id);

  // If default: show default note only
  if (templateId === 'default') {
    stopSoapGenerationTimer();
    soapGenerating = false;

    latestSoapNote = item.notes?.default || {};
    saveLatestSoap(latestSoapNote);
    renderSoapNote(latestSoapNote);
    return;
  }

  // If already generated for this template, reuse it
  if (item.notes?.templates?.[templateId]) {
    stopSoapGenerationTimer();
    soapGenerating = false;

    latestSoapNote = item.notes.templates[templateId];
    saveLatestSoap(latestSoapNote);
    renderSoapNote(latestSoapNote);
    return;
  }

  const transcript = String(item.text || '').trim();
  if (!transcript) {
    stopSoapGenerationTimer();
    soapGenerating = false;

    latestSoapNote = item.notes?.default || {};
    renderSoapNote(latestSoapNote);
    return;
  }

  // TEMPLATE TIMER (explicit requirement)
  startSoapGenerationTimer('template');

  try {
    const resp = await fetch(`${SERVER_URL}/api/notes/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, templateId }),
    });

    if (!resp.ok) {
      stopSoapGenerationTimer();
      soapGenerating = false;
      renderSoapNoteError(`Server returned ${resp.status} ${resp.statusText || ''}`);

      // Keep latestSoapNote unchanged
      latestSoapNote = getNoteForItem(item) || loadLatestSoap() || {};
      saveLatestSoap(latestSoapNote);
      return;
    }

    const data = await resp.json();
    const note = data.note || {};

    // New AI baseline
    initializeEditMetaForSoap(note);

    // Store ONLY on this transcript item
    item.notes = item.notes || { default: null, templates: {} };
    item.notes.templates = item.notes.templates || {};
    item.notes.templates[templateId] = note;

    ctx.hist[ctx.index] = item;
    saveHistory(ctx.hist);

    stopSoapGenerationTimer();
    soapGenerating = false;

    latestSoapNote = note;
    saveLatestSoap(latestSoapNote);
    renderSoapNote(latestSoapNote);
  } catch (e) {
    stopSoapGenerationTimer();
    soapGenerating = false;

    renderSoapNoteError(String(e?.message || e));

    latestSoapNote = getNoteForItem(item) || loadLatestSoap() || {};
    saveLatestSoap(latestSoapNote);
  }
}

// ============================================================================
// Templates dropdown population
// ============================================================================
async function initTemplateDropdown() {
  if (!templateSelectEl || !SERVER_URL) return;

  templateSelectEl.innerHTML = '';

  const optDefault = document.createElement('option');
  optDefault.value = 'default';
  optDefault.textContent = 'SOAP Note';
  templateSelectEl.appendChild(optDefault);

  try {
    const resp = await fetch(`${SERVER_URL}/api/templates`);
    if (resp.ok) {
      const data = await resp.json();
      const templates = data.templates || [];
      templates.forEach(t => {
        const opt = document.createElement('option');
        opt.value = String(t.id);
        opt.textContent = t.name || t.short_name || `Template ${t.id}`;
        templateSelectEl.appendChild(opt);
      });
    } else {
      console.warn('[TEMPLATE] /api/templates failed:', resp.status);
    }
  } catch (e) {
    console.warn('[TEMPLATE] template fetch error', e);
  }

  syncDropdownToActiveTranscript();

  templateSelectEl.onchange = () => {
    applyTemplateToActiveTranscript(templateSelectEl.value || 'default');
  };
}

// ============================================================================
// Medication availability (inline emojis) + persistence
// ============================================================================
const medAvailability = new Map();
let medicationValidationPending = false;
let medicationDebounceTimer = null;

function saveMedStatus(byName, lastText) {
  localStorage.setItem(
    LS_KEYS.MED_AVAIL(),
    JSON.stringify({ byName: byName || {}, lastText: lastText || '' })
  );
}
function loadMedStatus() {
  const { byName = {}, lastText = '' } =
    lsSafeParse(LS_KEYS.MED_AVAIL(), { byName: {}, lastText: '' }) || {};
  return { byName, lastText };
}

function normalizeDrugKey(str) {
  if (!str) return '';
  let s = String(str).trim();
  s = s.replace(/\s+for\s+.+$/i, '');
  s = s.replace(/\s*[\(\[\{].*?[\)\]\}]\s*$/g, '');
  s = s.split(/\s*[-,:@|]\s*/)[0];
  s = s.replace(/\s+/g, ' ').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
  return s.toLowerCase();
}

function normalizedMedicationBlock(textarea) {
  const lines = (textarea?.value || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(normalizeDrugKey);
  return lines.join('\n');
}

async function checkMedicationsFromTextarea(textarea) {
  if (!textarea || !SERVER_URL) return;

  const currentNormalized = normalizedMedicationBlock(textarea);
  const { byName: persistedByName, lastText } = loadMedStatus();

  // unchanged => use cache, NO API call
  if (currentNormalized === lastText) {
    medAvailability.clear();
    Object.entries(persistedByName).forEach(([k, v]) => medAvailability.set(k, !!v));
    medicationValidationPending = false;
    renderMedicationInline();
    return;
  }

  const rawLines = (textarea.value || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!rawLines.length) {
    medAvailability.clear();
    saveMedStatus({}, currentNormalized);
    medicationValidationPending = false;
    renderMedicationInline();
    return;
  }

  medicationValidationPending = true;
  renderMedicationInline();

  try {
    const response = await fetch(`${SERVER_URL}/api/medications/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: rawLines }),
    });

    if (!response.ok) {
      console.warn('[MED_CHECK] API error:', response.status);
      medicationValidationPending = false;
      renderMedicationInline();
      return;
    }

    const data = await response.json();
    const results = data.results || [];

    medAvailability.clear();
    const newByName = {};

    results.forEach(item => {
      const rawName = (item.name ?? item.query ?? item.drug ?? item.drugName ?? '').toString();
      const key = normalizeDrugKey(rawName);
      if (!key) return;
      const available =
        typeof item.available === 'boolean'
          ? item.available
          : (item.status === 'exists' || item.status === 'available' || item.status === true);
      medAvailability.set(key, !!available);
      newByName[key] = !!available;
    });

    saveMedStatus(newByName, currentNormalized);
    medicationValidationPending = false;
    renderMedicationInline();
  } catch (err) {
    console.error('[MED_CHECK] Error:', err);
    medicationValidationPending = false;
    renderMedicationInline();
  }
}

// Medication overlay CSS
function ensureMedStyles() {
  if (document.getElementById('med-inline-css')) return;
  const s = document.createElement('style');
  s.id = 'med-inline-css';
  s.textContent = `
    .med-line { display:flex; align-items:center; gap:8px; }
    .med-emoji { font-weight: 800; display:inline-block; transform-origin:center; }
    .med-wrap { position: relative; }
    .med-overlay {
      position:absolute;
      inset:0;
      pointer-events:none;
      white-space: pre-wrap;
      overflow:hidden;
      font: inherit;
      line-height: inherit;
      color: inherit;
      z-index:2;
    }
    @keyframes pulse { 0%,100% { transform:scale(1); opacity:1; } 50% { transform:scale(.9); opacity:.7; } }
    .med-pending { animation: pulse 1.2s ease-in-out infinite; }
  `;
  document.head.appendChild(s);
}

function getMedicationTextarea(scroller) {
  if (!scroller) return null;
  const editors = scroller.querySelectorAll('textarea[data-section]');
  for (const t of editors) if (isMedicationSectionName(t.dataset.section)) return t;
  return null;
}

function getMedicationSectionElement(scroller) {
  if (!scroller) return null;
  const sections = scroller.querySelectorAll('.scribe-section[data-section]');
  for (const s of sections) if (isMedicationSectionName(s.dataset.section)) return s;
  return null;
}

function ensureMedicationWrap(medSection) {
  const textarea = medSection.querySelector('textarea[data-section]');
  if (!textarea) return null;

  let wrap = medSection.querySelector('.med-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'med-wrap';
    textarea.parentNode.insertBefore(wrap, textarea);
    wrap.appendChild(textarea);
  }

  let overlay = wrap.querySelector('.med-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'med-overlay';
    wrap.appendChild(overlay);
    textarea.addEventListener('scroll', () => {
      overlay.scrollTop = textarea.scrollTop;
    });
  }

  return wrap;
}

function renderMedicationInline() {
  ensureMedStyles();
  const scroller = soapContainerEnsure();
  const medSection = getMedicationSectionElement(scroller);
  if (!medSection) return;

  const wrap = ensureMedicationWrap(medSection);
  const textarea = getMedicationTextarea(scroller);
  const overlay = wrap?.querySelector('.med-overlay');
  if (!wrap || !textarea || !overlay) return;

  // mirror metrics
  const cs = getComputedStyle(textarea);
  overlay.style.padding = cs.padding;
  overlay.style.lineHeight = cs.lineHeight;
  overlay.style.fontSize = cs.fontSize;
  overlay.style.fontFamily = cs.fontFamily;
  overlay.scrollTop = textarea.scrollTop;

  // hydrate in-memory from cache if matches
  const currentNormalized = normalizedMedicationBlock(textarea);
  const { byName, lastText } = loadMedStatus();
  if (currentNormalized === lastText) {
    medAvailability.clear();
    Object.entries(byName).forEach(([k, v]) => medAvailability.set(k, !!v));
  }

  const frag = document.createDocumentFragment();
  const lines = (textarea.value || '').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    const row = document.createElement('div');
    row.className = 'med-line';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = line;
    nameSpan.style.color = 'transparent'; // keep alignment without duplicating visible text
    row.appendChild(nameSpan);

    if (line) {
      const key = normalizeDrugKey(line);
      if (medAvailability.has(key)) {
        const ok = !!medAvailability.get(key);
        const badge = document.createElement('span');
        badge.className = 'med-emoji';
        badge.textContent = ok ? '✅' : '❌';
        row.appendChild(badge);
      } else if (medicationValidationPending) {
        const badge = document.createElement('span');
        badge.className = 'med-emoji med-pending';
        badge.textContent = '⏳';
        row.appendChild(badge);
      }
    }

    frag.appendChild(row);
  }

  overlay.replaceChildren(frag);
}

// Back-compat
function updateMedicationAvailabilityIndicators() {
  renderMedicationInline();
}

// ============================================================================
// Signal handling (Socket.IO only) — room isolation + FIFO SOAP binding
// ============================================================================
function ingestDrugAvailabilityPayload(payload) {
  const arr = Array.isArray(payload) ? payload : (payload ? [payload] : []);

  medAvailability.clear();
  const newByName = {};

  for (const item of arr) {
    const raw = (item?.name ?? item?.query ?? item?.drug ?? item?.drugName ?? '').toString();
    const key = normalizeDrugKey(raw);
    if (!key) continue;

    const available =
      typeof item?.available === 'boolean'
        ? item.available
        : (item?.status === 'exists' || item?.status === 'available' || item?.status === true);

    medAvailability.set(key, !!available);
    newByName[key] = !!available;
  }

  const scroller = soapContainerEnsure();
  const medTextarea = getMedicationTextarea(scroller);
  saveMedStatus(newByName, normalizedMedicationBlock(medTextarea));
  renderMedicationInline();
}

function handleSignalMessage(packet) {
  if (!packet?.type) return;

  // Strict room isolation:
  const msgRoom = packet.roomId ?? packet?.data?.roomId ?? packet?.data?.room ?? null;
  if (msgRoom && !currentRoom) return;
  if (msgRoom && currentRoom && msgRoom !== currentRoom) return;

  if (packet.type === 'drug_availability' || packet.type === 'drug_availability_console') {
    ingestDrugAvailabilityPayload(packet.data);
    return;
  }

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
        appendTranscriptItem({ from, to, text: slot.paragraph, timestamp });
        slot.paragraph = '';
      }
      slot.flushTimer = null;
    }, 800);

    return;
  }

 if (packet.type === 'soap_note_console') {
  const soap = packet.data || {};
  initializeEditMetaForSoap(soap);

  const hist = normalizeHistoryItems(loadHistory());

  // Bind to correct transcript via FIFO
  const targetId = pendingSoapItemQueue.length
    ? pendingSoapItemQueue.shift()
    : loadActiveItemId();

  const idx = hist.findIndex(x => x.id === targetId);

  if (idx !== -1) {
    hist[idx].notes = hist[idx].notes || { default: null, templates: {} };
    hist[idx].notes.default = soap;
  }

  saveHistory(hist);

  // Decide whether we should render this SOAP now (only if active + default)
  const activeId = loadActiveItemId();
  const isActive = activeId === targetId;
  const isDefault =
    idx !== -1
      ? String(hist[idx].activeTemplateId || 'default') === 'default'
      : true;

  // CRITICAL FIX:
  // Stop the timer + flip soapGenerating OFF BEFORE rendering,
  // otherwise renderSoapNote() early-returns and note never shows.
  stopSoapGenerationTimer();
  soapGenerating = false;

  if (isActive && isDefault) {
    latestSoapNote = soap;
    saveLatestSoap(latestSoapNote);
    renderSoapNote(latestSoapNote);
    syncDropdownToActiveTranscript();
  } else {
    // If not rendering now, keep latestSoapNote as the currently active note
    // (avoid UI jumping to non-active transcript's note)
    const ctx = getActiveHistoryContext();
    latestSoapNote = getNoteForItem(ctx.item) || loadLatestSoap() || {};
    saveLatestSoap(latestSoapNote);
  }

  // Restart timer ONLY if the ACTIVE transcript is still waiting in queue
  if (pendingSoapItemQueue.includes(activeId)) {
    startSoapGenerationTimer('default_next');
  }

  // IMPORTANT: do not auto-call meds API; just render from cache if present
  renderMedicationInline();
  return;
}

}

// ============================================================================
// Socket.IO loader + connection
// ============================================================================
async function loadScript(src, timeoutMs = 8000) {
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

    s.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };

    s.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`Failed to load ${src}`));
    };

    document.head.appendChild(s);
  });
}

async function loadSocketIoClientFor(endpointBase) {
  if (window.io) return;

  const endpointClient = `${endpointBase}/socket.io/socket.io.js`;
  try {
    console.log('[SCRIBE] Trying Socket.IO client from:', endpointClient);
    await loadScript(endpointClient);
    if (window.io) return;
  } catch (e) {
    console.warn('[SCRIBE] Load failed:', String(e));
  }

  const CDN = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
  console.log('[SCRIBE] Falling back to Socket.IO CDN:', CDN);
  await loadScript(CDN);

  if (!window.io) throw new Error('Socket.IO client not available after CDN load.');
}

/**
 * Room switch cleanup
 * - Stops pending flush timers
 * - Clears transcript DOM & SOAP UI
 * - Clears pending SOAP queue (so old room SOAP doesn't attach to new room)
 * - DOES NOT delete room storage (history stays under its room key)
 */
function clearCockpitUiForRoomSwitch(prevRoom, nextRoom) {
  if (prevRoom === nextRoom) return;

  console.warn('[COCKPIT][ROOM][CLEAR] switching rooms', { prevRoom, nextRoom });

  // stop default SOAP generation timer
  stopSoapGenerationTimer();
  soapGenerating = false;

  // stop any pending transcript flush timers
  try {
    Object.values(transcriptState.byKey || {}).forEach(slot => {
      try { if (slot?.flushTimer) clearTimeout(slot.flushTimer); } catch {}
    });
  } catch {}
  transcriptState.byKey = {};

  // wipe transcript DOM
  try { if (transcriptEl) transcriptEl.innerHTML = ''; } catch {}
  try { ensureTranscriptPlaceholder(); } catch {}

  // wipe in-memory selection + pending queue
  currentActiveItemId = null;
  pendingSoapItemQueue.length = 0;
  latestSoapNote = {};

  // clear SOAP UI
  try { renderSoapBlank(); } catch {}

  // dropdown resets visually until restore
  try { if (templateSelectEl) setTemplateSelectValue('default'); } catch {}

  // clear med in-memory; restore() will rehydrate if matching cached text
  try { medAvailability.clear(); } catch {}
  medicationValidationPending = false;
}

function connectTo(endpointBase, onFailover) {
  return new Promise(resolve => {
    setStatus('Connecting');
    SERVER_URL = endpointBase;

    const opts = {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      secure: SERVER_URL.startsWith('https://'),
    };

    // stop poller for old socket before swapping
    stopDeviceListWatchdog();

    try { socket?.close(); } catch {}

    socket = window.io(SERVER_URL, opts);

    let connected = false;
    const failTimer = setTimeout(() => {
      if (!connected) onFailover?.();
    }, 4000);

    socket.on('connect', async () => {
      connected = true;
      clearTimeout(failTimer);

      // attach core listeners (ensure no duplicates)
      socket.off('device_list', updateDeviceList);
      socket.off('signal', handleSignalMessage);
      socket.off('room_joined');
      socket.off('peer_left');
      socket.off('room_update');
      socket.off('telemetry_update');

      socket.on('device_list', updateDeviceList);
      socket.on('signal', handleSignalMessage);

      // room_update: if pairing appears, refresh device list (throttled)
      socket.on('room_update', ({ pairs } = {}) => {
        try {
          if (!COCKPIT_FOR_XR_ID) return;
          const me = String(COCKPIT_FOR_XR_ID).trim().toUpperCase();
          const list = Array.isArray(pairs) ? pairs : [];
          const inAnyPair = list.some(p => {
            const a = String(p?.a || '').trim().toUpperCase();
            const b = String(p?.b || '').trim().toUpperCase();
            return a === me || b === me;
          });
          if (inAnyPair && !currentRoom) {
            console.log('[COCKPIT][ROOM_UPDATE] pair detected for me; requesting device_list');
            requestDeviceListThrottled('room_update_pair_detected');
          }
        } catch (e) {
          console.warn('[COCKPIT][ROOM_UPDATE] handler error', e);
        }
      });

      // telemetry_update: bootstrap single-device visibility before pairing
      socket.on('telemetry_update', (t = {}) => {
        try {
          if (!COCKPIT_FOR_XR_ID) return;
          const me = String(COCKPIT_FOR_XR_ID).trim().toUpperCase();
          const xr = String(t?.xrId || '').trim().toUpperCase();
          if (!xr) return;
          if (xr !== me) return;
          if (!currentRoom) requestDeviceListThrottled('telemetry_bootstrap_single_device');
        } catch (e) {
          console.warn('[COCKPIT][TELEMETRY_UPDATE] handler error', e);
        }
      });

      socket.on('peer_left', ({ xrId, roomId, reason } = {}) => {
        if (roomId && currentRoom && roomId !== currentRoom) return;

        const prevRoom = currentRoom;
        currentRoom = null;

        console.warn('[COCKPIT] peer_left', { xrId, roomId, reason, prevRoom });

        clearCockpitUiForRoomSwitch(prevRoom, null);

        showNoDevices();
        updateConnectionStatus('peer_left', []);
        requestDeviceListThrottled('after_peer_left');
      });

      socket.on('room_joined', ({ roomId, reason, members } = {}) => {
        const prevRoom = currentRoom;
        const nextRoom = roomId || null;

        console.log('[COCKPIT][ROOM] room_joined (raw)', { prevRoom, nextRoom, reason, members, socketId: socket.id });

        clearCockpitUiForRoomSwitch(prevRoom, nextRoom);

        // Set room BEFORE restore (restore uses currentRoom for storage keys)
        currentRoom = nextRoom;

        // Status pill depends on device_list; we still show "Connecting" until list arrives
        updateConnectionStatus('room_joined', []);

        try {
          restoreFromLocalStorage();
          console.debug('[COCKPIT][RESTORE] after room_joined', {
            currentRoom,
            historyCount: (loadHistory() || []).length,
            activeId: loadActiveItemId(),
          });
        } catch (e) {
          console.warn('[COCKPIT][RESTORE] failed after room_joined', e);
        }

        if (currentRoom) requestDeviceListThrottled('after_room_joined');
      });

      // Identify as cockpit using /api/platform/me xrId
      try {
        const meRes = await fetch('/api/platform/me', { credentials: 'include' });
        const me = await meRes.json();
        const xrId = (me?.xrId || me?.xr_id || '').toString().trim();
        COCKPIT_FOR_XR_ID = xrId || null;

        if (xrId) {
          socket.emit('identify', {
            xrId,
            deviceName: 'XR Dock (Scribe Cockpit)',
            clientType: 'cockpit',
          });
        } else {
          console.warn('[SCRIBE] /api/platform/me returned no xrId');
        }
      } catch (e) {
        console.warn('[SCRIBE] Failed to load /api/platform/me for identify:', e);
      }

      // request list after identify
      requestDeviceListThrottled('after_identify');

      // start watchdog so device list stays accurate without refresh
      startDeviceListWatchdog();

      resolve();
    });

    socket.on('connect_error', err => console.warn('[SCRIBE] connect_error:', err));

    socket.on('disconnect', (reason) => {
      console.warn('[COCKPIT] disconnect', { reason, socketId: socket?.id, currentRoom });

      const prevRoom = currentRoom;
      currentRoom = null;

      _lastReqListAt = 0;
      stopDeviceListWatchdog();

      clearCockpitUiForRoomSwitch(prevRoom, null);

      showNoDevices();
      updateConnectionStatus('disconnect', []);
    });
  });
}

// ============================================================================
// Restore state from localStorage (strictly for currentRoom)
// ============================================================================
function restoreFromLocalStorage() {
  // Transcript history
  if (transcriptEl) transcriptEl.innerHTML = '';
  const hist = normalizeHistoryItems(loadHistory());

  if (!hist.length) ensureTranscriptPlaceholder();
  else {
    removeTranscriptPlaceholder();
    hist.forEach(item => transcriptEl?.appendChild(createTranscriptCard(item)));
  }

  // Active transcript
  const activeId = loadActiveItemId();
  if (!activeId && hist.length) saveActiveItemId(hist[hist.length - 1].id);

  highlightActiveCard();
  ensureTopHeadingBadge();

  // Render active transcript's note (default/template)
  const ctx = getActiveHistoryContext();
  latestSoapNote = getNoteForItem(ctx.item) || loadLatestSoap() || {};

  if (!hist.length) renderSoapBlank();
  else renderSoapNote(latestSoapNote);

  // Dropdown reflects active transcript selection
  syncDropdownToActiveTranscript();

  // Restore cached med availability if matches
  const scroller = soapContainerEnsure();
  const medTextarea = getMedicationTextarea(scroller);
  if (medTextarea) {
    const currentNormalized = normalizedMedicationBlock(medTextarea);
    const { byName, lastText } = loadMedStatus();
    if (currentNormalized === lastText) {
      medAvailability.clear();
      Object.entries(byName).forEach(([k, v]) => medAvailability.set(k, !!v));
    }
  }
  renderMedicationInline();
}

// ============================================================================
// Wire HTML buttons
// ============================================================================
function wireSoapActionButtons() {
  const scroller = soapContainerEnsure();

  if (clearBtnEl) {
    clearBtnEl.onclick = () => {
      scroller.querySelectorAll('textarea[data-section]').forEach(t => {
        t.value = '';
        autoExpandTextarea(t);
        rebaseBoxStateToCurrent(t);
        t.dataset.editCount = '0';

        const headMeta = scroller.querySelector(
          `.scribe-section[data-section="${CSS.escape(t.dataset.section)}"] .scribe-section-meta`
        );
        if (headMeta) headMeta.textContent = 'Edits: 0';
      });

      persistActiveNoteFromUI();

      // Clear med cache for this room note text
      saveMedStatus({}, '');
      medAvailability.clear();
      medicationValidationPending = false;
      renderMedicationInline();

      resetAllEditCountersToZero();
      console.log('[SCRIBE] SOAP cleared and edit counters reset.');
    };
  }

  if (saveBtnEl) {
    saveBtnEl.onclick = () => {
      persistActiveNoteFromUI();
      scroller.querySelectorAll('textarea[data-section]').forEach(t => rebaseBoxStateToCurrent(t));
      resetAllEditCountersToZero();
      console.log('[SCRIBE] SOAP saved and edit counters reset.');
    };
  }

  if (addEhrBtnEl) {
    addEhrBtnEl.disabled = true;
    addEhrBtnEl.classList.add('scribe-add-ehr-disabled');
    addEhrBtnEl.onclick = () => {
      console.log('[SCRIBE] Add EHR is disabled (placeholder).');
      scroller.querySelectorAll('textarea[data-section]').forEach(t => rebaseBoxStateToCurrent(t));
      resetAllEditCountersToZero();
    };
  }
}

// ============================================================================
// Boot
// ============================================================================
(async function boot() {
  try {
    ensureUiStyles();
    ensureMedStyles();
    ensureTranscriptPlaceholder();
    showNoDevices();

    // restore whatever we have before pairing (legacy or last room keys)
    restoreFromLocalStorage();

    wireSoapActionButtons();

    await loadSocketIoClientFor(preferred);
    await connectTo(preferred, async () => {
      if (!window.io) await loadSocketIoClientFor(fallback);
      await connectTo(fallback);
    });

    await initTemplateDropdown();

    console.log('[SCRIBE] Cockpit booted successfully');
  } catch (e) {
    console.error('[SCRIBE] Failed to initialize:', e);
    setStatus('Disconnected');
    if (deviceListEl) {
      deviceListEl.innerHTML =
        `<li class="text-red-400">Could not initialize cockpit. Ensure your signaling server is live (${isLocal ? 'local' : 'production'}).</li>`;
    }
  }
})();

// ============================================================================
// Helpers (Cockpit)
// ============================================================================
function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ============================================================================
// EHR Integration (MRN -> Clinical Notes by short_name) — Summary always first
// (No logic change; uses separate escapeHtmlEhr)
// ============================================================================
const ehrButton = document.getElementById('ehrButton');
const ehrSidebar = document.getElementById('ehrSidebar');
const ehrOverlay = document.getElementById('ehrOverlay');
const ehrCloseButton = document.getElementById('ehrCloseButton');
const mrnInput = document.getElementById('mrnInput');
const mrnSearchButton = document.getElementById('mrnSearchButton');
const ehrError = document.getElementById('ehrError');
const ehrInitialState = document.getElementById('ehrInitialState');
const ehrPatientState = document.getElementById('ehrPatientState');
const patientNameDisplay = document.getElementById('patientNameDisplay');
const patientMRNDisplay = document.getElementById('patientMRNDisplay');
const patientEmailDisplay = document.getElementById('patientEmailDisplay');
const patientMobileDisplay = document.getElementById('patientMobileDisplay');
const notesList = document.getElementById('notesList');
const noteDetail = document.getElementById('noteDetail');

let currentPatient = null;
let currentNotes = [];

const noteCache = new Map(); // noteId -> API response
const SUMMARY_NOTE_ID = 'summary';

const EHR_STORAGE_KEY = 'ehr_state_v1';

function persistEHRState() {
  sessionStorage.setItem(
    EHR_STORAGE_KEY,
    JSON.stringify({
      currentPatient,
      currentNotes,
      activeNoteId: document.querySelector('.ehr-note-item.active')?.dataset?.noteId || SUMMARY_NOTE_ID,
      noteCache: [...noteCache.entries()],
    })
  );
}

function restoreEHRState() {
  const raw = sessionStorage.getItem(EHR_STORAGE_KEY);
  if (!raw) return;

  const state = JSON.parse(raw);

  if (!state.currentPatient || !state.currentNotes || state.currentNotes.length === 0) {
    sessionStorage.removeItem(EHR_STORAGE_KEY);
    resetEHRState();
    return;
  }

  currentPatient = state.currentPatient;
  currentNotes = state.currentNotes || [];
  state.noteCache?.forEach(([k, v]) => noteCache.set(k, v));

  renderPatient(currentPatient);
  renderClinicalNotes(currentNotes);

  const activeId = state.activeNoteId || SUMMARY_NOTE_ID;
  setActiveNote(activeId);

  if (activeId === SUMMARY_NOTE_ID) loadSummary();
  else loadNote(activeId);
}

window.addEventListener('beforeunload', persistEHRState);
window.addEventListener('load', restoreEHRState);

function escapeHtmlEhr(str) {
  return String(str ?? 'N/A')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(dt) {
  if (!dt) return 'N/A';
  const d = new Date(dt);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString();
}

async function apiGetJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

if (ehrButton) {
  ehrButton.onclick = () => {
    ehrSidebar.classList.add('active');
    ehrOverlay.classList.add('active');
  };
}

if (ehrOverlay) {
  ehrOverlay.onclick = () => {
    ehrSidebar.classList.remove('active');
    ehrOverlay.classList.remove('active');
  };
}

if (ehrCloseButton) {
  ehrCloseButton.onclick = () => {
    sessionStorage.removeItem(EHR_STORAGE_KEY);
    resetEHRState();
  };
}

function resetEHRState() {
  ehrSidebar.classList.remove('active');
  ehrOverlay.classList.remove('active');
  ehrInitialState.style.display = 'flex';
  ehrPatientState.style.display = 'none';
  mrnInput.value = '';
  ehrError.style.display = 'none';
  notesList.innerHTML = '';
  noteDetail.innerHTML = '';
  currentPatient = null;
  currentNotes = [];
  noteCache.clear();
}

async function searchMRN() {
  const mrn = mrnInput.value.trim();
  if (!mrn) return;

  ehrError.style.display = 'none';
  mrnSearchButton.disabled = true;
  mrnSearchButton.textContent = 'Searching...';

  noteCache.clear();
  sessionStorage.removeItem(EHR_STORAGE_KEY);

  try {
    const data = await apiGetJson(`${SERVER_URL}/ehr/patient/${encodeURIComponent(mrn)}`);
    currentPatient = data.patient || {};
    currentNotes = (data.notes || []).map(n => ({
      note_id: n.note_id ?? n.patient_note_id,
      short_name: n.short_name,
      template: n.template,
      document_created_date: n.document_created_date,
    }));

    renderPatient(currentPatient);
    renderClinicalNotes(currentNotes);
    noteDetail.innerHTML = `<div class="text-gray-400 text-sm">Select a note to view details</div>`;
  } catch (e) {
    ehrError.textContent = e.message;
    ehrError.style.display = 'block';
  } finally {
    mrnSearchButton.disabled = false;
    mrnSearchButton.textContent = 'Search';
  }
}

if (mrnSearchButton) mrnSearchButton.onclick = searchMRN;
if (mrnInput) mrnInput.addEventListener('keypress', e => e.key === 'Enter' && searchMRN());

function renderPatient(p) {
  ehrInitialState.style.display = 'none';
  ehrPatientState.style.display = 'flex';
  patientNameDisplay.textContent = p.full_name || 'N/A';
  patientMRNDisplay.textContent = p.mrn_no || 'N/A';
  patientEmailDisplay.textContent = p.email || 'N/A';
  if (patientMobileDisplay) patientMobileDisplay.textContent = p.mobile || 'N/A';
}

function renderClinicalNotes(notes) {
  notesList.innerHTML = '';
  notesList.classList.add('ehr-notes-scroll');

  const summary = document.createElement('div');
  summary.className = 'ehr-note-item';
  summary.textContent = 'Summary';
  summary.onclick = () => {
    setActiveNote(SUMMARY_NOTE_ID);
    loadSummary();
  };
  notesList.appendChild(summary);

  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'ehr-note-item';
    item.dataset.noteId = note.note_id;
    item.title = note.short_name;
    item.textContent = note.short_name;
    item.onclick = () => {
      setActiveNote(note.note_id);
      loadNote(note.note_id);
    };
    notesList.appendChild(item);
  });
}

function setActiveNote(noteId) {
  document.querySelectorAll('.ehr-note-item').forEach(el => el.classList.remove('active'));

  const items = [...document.querySelectorAll('.ehr-note-item')];
  const active = items.find(el =>
    el.dataset.noteId == noteId || (noteId === SUMMARY_NOTE_ID && el.textContent === 'Summary')
  );
  if (active) active.classList.add('active');
}

async function loadNote(noteId) {
  noteDetail.innerHTML = `<div class="text-gray-400 text-sm">Loading...</div>`;

  if (noteCache.has(noteId)) {
    const cached = noteCache.get(noteId);
    renderNoteDetail(cached.note.template, cached.note.document_created_date, cached.sections, false);
    return;
  }

  try {
    const data = await apiGetJson(`${SERVER_URL}/ehr/notes/${noteId}`);
    noteCache.set(noteId, data);
    renderNoteDetail(
      data.note?.template || 'Clinical Note',
      data.note?.document_created_date,
      data.sections || [],
      false
    );
  } catch {
    noteDetail.innerHTML = `<div class="text-red-500 text-sm">Failed to load note</div>`;
  }
}

async function loadSummary() {
  noteDetail.innerHTML = `<div class="text-gray-400 text-sm">Generating summary...</div>`;

  const res = await fetch(`${SERVER_URL}/ehr/ai/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mrn: currentPatient?.mrn_no }),
  });

  const data = await res.json();
  renderNoteDetail(data.template_title || 'AI Summary', data.document_created_date, data.sections || [], true);
}

function renderNoteDetail(template, createdDate, sections, isSummary) {
  let html = '';

  if (!isSummary) {
    html += `<div style="font-size:12px;font-weight:600;margin-bottom:12px;">
      DATE: ${escapeHtmlEhr(fmtDate(createdDate))}
    </div>`;
  }

  html += `<div style="text-align:center;font-size:18px;font-weight:800;margin-top:22px;margin-bottom:20px;">
    ${escapeHtmlEhr(template)}
  </div>`;

  sections.forEach(s => {
    html += `<div style="margin-bottom:18px;">
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtmlEhr(s.component)}</div>
      <div>${escapeHtmlEhr(s.text || 'N/A')}</div>
    </div>`;
  });

  noteDetail.innerHTML = html;
}
