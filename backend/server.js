// const express = require('express');
// const path = require('path');
// const WebSocket = require('ws');
// const fs = require('fs');
// require('dotenv').config();

// const PORT = process.env.PORT || 8080;
// const app = express();

// const staticPaths = [
//   path.join(__dirname, 'public'),
//   path.join(__dirname, '../frontend')
// ];

// let staticPathFound = null;
// staticPaths.forEach(possiblePath => {
//   if (fs.existsSync(possiblePath)) {
//     app.use(express.static(possiblePath));
//     console.log(`[STATIC] Serving static files from ${possiblePath}`);
//     if (!staticPathFound) staticPathFound = possiblePath;
//   }
// });
// if (!staticPathFound) {
//   console.error('ERROR: No static files directory found! Tried:', staticPaths);
// }

// function injectTurnConfig(html) {
//   const turnConfigScript = `
//     <script>
//       window.TURN_CONFIG = {
//         urls: '${process.env.TURN_URL}',
//         username: '${process.env.TURN_USERNAME}',
//         credential: '${process.env.TURN_CREDENTIAL}'
//       };
//     </script>
//   `;
//   return html.replace('</body>', `${turnConfigScript}\n</body>`);
// }

// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'healthy',
//     timestamp: new Date().toISOString(),
//     websocketClients: wss?.clients?.size || 0
//   });
// });

// app.get('/', (req, res) => {
//   if (!staticPathFound) return res.status(404).send('Static files not found');
//   let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//   res.send(injectTurnConfig(html));
// });

// app.get('*', (req, res) => {
//   if (staticPathFound) {
//     let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//     res.send(injectTurnConfig(html));
//   } else {
//     res.status(404).send('Static files not found');
//   }
// });

// const server = app.listen(PORT, '0.0.0.0', () => {
//   console.log(`[HTTP+WS] Server running on http://0.0.0.0:${PORT}`);
// });

// const wss = new WebSocket.Server({ server });
// const clients = new Set();
// const messageHistory = [];

// const heartbeat = (ws) => { ws.isAlive = true; };

// wss.on('connection', (ws) => {
//   clients.add(ws);
//   ws.isAlive = true;

//   console.log('\n[WS] New client connected (pending identification)...');
//   logCurrentDevices();

//   ws.on('pong', () => heartbeat(ws));
//   ws.on('error', (error) => console.error('[WS ERROR]', error));

//   // Send recent message history to new client
//   if (messageHistory.length > 0) {
//     ws.send(JSON.stringify({
//       type: 'message_history',
//       messages: messageHistory.slice(-10),
//     }));
//   }

//   ws.on('message', (message) => {
//     console.log('[WS] Received:', message.toString());

//     let data;
//     try {
//       data = JSON.parse(message);
//     } catch {
//       console.warn('[WS WARNING] Invalid JSON:', message.toString());
//       return;
//     }

//     if (!data || typeof data !== 'object' || !data.type) {
//       console.warn('[WS WARNING] Malformed message object:', data);
//       return;
//     }

//     const { type, from, to, deviceName } = data;

//     switch (type) {
//       case 'identification':
//         ws.deviceName = deviceName || 'Unknown';
//         ws.xrId = data.xrId || null;
//         console.log(`[IDENTIFIED] ${ws.deviceName} (${ws.xrId || 'no-id'}) just connected.`);
//         broadcastDeviceList();
//         logCurrentDevices();
//         break;

//       case 'message':
//         const fullMessage = {
//           ...data,
//           id: Date.now(),
//           timestamp: new Date().toISOString()
//         };
//         messageHistory.push(fullMessage);
//         if (messageHistory.length > 100) messageHistory.shift();
//         broadcastExcept(ws, fullMessage);
//         break;

//       case 'clear-messages':
//         console.log(`[MESSAGE] Clear requested by ${data.by}`);
//         broadcastAll({
//           type: 'message-cleared',
//           by: data.by,
//           messageId: Date.now()
//         });
//         break;

//       case 'clear_confirmation':
//         broadcastToDesktop({
//           type: 'message_cleared',
//           by: data.device,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       // ==== WEBRTC SIGNALING ====
//       case 'offer':
//       case 'webrtc-offer':
//         console.log(`[WEBRTC] Offer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({
//           type: 'offer',
//           sdp: data.sdp,
//           from,
//           to
//         }, ws);
//         break;

//       case 'answer':
//       case 'webrtc-answer':
//         console.log(`[WEBRTC] Answer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({
//           type: 'answer',
//           sdp: data.sdp,
//           from,
//           to
//         }, ws);
//         break;

//       case 'ice-candidate':
//         console.log(`[WEBRTC] ICE candidate from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({
//           type: 'ice-candidate',
//           candidate: data.candidate,
//           from,
//           to
//         }, ws);
//         break;

//       // ===========================
//       case 'control-command':
//       case 'control_command':
//         console.log(`[CONTROL] Command "${data.command}" from ${from}`);
//         broadcastAll({
//           type: 'control-command',
//           command: data.command,
//           from
//         });
//         break;

//       case 'status_report':
//         console.log(`[STATUS] Report from ${from}:`, data.status);
//         broadcastToDesktop({
//           type: 'status_report',
//           from,
//           status: data.status,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       default:
//         console.warn(`[WS WARNING] Unknown type received: ${type}`);
//     }
//   });

//   ws.on('close', () => {
//     clients.delete(ws);
//     console.log(`[DISCONNECTED] ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//     broadcastDeviceList();
//     logCurrentDevices();
//   });
// });

