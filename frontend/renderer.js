// XR Messaging System - renderer.js (CLEANED VERSION)

// ==== DOM ELEMENTS ====
const videoElement = document.getElementById('xrVideo');
const statusElement = document.getElementById('status');
const deviceListElement = document.getElementById('deviceList');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const urgentCheckbox = document.getElementById('urgentCheckbox');
const recentMessagesDiv = document.getElementById('recentMessages');
const messageHistoryDiv = document.getElementById('messageHistory');
const usernameInput = document.getElementById('usernameInput');
const xrIdInput = document.getElementById('xrIdInput');
const muteBadge = document.getElementById('muteBadge');
const videoOverlay = document.getElementById('videoOverlay');
const openEmulatorBtn = document.getElementById('openEmulator');
const clearMessagesBtn = document.getElementById('clearMessagesBtn');

// ==== GLOBAL STATE ====
let peerConnection = null;
let remoteStream = null;
let clearedMessages = new Set();
let pendingIceCandidates = [];
let isStreamActive = false;

// ==== STATUS INDICATOR ====
function setStatus(status) {
  statusElement.textContent = status;
  statusElement.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
  switch (status.toLowerCase()) {
    case 'connected':    statusElement.classList.add('bg-green-500'); break;
    case 'connecting':   statusElement.classList.add('bg-yellow-500'); break;
    case 'disconnected': statusElement.classList.add('bg-red-600'); break;
    default:             statusElement.classList.add('bg-yellow-500');
  }
}

// ==== MESSAGING LOGIC ====

// Send chat/message
function sendMessage() {
  const text = messageInput.value.trim();
  const sender = usernameInput.value.trim() || 'Web Browser';
  const xrId = xrIdInput.value.trim() || 'XR-1238';
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (text) {
    const message = {
      type: "message",
      text,
      sender,
      xrId,
      priority: urgentCheckbox.checked ? 'urgent' : 'normal',
      timestamp
    };
    socket.send(JSON.stringify(message));
    addMessageToHistory(message);
    addToRecentMessages(message);
    messageInput.value = '';
  }
}

// Process incoming message from server
function handleIncomingMessage(data) {
  const msg = normalizeMessage(data);
  addMessageToHistory(msg);
  addToRecentMessages(msg);
}

// Handle "messages cleared" event
function handleMessageCleared(data) {
  if (!clearedMessages.has(data.messageId)) {
    clearedMessages.add(data.messageId);
    addSystemMessage(`🧹 Messages cleared by ${data.by}`);
    recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
  }
}

// Normalize message object for display
function normalizeMessage(message) {
  if (!message || typeof message !== 'object') {
    return {
      text: String(message),
      sender: 'unknown',
      xrId: 'unknown',
      timestamp: new Date().toLocaleTimeString(),
      priority: 'normal'
    };
  }
  const isUrgent = message.urgent === true ||
    message.priority === 'urgent' ||
    (message.data && typeof message.data === 'string' && message.data.includes('"urgent":true'));
  return {
    text: message.text || (message.data || ''),
    sender: message.sender || 'unknown',
    xrId: message.xrId || 'unknown',
    timestamp: message.timestamp || new Date().toLocaleTimeString(),
    priority: isUrgent ? 'urgent' : 'normal'
  };
}

// Add a message to full message history
function addMessageToHistory(message) {
  const msg = normalizeMessage(message);
  const el = document.createElement('div');
  el.className = `message ${msg.priority}`;
  el.innerHTML = `
    <div class="message-header">
      <div class="sender-info">
        <span class="sender-name">${msg.sender}</span>
        <span class="xr-id">${msg.xrId}</span>
      </div>
      <div class="message-time">${msg.timestamp}</div>
    </div>
    <div class="message-content">${msg.text}</div>
    ${msg.priority === 'urgent' ? '<div class="urgent-badge">URGENT</div>' : ''}
  `;
  messageHistoryDiv.appendChild(el);
  messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
}

// Add a message to the "recent messages" area
function addToRecentMessages(message) {
  const msg = normalizeMessage(message);
  const el = document.createElement('div');
  el.className = `recent-message ${msg.priority}`;
  el.innerHTML = `
    <div class="recent-message-header">
      <span class="recent-sender">${msg.sender}</span>
      <span class="recent-xr-id">${msg.xrId}</span>
      <span class="recent-time">${msg.timestamp}</span>
    </div>
    <div class="recent-message-content">${msg.text}</div>
  `;
  recentMessagesDiv.prepend(el);
  // Limit to 5 recent messages
  if (recentMessagesDiv.children.length > 5) {
    recentMessagesDiv.removeChild(recentMessagesDiv.lastChild);
  }
}

