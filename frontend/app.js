// // === DOM Elements ===
// const videoElement = document.getElementById('xrVideo');
// const statusElement = document.getElementById('status');
// const deviceListElement = document.getElementById('deviceList');
// const messageInput = document.getElementById('messageInput');
// const sendButton = document.getElementById('sendButton');
// const urgentCheckbox = document.getElementById('urgentCheckbox');
// const recentMessagesDiv = document.getElementById('recentMessages');
// const messageHistoryDiv = document.getElementById('messageHistory');
// const usernameInput = document.getElementById('usernameInput');
// const xrIdInput = document.getElementById('xrIdInput');
// const muteBadge = document.getElementById('muteBadge');
// const videoOverlay = document.getElementById('videoOverlay');
// const openEmulatorBtn = document.getElementById('openEmulator');
// const clearMessagesBtn = document.getElementById('clearMessagesBtn');

// let ws = null;
// let peerConnection = null;
// let remoteStream = null;
// let clearedMessages = new Set();
// let pendingIceCandidates = [];
// let isStreamActive = false;
// let allowAutoPlay = false;
// let reconnectTimeout = null;
// let heartbeatInterval = null;

// // CONFIG
// const SIGNALING_SERVER_URL = 'wss://7ee567fe28d8.ngrok-free.app';
// // const SIGNALING_SERVER_URL = 'wss://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';

// function setStatus(status) {
//   console.log('[STATUS] Updated:', status);
//   statusElement.textContent = status;
//   statusElement.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
//   switch (status.toLowerCase()) {
//     case 'connected': statusElement.classList.add('bg-green-500'); break;
//     case 'connecting': statusElement.classList.add('bg-yellow-500'); break;
//     case 'disconnected': statusElement.classList.add('bg-red-600'); break;
//     default: statusElement.classList.add('bg-yellow-500');
//   }
// }

// function connectWebSocket() {
//   console.log('[WS] Connecting to:', SIGNALING_SERVER_URL);
//   setStatus('Connecting');
//   ws = new WebSocket(SIGNALING_SERVER_URL);

//   ws.onopen = () => {
//     console.log('[WS] Connected');
//     setStatus('Connected');
//     ws.send(JSON.stringify({
//       type: "identification",
//       xrId: xrIdInput.value || "XR-1238",
//       deviceName: usernameInput.value || "Desktop"
//     }));
//     if (reconnectTimeout) {
//       clearTimeout(reconnectTimeout);
//       reconnectTimeout = null;
//     }
//     startHeartbeat();
//   };

//   ws.onclose = () => {
//     console.warn('[WS] Connection closed');
//     setStatus('Disconnected');
//     if (heartbeatInterval) clearInterval(heartbeatInterval);
//     if (!reconnectTimeout) {
//       reconnectTimeout = setTimeout(connectWebSocket, 1000);
//     }
//   };

//   ws.onerror = (err) => {
//     console.error('[WS] Error occurred:', err);
//     setStatus('Disconnected');
//     try { ws.close(); } catch {}
//   };

//   ws.onmessage = (event) => {
//     console.log('[WS] Message received:', event.data);
//     let data;
//     try { data = JSON.parse(event.data); } catch { data = {}; }
//     handleSocketMessage(data);
//   };
// }

// function startHeartbeat() {
//   if (heartbeatInterval) clearInterval(heartbeatInterval);
//   heartbeatInterval = setInterval(() => {
//     if (ws && ws.readyState === WebSocket.OPEN) {
//       ws.send(JSON.stringify({ type: "ping" }));
//     }
//   }, 25000);
// }

// function handleSocketMessage(data) {
//   if (!data || !data.type) return;
//   console.log('[MSG] Handling type:', data.type);
//   switch (data.type) {
//     case 'offer': handleOffer(data.sdp ? data : data.offer ? data.offer : data); break;
//     case 'ice-candidate': handleRemoteIceCandidate(data.candidate); break;
//     case 'answer': break; // desktop only answers
//     case 'message':
//       const msg = normalizeMessage(data);
//       addMessageToHistory(msg);
//       addToRecentMessages(msg);
//       break;
//     case 'clear-messages':
//       if (!clearedMessages.has(data.messageId)) {
//         clearedMessages.add(data.messageId);
//         addSystemMessage(`🧹 Messages cleared by ${data.by}`);
//         recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
//       }
//       break;
//     case 'device_list': // SERVER now sends snake_case!
//     case 'device-list': // Just in case
//       console.log('[DEVICES] List received:', data.devices);
//       updateDeviceList(data.devices || []);
//       break;
//     case 'control-command':
//       console.log('[CONTROL] Command received:', data.command);
//       handleControlCommand(data.command);
//       break;
//     default:
//       if (data.status) setStatus(data.status);
//   }
// }

// function createPeerConnection() {
//   console.log('[WebRTC] Creating peer connection');
//   stopStream();
//   const turnConfig = window.TURN_CONFIG || {};
//   const iceServers = [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'stun:stun1.l.google.com:19302' },
//     { urls: 'stun:stun2.l.google.com:19302' },
//     { urls: 'stun:stun3.l.google.com:19302' },
//     { urls: 'stun:stun4.l.google.com:19302' }
//   ];
//   if (turnConfig.urls && turnConfig.username && turnConfig.credential) {
//     iceServers.push({ urls: turnConfig.urls, username: turnConfig.username, credential: turnConfig.credential });
//     console.log('[WebRTC] Using TURN:', turnConfig);
//   }
//   const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });

//   pc.ontrack = (event) => {
//     console.log('[WebRTC] ontrack:', event.track.kind);
//     if (!remoteStream) {
//       remoteStream = new MediaStream();
//       videoElement.srcObject = remoteStream;
//       videoElement.muted = true;
//     }
//     if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
//       remoteStream.addTrack(event.track);
//     }
//     videoElement.play().catch(e => {
//       console.warn('[WebRTC] video play error', e);
//       showClickToPlayOverlay();
//     });
//   };

//   pc.onicecandidate = (event) => {
//     if (event.candidate) {
//       console.log('[WebRTC] Local ICE candidate:', event.candidate);
//       ws && ws.send(JSON.stringify({
//         type: 'ice-candidate',
//         to: "XR-1234",
//         from: xrIdInput.value?.trim() || "XR-1238",
//         candidate: event.candidate
//       }));
//     }
//   };

//   pc.oniceconnectionstatechange = () => {
//     console.log('[WebRTC] ICE state:', pc.iceConnectionState);
//     if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') stopStream();
//   };

//   pc.onconnectionstatechange = () => {
//     console.log('[WebRTC] Conn state:', pc.connectionState);
//     if (pc.connectionState === 'connected') setStatus('Connected');
//     else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
//       stopStream();
//       setStatus('Connecting');
//     }
//   };

//   isStreamActive = true;
//   return pc;
// }

// async function handleOffer(offer) {
//   stopStream();
//   peerConnection = createPeerConnection();
//   console.log('[WebRTC] Received offer:', offer);

//   if (pendingIceCandidates.length > 0) {
//     for (const cand of pendingIceCandidates) {
//       await handleRemoteIceCandidate(cand);
//     }
//     pendingIceCandidates = [];
//   }

//   try {
//     // Support both {type, sdp} or full RTCSessionDescription object
//     const remoteDesc = offer.sdp
//       ? { type: offer.type || 'offer', sdp: offer.sdp }
//       : offer;
//     await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
//     const answer = await peerConnection.createAnswer();
//     await peerConnection.setLocalDescription(answer);

//     ws && ws.send(JSON.stringify({
//       type: 'answer',
//       to: "XR-1234",
//       from: xrIdInput.value || "XR-1238",
//       sdp: peerConnection.localDescription.sdp
//     }));
//     console.log('[WebRTC] Sent answer');
//   } catch (err) {
//     console.error('[WebRTC] Error handling offer:', err);
//   }
// }

// async function handleRemoteIceCandidate(candidate) {
//   if (peerConnection && candidate && candidate.candidate) {
//     try {
//       await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
//       console.log('[WebRTC] Added ICE candidate:', candidate);
//     } catch (err) {
//       console.error('[WebRTC] Error adding ICE candidate:', err);
//     }
//   } else if (candidate) {
//     pendingIceCandidates.push(candidate);
//     console.log('[WebRTC] ICE candidate buffered:', candidate);
//   }
// }

// function stopStream() {
//   isStreamActive = false;
//   if (videoElement) {
//     videoElement.pause();
//     videoElement.srcObject = null;
//     videoElement.removeAttribute('src');
//     videoElement.load();
//   }
//   if (muteBadge) muteBadge.style.display = 'none';
//   if (videoOverlay) videoOverlay.style.display = 'none';
//   if (peerConnection) {
//     try { peerConnection.close(); } catch {}
//     peerConnection = null;
//   }
//   if (remoteStream) {
//     remoteStream.getTracks().forEach(track => { try { track.stop(); } catch {} });
//     remoteStream = null;
//   }
//   pendingIceCandidates = [];
// }