// // ==== Broadcast helpers ====
// function broadcastAll(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastExcept(sender, data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c !== sender && c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastToDesktop(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (
//       (c.deviceName === 'Desktop App' || c.deviceName === 'Desktop' || c.xrId === 'XR-1238')
//       && c.readyState === WebSocket.OPEN
//     ) {
//       c.send(msg);
//     }
//   });
// }

// function broadcastToTarget(data, sender) {
//   if (data.to) {
//     let sent = false;
//     clients.forEach(c => {
//       if (
//         (c.xrId === data.to || c.deviceName === data.to)
//         && c.readyState === WebSocket.OPEN
//         && c !== sender
//       ) {
//         c.send(JSON.stringify(data));
//         sent = true;
//       }
//     });
//     if (!sent) {
//       console.warn(`[WS WARNING] No client found for target: ${data.to}`);
//     }
//   } else {
//     broadcastExcept(sender, data);
//   }
// }

// function broadcastDeviceList() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => ({ name: c.deviceName, xrId: c.xrId }));

//   const msg = JSON.stringify({ type: 'device_list', devices: deviceList });

//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// // ---- Extra: Log all connected clients with XR IDs and Names ----
// function logCurrentDevices() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => `${c.deviceName} (${c.xrId || 'no-id'})`);
//   console.log(`[DEVICES] Currently connected:`);
//   deviceList.length === 0
//     ? console.log('   (none)')
//     : deviceList.forEach(d => console.log(`   - ${d}`));
// }

// // --- Heartbeat ping every 30s ---
// const interval = setInterval(() => {
//   wss.clients.forEach(ws => {
//     if (ws.isAlive === false) {
//       console.log(`[HEARTBEAT] Terminating dead client: ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//       return ws.terminate();
//     }
//     ws.isAlive = false;
//     ws.ping();
//   });
// }, 30000);

// // --- Graceful shutdown ---
// process.on('SIGINT', shutdown);
// process.on('SIGTERM', shutdown);

// function shutdown() {
//   console.log('[SERVER] Graceful shutdown initiated...');
//   clearInterval(interval);
//   wss.close(() => console.log('[SERVER] WebSocket server closed.'));
//   server.close(() => {
//     console.log('[SERVER] HTTP server closed.');
//     process.exit(0);
//   });
// }

// process.on('uncaughtException', (err) => {
//   console.error('[FATAL ERROR] Uncaught exception occurred:', err);
// });
// =======================================================================================================================================================================

// -------------------------------------------------one to one -----------------------------------------------------------------------------------------

// const express = require('express');
// const path = require('path');
// const WebSocket = require('ws');
// const fs = require('fs');
// require('dotenv').config();

// const PORT = process.env.PORT || 8080;
// const app = express();

// const staticPaths = [
//   path.join(__dirname, 'public'),
//   path.join(__dirname, '../frontend')
// ];

// let staticPathFound = null;
// staticPaths.forEach(possiblePath => {
//   if (fs.existsSync(possiblePath)) {
//     app.use(express.static(possiblePath));
//     console.log(`[STATIC] Serving static files from ${possiblePath}`);
//     if (!staticPathFound) staticPathFound = possiblePath;
//   }
// });
// if (!staticPathFound) {
//   console.error('ERROR: No static files directory found! Tried:', staticPaths);
// }

// function injectTurnConfig(html) {
//   const turnConfigScript = `
//     <script>
//       window.TURN_CONFIG = {
//         urls: '${process.env.TURN_URL}',
//         username: '${process.env.TURN_USERNAME}',
//         credential: '${process.env.TURN_CREDENTIAL}'
//       };
//     </script>
//   `;
//   return html.replace('</body>', `${turnConfigScript}\n</body>`);
// }

// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'healthy',
//     timestamp: new Date().toISOString(),
//     websocketClients: wss?.clients?.size || 0
//   });
// });

// app.get('/', (req, res) => {
//   if (!staticPathFound) return res.status(404).send('Static files not found');
//   let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//   res.send(injectTurnConfig(html));
// });

// app.get('*', (req, res) => {
//   if (staticPathFound) {
//     let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//     res.send(injectTurnConfig(html));
//   } else {
//     res.status(404).send('Static files not found');
//   }
// });

// const server = app.listen(PORT, '0.0.0.0', () => {
//   console.log(`[HTTP+WS] Server running on http://0.0.0.0:${PORT}`);
// });

// const wss = new WebSocket.Server({ server });
// const clients = new Set();
// const desktopClients = new Map(); // NEW: Track desktop clients by xrId
// const messageHistory = [];

// const heartbeat = (ws) => { ws.isAlive = true; };

// wss.on('connection', (ws) => {
//   clients.add(ws);
//   ws.isAlive = true;

//   console.log('\n[WS] New client connected (pending identification)...');
//   logCurrentDevices();

//   ws.on('pong', () => heartbeat(ws));
//   ws.on('error', (error) => console.error('[WS ERROR]', error));

//   if (messageHistory.length > 0) {
//     ws.send(JSON.stringify({
//       type: 'message_history',
//       messages: messageHistory.slice(-10),
//     }));
//   }

//   ws.on('message', (message) => {
//     console.log('[WS] Received:', message.toString());

//     let data;
//     try {
//       data = JSON.parse(message);
//     } catch {
//       console.warn('[WS WARNING] Invalid JSON:', message.toString());
//       return;
//     }

//     if (!data || typeof data !== 'object' || !data.type) {
//       console.warn('[WS WARNING] Malformed message object:', data);
//       return;
//     }

//     const { type, from, to, deviceName, xrId } = data;

