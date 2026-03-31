import { SignalingClient } from './signaling.js';
import { WebRtcStreamer } from './device.js';

const XR_DEVICE_SCREEN_ID = 4;

let xrDevicePermissions = null;
let xrDevicePermsLoaded = false;

async function loadDevicePermissionsOnce() {
  if (xrDevicePermsLoaded) return;
  xrDevicePermsLoaded = true;

  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    xrDevicePermissions = null;
    return;
  }

  try {
    const res = await fetch('/api/platform/my-screens', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      console.warn('[XRDEVICE] my-screens returned', res.status);
      xrDevicePermissions = null;
      return;
    }

    const data = await res.json();
    const screens = data?.screens || [];

    let match = screens.find(s => s.id === XR_DEVICE_SCREEN_ID);

    if (!match) {
      match = screens.find(s => (s.screen_name || '').toLowerCase() === 'xr device');
    }
    if (!match) {
      match = screens.find(s => (s.route_path || '').toLowerCase() === '/device');
    }

    if (!match) {
      console.warn('[XRDEVICE] No screen entry for XR Device; leaving unrestricted.');
      xrDevicePermissions = null;
      return;
    }

    xrDevicePermissions = {
      read: !!match.read,
      write: !!match.write,
      edit: !!match.edit,
      delete: !!match.delete
    };

    console.log('[XRDEVICE] Permissions:', xrDevicePermissions);
  } catch (err) {
    console.warn('[XRDEVICE] Failed to load my-screens:', err);
    xrDevicePermissions = null;
  }
}

function hasDeviceWritePermission() {
  if (!xrDevicePermissions) return true;
  return !!xrDevicePermissions.write;
}

function notifyReadOnlyDevice() {
  const msg = 'You only have READ permission for XR Device. Streaming is not allowed.';
  if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
    window.showToast(msg, 'error');
  } else if (typeof alert === 'function') {
    alert(msg);
  } else {
    console.warn(msg);
  }
}

class DeviceApp {
  constructor() {
    this.currentScreen = 'home';
    this.isStreaming = false;
    this.isVoiceActive = false;
    this.signaling = null;
    this.webrtc = null;
    this.waveformAnimationId = null;

    this.init();
  }

  async init() {
    await loadDevicePermissionsOnce();
    this.initializeElements();
    this.setupEventListeners();
    this.initializeSignaling();
    this.setupWaveform();
    this.showScreen('home');
  }

  initializeElements() {
    this.screens = {
      home: document.getElementById('homeScreen'),
      video: document.getElementById('videoScreen'),
      messages: document.getElementById('messagesScreen'),
      profile: document.getElementById('profileScreen')
    };

    this.buttons = {
      play: document.getElementById('playBtn'),
      center: document.getElementById('centerBtn'),
      message: document.getElementById('messageBtn'),
      profileIcon: document.getElementById('profileIconBtn'),
      profileLogout: document.getElementById('profileLogoutBtn'),
      closeProfile: document.getElementById('closeProfileBtn'),
      mute: document.getElementById('muteBtn'),
      hide: document.getElementById('hideBtn'),
      pause: document.getElementById('pauseBtn'),
      pauseControl: document.getElementById('pauseControlBtn'),
      centerControl: document.getElementById('centerControlBtn'),
      chatControl: document.getElementById('chatControlBtn'),
      playMsg: document.getElementById('playBtnMsg'),
      centerMsg: document.getElementById('centerBtnMsg'),
      messageMsg: document.getElementById('messageBtnMsg'),
      messageSend: document.getElementById('messageSendBtn')
    };

    this.videoFeed = document.getElementById('videoFeed');
    this.waveformCanvas = document.getElementById('waveformCanvas');
    this.controlsPill = document.getElementById('controlsPill');
    this.controlsButtons = document.getElementById('controlsButtons');
    this.transcriptionOverlay = document.getElementById('transcriptionOverlay');
    this.messageInput = document.getElementById('messageInput');
    this.messageList = document.getElementById('messageList');
  }