// // ========== Overlay UI for User Gesture to Play Video ==========
// function showClickToPlayOverlay() {
//   if (!videoOverlay) return;
//   videoOverlay.style.display = 'flex';
//   videoOverlay.innerHTML = `<button id="clickToPlayBtn" style="padding:1rem 2rem;font-size:1.25rem;">Click to Start Video</button>`;
//   document.getElementById('clickToPlayBtn').onclick = () => {
//     videoOverlay.style.display = 'none';
//     videoElement.play();
//   };
// }

// // ========== Device List ==========
// function updateDeviceList(devices) {
//   deviceListElement.innerHTML = '';
//   devices.forEach(device => {
//     // Log devices and XR IDs for clarity
//     console.log(`[DEVICE] DeviceName: ${device.name || device.deviceName || '(no name)'}  XR-ID: ${device.xrId || '(no xrId)'}`);
//     const li = document.createElement('li');
//     li.textContent = `${device.name || device.deviceName || device.xrId} (${device.xrId})`;
//     deviceListElement.appendChild(li);
//   });
// }

// // ========== Messaging/UI Logic ==========
// function sendMessage() {
//   const text = messageInput.value.trim();
//   const sender = usernameInput.value.trim() || 'Desktop';
//   const xrId = xrIdInput.value.trim() || 'XR-1238';
//   const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

//   if (text && ws && ws.readyState === WebSocket.OPEN) {
//     const message = {
//       type: "message",
//       text,
//       sender,
//       xrId,
//       priority: urgentCheckbox.checked ? 'urgent' : 'normal',
//       timestamp
//     };
//     ws.send(JSON.stringify(message));
//     addMessageToHistory(message);
//     // addToRecentMessages(message);
//     messageInput.value = '';
//   }
// }

// // === UPDATED normalizeMessage with stringified JSON support ===
// function normalizeMessage(message) {
//   if (!message || typeof message !== 'object') return {
//     text: String(message),
//     sender: 'unknown',
//     xrId: 'unknown',
//     timestamp: new Date().toLocaleTimeString(),
//     priority: 'normal'
//   };

//   // If message.text looks like a JSON object, parse it!
//   let parsed = {};
//   if (typeof message.text === 'string' && message.text.trim().startsWith('{') && message.text.trim().endsWith('}')) {
//     try {
//       parsed = JSON.parse(message.text);
//     } catch (e) {
//       // Not JSON, leave as is
//     }
//   }

//   // Merge parsed fields, prefer real message fields first
//   const sender = message.sender || parsed.sender || 'unknown';
//   const xrId = message.xrId || parsed.xrId || 'unknown';
//   const text = message.text && typeof message.text === 'string' && parsed.text ? parsed.text : message.text || '';
//   const timestamp = message.timestamp || parsed.timestamp || new Date().toLocaleTimeString();
//   const isUrgent = message.urgent === true ||
//     message.priority === 'urgent' ||
//     parsed.urgent === true ||
//     parsed.priority === 'urgent' ||
//     (message.data && typeof message.data === 'string' &&
//       message.data.includes('"urgent":true'));

//   return {
//     text,
//     sender,
//     xrId,
//     timestamp,
//     priority: isUrgent ? 'urgent' : 'normal'
//   };
// }

// function addMessageToHistory(message) {
//   const msg = normalizeMessage(message);
//   const el = document.createElement('div');
//   el.className = `message ${msg.priority}`;
//   el.innerHTML = `
//     <div class="message-header">
//       <div class="sender-info">
//         <span class="sender-name">${msg.sender}</span>
//         <span class="xr-id">${msg.xrId}</span>
//       </div>
//       <div class="message-time">${msg.timestamp}</div>
//     </div>
//     <div class="message-content">${msg.text}</div>
//     ${msg.priority === 'urgent' ? '<div class="urgent-badge">URGENT</div>' : ''}
//   `;
//   messageHistoryDiv.appendChild(el);
//   messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
// }

// function addToRecentMessages(message) {
//   const msg = normalizeMessage(message);
//   const el = document.createElement('div');
//   el.className = `recent-message ${msg.priority}`;
//   el.innerHTML = `
//     <div class="recent-message-header">
//       <span class="recent-sender">${msg.sender}</span>
//       <span class="recent-xr-id">${msg.xrId}</span>
//       <span class="recent-time">${msg.timestamp}</span>
//     </div>
//     <div class="recent-message-content">${msg.text}</div>
//   `;
//   recentMessagesDiv.prepend(el);
//   if (recentMessagesDiv.children.length > 5) {
//     recentMessagesDiv.removeChild(recentMessagesDiv.lastChild);
//   }
// }

// function addSystemMessage(text) {
//   const el = document.createElement('div');
//   el.className = 'system-message';
//   el.textContent = text;
//   messageHistoryDiv.appendChild(el);
//   messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
// }

// function clearMessages() {
//   const by = usernameInput.value.trim() || 'Desktop';
//   if (ws && ws.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({
//       type: 'clear-messages',
//       by
//     }));
//     clearedMessages.clear();
//     recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
//     addSystemMessage(`🧹 Cleared messages locally by ${by}`);
//   }
// }

// // === FINALIZED: Audio Mute/Unmute from ANDROID ===
// function handleControlCommand(command) {
//   if (!isStreamActive && command !== 'stop_stream') return;
//   switch (command && command.toLowerCase && command.toLowerCase()) {
//     case 'mute':
//       if (muteBadge) muteBadge.style.display = 'block';
//       if (videoElement) videoElement.muted = true;
//       break;
//     case 'unmute':
//       if (muteBadge) muteBadge.style.display = 'none';
//       if (videoElement) videoElement.muted = false;
//       videoElement.play().catch(()=>{});
//       break;
//     case 'hide_video':
//       if (videoOverlay) videoOverlay.style.display = 'flex';
//       if (videoElement) videoElement.style.visibility = 'hidden';
//       break;
//     case 'show_video':
//       if (videoOverlay) videoOverlay.style.display = 'none';
//       if (videoElement) videoElement.style.visibility = 'visible';
//       break;
//     case 'stop_stream':
//       console.log('[CONTROL] Stopping stream via command');
//       stopStream();
//       break;
//     default:
//       console.warn('[CONTROL] Unknown command:', command);
//   }
// }

// // Don't change audio tracks, only Android controls mute/unmute
// function setAudioTracksMuted(mute) {
//   // No-op; muting is controlled by Android.
// }

// function checkStreamHealth() {
//   if (!peerConnection || !isStreamActive) return false;
//   const videoTracks = remoteStream?.getVideoTracks() || [];
//   const audioTracks = remoteStream?.getAudioTracks() || [];
//   return videoTracks.length > 0 && audioTracks.length > 0 &&
//     videoTracks.every(t => t.readyState === 'live') &&
//     audioTracks.every(t => t.readyState === 'live');
// }

// // === UI Event Bindings ===
// sendButton.addEventListener('click', sendMessage);
// messageInput.addEventListener('keypress', (e) => {
//   if (e.key === 'Enter' && !e.shiftKey) {
//     e.preventDefault();
//     sendMessage();
//   }
// });
// clearMessagesBtn?.addEventListener('click', clearMessages);
// openEmulatorBtn?.addEventListener('click', () => {
//   window.open('http://localhost:3000/display.html', '_blank');
// });
// if (videoOverlay) {
//   videoOverlay.addEventListener('click', () => {
//     videoOverlay.style.display = 'none';
//     videoElement.play();
//   });
// }


// ===================================================================================================================================

// ---------------------------------------------------one to one------------------------------------------------------------------------------

// === DOM Elements ===
// const videoElement = document.getElementById('xrVideo');
// const statusElement = document.getElementById('status');
// const deviceListElement = document.getElementById('deviceList');
// const messageInput = document.getElementById('messageInput');
// const sendButton = document.getElementById('sendButton');
// const urgentCheckbox = document.getElementById('urgentCheckbox');
// const recentMessagesDiv = document.getElementById('recentMessages');
// const messageHistoryDiv = document.getElementById('messageHistory');
// const usernameInput = document.getElementById('usernameInput');
// const xrIdInput = document.getElementById('xrIdInput');
// const muteBadge = document.getElementById('muteBadge');
// const videoOverlay = document.getElementById('videoOverlay');
// const openEmulatorBtn = document.getElementById('openEmulator');
// const clearMessagesBtn = document.getElementById('clearMessagesBtn');

// let ws = null;
// let peerConnection = null;
// let remoteStream = null;
// let clearedMessages = new Set();
// let pendingIceCandidates = [];
// let isStreamActive = false;
// let allowAutoPlay = false;
// let reconnectTimeout = null;
// let heartbeatInterval = null;

// // CONFIG
// // const SIGNALING_SERVER_URL = 'wss://914a075c3b07.ngrok-free.app';
// const SIGNALING_SERVER_URL = 'wss://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';

// function setStatus(status) {
//   console.log('[STATUS] Updated:', status);
//   statusElement.textContent = status;
//   statusElement.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
//   switch (status.toLowerCase()) {
//     case 'connected': statusElement.classList.add('bg-green-500'); break;
//     case 'connecting': statusElement.classList.add('bg-yellow-500'); break;
//     case 'disconnected': statusElement.classList.add('bg-red-600'); break;
//     default: statusElement.classList.add('bg-yellow-500');
//   }
// }