//     switch (type) {
//       case 'identification':
//         ws.deviceName = deviceName || 'Unknown';
//         ws.xrId = xrId || null;

//         // === NEW: Enforce 1:1 Desktop Connection ===
//         if (ws.deviceName.startsWith('Desktop') || ws.xrId === 'XR-1238') {
//           if (desktopClients.has(ws.xrId)) {
//             console.log(`[BLOCKED] Duplicate desktop tab for ${ws.xrId}`);
//             ws.send(JSON.stringify({
//               type: 'error',
//               message: 'Duplicate desktop tab. Only one allowed.'
//             }));
//             ws.close();
//             return;
//           }
//           desktopClients.set(ws.xrId, ws);
//         }

//         console.log(`[IDENTIFIED] ${ws.deviceName} (${ws.xrId || 'no-id'}) just connected.`);
//         broadcastDeviceList();
//         logCurrentDevices();
//         break;

//       case 'message':
//         const fullMessage = {
//           ...data,
//           id: Date.now(),
//           timestamp: new Date().toISOString()
//         };
//         messageHistory.push(fullMessage);
//         if (messageHistory.length > 100) messageHistory.shift();
//         broadcastExcept(ws, fullMessage);
//         break;

//       case 'clear-messages':
//         console.log(`[MESSAGE] Clear requested by ${data.by}`);
//         broadcastAll({
//           type: 'message-cleared',
//           by: data.by,
//           messageId: Date.now()
//         });
//         break;

//       case 'clear_confirmation':
//         broadcastToDesktop({
//           type: 'message_cleared',
//           by: data.device,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       case 'offer':
//       case 'webrtc-offer':
//         console.log(`[WEBRTC] Offer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'offer', sdp: data.sdp, from, to }, ws);
//         break;

//       case 'answer':
//       case 'webrtc-answer':
//         console.log(`[WEBRTC] Answer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'answer', sdp: data.sdp, from, to }, ws);
//         break;

//       case 'ice-candidate':
//         console.log(`[WEBRTC] ICE candidate from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'ice-candidate', candidate: data.candidate, from, to }, ws);
//         break;

//       case 'control-command':
//       case 'control_command':
//         console.log(`[CONTROL] Command "${data.command}" from ${from}`);
//         broadcastAll({ type: 'control-command', command: data.command, from });
//         break;

//       case 'status_report':
//         console.log(`[STATUS] Report from ${from}:`, data.status);
//         broadcastToDesktop({
//           type: 'status_report',
//           from,
//           status: data.status,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       default:
//         console.warn(`[WS WARNING] Unknown type received: ${type}`);
//     }
//   });

//   ws.on('close', () => {
//     clients.delete(ws);
//     if (ws.xrId && desktopClients.get(ws.xrId) === ws) {
//       desktopClients.delete(ws.xrId); // Remove desktop mapping
//     }
//     console.log(`[DISCONNECTED] ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//     broadcastDeviceList();
//     logCurrentDevices();
//   });
// });

// // ==== Broadcast helpers remain unchanged ====
// function broadcastAll(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastExcept(sender, data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c !== sender && c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastToDesktop(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (
//       (c.deviceName === 'Desktop App' || c.deviceName === 'Desktop' || c.xrId === 'XR-1238')
//       && c.readyState === WebSocket.OPEN
//     ) {
//       c.send(msg);
//     }
//   });
// }

// function broadcastToTarget(data, sender) {
//   if (data.to) {
//     let sent = false;
//     clients.forEach(c => {
//       if (
//         (c.xrId === data.to || c.deviceName === data.to)
//         && c.readyState === WebSocket.OPEN
//         && c !== sender
//       ) {
//         c.send(JSON.stringify(data));
//         sent = true;
//       }
//     });
//     if (!sent) {
//       console.warn(`[WS WARNING] No client found for target: ${data.to}`);
//     }
//   } else {
//     broadcastExcept(sender, data);
//   }
// }

// function broadcastDeviceList() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => ({ name: c.deviceName, xrId: c.xrId }));

//   const msg = JSON.stringify({ type: 'device_list', devices: deviceList });

//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function logCurrentDevices() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => `${c.deviceName} (${c.xrId || 'no-id'})`);
//   console.log(`[DEVICES] Currently connected:`);
//   deviceList.length === 0
//     ? console.log('   (none)')
//     : deviceList.forEach(d => console.log(`   - ${d}`));
// }

// const interval = setInterval(() => {
//   wss.clients.forEach(ws => {
//     if (ws.isAlive === false) {
//       console.log(`[HEARTBEAT] Terminating dead client: ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//       return ws.terminate();
//     }
//     ws.isAlive = false;
//     ws.ping();
//   });
// }, 30000);

// process.on('SIGINT', shutdown);
// process.on('SIGTERM', shutdown);

// function shutdown() {
//   console.log('[SERVER] Graceful shutdown initiated...');
//   clearInterval(interval);
//   wss.close(() => console.log('[SERVER] WebSocket server closed.'));
//   server.close(() => {
//     console.log('[SERVER] HTTP server closed.');
//     process.exit(0);
//   });
// }

// process.on('uncaughtException', (err) => {
//   console.error('[FATAL ERROR] Uncaught exception occurred:', err);
// });


//--------------------------------------------------------------------deep seek------------------------------------------------------------------------

// const express = require('express');
// const path = require('path');
// const WebSocket = require('ws');
// const fs = require('fs');
// require('dotenv').config();

// const PORT = process.env.PORT || 8080;
// const app = express();

// const staticPaths = [
//   path.join(__dirname, 'public'),
//   path.join(__dirname, '../frontend')
// ];