  setupEventListeners() {
    this.buttons.play.addEventListener('click', () => this.handlePlay());
    this.buttons.center.addEventListener('click', () => this.handleCenterButton());
    this.buttons.message.addEventListener('click', () => this.showScreen('messages'));
    this.buttons.profileIcon.addEventListener('click', () => this.showScreen('profile'));
    this.buttons.profileLogout.addEventListener('click', () => this.handleLogout());
    this.buttons.closeProfile.addEventListener('click', () => this.showScreen('home'));

    this.buttons.mute.addEventListener('click', () => this.handleMute());
    this.buttons.hide.addEventListener('click', () => this.handleHide());
    this.buttons.pause.addEventListener('click', () => this.handlePause());

    this.buttons.pauseControl.addEventListener('click', () => this.handlePause());
    this.buttons.centerControl.addEventListener('click', () => this.handleCenterButton());
    this.buttons.chatControl.addEventListener('click', () => this.showScreen('messages'));

    this.buttons.playMsg.addEventListener('click', () => this.handlePlay());
    this.buttons.centerMsg.addEventListener('click', () => this.handleCenterButton());
    this.buttons.messageMsg.addEventListener('click', () => this.showScreen('messages'));

    this.buttons.messageSend.addEventListener('click', () => this.handleSendMessage());
    this.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleSendMessage();
      }
    });

    this.buttons.centerControl.addEventListener('click', () => {
      this.controlsPill.classList.toggle('show');
      this.controlsButtons.classList.toggle('show');
    });
  }

  async initializeSignaling() {
    try {
      const res = await fetch('/api/platform/me', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        console.error('[DeviceApp] Failed to fetch user info');
        return;
      }

      const userData = await res.json();
      const xrId = userData.xr_id || 'UNKNOWN';

      const profileXrId = document.getElementById('profileXrId');
      if (profileXrId) {
        profileXrId.textContent = xrId;
      }

      const socketUrl = window.SOCKET_URL || window.location.origin;
      this.signaling = new SignalingClient(socketUrl, xrId);

      this.signaling.on('connected', () => {
        console.log('[DeviceApp] Signaling connected');
      });

      this.signaling.on('peer_online', (peerId) => {
        console.log('[DeviceApp] Peer online:', peerId);
        this.updateDoctorStatus(true);
      });

      this.signaling.on('peer_offline', (peerId) => {
        console.log('[DeviceApp] Peer offline:', peerId);
        this.updateDoctorStatus(false);
      });

      this.signaling.on('message', (data) => {
        this.handleIncomingMessage(data);
      });

      this.webrtc = new WebRtcStreamer({
        signaling: this.signaling,
        androidXrId: xrId
      });

      this.signaling.on('rtc_offer', ({ offer, from }) => {
        this.webrtc.onRemoteOfferReceived(offer, from);
      });

      this.signaling.on('rtc_answer', ({ answer, from }) => {
        this.webrtc.onRemoteAnswerReceived(answer, from);
      });

      this.signaling.on('ice_candidate', ({ candidate, from }) => {
        this.webrtc.onRemoteIceCandidate(candidate, from);
      });

      this.signaling.on('control', (data) => {
        this.handleControlCommand(data);
      });

    } catch (err) {
      console.error('[DeviceApp] Failed to initialize signaling:', err);
    }
  }

  updateDoctorStatus(isOnline) {
    const statusIndicators = document.querySelectorAll('.status-indicator');
    const profileStatus = document.getElementById('profileStatus');

    statusIndicators.forEach(indicator => {
      if (isOnline) {
        indicator.classList.remove('offline');
      } else {
        indicator.classList.add('offline');
      }
    });

    if (profileStatus) {
      profileStatus.textContent = isOnline ? 'Online' : 'Offline';
      if (isOnline) {
        profileStatus.classList.remove('offline');
      } else {
        profileStatus.classList.add('offline');
      }
    }
  }

  handleIncomingMessage(data) {
    const messageItem = document.createElement('div');
    messageItem.className = 'message-item';
    if (data.urgent) {
      messageItem.classList.add('urgent');
    }

    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = data.from || 'Unknown';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = data.message || data.text || '';

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = 'Just now';

    messageItem.appendChild(sender);
    messageItem.appendChild(content);
    messageItem.appendChild(time);

    this.messageList.insertBefore(messageItem, this.messageList.firstChild);
  }

  handleControlCommand(data) {
    const cmd = data.cmd || data.command;
    console.log('[DeviceApp] Control command:', cmd);

    switch(cmd) {
      case 'start_stream':
        this.handlePlay();
        break;
      case 'stop_stream':
        this.handleStopStream();
        break;
      case 'mute':
        this.handleMute();
        break;
      case 'unmute':
        this.handleUnmute();
        break;
      case 'hide_video':
        this.handleHide();
        break;
      case 'show_video':
        this.handleShowVideo();
        break;
    }
  }

  showScreen(screenName) {
    Object.keys(this.screens).forEach(key => {
      this.screens[key].classList.remove('active');
    });

    if (this.screens[screenName]) {
      this.screens[screenName].classList.add('active');
      this.currentScreen = screenName;
    }
  }

  async handlePlay() {
    try {
      if (!hasDeviceWritePermission()) {
        notifyReadOnlyDevice();
        return;
      }

      this.showScreen('video');

      if (!this.isStreaming && this.webrtc) {
        const targetIds = this.signaling ? [this.signaling.xrId] : [];
        await this.webrtc.startStreaming(targetIds);
        this.webrtc.attachVideo(this.videoFeed);
        this.isStreaming = true;
        this.startWaveformAnimation();
      }
    } catch (err) {
      console.error('[DeviceApp] Failed to start stream:', err);
    }
  }

  async handleStopStream() {
    try {
      if (this.webrtc && this.isStreaming) {
        await this.webrtc.stopStreaming();
        this.isStreaming = false;
        this.stopWaveformAnimation();
      }
      this.showScreen('home');
    } catch (err) {
      console.error('[DeviceApp] Failed to stop stream:', err);
    }
  }

  handleCenterButton() {
    this.isVoiceActive = !this.isVoiceActive;
    console.log('[DeviceApp] Voice active:', this.isVoiceActive);
  }

  async handleMute() {
    if (this.webrtc) {
      this.webrtc.muteMic();
      console.log('[DeviceApp] Muted');
    }
  }

  async handleUnmute() {
    if (this.webrtc) {
      await this.webrtc.unmuteMic();
      console.log('[DeviceApp] Unmuted');
    }
  }

  handleHide() {
    if (this.webrtc) {
      this.webrtc.hideVideo();
      console.log('[DeviceApp] Video hidden');
    }
  }

  handleShowVideo() {
    if (this.webrtc) {
      this.webrtc.showVideo();
      console.log('[DeviceApp] Video shown');
    }
  }

  handlePause() {
    this.handleStopStream();
  }

  async handleSendMessage() {
    const message = this.messageInput.value.trim();
    if (!message) return;

    if (this.signaling) {
      this.signaling.sendMessage({
        type: 'text',
        message: message,
        urgent: false
      });
    }

    const messageItem = document.createElement('div');
    messageItem.className = 'message-item';

    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = 'You';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message;

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = 'Just now';

    messageItem.appendChild(sender);
    messageItem.appendChild(content);
    messageItem.appendChild(time);

    this.messageList.insertBefore(messageItem, this.messageList.firstChild);

    this.messageInput.value = '';
  }

  async handleLogout() {
    try {
      console.log('[DeviceApp] Manual logout initiated');

      try {
        sessionStorage.removeItem('XR_DEVICE_LAST_XR_ID_UI');
        sessionStorage.removeItem('xr-device-id');
        console.log('[DeviceApp] SessionStorage cleared on logout');
      } catch (e) {
        console.warn('[DeviceApp] Failed to clear sessionStorage:', e);
      }

      const response = await fetch('/api/platform/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      const data = await response.json();

      if (data.ok) {
        console.log('[DeviceApp] Logout successful, redirecting to login page');
        history.replaceState(null, '', '/platform');
        window.location.replace('/platform');
      } else {
        console.error('[DeviceApp] Logout failed:', data.message);
        history.replaceState(null, '', '/platform');
        window.location.replace('/platform');
      }
    } catch (err) {
      console.error('[DeviceApp] Logout error:', err);

      try {
        sessionStorage.removeItem('XR_DEVICE_LAST_XR_ID_UI');
        sessionStorage.removeItem('xr-device-id');
      } catch (e) {
        console.warn('[DeviceApp] Failed to clear sessionStorage:', e);
      }

      history.replaceState(null, '', '/platform');
      window.location.replace('/platform');
    }
  }

  setupWaveform() {
    if (!this.waveformCanvas) return;

    const ctx = this.waveformCanvas.getContext('2d');
    const canvas = this.waveformCanvas;
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    this.waveformCtx = ctx;
  }

  startWaveformAnimation() {
    if (this.waveformAnimationId) return;

    const animate = () => {
      this.drawWaveform();
      this.waveformAnimationId = requestAnimationFrame(animate);
    };

    animate();
  }

  stopWaveformAnimation() {
    if (this.waveformAnimationId) {
      cancelAnimationFrame(this.waveformAnimationId);
      this.waveformAnimationId = null;
    }
  }

  drawWaveform() {
    if (!this.waveformCtx || !this.waveformCanvas) return;

    const ctx = this.waveformCtx;
    const canvas = this.waveformCanvas;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    ctx.clearRect(0, 0, width, height);

    const time = Date.now() * 0.001;
    const points = 100;
    const amplitude = 40;
    const frequency = 2;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(110, 63, 243, 0.6)';
    ctx.lineWidth = 3;

    for (let i = 0; i < points; i++) {
      const x = (i / points) * width;
      const y = height / 2 + Math.sin((i / points) * frequency * Math.PI * 2 + time) * amplitude;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
    ctx.lineWidth = 2;

    for (let i = 0; i < points; i++) {
      const x = (i / points) * width;
      const y = height / 2 + Math.sin((i / points) * frequency * Math.PI * 2 + time + Math.PI / 4) * (amplitude * 0.7);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.deviceApp = new DeviceApp();
});