// Add a system/info message to history
function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-message';
  el.textContent = text;
  messageHistoryDiv.appendChild(el);
  messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
}

// Send clear-messages command
function clearMessages() {
  const by = usernameInput.value.trim() || 'Web Browser';
  socket.send(JSON.stringify({
    type: 'clear-messages',
    by
  }));
  clearedMessages.clear();
  recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
  addSystemMessage(`🧹 Cleared messages locally by ${by}`);
}

// Render the list of connected devices
function renderDeviceList(devices = []) {
  deviceListElement.innerHTML = '';
  devices.forEach(device => {
    const li = document.createElement('li');
    li.textContent = device.name + (device.xrId ? ` (${device.xrId})` : '');
    deviceListElement.appendChild(li);
  });
}

// ==== WEBRTC LOGIC ====

// Create and configure PeerConnection
function createPeerConnection() {
  stopStream();
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      {
        urls: 'turn:relay1.expressturn.com:3480',
        username: '00000002068692408',
        credential: 'pd93cTNQ4Wa0Er7v3k5pLF+14+w='
      }
    ],
    iceTransportPolicy: 'all'
  });

  // Handle incoming media tracks (video/audio)
  pc.ontrack = (event) => {
    if (!isStreamActive) return;
    if (!remoteStream) {
      remoteStream = new MediaStream();
      videoElement.srcObject = remoteStream;
    }
    // Remove duplicates (same kind)
    remoteStream.getTracks().filter(t => t.kind === event.track.kind).forEach(t => remoteStream.removeTrack(t));
    remoteStream.addTrack(event.track);

    // Unmute if remote audio present
    if (remoteStream.getAudioTracks().length > 0) {
      videoElement.muted = false;
    }
    videoElement.play().catch(() => {});
  };

  // Send ICE candidates to server
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: 'ice-candidate',
        from: xrIdInput.value.trim() || 'XR-1238',
        to: 'XR-1234',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        }
      }));
    }
  };

  // Handle ICE connection state
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      stopStream();
    }
  };

  // Handle overall connection state
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setStatus('Connected');
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      stopStream();
      setStatus('Connecting');
    }
  };

  isStreamActive = true;
  return pc;
}

// Handle WebRTC offer (from Android)
async function handleOffer(offer) {
  stopStream();
  peerConnection = createPeerConnection();

  // Add any pending ICE candidates
  if (pendingIceCandidates.length > 0) {
    for (const cand of pendingIceCandidates) {
      await handleRemoteIceCandidate(cand);
    }
    pendingIceCandidates = [];
  }

  // Normalize SDP
  let realOffer = offer;
  if (offer && typeof offer.sdp !== 'string' && offer.sdp && typeof offer.sdp === 'object' && offer.sdp.sdp) {
    realOffer = { type: offer.sdp.type, sdp: offer.sdp.sdp };
  }

  if (realOffer && (realOffer.type === 'offer' || realOffer.type === 'webrtc-offer') && typeof realOffer.sdp === 'string') {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: realOffer.sdp }));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send answer to signaling server
      socket.send(JSON.stringify({
        type: 'answer',
        from: xrIdInput.value.trim() || 'XR-1238',
        to: 'XR-1234',
        sdp: peerConnection.localDescription.sdp
      }));
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  } else {
    console.error('[WebRTC] Offer is invalid format:', offer);
  }
}

// Handle incoming ICE candidate
async function handleRemoteIceCandidate(candidate) {
  if (peerConnection && candidate && candidate.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC] Error adding ICE candidate:', err);
    }
  } else {
    // Buffer until peerConnection is ready
    pendingIceCandidates.push(candidate);
  }
}