// let staticPathFound = null;
// staticPaths.forEach(possiblePath => {
//   if (fs.existsSync(possiblePath)) {
//     app.use(express.static(possiblePath));
//     console.log(`[STATIC] Serving static files from ${possiblePath}`);
//     if (!staticPathFound) staticPathFound = possiblePath;
//   }
// });
// if (!staticPathFound) {
//   console.error('ERROR: No static files directory found! Tried:', staticPaths);
// }

// function injectTurnConfig(html) {
//   const turnConfigScript = `
//     <script>
//       window.TURN_CONFIG = {
//         urls: '${process.env.TURN_URL}',
//         username: '${process.env.TURN_USERNAME}',
//         credential: '${process.env.TURN_CREDENTIAL}'
//       };
//     </script>
//   `;
//   return html.replace('</body>', `${turnConfigScript}\n</body>`);
// }

// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'healthy',
//     timestamp: new Date().toISOString(),
//     websocketClients: wss?.clients?.size || 0
//   });
// });

// app.get('/', (req, res) => {
//   if (!staticPathFound) return res.status(404).send('Static files not found');
//   let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//   res.send(injectTurnConfig(html));
// });

// app.get('*', (req, res) => {
//   if (staticPathFound) {
//     let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//     res.send(injectTurnConfig(html));
//   } else {
//     res.status(404).send('Static files not found');
//   }
// });

// const server = app.listen(PORT, '0.0.0.0', () => {
//   console.log(`[HTTP+WS] Server running on http://0.0.0.0:${PORT}`);
// });

// const wss = new WebSocket.Server({ server });
// const clients = new Set();
// const desktopClients = new Map();
// const messageHistory = [];

// const heartbeat = (ws) => { ws.isAlive = true; };

// wss.on('connection', (ws) => {
//   clients.add(ws);
//   ws.isAlive = true;

//   console.log('\n[WS] New client connected (pending identification)...');
//   logCurrentDevices();

//   ws.on('pong', () => heartbeat(ws));
//   ws.on('error', (error) => console.error('[WS ERROR]', error));

//   if (messageHistory.length > 0) {
//     ws.send(JSON.stringify({
//       type: 'message_history',
//       messages: messageHistory.slice(-10),
//     }));
//   }

//   ws.on('message', (message) => {
//     console.log('[WS] Received:', message.toString());

//     let data;
//     try {
//       data = JSON.parse(message);
//     } catch {
//       console.warn('[WS WARNING] Invalid JSON:', message.toString());
//       return;
//     }

//     if (!data || typeof data !== 'object' || !data.type) {
//       console.warn('[WS WARNING] Malformed message object:', data);
//       return;
//     }

//     const { type, from, to, deviceName, xrId } = data;

//     switch (type) {
//       case 'identification':
//         ws.deviceName = deviceName || 'Unknown';
//         ws.xrId = xrId || null;

//         // Enhanced desktop client tracking
//         if (ws.deviceName.toLowerCase().includes('desktop') || ws.xrId === 'XR-1238') {
//           console.log(`[DESKTOP] Registering desktop client: ${ws.xrId}`);
//           if (desktopClients.has(ws.xrId)) {
//             console.log(`[BLOCKED] Duplicate desktop tab for ${ws.xrId}`);
//             ws.send(JSON.stringify({
//               type: 'error',
//               message: 'Duplicate desktop tab. Only one allowed.'
//             }));
//             ws.close();
//             return;
//           }
//           desktopClients.set(ws.xrId, ws);
//         }

//         console.log(`[IDENTIFIED] ${ws.deviceName} (${ws.xrId || 'no-id'}) just connected.`);
//         broadcastDeviceList();
//         logCurrentDevices();
//         break;

//       case 'setXrId':
//         ws.xrId = data.xrId;
//         console.log(`[XR-ID] Client registered as XR ID: ${data.xrId}`);
//         if (ws.deviceName && ws.deviceName.toLowerCase().includes('desktop')) {
//           desktopClients.set(data.xrId, ws);
//         }
//         broadcastDeviceList();
//         break;

//       case 'message':
//         const fullMessage = {
//           ...data,
//           id: Date.now(),
//           timestamp: new Date().toISOString()
//         };
//         messageHistory.push(fullMessage);
//         if (messageHistory.length > 100) messageHistory.shift();
//         broadcastExcept(ws, fullMessage);
//         break;

//       case 'clear-messages':
//         console.log(`[MESSAGE] Clear requested by ${data.by}`);
//         broadcastAll({
//           type: 'message-cleared',
//           by: data.by,
//           messageId: Date.now()
//         });
//         break;

//       case 'clear_confirmation':
//         broadcastToDesktop({
//           type: 'message_cleared',
//           by: data.device,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       case 'offer':
//       case 'webrtc-offer':
//         console.log(`[WEBRTC] Offer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'offer', sdp: data.sdp, from, to }, ws);
//         break;

//       case 'answer':
//       case 'webrtc-answer':
//         console.log(`[WEBRTC] Answer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'answer', sdp: data.sdp, from, to }, ws);
//         break;

//       case 'ice-candidate':
//         console.log(`[WEBRTC] ICE candidate from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'ice-candidate', candidate: data.candidate, from, to }, ws);
//         break;

//       case 'control-command':
//       case 'control_command':
//         console.log(`[CONTROL] Command "${data.command}" from ${from}`);
//         broadcastAll({ type: 'control-command', command: data.command, from });
//         break;

//       case 'status_report':
//         console.log(`[STATUS] Report from ${from}:`, data.status);
//         broadcastToDesktop({
//           type: 'status_report',
//           from,
//           status: data.status,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       case 'ping':
//         // Respond to ping for connection health checks
//         ws.send(JSON.stringify({ type: 'pong' }));
//         break;