// // function connectWebSocket() {
// //   console.log('[WS] Connecting to:', SIGNALING_SERVER_URL);
// //   setStatus('Connecting');
// //   ws = new WebSocket(SIGNALING_SERVER_URL);

// //   ws.onopen = () => {
// //     console.log('[WS] Connected');
// //     setStatus('Connected');
// //     ws.send(JSON.stringify({
// //       type: "identification",
// //       xrId: xrIdInput.value || "XR-1238",
// //       deviceName: usernameInput.value || "Desktop"
// //     }));
// //     if (reconnectTimeout) {
// //       clearTimeout(reconnectTimeout);
// //       reconnectTimeout = null;
// //     }
// //     startHeartbeat();
// //   };

// //   ws.onclose = () => {
// //     console.warn('[WS] Connection closed');
// //     setStatus('Disconnected');
// //     if (heartbeatInterval) clearInterval(heartbeatInterval);
// //     if (!reconnectTimeout) {
// //       reconnectTimeout = setTimeout(connectWebSocket, 1000);
// //     }
// //   };

// //   ws.onerror = (err) => {
// //     console.error('[WS] Error occurred:', err);
// //     setStatus('Disconnected');
// //     try { ws.close(); } catch {}
// //   };

// //   ws.onmessage = (event) => {
// //     console.log('[WS] Message received:', event.data);
// //     let data;
// //     try { data = JSON.parse(event.data); } catch { data = {}; }
// //     handleSocketMessage(data);
// //   };
// // }

// function connectWebSocket() {
//   console.log('[WS] Connecting to:', SIGNALING_SERVER_URL);
//   setStatus('Connecting');
//   ws = new WebSocket(SIGNALING_SERVER_URL);

//   ws.onopen = () => {
//     console.log('[WS] ✅ WebSocket connected.');
//     setStatus('Connected');
//     ws.send(JSON.stringify({
//       type: "identification",
//       xrId: xrIdInput.value || "XR-1238",
//       deviceName: usernameInput.value || "Desktop"
//     }));
//     if (reconnectTimeout) {
//       clearTimeout(reconnectTimeout);
//       reconnectTimeout = null;
//     }
//     startHeartbeat();
//   };

//   ws.onclose = () => {
//     console.warn('[WS] ❌ WebSocket closed.');
//     setStatus('Disconnected');
//     if (heartbeatInterval) clearInterval(heartbeatInterval);
//     if (!reconnectTimeout) {
//       reconnectTimeout = setTimeout(() => {
//         console.log('[WS] 🔁 Attempting reconnect...');
//         connectWebSocket();
//       }, 1000);
//     }
//   };

//   ws.onerror = (err) => {
//     console.error('[WS] 🛑 WebSocket error occurred:', err);
//     setStatus('Disconnected');
//     try { ws.close(); } catch {}
//   };

//   ws.onmessage = (event) => {
//     console.log('[WS] 📩 Message received:', event.data);
//     let data;
//     try {
//       data = JSON.parse(event.data);
//     } catch {
//       console.warn('[WS] ⚠️ Failed to parse message as JSON:', event.data);
//       data = {};
//     }

//     // === 🔴 Block duplicate desktop tabs ===
//     if (data.type === 'error' && data.message?.includes('Duplicate desktop')) {
//       console.warn('[WS] 🚫 Duplicate desktop tab detected. Blocking UI...');
//       alert('This desktop session is inactive. Please close other tabs.');
//       document.body.innerHTML = `
//         <div style="display: flex; flex-direction: column; align-items: center; margin-top: 20%;">
//           <h1 style="color: red; text-align: center;">Another tab is already connected.</h1>
//           <p style="margin-top: 1rem;">Only one desktop tab can be active at a time.</p>
//         </div>`;
//       try { ws.close(); } catch {}
//       return;
//     }

//     handleSocketMessage(data);
//   };
// }

// function startHeartbeat() {
//   if (heartbeatInterval) clearInterval(heartbeatInterval);
//   heartbeatInterval = setInterval(() => {
//     if (ws && ws.readyState === WebSocket.OPEN) {
//       ws.send(JSON.stringify({ type: "ping" }));
//     }
//   }, 25000);
// }

// // function handleSocketMessage(data) {
// //   if (!data || !data.type) return;
// //   console.log('[MSG] Handling type:', data.type);
// //   switch (data.type) {
// //     case 'offer': handleOffer(data.sdp ? data : data.offer ? data.offer : data); break;
// //     case 'ice-candidate': handleRemoteIceCandidate(data.candidate); break;
// //     case 'answer': break; // desktop only answers
// //     case 'message':
// //       const msg = normalizeMessage(data);
// //       addMessageToHistory(msg);
// //       addToRecentMessages(msg);
// //       break;
// //     case 'clear-messages':
// //       if (!clearedMessages.has(data.messageId)) {
// //         clearedMessages.add(data.messageId);
// //         addSystemMessage(`🧹 Messages cleared by ${data.by}`);
// //         recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
// //       }
// //       break;
// //     case 'device_list': // SERVER now sends snake_case!
// //     case 'device-list': // Just in case
// //       console.log('[DEVICES] List received:', data.devices);
// //       updateDeviceList(data.devices || []);
// //       break;
// //     case 'control-command':
// //       console.log('[CONTROL] Command received:', data.command);
// //       handleControlCommand(data.command);
// //       break;
// //     default:
// //       if (data.status) setStatus(data.status);
// //   }
// // }
// function handleSocketMessage(data) {
//   if (!data || !data.type) return;
//   console.log('[MSG] 🔍 Handling message of type:', data.type);
//   switch (data.type) {
//     case 'offer':
//       console.log('[WebRTC] 📞 Received offer');
//       handleOffer(data.sdp ? data : data.offer ? data.offer : data);
//       break;

//     case 'ice-candidate':
//       console.log('[WebRTC] ❄️ Received ICE candidate');
//       handleRemoteIceCandidate(data.candidate);
//       break;

//     case 'answer':
//       console.log('[WebRTC] 🎤 Ignored answer (desktop does not need to handle)');
//       break;

//     case 'message':
//       const msg = normalizeMessage(data);
//       console.log('[MSG] 📨 Chat message:', msg);
//       addMessageToHistory(msg);
//       addToRecentMessages(msg);
//       break;

//     case 'clear-messages':
//       if (!clearedMessages.has(data.messageId)) {
//         console.log('[MSG] 🧹 Message clear triggered by', data.by);
//         clearedMessages.add(data.messageId);
//         addSystemMessage(`🧹 Messages cleared by ${data.by}`);
//         recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
//       }
//       break;

//     case 'device_list':
//     case 'device-list':
//       console.log('[DEVICES] 🧭 Device list received:', data.devices);
//       updateDeviceList(data.devices || []);
//       break;

//     case 'control-command':
//       console.log('[CONTROL] 🎮 Command received:', data.command);
//       handleControlCommand(data.command);
//       break;

//     default:
//       console.log('[WS] ℹ️ Unhandled message type:', data.type);
//       if (data.status) setStatus(data.status);
//   }
// }

// function createPeerConnection() {
//   console.log('[WebRTC] Creating peer connection');
//   stopStream();
//   const turnConfig = window.TURN_CONFIG || {};
//   const iceServers = [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'stun:stun1.l.google.com:19302' },
//     { urls: 'stun:stun2.l.google.com:19302' },
//     { urls: 'stun:stun3.l.google.com:19302' },
//     { urls: 'stun:stun4.l.google.com:19302' }
//   ];
//   if (turnConfig.urls && turnConfig.username && turnConfig.credential) {
//     iceServers.push({ urls: turnConfig.urls, username: turnConfig.username, credential: turnConfig.credential });
//     console.log('[WebRTC] Using TURN:', turnConfig);
//   }
//   const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });

//   pc.ontrack = (event) => {
//     console.log('[WebRTC] ontrack:', event.track.kind);
//     if (!remoteStream) {
//       remoteStream = new MediaStream();
//       videoElement.srcObject = remoteStream;
//       videoElement.muted = true;
//     }
//     if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
//       remoteStream.addTrack(event.track);
//     }
//     videoElement.play().catch(e => {
//       console.warn('[WebRTC] video play error', e);
//       showClickToPlayOverlay();
//     });
//   };

//   pc.onicecandidate = (event) => {
//     if (event.candidate) {
//       console.log('[WebRTC] Local ICE candidate:', event.candidate);
//       ws && ws.send(JSON.stringify({
//         type: 'ice-candidate',
//         to: "XR-1234",
//         from: xrIdInput.value?.trim() || "XR-1238",
//         candidate: event.candidate
//       }));
//     }
//   };

//   pc.oniceconnectionstatechange = () => {
//     console.log('[WebRTC] ICE state:', pc.iceConnectionState);
//     if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') stopStream();
//   };

//   pc.onconnectionstatechange = () => {
//     console.log('[WebRTC] Conn state:', pc.connectionState);
//     if (pc.connectionState === 'connected') setStatus('Connected');
//     else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
//       stopStream();
//       setStatus('Connecting');
//     }
//   };