// Stop and clean up all media and PeerConnection
function stopStream() {
  isStreamActive = false;
  if (videoElement) {
    videoElement.pause();
    videoElement.srcObject = null;
    videoElement.removeAttribute('src');
    videoElement.load();
  }
  if (muteBadge) muteBadge.style.display = 'none';
  if (videoOverlay) videoOverlay.style.display = 'none';

  if (peerConnection) {
    if (peerConnection.getTransceivers) {
      peerConnection.getTransceivers().forEach(transceiver => {
        try {
          if (transceiver.stop) transceiver.stop();
          if (transceiver.sender && transceiver.sender.track) transceiver.sender.track.stop();
          if (transceiver.receiver && transceiver.receiver.track) transceiver.receiver.track.stop();
        } catch (e) {}
      });
    }
    try { peerConnection.close(); } catch (e) {}
    peerConnection = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
    });
    remoteStream = null;
  }

  pendingIceCandidates = [];
}

// ==== CONTROL COMMANDS (mute, hide video, etc) ====

// Handle incoming control commands from server
function handleControlCommand(command) {
  if (!isStreamActive) return;
  switch (command?.toLowerCase?.()) {
    case 'mute':
      setAudioTracksMuted(true);
      if (muteBadge) muteBadge.style.display = 'block';
      break;
    case 'unmute':
      setAudioTracksMuted(false);
      if (muteBadge) muteBadge.style.display = 'none';
      break;
    case 'hide_video':
      if (videoOverlay) videoOverlay.style.display = 'flex';
      if (videoElement) videoElement.style.visibility = 'hidden';
      break;
    case 'show_video':
      if (videoOverlay) videoOverlay.style.display = 'none';
      if (videoElement) videoElement.style.visibility = 'visible';
      break;
    default:
      // Unknown commands ignored
  }
}

// Mute or unmute audio tracks on remote stream
function setAudioTracksMuted(mute) {
  if (remoteStream) {
    remoteStream.getAudioTracks().forEach(track => { track.enabled = !mute; });
    videoElement.muted = mute;
  }
}

// Stream health check
function checkStreamHealth() {
  if (!peerConnection || !isStreamActive) return false;
  const videoTracks = remoteStream?.getVideoTracks() || [];
  const audioTracks = remoteStream?.getAudioTracks() || [];
  return videoTracks.length > 0 && audioTracks.length > 0 &&
    videoTracks.every(t => t.readyState === 'live') &&
    audioTracks.every(t => t.readyState === 'live');
}

// ==== WEBSOCKET SIGNALLING CONNECTION ====

const wsUrl = 'ws://192.168.29.47:8080'; // <== Set your signaling server address here
let socket = null;

function connectWebSocket() {
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    setStatus('Connected');
    socket.send(JSON.stringify({
      type: 'identification',
      deviceName: 'Web Browser',
      xrId: xrIdInput?.value?.trim() || 'XR-1238',
      platform: 'web'
    }));
  };

  socket.onclose = () => {
    setStatus('Disconnected');
    setTimeout(connectWebSocket, 2000); // auto-reconnect
  };

  socket.onerror = () => setStatus('Disconnected');

  socket.onmessage = async (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { data = event.data; }
    switch (data.type) {
      case 'offer':
      case 'webrtc-offer':
        await handleOffer(data);
        break;
      case 'answer':
      case 'webrtc-answer':
        if (peerConnection && data.sdp) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
        }
        break;
      case 'ice-candidate':
        handleRemoteIceCandidate(data.candidate || data);
        break;
      case 'connection-status':
        setStatus(data.status || 'Connecting');
        break;
      case 'new-message':
        handleIncomingMessage(data);
        break;
      case 'device_list':
        renderDeviceList(data.devices);
        break;
      case 'message-cleared':
        handleMessageCleared(data);
        break;
      case 'status_report':
        addSystemMessage(`📋 Status Report from ${data.from}: ${data.status}`);
        break;
      case 'control-command':
      case 'control_command':
        handleControlCommand(data.command);
        break;
      case 'message_history':
        (data.messages || []).forEach(handleIncomingMessage);
        break;
      default:
        // Fallback for any raw offer/ICE
        if (data.sdp && data.type === 'offer') await handleOffer(data);
        else if (data.sdp && data.type === 'answer') {
          if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
        }
        else if (data.candidate) handleRemoteIceCandidate(data);
        else if (data.text && data.sender) handleIncomingMessage(data);
    }
  };
}
connectWebSocket();

// ==== BUTTON/EVENT HANDLERS ====
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

clearMessagesBtn?.addEventListener('click', clearMessages);

openEmulatorBtn?.addEventListener('click', () => {
  window.open('http://localhost:3000/display.html', '_blank');
});