//       default:
//         console.warn(`[WS WARNING] Unknown type received: ${type}`);
//     }
//   });

//   ws.on('close', () => {
//     clients.delete(ws);
//     if (ws.xrId && desktopClients.get(ws.xrId) === ws) {
//       console.log(`[DESKTOP] Removing desktop client: ${ws.xrId}`);
//       desktopClients.delete(ws.xrId);
//     }
//     console.log(`[DISCONNECTED] ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//     broadcastDeviceList();
//     logCurrentDevices();
//   });
// });

// // Broadcast helpers
// function broadcastAll(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastExcept(sender, data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c !== sender && c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastToDesktop(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (
//       (c.deviceName && c.deviceName.toLowerCase().includes('desktop')) ||
//       c.xrId === 'XR-1238'
//     ) {
//       if (c.readyState === WebSocket.OPEN) {
//         c.send(msg);
//       }
//     }
//   });
// }

// function broadcastToTarget(data, sender) {
//   if (data.to) {
//     let sent = false;
//     clients.forEach(c => {
//       if (
//         (c.xrId === data.to || c.deviceName === data.to) &&
//         c.readyState === WebSocket.OPEN &&
//         c !== sender
//       ) {
//         c.send(JSON.stringify(data));
//         sent = true;
//       }
//     });
//     if (!sent) {
//       console.warn(`[WS WARNING] No client found for target: ${data.to}`);
//     }
//   } else {
//     broadcastExcept(sender, data);
//   }
// }

// function broadcastDeviceList() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => ({ name: c.deviceName, xrId: c.xrId }));

//   const msg = JSON.stringify({ type: 'device_list', devices: deviceList });

//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function logCurrentDevices() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => `${c.deviceName} (${c.xrId || 'no-id'})`);
//   console.log(`[DEVICES] Currently connected:`);
//   deviceList.length === 0
//     ? console.log('   (none)')
//     : deviceList.forEach(d => console.log(`   - ${d}`));
// }

// const interval = setInterval(() => {
//   wss.clients.forEach(ws => {
//     if (ws.isAlive === false) {
//       console.log(`[HEARTBEAT] Terminating dead client: ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//       return ws.terminate();
//     }
//     ws.isAlive = false;
//     ws.ping();
//   });
// }, 30000);

// process.on('SIGINT', shutdown);
// process.on('SIGTERM', shutdown);

// function shutdown() {
//   console.log('[SERVER] Graceful shutdown initiated...');
//   clearInterval(interval);
//   wss.close(() => console.log('[SERVER] WebSocket server closed.'));
//   server.close(() => {
//     console.log('[SERVER] HTTP server closed.');
//     process.exit(0);
//   });
// }

// process.on('uncaughtException', (err) => {
//   console.error('[FATAL ERROR] Uncaught exception occurred:', err);
// });

// ===================================================================***************=============================================================

// const express = require('express');
// const path = require('path');
// const WebSocket = require('ws');
// const fs = require('fs');
// require('dotenv').config();

// const PORT = process.env.PORT || 8080;
// const app = express();

// const staticPaths = [
//   path.join(__dirname, 'public'),
//   path.join(__dirname, '../frontend')
// ];

// let staticPathFound = null;
// staticPaths.forEach(possiblePath => {
//   if (fs.existsSync(possiblePath)) {
//     app.use(express.static(possiblePath));
//     console.log(`[STATIC] Serving static files from ${possiblePath}`);
//     if (!staticPathFound) staticPathFound = possiblePath;
//   }
// });
// if (!staticPathFound) {
//   console.error('ERROR: No static files directory found! Tried:', staticPaths);
// }

// function injectTurnConfig(html) {
//   const turnConfigScript = `
//     <script>
//       window.TURN_CONFIG = {
//         urls: '${process.env.TURN_URL}',
//         username: '${process.env.TURN_USERNAME}',
//         credential: '${process.env.TURN_CREDENTIAL}'
//       };
//     </script>
//   `;
//   return html.replace('</body>', `${turnConfigScript}\n</body>`);
// }

// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'healthy',
//     timestamp: new Date().toISOString(),
//     websocketClients: wss?.clients?.size || 0
//   });
// });

// app.get('/', (req, res) => {
//   if (!staticPathFound) return res.status(404).send('Static files not found');
//   let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//   res.send(injectTurnConfig(html));
// });

// app.get('*', (req, res) => {
//   if (staticPathFound) {
//     let html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
//     res.send(injectTurnConfig(html));
//   } else {
//     res.status(404).send('Static files not found');
//   }
// });

// const server = app.listen(PORT, '0.0.0.0', () => {
//   console.log(`[HTTP+WS] Server running on http://0.0.0.0:${PORT}`);
// });

// const wss = new WebSocket.Server({ server });
// const clients = new Set();
// const desktopClients = new Map();
// const messageHistory = [];

// const heartbeat = (ws) => { ws.isAlive = true; };

// let deviceListTimeout = null;
// function broadcastDeviceListWithDelay(delayMs = 500) {
//   if (deviceListTimeout) clearTimeout(deviceListTimeout);
//   deviceListTimeout = setTimeout(() => {
//     broadcastDeviceList();
//     deviceListTimeout = null;
//   }, delayMs);
//   console.log(`[DEVICE LIST] Broadcasting device list in ${delayMs}ms...`);
// }

// wss.on('connection', (ws) => {
//   clients.add(ws);
//   ws.isAlive = true;