//   isStreamActive = true;
//   return pc;
// }

// async function handleOffer(offer) {
//   stopStream();
//   peerConnection = createPeerConnection();
//   console.log('[WebRTC] Received offer:', offer);

//   if (pendingIceCandidates.length > 0) {
//     for (const cand of pendingIceCandidates) {
//       await handleRemoteIceCandidate(cand);
//     }
//     pendingIceCandidates = [];
//   }

//   try {
//     // Support both {type, sdp} or full RTCSessionDescription object
//     const remoteDesc = offer.sdp
//       ? { type: offer.type || 'offer', sdp: offer.sdp }
//       : offer;
//     await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
//     const answer = await peerConnection.createAnswer();
//     await peerConnection.setLocalDescription(answer);

//     ws && ws.send(JSON.stringify({
//       type: 'answer',
//       to: "XR-1234",
//       from: xrIdInput.value || "XR-1238",
//       sdp: peerConnection.localDescription.sdp
//     }));
//     console.log('[WebRTC] Sent answer');
//   } catch (err) {
//     console.error('[WebRTC] Error handling offer:', err);
//   }
// }

// async function handleRemoteIceCandidate(candidate) {
//   if (peerConnection && candidate && candidate.candidate) {
//     try {
//       await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
//       console.log('[WebRTC] Added ICE candidate:', candidate);
//     } catch (err) {
//       console.error('[WebRTC] Error adding ICE candidate:', err);
//     }
//   } else if (candidate) {
//     pendingIceCandidates.push(candidate);
//     console.log('[WebRTC] ICE candidate buffered:', candidate);
//   }
// }

// function stopStream() {
//   isStreamActive = false;
//   if (videoElement) {
//     videoElement.pause();
//     videoElement.srcObject = null;
//     videoElement.removeAttribute('src');
//     videoElement.load();
//   }
//   if (muteBadge) muteBadge.style.display = 'none';
//   if (videoOverlay) videoOverlay.style.display = 'none';
//   if (peerConnection) {
//     try { peerConnection.close(); } catch {}
//     peerConnection = null;
//   }
//   if (remoteStream) {
//     remoteStream.getTracks().forEach(track => { try { track.stop(); } catch {} });
//     remoteStream = null;
//   }
//   pendingIceCandidates = [];
// }

// // ========== Overlay UI for User Gesture to Play Video ==========
// function showClickToPlayOverlay() {
//   if (!videoOverlay) return;
//   videoOverlay.style.display = 'flex';
//   videoOverlay.innerHTML = `<button id="clickToPlayBtn" style="padding:1rem 2rem;font-size:1.25rem;">Click to Start Video</button>`;
//   document.getElementById('clickToPlayBtn').onclick = () => {
//     videoOverlay.style.display = 'none';
//     videoElement.play();
//   };
// }

// // ========== Device List ==========
// function updateDeviceList(devices) {
//   deviceListElement.innerHTML = '';
//   devices.forEach(device => {
//     // Log devices and XR IDs for clarity
//     console.log(`[DEVICE] DeviceName: ${device.name || device.deviceName || '(no name)'}  XR-ID: ${device.xrId || '(no xrId)'}`);
//     const li = document.createElement('li');
//     li.textContent = `${device.name || device.deviceName || device.xrId} (${device.xrId})`;
//     deviceListElement.appendChild(li);
//   });
// }

// // ========== Messaging/UI Logic ==========
// function sendMessage() {
//   const text = messageInput.value.trim();
//   const sender = usernameInput.value.trim() || 'Desktop';
//   const xrId = xrIdInput.value.trim() || 'XR-1238';
//   const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

//   if (text && ws && ws.readyState === WebSocket.OPEN) {
//     const message = {
//       type: "message",
//       text,
//       sender,
//       xrId,
//       priority: urgentCheckbox.checked ? 'urgent' : 'normal',
//       timestamp
//     };
//     ws.send(JSON.stringify(message));
//     addMessageToHistory(message);
//     // addToRecentMessages(message);
//     messageInput.value = '';
//   }
// }

// // === UPDATED normalizeMessage with stringified JSON support ===
// function normalizeMessage(message) {
//   if (!message || typeof message !== 'object') return {
//     text: String(message),
//     sender: 'unknown',
//     xrId: 'unknown',
//     timestamp: new Date().toLocaleTimeString(),
//     priority: 'normal'
//   };

//   // If message.text looks like a JSON object, parse it!
//   let parsed = {};
//   if (typeof message.text === 'string' && message.text.trim().startsWith('{') && message.text.trim().endsWith('}')) {
//     try {
//       parsed = JSON.parse(message.text);
//     } catch (e) {
//       // Not JSON, leave as is
//     }
//   }

//   // Merge parsed fields, prefer real message fields first
//   const sender = message.sender || parsed.sender || 'unknown';
//   const xrId = message.xrId || parsed.xrId || 'unknown';
//   const text = message.text && typeof message.text === 'string' && parsed.text ? parsed.text : message.text || '';
//   const timestamp = message.timestamp || parsed.timestamp || new Date().toLocaleTimeString();
//   const isUrgent = message.urgent === true ||
//     message.priority === 'urgent' ||
//     parsed.urgent === true ||
//     parsed.priority === 'urgent' ||
//     (message.data && typeof message.data === 'string' &&
//       message.data.includes('"urgent":true'));

//   return {
//     text,
//     sender,
//     xrId,
//     timestamp,
//     priority: isUrgent ? 'urgent' : 'normal'
//   };
// }

// function addMessageToHistory(message) {
//   const msg = normalizeMessage(message);
//   const el = document.createElement('div');
//   el.className = `message ${msg.priority}`;
//   el.innerHTML = `
//     <div class="message-header">
//       <div class="sender-info">
//         <span class="sender-name">${msg.sender}</span>
//         <span class="xr-id">${msg.xrId}</span>
//       </div>
//       <div class="message-time">${msg.timestamp}</div>
//     </div>
//     <div class="message-content">${msg.text}</div>
//     ${msg.priority === 'urgent' ? '<div class="urgent-badge">URGENT</div>' : ''}
//   `;
//   messageHistoryDiv.appendChild(el);
//   messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
// }

// function addToRecentMessages(message) {
//   const msg = normalizeMessage(message);
//   const el = document.createElement('div');
//   el.className = `recent-message ${msg.priority}`;
//   el.innerHTML = `
//     <div class="recent-message-header">
//       <span class="recent-sender">${msg.sender}</span>
//       <span class="recent-xr-id">${msg.xrId}</span>
//       <span class="recent-time">${msg.timestamp}</span>
//     </div>
//     <div class="recent-message-content">${msg.text}</div>
//   `;
//   recentMessagesDiv.prepend(el);
//   if (recentMessagesDiv.children.length > 5) {
//     recentMessagesDiv.removeChild(recentMessagesDiv.lastChild);
//   }
// }

// function addSystemMessage(text) {
//   const el = document.createElement('div');
//   el.className = 'system-message';
//   el.textContent = text;
//   messageHistoryDiv.appendChild(el);
//   messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
// }

// function clearMessages() {
//   const by = usernameInput.value.trim() || 'Desktop';
//   if (ws && ws.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({
//       type: 'clear-messages',
//       by
//     }));
//     clearedMessages.clear();
//     recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
//     addSystemMessage(`🧹 Cleared messages locally by ${by}`);
//   }
// }

// // === FINALIZED: Audio Mute/Unmute from ANDROID ===
// function handleControlCommand(command) {
//   if (!isStreamActive && command !== 'stop_stream') return;
//   switch (command && command.toLowerCase && command.toLowerCase()) {
//     case 'mute':
//       if (muteBadge) muteBadge.style.display = 'block';
//       if (videoElement) videoElement.muted = true;
//       break;
//     case 'unmute':
//       if (muteBadge) muteBadge.style.display = 'none';
//       if (videoElement) videoElement.muted = false;
//       videoElement.play().catch(()=>{});
//       break;
//     case 'hide_video':
//       if (videoOverlay) videoOverlay.style.display = 'flex';
//       if (videoElement) videoElement.style.visibility = 'hidden';
//       break;
//     case 'show_video':
//       if (videoOverlay) videoOverlay.style.display = 'none';
//       if (videoElement) videoElement.style.visibility = 'visible';
//       break;
//     case 'stop_stream':
//       console.log('[CONTROL] Stopping stream via command');
//       stopStream();
//       break;
//     default:
//       console.warn('[CONTROL] Unknown command:', command);
//   }
// }

// // Don't change audio tracks, only Android controls mute/unmute
// function setAudioTracksMuted(mute) {
//   // No-op; muting is controlled by Android.
// }

// function checkStreamHealth() {
//   if (!peerConnection || !isStreamActive) return false;
//   const videoTracks = remoteStream?.getVideoTracks() || [];
//   const audioTracks = remoteStream?.getAudioTracks() || [];
//   return videoTracks.length > 0 && audioTracks.length > 0 &&
//     videoTracks.every(t => t.readyState === 'live') &&
//     audioTracks.every(t => t.readyState === 'live');
// }