//   console.log('\n[WS] New client connected (pending identification)...');
//   logCurrentDevices();

//   ws.on('pong', () => heartbeat(ws));
//   ws.on('error', (error) => console.error('[WS ERROR]', error));

//   if (messageHistory.length > 0) {
//     ws.send(JSON.stringify({
//       type: 'message_history',
//       messages: messageHistory.slice(-10),
//     }));
//   }

//   ws.on('message', (message) => {
//     console.log('[WS] Received:', message.toString());

//     let data;
//     try {
//       data = JSON.parse(message);
//     } catch {
//       console.warn('[WS WARNING] Invalid JSON:', message.toString());
//       return;
//     }

//     if (!data || typeof data !== 'object' || !data.type) {
//       console.warn('[WS WARNING] Malformed message object:', data);
//       return;
//     }

//     const { type, from, to, deviceName, xrId } = data;

//     switch (type) {
//       case 'identification':
//         ws.deviceName = deviceName || 'Unknown';
//         ws.xrId = xrId || null;

//         console.log(`[IDENTIFY] ${ws.deviceName} (${ws.xrId || 'no-id'}) identified. Sending device list with delay...`);

//         if (ws.deviceName.toLowerCase().includes('desktop') || ws.xrId === 'XR-1238') {
//           console.log(`[DESKTOP] Registering desktop client: ${ws.xrId}`);
//           if (desktopClients.has(ws.xrId)) {
//             console.log(`[BLOCKED] Duplicate desktop tab for ${ws.xrId}`);
//             ws.send(JSON.stringify({
//               type: 'error',
//               message: 'Duplicate desktop tab. Only one allowed.'
//             }));
//             ws.close();
//             return;
//           }
//           desktopClients.set(ws.xrId, ws);
//         }

//         broadcastDeviceListWithDelay();
//         logCurrentDevices();
//         break;

//       case 'setXrId':
//         ws.xrId = data.xrId;
//         console.log(`[XR-ID] Client registered as XR ID: ${data.xrId}`);
//         if (ws.deviceName && ws.deviceName.toLowerCase().includes('desktop')) {
//           desktopClients.set(data.xrId, ws);
//         }
//         broadcastDeviceListWithDelay();
//         break;

//       case 'message':
//         const fullMessage = {
//           ...data,
//           id: Date.now(),
//           timestamp: new Date().toISOString()
//         };
//         messageHistory.push(fullMessage);
//         if (messageHistory.length > 100) messageHistory.shift();
//         broadcastExcept(ws, fullMessage);
//         break;

//       case 'clear-messages':
//         console.log(`[MESSAGE] Clear requested by ${data.by}`);
//         broadcastAll({
//           type: 'message-cleared',
//           by: data.by,
//           messageId: Date.now()
//         });
//         break;

//       case 'clear_confirmation':
//         broadcastToDesktop({
//           type: 'message_cleared',
//           by: data.device,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       case 'offer':
//       case 'webrtc-offer':
//         console.log(`[WEBRTC] Offer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'offer', sdp: data.sdp, from, to }, ws);
//         break;

//       case 'answer':
//       case 'webrtc-answer':
//         console.log(`[WEBRTC] Answer from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'answer', sdp: data.sdp, from, to }, ws);
//         break;

//       case 'ice-candidate':
//         console.log(`[WEBRTC] ICE candidate from ${from || 'unknown'} to ${to}`);
//         broadcastToTarget({ type: 'ice-candidate', candidate: data.candidate, from, to }, ws);
//         break;

//       case 'control-command':
//       case 'control_command':
//         console.log(`[CONTROL] Command "${data.command}" from ${from}`);
//         broadcastAll({ type: 'control-command', command: data.command, from });
//         break;

//       case 'status_report':
//         console.log(`[STATUS] Report from ${from}:`, data.status);
//         broadcastToDesktop({
//           type: 'status_report',
//           from,
//           status: data.status,
//           timestamp: new Date().toISOString()
//         });
//         break;

//       case 'ping':
//         ws.send(JSON.stringify({ type: 'pong' }));
//         break;

//       default:
//         console.warn(`[WS WARNING] Unknown type received: ${type}`);
//     }
//   });

//   ws.on('close', () => {
//     clients.delete(ws);
//     if (ws.xrId && desktopClients.get(ws.xrId) === ws) {
//       console.log(`[DESKTOP] Removing desktop client: ${ws.xrId}`);
//       desktopClients.delete(ws.xrId);
//     }
//     console.log(`[DISCONNECTED] ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//     broadcastDeviceListWithDelay();
//     logCurrentDevices();
//   });
// });

// // Broadcast helpers
// function broadcastAll(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastExcept(sender, data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (c !== sender && c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function broadcastToDesktop(data) {
//   const msg = JSON.stringify(data);
//   clients.forEach(c => {
//     if (
//       (c.deviceName && c.deviceName.toLowerCase().includes('desktop')) ||
//       c.xrId === 'XR-1238'
//     ) {
//       if (c.readyState === WebSocket.OPEN) {
//         c.send(msg);
//       }
//     }
//   });
// }

// function broadcastToTarget(data, sender) {
//   if (data.to) {
//     let sent = false;
//     clients.forEach(c => {
//       if (
//         (c.xrId === data.to || c.deviceName === data.to) &&
//         c.readyState === WebSocket.OPEN &&
//         c !== sender
//       ) {
//         c.send(JSON.stringify(data));
//         sent = true;
//       }
//     });
//     if (!sent) {
//       console.warn(`[WS WARNING] No client found for target: ${data.to}`);
//     }
//   } else {
//     broadcastExcept(sender, data);
//   }
// }

// function broadcastDeviceList() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => ({ name: c.deviceName, xrId: c.xrId || 'unknown' }));

//   const msg = JSON.stringify({ type: 'device_list', devices: deviceList });

//   clients.forEach(c => {
//     if (c.readyState === WebSocket.OPEN) c.send(msg);
//   });
// }

// function logCurrentDevices() {
//   const deviceList = Array.from(clients)
//     .filter(c => c.deviceName)
//     .map(c => `${c.deviceName} (${c.xrId || 'no-id'})`);
//   console.log(`[DEVICES] Currently connected:`);
//   deviceList.length === 0
//     ? console.log('   (none)')
//     : deviceList.forEach(d => console.log(`   - ${d}`));
// }

// const interval = setInterval(() => {
//   wss.clients.forEach(ws => {
//     if (ws.isAlive === false) {
//       console.log(`[HEARTBEAT] Terminating dead client: ${ws.deviceName || 'Unknown'} (${ws.xrId || 'no-id'})`);
//       return ws.terminate();
//     }
//     ws.isAlive = false;
//     ws.ping();
//   });
// }, 30000);

// process.on('SIGINT', shutdown);
// process.on('SIGTERM', shutdown);

// function shutdown() {
//   console.log('[SERVER] Graceful shutdown initiated...');
//   clearInterval(interval);
//   wss.close(() => console.log('[SERVER] WebSocket server closed.'));
//   server.close(() => {
//     console.log('[SERVER] HTTP server closed.');
//     process.exit(0);
//   });
// }

// process.on('uncaughtException', (err) => {
//   console.error('[FATAL ERROR] Uncaught exception occurred:', err);
// });


// ==============================================================@@@@@@@@@@@@@@@@@@@@@@@@@@@==============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

console.log('[INIT] Starting server initialization...');

// Configuration
const PORT = process.env.PORT || 8080;
console.log(`[CONFIG] Using port: ${PORT}`);

const app = express();
const server = http.createServer(app);
console.log('[HTTP] Server created');

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
console.log('[SOCKET.IO] Socket.IO server initialized');

// Middleware
app.use(cors());
app.use(express.json());
console.log('[MIDDLEWARE] CORS and JSON middleware applied');

// Static file handling
const staticPaths = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '../frontend')
];

console.log('[STATIC] Checking for static paths...');
let staticPathFound = null;
staticPaths.forEach((dir) => {
  if (fs.existsSync(dir)) {
    app.use(express.static(dir));
    staticPathFound = dir;
    console.log(`[STATIC] Serving from ${dir}`);
  }
});
if (!staticPathFound) {
  console.warn('⚠️ [STATIC] No static path found.');
}

// TURN injection into HTML
function injectTurnConfig(html) {
  console.log('[TURN] Injecting TURN configuration into HTML');
  const configScript = `
    <script>
      window.TURN_CONFIG = {
        urls: '${process.env.TURN_URL || ''}',
        username: '${process.env.TURN_USERNAME || ''}',
        credential: '${process.env.TURN_CREDENTIAL || ''}'
      };
    </script>
  `;
  return html.replace('</body>', `${configScript}\n</body>`);
}

// HTTP routes
app.get('/health', (req, res) => {
  console.log('[HEALTH] Health check requested');
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connectedClients: clients.size
  });
});

app.get('/', (req, res) => {
  console.log('[ROUTE] Serving root path');
  if (!staticPathFound) {
    console.warn('[ROUTE] Static path not found for root');
    return res.status(404).send('Static not found');
  }
  const html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
  res.send(injectTurnConfig(html));
});

app.get('*', (req, res) => {
  console.log(`[ROUTE] Catch-all route for: ${req.path}`);
  if (!staticPathFound) {
    console.warn('[ROUTE] Static path not found for catch-all');
    return res.status(404).send('Static not found');
  }
  const html = fs.readFileSync(path.join(staticPathFound, 'index.html'), 'utf8');
  res.send(injectTurnConfig(html));
});

// Socket.IO logic
const clients = new Map();         // xrId → socket
const desktopClients = new Map();  // xrId → socket
const messageHistory = [];
console.log('[SOCKET.IO] Data structures initialized');

function broadcastDeviceList() {
  console.log('[DEVICE_LIST] Broadcasting device list');
  const deviceList = Array.from(clients.entries()).map(([xrId, socket]) => ({
    xrId,
    deviceName: socket.data.deviceName || 'Unknown'
  }));
  io.emit('device_list', deviceList); // emit array of { deviceName, xrId }
}

function logCurrentDevices() {
  console.log('[DEVICES] Current connected devices:');
  if (clients.size === 0) {
    console.log('   (none)');
    return;
  }
  for (const [xrId, socket] of clients.entries()) {
    console.log(`   - ${socket.data.deviceName || 'Unknown'} (${xrId})`);
  }
}

function broadcastToDesktop(type, data) {
  console.log(`[BROADCAST] Sending to desktop clients: ${type}`);
  for (const socket of desktopClients.values()) {
    socket.emit(type, data);
  }
}

function broadcastToTarget(to, type, data) {
  console.log(`[TARGET] Sending to ${to}: ${type}`);
  const target = clients.get(to);
  if (target) {
    target.emit(type, data);
  } else {
    console.warn(`[TARGET] Target not found: ${to}`);
  }
}

function addToMessageHistory(message) {
  console.log('[MESSAGE_HISTORY] Adding message to history');
  messageHistory.push({
    ...message,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });

  if (messageHistory.length > 100) {
    console.log('[MESSAGE_HISTORY] Trimming message history');
    messageHistory.shift();
  }
}