// // === UI Event Bindings ===
// sendButton.addEventListener('click', sendMessage);
// messageInput.addEventListener('keypress', (e) => {
//   if (e.key === 'Enter' && !e.shiftKey) {
//     e.preventDefault();
//     sendMessage();
//   }
// });
// clearMessagesBtn?.addEventListener('click', clearMessages);
// openEmulatorBtn?.addEventListener('click', () => {
//   window.open('http://localhost:3000/display.html', '_blank');
// });
// if (videoOverlay) {
//   videoOverlay.addEventListener('click', () => {
//     videoOverlay.style.display = 'none';
//     videoElement.play();
//   });
// }

// window.addEventListener('load', () => {
//   console.log('[APP] Window loaded. Connecting WebSocket...');
//   connectWebSocket();
// });
// ----------------------------------------------------------------------------------------------------------------------------------

// ------------------------------------------------------------deepseek version----------------------------------------------------------------------

// const videoElement = document.getElementById('xrVideo');
// const statusElement = document.getElementById('status');
// const deviceListElement = document.getElementById('deviceList');
// const messageInput = document.getElementById('messageInput');
// const sendButton = document.getElementById('sendButton');
// const urgentCheckbox = document.getElementById('urgentCheckbox');
// const recentMessagesDiv = document.getElementById('recentMessages');
// const messageHistoryDiv = document.getElementById('messageHistory');
// const usernameInput = document.getElementById('usernameInput');
// const xrIdInput = document.getElementById('xrIdInput');
// const muteBadge = document.getElementById('muteBadge');
// const videoOverlay = document.getElementById('videoOverlay');
// const openEmulatorBtn = document.getElementById('openEmulator');
// const clearMessagesBtn = document.getElementById('clearMessagesBtn');

// let ws = null;
// let peerConnection = null;
// let remoteStream = null;
// let clearedMessages = new Set();
// let pendingIceCandidates = [];
// let isStreamActive = false;
// let allowAutoPlay = false;
// let reconnectTimeout = null;
// let heartbeatInterval = null;

// // CONFIG
// // const SIGNALING_SERVER_URL = 'wss://8c4d78ab77fb.ngrok-free.app';
// const SIGNALING_SERVER_URL = 'wss://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';

// function setStatus(status) {
//   console.log('[STATUS] Updated:', status);
//   statusElement.textContent = status;
//   statusElement.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
//   switch (status.toLowerCase()) {
//     case 'connected': 
//       statusElement.classList.add('bg-green-500'); 
//       break;
//     case 'connecting': 
//       statusElement.classList.add('bg-yellow-500'); 
//       break;
//     case 'disconnected': 
//       statusElement.classList.add('bg-red-600'); 
//       break;
//     default: 
//       statusElement.classList.add('bg-yellow-500');
//   }
// }

// function safeConnectWebSocket(retries = 5) {
//   try {
//     connectWebSocket();
//   } catch (e) {
//     console.error('[WS] Initial connection failed:', e);
//     if (retries > 0) {
//       setTimeout(() => safeConnectWebSocket(retries - 1), 1000);
//     }
//   }
// }

// function sendIdentificationWhenReady() {
//   if (ws && ws.readyState === WebSocket.OPEN) {
//     const xrId = xrIdInput.value.trim() || "XR-1238";
//     const deviceName = usernameInput.value.trim() || "Desktop";
    
//     console.log('[WS] Sending identification:', { xrId, deviceName });
//     ws.send(JSON.stringify({
//       type: "identification",
//       xrId,
//       deviceName
//     }));
//   } else {
//     setTimeout(sendIdentificationWhenReady, 300);
//   }
// }

// function connectWebSocket() {
//   console.log('[WS] Connecting to:', SIGNALING_SERVER_URL);
//   setStatus('Connecting');
  
//   let retryCount = 0;
//   const maxRetries = 3;
//   const retryDelay = 500;

//   function initWebSocket() {
//     ws = new WebSocket(SIGNALING_SERVER_URL);

//     ws.onopen = () => {
//       console.log('[WS] ✅ WebSocket connected.');
//       setStatus('Connected');
//       sendIdentificationWhenReady();
//       if (reconnectTimeout) {
//         clearTimeout(reconnectTimeout);
//         reconnectTimeout = null;
//       }
//       startHeartbeat();
//     };

//     ws.onclose = () => {
//       console.warn('[WS] ❌ WebSocket closed.');
//       setStatus('Disconnected');
//       if (heartbeatInterval) clearInterval(heartbeatInterval);
      
//       if (retryCount < maxRetries) {
//         retryCount++;
//         console.log(`[WS] 🔁 Attempting reconnect (${retryCount}/${maxRetries})...`);
//         setTimeout(initWebSocket, retryDelay);
//       } else if (!reconnectTimeout) {
//         reconnectTimeout = setTimeout(() => {
//           console.log('[WS] 🔁 Attempting fresh reconnect...');
//           safeConnectWebSocket();
//         }, 1000);
//       }
//     };

//     ws.onerror = (err) => {
//       console.error('[WS] 🛑 WebSocket error occurred:', err);
//       setStatus('Disconnected');
//       try { ws.close(); } catch {}
//     };

//     ws.onmessage = (event) => {
//       console.log('[WS] 📩 Message received:', event.data);
//       let data;
//       try {
//         data = JSON.parse(event.data);
//       } catch {
//         console.warn('[WS] ⚠️ Failed to parse message as JSON:', event.data);
//         data = {};
//       }

//       if (data.type === 'error' && data.message?.includes('Duplicate desktop')) {
//         console.warn('[WS] 🚫 Duplicate desktop tab detected. Blocking UI...');
//         alert('This desktop session is inactive. Please close other tabs.');
//         document.body.innerHTML = `
//           <div style="display: flex; flex-direction: column; align-items: center; margin-top: 20%;">
//             <h1 style="color: red; text-align: center;">Another tab is already connected.</h1>
//             <p style="margin-top: 1rem;">Only one desktop tab can be active at a time.</p>
//           </div>`;
//         try { ws.close(); } catch {}
//         return;
//       }

//       handleSocketMessage(data);
//     };
//   }

//   initWebSocket();
// }

// function startHeartbeat() {
//   if (heartbeatInterval) clearInterval(heartbeatInterval);
//   heartbeatInterval = setInterval(() => {
//     if (ws && ws.readyState === WebSocket.OPEN) {
//       ws.send(JSON.stringify({ type: "ping" }));
//     }
//   }, 25000);
// }

// function handleSocketMessage(data) {
//   if (!data || !data.type) return;
//   console.log('[MSG] 🔍 Handling message of type:', data.type);
//   switch (data.type) {
//     case 'offer':
//       console.log('[WebRTC] 📞 Received offer');
//       handleOffer(data.sdp ? data : data.offer ? data.offer : data);
//       break;

//     case 'ice-candidate':
//       console.log('[WebRTC] ❄️ Received ICE candidate');
//       handleRemoteIceCandidate(data.candidate);
//       break;

//     case 'answer':
//       console.log('[WebRTC] 🎤 Ignored answer (desktop does not need to handle)');
//       break;

//     case 'message':
//       const msg = normalizeMessage(data);
//       console.log('[MSG] 📨 Chat message:', msg);
//       addMessageToHistory(msg);
//       addToRecentMessages(msg);
//       break;

//     case 'clear-messages':
//       if (!clearedMessages.has(data.messageId)) {
//         console.log('[MSG] 🧹 Message clear triggered by', data.by);
//         clearedMessages.add(data.messageId);
//         addSystemMessage(`🧹 Messages cleared by ${data.by}`);
//         recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
//       }
//       break;

//     case 'device_list':
//     case 'device-list':
//       console.log('[DEVICES] 🧭 Device list received:', data.devices);
//       updateDeviceList(data.devices || []);
//       break;

//     case 'control-command':
//       console.log('[CONTROL] 🎮 Command received:', data.command);
//       handleControlCommand(data.command);
//       break;

//     default:
//       console.log('[WS] ℹ️ Unhandled message type:', data.type);
//       if (data.status) setStatus(data.status);
//   }
// }

// function createPeerConnection() {
//   console.log('[WebRTC] Creating peer connection');
//   stopStream();
//   const turnConfig = window.TURN_CONFIG || {};
//   const iceServers = [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'stun:stun1.l.google.com:19302' },
//     { urls: 'stun:stun2.l.google.com:19302' },
//     { urls: 'stun:stun3.l.google.com:19302' },
//     { urls: 'stun:stun4.l.google.com:19302' }
//   ];
//   if (turnConfig.urls && turnConfig.username && turnConfig.credential) {
//     iceServers.push({ urls: turnConfig.urls, username: turnConfig.username, credential: turnConfig.credential });
//     console.log('[WebRTC] Using TURN:', turnConfig);
//   }
//   const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });

//   pc.ontrack = (event) => {
//     console.log('[WebRTC] ontrack:', event.track.kind);
//     if (!remoteStream) {
//       remoteStream = new MediaStream();
//       videoElement.srcObject = remoteStream;
//       videoElement.muted = true;
//     }
//     if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
//       remoteStream.addTrack(event.track);
//     }
//     videoElement.play().catch(e => {
//       console.warn('[WebRTC] video play error', e);
//       showClickToPlayOverlay();
//     });
//   };