io.on('connection', (socket) => {
  console.log(`🔌 [CONNECTION] New connection: ${socket.id}`);

  // Send recent message history to new connections
  if (messageHistory.length > 0) {
    console.log(`[MESSAGE_HISTORY] Sending ${messageHistory.length} messages to new connection`);
    socket.emit('message_history', {
      type: 'message_history',
      messages: messageHistory.slice(-10)
    });
  }

  socket.on('join', (xrId) => {
    console.log(`[JOIN] Request from ${socket.id} to join as ${xrId}`);
    socket.data.xrId = xrId;
    clients.set(xrId, socket);
    console.log(`✅ [JOIN] Successfully joined as ${xrId}`);
    broadcastDeviceList();
    logCurrentDevices();
  });

  socket.on('identify', ({ deviceName, xrId }) => {
    console.log(`[IDENTIFY] Request from ${socket.id}: ${deviceName} (${xrId})`);
    socket.data.deviceName = deviceName || 'Unknown';
    socket.data.xrId = xrId;
    clients.set(xrId, socket);

    if (deviceName?.toLowerCase().includes('desktop') || xrId === 'XR-1238') {
      console.log(`[IDENTIFY] Detected desktop client: ${xrId}`);
      if (desktopClients.has(xrId)) {
        console.warn(`[IDENTIFY] Duplicate desktop tab detected: ${xrId}`);
        socket.emit('error', { message: 'Duplicate desktop tab' });
        socket.disconnect();
        return;
      }
      desktopClients.set(xrId, socket);
    }

    console.log(`[IDENTIFY] Successfully identified: ${deviceName} (${xrId})`);
    broadcastDeviceList();
  });

  // WebRTC signaling
  socket.on('signal', ({ type, from, to, data }) => {
    console.log(`📡 [SIGNAL] ${type} signal from ${from} to ${to}`);
    // Keep payload shape { type, from, data } — desktop code expects 'data' for offer/ICE
    if (!to) {
      console.warn(`[SIGNAL] Missing 'to' in signal from ${from}`);
      return;
    }
    broadcastToTarget(to, 'signal', { type, from, data });
  });

  // Control commands
  socket.on('control', ({ command, from, to, message }) => {
    console.log(`🎮 [CONTROL] ${command} command from ${from} to ${to || 'all'}`);
    const payload = { command, from, message };
    if (to) {
      broadcastToTarget(to, 'control', payload);
    } else {
      io.emit('control', payload);
    }
  });

  // Messaging system
  socket.on('message', ({ from, to, text, urgent }) => {
    console.log(`[MESSAGE] Received message from ${from} to ${to || 'all'}: ${text}`);
    const msg = {
      type: 'message',
      from,
      to,
      text,
      urgent,
      sender: socket.data.deviceName || from || 'unknown',
      xrId: from,
      timestamp: new Date().toISOString()
    };

    addToMessageHistory(msg);

    if (to) {
      broadcastToTarget(to, 'message', msg);
    } else {
      socket.broadcast.emit('message', msg);
    }
  });

  socket.on('clear-messages', ({ by }) => {
    console.log(`[CLEAR] Request to clear messages by ${by}`);
    const payload = { type: 'message-cleared', by, messageId: Date.now() };
    io.emit('message-cleared', payload);
  });

  socket.on('clear_confirmation', ({ device }) => {
    console.log(`[CLEAR_CONFIRM] Confirmation from ${device}`);
    const payload = {
      type: 'message_cleared',
      by: device,
      timestamp: new Date().toISOString()
    };
    broadcastToDesktop('message_cleared', payload);
  });

  socket.on('status_report', ({ from, status }) => {
    console.log(`[STATUS_REPORT] Received from ${from}: ${status}`);
    const payload = {
      type: 'status_report',
      from,
      status,
      timestamp: new Date().toISOString()
    };
    broadcastToDesktop('status_report', payload);
  });

  socket.on('message_history', () => {
    console.log(`[MESSAGE_HISTORY] Request from ${socket.id}`);
    socket.emit('message_history', {
      type: 'message_history',
      messages: messageHistory.slice(-10)
    });
  });

  socket.on('disconnect', () => {
    const xrId = socket.data.xrId;
    if (xrId) {
      clients.delete(xrId);
      if (desktopClients.get(xrId) === socket) {
        desktopClients.delete(xrId);
        console.log(`[DISCONNECT] Removed desktop client: ${xrId}`);
      }
      console.log(`❎ [DISCONNECT] ${socket.data.deviceName || 'Unknown'} (${xrId}) disconnected`);
    } else {
      console.log(`❎ [DISCONNECT] Anonymous ${socket.id} disconnected`);
    }

    broadcastDeviceList();
    logCurrentDevices();
  });

  socket.on('error', (err) => {
    console.error(`[SOCKET_ERROR] ${socket.id}:`, err);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [SERVER] Running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('uncaughtException', (err) => {
  console.error('[FATAL_ERROR] Uncaught exception:', err);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  console.log('\n[SHUTDOWN] Graceful shutdown initiated...');

  // Disconnect all sockets
  const socketCount = io.sockets.sockets.size;
  console.log(`[SHUTDOWN] Disconnecting ${socketCount} sockets...`);
  io.sockets.sockets.forEach(socket => {
    socket.disconnect(true);
  });

  // Close Socket.IO
  io.close(() => {
    console.log('[SHUTDOWN] Socket.IO server closed');

    // Close HTTP server
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed');
      process.exit(0);
    });
  });
}

console.log('[INIT] Server initialization complete');