//   pc.onicecandidate = (event) => {
//     if (event.candidate) {
//       console.log('[WebRTC] Local ICE candidate:', event.candidate);
//       ws && ws.send(JSON.stringify({
//         type: 'ice-candidate',
//         to: "XR-1234",
//         from: xrIdInput.value?.trim() || "XR-1238",
//         candidate: event.candidate
//       }));
//     }
//   };

//   pc.oniceconnectionstatechange = () => {
//     console.log('[WebRTC] ICE state:', pc.iceConnectionState);
//     if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') stopStream();
//   };

//   pc.onconnectionstatechange = () => {
//     console.log('[WebRTC] Conn state:', pc.connectionState);
//     if (pc.connectionState === 'connected') setStatus('Connected');
//     else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
//       stopStream();
//       setStatus('Connecting');
//     }
//   };

//   isStreamActive = true;
//   return pc;
// }

// async function handleOffer(offer) {
//   stopStream();
//   peerConnection = createPeerConnection();
//   console.log('[WebRTC] Received offer:', offer);

//   if (pendingIceCandidates.length > 0) {
//     for (const cand of pendingIceCandidates) {
//       await handleRemoteIceCandidate(cand);
//     }
//     pendingIceCandidates = [];
//   }

//   try {
//     const remoteDesc = offer.sdp
//       ? { type: offer.type || 'offer', sdp: offer.sdp }
//       : offer;
//     await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
//     const answer = await peerConnection.createAnswer();
//     await peerConnection.setLocalDescription(answer);

//     ws && ws.send(JSON.stringify({
//       type: 'answer',
//       to: "XR-1234",
//       from: xrIdInput.value || "XR-1238",
//       sdp: peerConnection.localDescription.sdp
//     }));
//     console.log('[WebRTC] Sent answer');
//   } catch (err) {
//     console.error('[WebRTC] Error handling offer:', err);
//   }
// }

// async function handleRemoteIceCandidate(candidate) {
//   if (peerConnection && candidate && candidate.candidate) {
//     try {
//       await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
//       console.log('[WebRTC] Added ICE candidate:', candidate);
//     } catch (err) {
//       console.error('[WebRTC] Error adding ICE candidate:', err);
//     }
//   } else if (candidate) {
//     pendingIceCandidates.push(candidate);
//     console.log('[WebRTC] ICE candidate buffered:', candidate);
//   }
// }

// function stopStream() {
//   isStreamActive = false;
//   if (videoElement) {
//     videoElement.pause();
//     videoElement.srcObject = null;
//     videoElement.removeAttribute('src');
//     videoElement.load();
//   }
//   if (muteBadge) muteBadge.style.display = 'none';
//   if (videoOverlay) videoOverlay.style.display = 'none';
//   if (peerConnection) {
//     try { peerConnection.close(); } catch {}
//     peerConnection = null;
//   }
//   if (remoteStream) {
//     remoteStream.getTracks().forEach(track => { try { track.stop(); } catch {} });
//     remoteStream = null;
//   }
//   pendingIceCandidates = [];
// }

// function showClickToPlayOverlay() {
//   if (!videoOverlay) return;
//   videoOverlay.style.display = 'flex';
//   videoOverlay.innerHTML = `<button id="clickToPlayBtn" style="padding:1rem 2rem;font-size:1.25rem;">Click to Start Video</button>`;
//   document.getElementById('clickToPlayBtn').onclick = () => {
//     videoOverlay.style.display = 'none';
//     videoElement.play();
//   };
// }

// function updateDeviceList(devices) {
//   deviceListElement.innerHTML = '';
//   devices.forEach(device => {
//     console.log(`[DEVICE] DeviceName: ${device.name || device.deviceName || '(no name)'}  XR-ID: ${device.xrId || '(no xrId)'}`);
//     const li = document.createElement('li');
//     li.textContent = `${device.name || device.deviceName || device.xrId} (${device.xrId})`;
//     deviceListElement.appendChild(li);
//   });
// }

// function sendMessage() {
//   const text = messageInput.value.trim();
//   const sender = usernameInput.value.trim() || 'Desktop';
//   const xrId = xrIdInput.value.trim() || 'XR-1238';
//   const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

//   if (text && ws && ws.readyState === WebSocket.OPEN) {
//     const message = {
//       type: "message",
//       text,
//       sender,
//       xrId,
//       priority: urgentCheckbox.checked ? 'urgent' : 'normal',
//       timestamp
//     };
//     ws.send(JSON.stringify(message));
//     addMessageToHistory(message);
//     messageInput.value = '';
//   }
// }

// function normalizeMessage(message) {
//   if (!message || typeof message !== 'object') return {
//     text: String(message),
//     sender: 'unknown',
//     xrId: 'unknown',
//     timestamp: new Date().toLocaleTimeString(),
//     priority: 'normal'
//   };

//   let parsed = {};
//   if (typeof message.text === 'string' && message.text.trim().startsWith('{') && message.text.trim().endsWith('}')) {
//     try {
//       parsed = JSON.parse(message.text);
//     } catch (e) {}
//   }

//   const sender = message.sender || parsed.sender || 'unknown';
//   const xrId = message.xrId || parsed.xrId || 'unknown';
//   const text = message.text && typeof message.text === 'string' && parsed.text ? parsed.text : message.text || '';
//   const timestamp = message.timestamp || parsed.timestamp || new Date().toLocaleTimeString();
//   const isUrgent = message.urgent === true ||
//     message.priority === 'urgent' ||
//     parsed.urgent === true ||
//     parsed.priority === 'urgent' ||
//     (message.data && typeof message.data === 'string' &&
//       message.data.includes('"urgent":true'));

//   return {
//     text,
//     sender,
//     xrId,
//     timestamp,
//     priority: isUrgent ? 'urgent' : 'normal'
//   };
// }

// function addMessageToHistory(message) {
//   const msg = normalizeMessage(message);
//   const el = document.createElement('div');
//   el.className = `message ${msg.priority}`;
//   el.innerHTML = `
//     <div class="message-header">
//       <div class="sender-info">
//         <span class="sender-name">${msg.sender}</span>
//         <span class="xr-id">${msg.xrId}</span>
//       </div>
//       <div class="message-time">${msg.timestamp}</div>
//     </div>
//     <div class="message-content">${msg.text}</div>
//     ${msg.priority === 'urgent' ? '<div class="urgent-badge">URGENT</div>' : ''}
//   `;
//   messageHistoryDiv.appendChild(el);
//   messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
// }

// function addToRecentMessages(message) {
//   const msg = normalizeMessage(message);
//   const el = document.createElement('div');
//   el.className = `recent-message ${msg.priority}`;
//   el.innerHTML = `
//     <div class="recent-message-header">
//       <span class="recent-sender">${msg.sender}</span>
//       <span class="recent-xr-id">${msg.xrId}</span>
//       <span class="recent-time">${msg.timestamp}</span>
//     </div>
//     <div class="recent-message-content">${msg.text}</div>
//   `;
//   recentMessagesDiv.prepend(el);
//   if (recentMessagesDiv.children.length > 5) {
//     recentMessagesDiv.removeChild(recentMessagesDiv.lastChild);
//   }
// }

// function addSystemMessage(text) {
//   const el = document.createElement('div');
//   el.className = 'system-message';
//   el.textContent = text;
//   messageHistoryDiv.appendChild(el);
//   messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
// }

// function clearMessages() {
//   const by = usernameInput.value.trim() || 'Desktop';
//   if (ws && ws.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({
//       type: 'clear-messages',
//       by
//     }));
//     clearedMessages.clear();
//     recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
//     addSystemMessage(`🧹 Cleared messages locally by ${by}`);
//   }
// }

// function handleControlCommand(command) {
//   if (!isStreamActive && command !== 'stop_stream') return;
//   switch (command && command.toLowerCase && command.toLowerCase()) {
//     case 'mute':
//       if (muteBadge) muteBadge.style.display = 'block';
//       if (videoElement) videoElement.muted = true;
//       break;
//     case 'unmute':
//       if (muteBadge) muteBadge.style.display = 'none';
//       if (videoElement) videoElement.muted = false;
//       videoElement.play().catch(()=>{});
//       break;
//     case 'hide_video':
//       if (videoOverlay) videoOverlay.style.display = 'flex';
//       if (videoElement) videoElement.style.visibility = 'hidden';
//       break;
//     case 'show_video':
//       if (videoOverlay) videoOverlay.style.display = 'none';
//       if (videoElement) videoElement.style.visibility = 'visible';
//       break;
//     case 'stop_stream':
//       console.log('[CONTROL] Stopping stream via command');
//       stopStream();
//       break;
//     default:
//       console.warn('[CONTROL] Unknown command:', command);
//   }
// }

// function setAudioTracksMuted(mute) {
//   // No-op; muting is controlled by Android.
// }

// function checkStreamHealth() {
//   if (!peerConnection || !isStreamActive) return false;
//   const videoTracks = remoteStream?.getVideoTracks() || [];
//   const audioTracks = remoteStream?.getAudioTracks() || [];
//   return videoTracks.length > 0 && audioTracks.length > 0 &&
//     videoTracks.every(t => t.readyState === 'live') &&
//     audioTracks.every(t => t.readyState === 'live');
// }

// // === UI Event Bindings ===
// sendButton.addEventListener('click', sendMessage);
// messageInput.addEventListener('keypress', (e) => {
//   if (e.key === 'Enter' && !e.shiftKey) {
//     e.preventDefault();
//     sendMessage();
//   }
// });
// clearMessagesBtn?.addEventListener('click', clearMessages);
// openEmulatorBtn?.addEventListener('click', () => {
//   window.open('http://localhost:3000/display.html', '_blank');
// });
// if (videoOverlay) {
//   videoOverlay.addEventListener('click', () => {
//     videoOverlay.style.display = 'none';
//     videoElement.play();
//   });
// }

// document.addEventListener('DOMContentLoaded', () => {
//   // Check for duplicate tabs using localStorage
//   if (localStorage.getItem("xr-tab-open")) {
//     alert("Another desktop session is already active in a different tab.");
//     document.body.innerHTML = `
//       <div style="margin-top: 20%; text-align: center; color: red;">
//         <h2>This session is inactive.</h2>
//         <p>Please close other desktop tabs first.</p>
//       </div>`;
//     return;
//   }

//   localStorage.setItem("xr-tab-open", "true");
//   window.addEventListener("beforeunload", () => {
//     localStorage.removeItem("xr-tab-open");
//   });

//   // Wait for inputs to be fully ready before connecting
//   const checkInputs = setInterval(() => {
//     if (xrIdInput && xrIdInput.value.trim() !== "" && 
//         usernameInput && usernameInput.value.trim() !== "") {
//       clearInterval(checkInputs);
//       console.log('[APP] Inputs ready. Connecting WebSocket...');
//       safeConnectWebSocket();
//     }
//   }, 100);

//   document.addEventListener('visibilitychange', () => {
//     if (!document.hidden) {
//       console.log('[TAB] Tab became visible, verifying connection');
//       if (!ws || ws.readyState !== WebSocket.OPEN) {
//         safeConnectWebSocket();
//       }
//     }
//   });
// });

// =================================================@@@@@@@@@@@@@@@@@@@@@@@@@@@============================================================================

// === DOM Elements ===
console.log('[INIT] Initializing DOM elements');
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

console.log('[INIT] DOM elements initialized:', {
  videoElement, statusElement, deviceListElement, messageInput,
  sendButton, urgentCheckbox, recentMessagesDiv, messageHistoryDiv
});

let socket = null;
let peerConnection = null;
let remoteStream = null;
let clearedMessages = new Set();
let pendingIceCandidates = [];
let isStreamActive = false;
let reconnectTimeout = null;
let heartbeatInterval = null;

// CONFIG
console.log('[CONFIG] Loading configuration');
const SERVER_URL = 'https://xr-messaging-geexbheshbghhab7.centralindia-01.azurewebsites.net';
const XR_ID = xrIdInput.value?.trim() || "XR-1238";
const DEVICE_NAME = usernameInput.value?.trim() || "Desktop";
const ANDROID_ID = "XR-1234"; // direct messages/control target
console.log('[CONFIG] Server URL:', SERVER_URL);
console.log('[CONFIG] XR ID:', XR_ID);
console.log('[CONFIG] Device Name:', DEVICE_NAME);

function setStatus(status) {
  console.log('[STATUS] Updating status to:', status);
  statusElement.textContent = status;
  statusElement.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-red-600');
  switch (status.toLowerCase()) {
    case 'connected':
      console.log('[STATUS] Setting connected state');
      statusElement.classList.add('bg-green-500');
      break;
    case 'connecting':
      console.log('[STATUS] Setting connecting state');
      statusElement.classList.add('bg-yellow-500');
      break;
    case 'disconnected':
      console.log('[STATUS] Setting disconnected state');
      statusElement.classList.add('bg-red-600');
      break;
    default:
      console.log('[STATUS] Setting default (connecting) state');
      statusElement.classList.add('bg-yellow-500');
  }
}

function connectSocketIO() {
  console.log('[SOCKET] Connecting to Socket.IO server:', SERVER_URL);
  setStatus('Connecting');

  socket = io(SERVER_URL, {
    path: "/socket.io",
    transports: ["websocket"],
    secure: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    autoConnect: true
  });


  

  socket.on('connect', () => {
    console.log('[SOCKET] ✅ Successfully connected to server');
    setStatus('Connected');
    console.log('[SOCKET] Emitting identify with:', { deviceName: DEVICE_NAME, xrId: XR_ID });
    socket.emit('identify', {
      deviceName: DEVICE_NAME,
      xrId: XR_ID
    });
    if (reconnectTimeout) {
      console.log('[SOCKET] Clearing reconnect timeout');
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    startHeartbeat();
  });

  socket.on('disconnect', (reason) => {
    console.warn('[SOCKET] ❌ Disconnected from server. Reason:', reason);
    setStatus('Disconnected');
    if (reason === 'io server disconnect') {
      console.log('[SOCKET] Server forced disconnect - attempting reconnect');
      setTimeout(() => {
        console.log('[SOCKET] Attempting manual reconnect');
        socket.connect();
      }, 1000);
    }
  });

  socket.on('connect_error', (err) => {
    console.error('[SOCKET] 🛑 Connection error:', err.message);
    setStatus('Disconnected');
  });

  socket.on('error', (data) => {
    if (data.message?.includes('Duplicate desktop')) {
      console.warn('[SOCKET] 🚫 Duplicate desktop tab detected');
      alert('This desktop session is inactive. Please close other tabs.');
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; margin-top: 20%;">
          <h1 style="color: red; text-align: center;">Another tab is already connected.</h1>
          <p style="margin-top: 1rem;">Only one desktop tab can be active at a time.</p>
        </div>`;
      socket.disconnect();
    }
  });

  socket.on('signal', handleSignalMessage);
  socket.on('message', handleChatMessage);
  socket.on('device_list', updateDeviceList);
  socket.on('control', handleControlCommand);
  socket.on('message-cleared', handleMessagesCleared);
  socket.on('message_history', handleMessageHistory);
}

function startHeartbeat() {
  console.log('[HEARTBEAT] Starting heartbeat interval');
  if (heartbeatInterval) {
    console.log('[HEARTBEAT] Clearing existing heartbeat interval');
    clearInterval(heartbeatInterval);
  }
  heartbeatInterval = setInterval(() => {
    if (socket?.connected) {
      console.log('[HEARTBEAT] Sending ping to server');
      socket.emit('ping');
    } else {
      console.log('[HEARTBEAT] Socket not connected - skipping ping');
    }
  }, 25000);
}

function handleSignalMessage(data) {
  console.log('[SIGNAL] Received signal message:', data.type);
  switch (data.type) {
    case 'offer':
      console.log('[WEBRTC] 📞 Received offer from peer');
      // Server relays payload as { type, from, data }, pass the SDP object only
      handleOffer(data.data);
      break;
    case 'ice-candidate':
      console.log('[WEBRTC] ❄️ Received ICE candidate from peer');
      handleRemoteIceCandidate(data.data);
      break;
    default:
      console.log('[WEBRTC] Unhandled signal type:', data.type);
  }
}

function handleChatMessage(msg) {
  console.log('[CHAT] Received chat message:', msg);
  const normalized = normalizeMessage(msg);
  console.log('[CHAT] Normalized message:', normalized);
  addMessageToHistory(normalized);
  addToRecentMessages(normalized);
}

function handleMessagesCleared(data) {
  if (!clearedMessages.has(data.messageId)) {
    console.log('[CHAT] Messages cleared by', data.by, 'messageId:', data.messageId);
    clearedMessages.add(data.messageId);
    addSystemMessage(`🧹 Messages cleared by ${data.by}`);
    recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
  } else {
    console.log('[CHAT] Already processed clear message for messageId:', data.messageId);
  }
}

function handleMessageHistory(data) {
  console.log('[CHAT] Received message history with', data.messages.length, 'messages');
  data.messages.forEach(msg => {
    const normalized = normalizeMessage(msg);
    addMessageToHistory(normalized);
  });
}

function createPeerConnection() {
  console.log('[WEBRTC] Creating new peer connection');
  stopStream();
  const turnConfig = window.TURN_CONFIG || {};
  console.log('[WEBRTC] TURN config:', turnConfig);

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ];

  if (turnConfig.urls && turnConfig.username && turnConfig.credential) {
    iceServers.push({ urls: turnConfig.urls, username: turnConfig.username, credential: turnConfig.credential });
    console.log('[WEBRTC] Added TURN server to ICE configuration');
  }

  const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
  console.log('[WEBRTC] Peer connection created with ICE servers:', iceServers);

  pc.ontrack = (event) => {
    console.log('[WEBRTC] Received track:', event.track.kind);
    if (!remoteStream) {
      console.log('[WEBRTC] Creating new remote stream');
      remoteStream = new MediaStream();
      videoElement.srcObject = remoteStream;
      videoElement.muted = true;
    }
    if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
      console.log('[WEBRTC] Adding track to remote stream');
      remoteStream.addTrack(event.track);
    }
    videoElement.play().catch(e => {
      console.warn('[WEBRTC] Video play error:', e);
      showClickToPlayOverlay();
    });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[WEBRTC] Generated ICE candidate:', event.candidate);
      socket?.emit('signal', {
        type: 'ice-candidate',
        to: ANDROID_ID,
        from: XR_ID,
        data: event.candidate
      });
    } else {
      console.log('[WEBRTC] ICE gathering complete');
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WEBRTC] ICE connection state changed:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      console.log('[WEBRTC] ICE connection failed or disconnected - stopping stream');
      stopStream();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[WEBRTC] Connection state changed:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      setStatus('Connected');
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      console.log('[WEBRTC] Connection failed or disconnected - stopping stream');
      stopStream();
      setStatus('Connecting');
    }
  };

  isStreamActive = true;
  return pc;
}

async function handleOffer(offer) {
  console.log('[WEBRTC] Handling offer:', offer);
  stopStream();
  peerConnection = createPeerConnection();

  if (pendingIceCandidates.length > 0) {
    console.log('[WEBRTC] Processing', pendingIceCandidates.length, 'pending ICE candidates');
    for (const cand of pendingIceCandidates) {
      await handleRemoteIceCandidate(cand);
    }
    pendingIceCandidates = [];
  }

  try {
    console.log('[WEBRTC] Setting remote description');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[WEBRTC] Creating answer');
    const answer = await peerConnection.createAnswer();
    console.log('[WEBRTC] Setting local description');
    await peerConnection.setLocalDescription(answer);

    socket?.emit('signal', {
      type: 'answer',
      to: ANDROID_ID,
      from: XR_ID,
      data: peerConnection.localDescription
    });
    console.log('[WEBRTC] Answer sent to peer');
  } catch (err) {
    console.error('[WEBRTC] Error handling offer:', err);
  }
}

async function handleRemoteIceCandidate(candidate) {
  console.log('[WEBRTC] Handling remote ICE candidate:', candidate);
  if (peerConnection && candidate && candidate.candidate) {
    try {
      console.log('[WEBRTC] Adding ICE candidate to peer connection');
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WEBRTC] Error adding ICE candidate:', err);
    }
  } else if (candidate) {
    console.log('[WEBRTC] Buffering ICE candidate for later');
    pendingIceCandidates.push(candidate);
  }
}

function stopStream() {
  console.log('[STREAM] Stopping stream');
  isStreamActive = false;
  
  if (videoElement) {
    console.log('[STREAM] Pausing and clearing video element');
    videoElement.pause();
    videoElement.srcObject = null;
    videoElement.removeAttribute('src');
    videoElement.load();
  }

  if (muteBadge) {
    console.log('[STREAM] Hiding mute badge');
    muteBadge.style.display = 'none';
  }

  if (videoOverlay) {
    console.log('[STREAM] Hiding video overlay');
    videoOverlay.style.display = 'none';
  }

  if (peerConnection) {
    console.log('[STREAM] Closing peer connection');
    try { peerConnection.close(); } catch (e) {
      console.warn('[STREAM] Error closing peer connection:', e);
    }
    peerConnection = null;
  }

  if (remoteStream) {
    console.log('[STREAM] Stopping remote stream tracks');
    remoteStream.getTracks().forEach(track => { 
      try { track.stop(); } catch (e) {
        console.warn('[STREAM] Error stopping track:', e);
      }
    });
    remoteStream = null;
  }

  pendingIceCandidates = [];
  console.log('[STREAM] Stream stopped completely');
}

function showClickToPlayOverlay() {
  console.log('[UI] Showing click-to-play overlay');
  if (!videoOverlay) return;
  videoOverlay.style.display = 'flex';
  videoOverlay.innerHTML = `<button id="clickToPlayBtn" style="padding:1rem 2rem;font-size:1.25rem;">Click to Start Video</button>`;
  document.getElementById('clickToPlayBtn').onclick = () => {
    console.log('[UI] Click-to-play button clicked');
    videoOverlay.style.display = 'none';
    videoElement.play().catch(e => {
      console.warn('[UI] Error playing video after click:', e);
    });
  };
}

function updateDeviceList(devices) {
  if (!Array.isArray(devices)) {
    console.error("Device list is not an array:", devices);
    return;
  }

  console.log('[DEVICES] Updating device list with', devices.length, 'devices');
  deviceListElement.innerHTML = '';
  devices.forEach(device => {
    // server emits { deviceName, xrId }
    const name = device.deviceName || device.name || 'Unknown';
    console.log(`[DEVICE] Adding device: ${name} (${device.xrId})`);
    const li = document.createElement('li');
    li.textContent = `${name} (${device.xrId})`;
    deviceListElement.appendChild(li);
  });
}

function sendMessage() {
  const text = messageInput.value.trim();
  console.log('[CHAT] Sending message:', text);
  if (!text) {
    console.log('[CHAT] Empty message - not sending');
    return;
  }

  const message = {
    from: XR_ID,
    to: ANDROID_ID, // direct to Android
    text,
    urgent: urgentCheckbox.checked
  };

  console.log('[CHAT] Emitting message to server:', message);
  socket?.emit('message', message);
  addMessageToHistory({
    ...message,
    sender: DEVICE_NAME,
    xrId: XR_ID,
    timestamp: new Date().toLocaleTimeString()
  });
  messageInput.value = '';
}

function normalizeMessage(message) {
  return {
    text: message.text || '',
    sender: message.sender || message.from || 'unknown',
    xrId: message.xrId || message.from || 'unknown',
    timestamp: message.timestamp || new Date().toLocaleTimeString(),
    priority: message.urgent || message.priority === 'urgent' ? 'urgent' : 'normal'
  };
}

function addMessageToHistory(message) {
  console.log('[CHAT] Adding message to history:', message);
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

function addToRecentMessages(message) {
  console.log('[CHAT] Adding to recent messages:', message);
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
  if (recentMessagesDiv.children.length > 5) {
    console.log('[CHAT] Trimming recent messages to 5');
    recentMessagesDiv.removeChild(recentMessagesDiv.lastChild);
  }
}

function addSystemMessage(text) {
  console.log('[CHAT] Adding system message:', text);
  const el = document.createElement('div');
  el.className = 'system-message';
  el.textContent = text;
  messageHistoryDiv.appendChild(el);
  messageHistoryDiv.scrollTop = messageHistoryDiv.scrollHeight;
}

function clearMessages() {
  console.log('[CHAT] Clearing messages');
  socket?.emit('clear-messages', { by: DEVICE_NAME });
  clearedMessages.clear();
  recentMessagesDiv.innerHTML = '<div class="system-message">Messages cleared</div>';
  addSystemMessage(`🧹 Cleared messages locally by ${DEVICE_NAME}`);
}

function handleControlCommand(data) {
  console.log('[CONTROL] Received control command:', data.command);
  const command = data.command;
  if (!isStreamActive && command !== 'stop_stream') {
    console.log('[CONTROL] Stream not active - ignoring command');
    return;
  }

  switch (command.toLowerCase()) {
    case 'mute':
      console.log('[CONTROL] Executing mute command');
      if (muteBadge) muteBadge.style.display = 'block';
      if (videoElement) videoElement.muted = true;
      break;
    case 'unmute':
      console.log('[CONTROL] Executing unmute command');
      if (muteBadge) muteBadge.style.display = 'none';
      if (videoElement) videoElement.muted = false;
      videoElement.play().catch(()=>{});
      break;
    case 'hide_video':
      console.log('[CONTROL] Executing hide_video command');
      if (videoOverlay) videoOverlay.style.display = 'flex';
      if (videoElement) videoElement.style.visibility = 'hidden';
      break;
    case 'show_video':
      console.log('[CONTROL] Executing show_video command');
      if (videoOverlay) videoOverlay.style.display = 'none';
      if (videoElement) videoElement.style.visibility = 'visible';
      break;
    case 'stop_stream':
      console.log('[CONTROL] Executing stop_stream command');
      stopStream();
      break;
    default:
      console.warn('[CONTROL] Unknown command received:', command);
  }
}

// Event listeners
console.log('[INIT] Setting up event listeners');
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

if (clearMessagesBtn) {
  clearMessagesBtn.addEventListener('click', clearMessages);
}

if (openEmulatorBtn) {
  openEmulatorBtn.addEventListener('click', () => {
    console.log('[UI] Opening emulator in new window');
    window.open('http://localhost:3000/display.html', '_blank');
  });
}

if (videoOverlay) {
  videoOverlay.addEventListener('click', () => {
    console.log('[UI] Video overlay clicked - attempting to play video');
    videoOverlay.style.display = 'none';
    videoElement.play().catch(e => {
      console.warn('[UI] Error playing video after overlay click:', e);
    });
  });
}

window.addEventListener('load', () => {
  console.log('[APP] Window loaded - initializing application');
  connectSocketIO();
});

console.log('[INIT] Application initialization complete');

