(function () {
  'use strict';

  var profileToggle = document.getElementById('hcProfileToggle');
  var profilePopup = document.getElementById('hcProfilePopup');
  var popupOverlay = document.getElementById('hcPopupOverlay');
  var popupConnect = document.getElementById('hcPopupConnect');
  var profileCircle = document.getElementById('hcProfileCircle');
  var doctorNameEl = document.getElementById('hcDoctorName');
  var popupNameEl = document.getElementById('hcPopupName');
  var popupScribeNameEl = document.getElementById('hcPopupScribeName');
  var popupScribeBadgeEl = document.getElementById('hcPopupScribeBadge');
  var popupConnStatus = document.getElementById('hcPopupConnStatus');
  var popupConnLabel = document.getElementById('hcPopupConnLabel');

  var streamDoctorName = document.getElementById('hcStreamDoctorName');
  var streamProfileCircle = document.getElementById('hcStreamProfileCircle');
  var msgDoctorName = document.getElementById('hcMsgDoctorName');
  var msgProfileCircle = document.getElementById('hcMsgProfileCircle');

  var homeContent = document.getElementById('hcHomeContent');
  var bottomNav = document.getElementById('hcBottomNav');

  var playBtn = document.getElementById('hcPlayBtn');
  var orbBtn = document.getElementById('hcOrbBtn');
  var msgBtn = document.getElementById('hcMsgBtn');

  var streamPopup = document.getElementById('hcStreamPopup');
  var streamVideoWrap = document.getElementById('hcStreamVideoWrap');
  var streamMuteBtn = document.getElementById('hcStreamMuteBtn');
  var streamHideBtn = document.getElementById('hcStreamHideBtn');
  var streamPauseBtn = document.getElementById('hcStreamPauseBtn');
  var streamPlayBtn = document.getElementById('hcStreamPlayBtn');
  var streamOrbBtn = document.getElementById('hcStreamOrbBtn');
  var streamMsgBtn = document.getElementById('hcStreamMsgBtn');

  var msgPopup = document.getElementById('hcMsgPopup');
  var msgPlayBtn = document.getElementById('hcMsgPlayBtn');
  var msgOrbBtn = document.getElementById('hcMsgOrbBtn');
  var msgMsgBtn = document.getElementById('hcMsgMsgBtn');
  var hcMsgInput = document.getElementById('hcMsgInput');
  var hcMsgSendBtn = document.getElementById('hcMsgSendBtn');
  var hcRecentMsgContent = document.getElementById('hcRecentMsgContent');
  var hcMsgHistoryContent = document.getElementById('hcMsgHistoryContent');

  var hcWaveCanvas = document.getElementById('hcWaveCanvas');
  var hcTranscriptCurrent = document.getElementById('hcTranscriptCurrent');
  var hcTranscriptPrev = document.getElementById('hcTranscriptPrev');
  var hcTranscriptNext = document.getElementById('hcTranscriptNext');
  var hcSummaryDisplay = document.getElementById('hcSummaryDisplay');
  var hcSummaryText = document.getElementById('hcSummaryText');

  var hiddenConnect = document.getElementById('btnConnect');
  var hiddenStream = document.getElementById('btnStream');
  var hiddenMute = document.getElementById('btnMute');
  var hiddenVideo = document.getElementById('btnVideo');
  var hiddenVoice = document.getElementById('btnVoice');
  var hiddenSend = document.getElementById('btnSend');
  var hiddenMsgInput = document.getElementById('msgInput');
  var hiddenChkUrgent = document.getElementById('chkUrgent');
  var hiddenMsgList = document.getElementById('msgList');
  var hiddenPreview = document.getElementById('preview');
  var hiddenBdot = document.getElementById('bdot');
  var hiddenBtxt = document.getElementById('btxt');
  var hiddenXrIdDisplay = document.getElementById('xrIdDisplay');
  var peerStatusText = document.getElementById('peerStatusText');

  function closeAllPopups() {
    if (profilePopup) profilePopup.classList.remove('show');
    if (popupOverlay) popupOverlay.classList.remove('show');
  }

  if (profileToggle) {
    profileToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = profilePopup && profilePopup.classList.contains('show');
      if (isOpen) {
        closeAllPopups();
      } else {
        if (profilePopup) profilePopup.classList.add('show');
        if (popupOverlay) popupOverlay.classList.add('show');
      }
    });
  }

  if (popupOverlay) {
    popupOverlay.addEventListener('click', closeAllPopups);
  }

  if (popupConnect) {
    popupConnect.addEventListener('click', function () {
      if (hiddenConnect) hiddenConnect.click();
      closeAllPopups();
    });
  }

  function openStreamPopup() {
    if (streamPopup) streamPopup.classList.add('show');
    if (msgPopup) msgPopup.classList.remove('show');

    if (hiddenPreview && streamVideoWrap) {
      hiddenPreview.hidden = false;
      hiddenPreview.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);position:absolute;inset:0;';
      streamVideoWrap.appendChild(hiddenPreview);
    }
    startStreamWaveAnimation();
  }

  function closeStreamPopup() {
    if (streamPopup) streamPopup.classList.remove('show');
    stopStreamWaveAnimation();

    if (hiddenPreview) {
      hiddenPreview.hidden = true;
      hiddenPreview.style.cssText = '';
      var shell = document.getElementById('shell');
      if (shell) shell.appendChild(hiddenPreview);
    }
  }

  function openMsgPopup() {
    if (msgPopup) msgPopup.classList.add('show');
    if (streamPopup) streamPopup.classList.remove('show');
    syncMessages();
  }

  function closeMsgPopup() {
    if (msgPopup) msgPopup.classList.remove('show');
  }

  if (playBtn) {
    playBtn.addEventListener('click', function () {
      if (hiddenStream) hiddenStream.click();
    });
  }

  if (orbBtn) {
    orbBtn.addEventListener('click', function () {
      if (hiddenVoice) hiddenVoice.click();
      orbBtn.classList.toggle('active');
    });
  }

  if (msgBtn) {
    msgBtn.addEventListener('click', function () {
      openMsgPopup();
    });
  }

  if (streamPlayBtn) {
    streamPlayBtn.addEventListener('click', function () {
      if (hiddenStream) hiddenStream.click();
    });
  }

  if (streamOrbBtn) {
    streamOrbBtn.addEventListener('click', function () {
      if (hiddenVoice) hiddenVoice.click();
      streamOrbBtn.classList.toggle('active');
      if (orbBtn) orbBtn.classList.toggle('active');
    });
  }

  if (streamMsgBtn) {
    streamMsgBtn.addEventListener('click', function () {
      closeStreamPopup();
      openMsgPopup();
    });
  }

  if (streamMuteBtn) {
    streamMuteBtn.addEventListener('click', function () {
      if (hiddenMute) hiddenMute.click();
    });
  }

  if (streamHideBtn) {
    streamHideBtn.addEventListener('click', function () {
      if (hiddenVideo) hiddenVideo.click();
    });
  }

  if (streamPauseBtn) {
    streamPauseBtn.addEventListener('click', function () {
      var btnAudio = document.getElementById('btnAudio');
      if (btnAudio && !btnAudio.disabled) {
        btnAudio.click();
      }
    });
  }

  if (msgPlayBtn) {
    msgPlayBtn.addEventListener('click', function () {
      closeMsgPopup();
      if (hiddenStream) hiddenStream.click();
    });
  }

  if (msgOrbBtn) {
    msgOrbBtn.addEventListener('click', function () {
      if (hiddenVoice) hiddenVoice.click();
      if (orbBtn) orbBtn.classList.toggle('active');
    });
  }

  if (msgMsgBtn) {
    msgMsgBtn.addEventListener('click', function () {
      closeMsgPopup();
    });
  }

  if (hcMsgSendBtn) {
    hcMsgSendBtn.addEventListener('click', function () {
      var text = (hcMsgInput && hcMsgInput.value || '').trim();
      if (!text) return;

      if (hiddenMsgInput) hiddenMsgInput.value = text;
      if (hiddenChkUrgent) hiddenChkUrgent.checked = false;
      if (hiddenSend) hiddenSend.click();

      if (hcMsgInput) hcMsgInput.value = '';
      setTimeout(syncMessages, 200);
    });
  }

  if (hcMsgInput) {
    hcMsgInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hcMsgSendBtn) hcMsgSendBtn.click();
      }
    });
  }

  function syncMessages() {
    if (!hiddenMsgList) return;

    var items = hiddenMsgList.querySelectorAll('.msg');
    var historyHtml = '';
    var recentHtml = '';

    var allItems = Array.prototype.slice.call(items);

    if (allItems.length > 0) {
      var last = allItems[allItems.length - 1];
      var lastSender = last.querySelector('.msg-header');
      var lastText = last.querySelector('.msg-text');
      var lastTime = last.querySelector('.msg-timestamp');

      recentHtml = '<div class="hc-msg-item"><div class="hc-msg-item-header"><div>';
      recentHtml += '<div class="hc-msg-sender">' + escapeHtml(lastSender ? lastSender.textContent : '') + '</div>';
      recentHtml += '</div><button class="hc-msg-reply-btn" onclick="document.getElementById(\'hcMsgInput\').focus()">Reply</button></div>';
      recentHtml += '<div class="hc-msg-text">' + escapeHtml(lastText ? lastText.textContent : '') + '</div></div>';
    }

    for (var i = allItems.length - 1; i >= 0; i--) {
      var item = allItems[i];
      var sender = item.querySelector('.msg-header');
      var text = item.querySelector('.msg-text');
      var time = item.querySelector('.msg-timestamp');

      var senderText = sender ? sender.textContent.replace(/URGENT/g, '').trim() : '';
      var msgText = text ? text.textContent : '';
      var timeText = time ? time.textContent : '';

      var msgType = 'MESSAGE';
      if (msgText.toLowerCase().indexOf('voice') >= 0 || msgText.toLowerCase().indexOf('unrecognized') >= 0) {
        msgType = 'VOICE';
      } else if (msgText.toLowerCase().indexOf('note') >= 0) {
        msgType = 'NOTE';
      }

      historyHtml += '<div class="hc-msg-item">';
      historyHtml += '<div class="hc-msg-item-header">';
      historyHtml += '<div><div class="hc-msg-sender">' + escapeHtml(senderText) + '</div>';
      historyHtml += '<div class="hc-msg-type">' + msgType + '</div></div>';
      historyHtml += '<div class="hc-msg-time">' + escapeHtml(timeText) + '</div>';
      historyHtml += '</div>';
      historyHtml += '<div class="hc-msg-text">' + escapeHtml(msgText) + '</div>';
      historyHtml += '</div>';
    }

    if (hcRecentMsgContent) hcRecentMsgContent.innerHTML = recentHtml || '<div class="hc-msg-text" style="color:#9ca3af">No messages yet</div>';
    if (hcMsgHistoryContent) hcMsgHistoryContent.innerHTML = historyHtml || '<div class="hc-msg-text" style="color:#9ca3af">No message history</div>';
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function syncConnectionStatus() {
    var isConnected = hiddenBdot && !hiddenBdot.classList.contains('off');

    var allCircles = [profileCircle, streamProfileCircle, msgProfileCircle];
    for (var i = 0; i < allCircles.length; i++) {
      if (allCircles[i]) {
        if (isConnected) {
          allCircles[i].classList.remove('disconnected');
        } else {
          allCircles[i].classList.add('disconnected');
        }
      }
    }

    if (popupConnect) {
      if (isConnected) {
        popupConnect.textContent = 'Disconnect';
        popupConnect.classList.add('connected');
      } else {
        popupConnect.textContent = 'Connect';
        popupConnect.classList.remove('connected');
      }
    }

    if (popupConnStatus) {
      if (isConnected) {
        popupConnStatus.className = 'hc-popup-conn-status connected';
      } else {
        popupConnStatus.className = 'hc-popup-conn-status disconnected';
      }
    }
    if (popupConnLabel) {
      popupConnLabel.textContent = isConnected ? 'Connected' : 'Disconnected';
    }

    var name = '';
    if (hiddenXrIdDisplay) {
      name = hiddenXrIdDisplay.value || '';
    }
    if (!name && window.XR_DEVICE_ID) {
      name = window.XR_DEVICE_ID;
    }

    var allNames = [doctorNameEl, streamDoctorName, msgDoctorName];
    for (var j = 0; j < allNames.length; j++) {
      if (allNames[j]) allNames[j].textContent = name;
    }
    if (popupNameEl) popupNameEl.textContent = name || 'Doctor';

    var peerText = peerStatusText ? peerStatusText.textContent : '';
    var isOnline = peerText && peerText.toLowerCase().indexOf('online') >= 0;
    var scribeName = peerText ? peerText.replace(/\s*is\s*(Online|Offline)\s*/i, '').trim() : '--';

    if (popupScribeNameEl) popupScribeNameEl.textContent = scribeName || '--';
    if (popupScribeBadgeEl) {
      if (isOnline) {
        popupScribeBadgeEl.textContent = 'Online';
        popupScribeBadgeEl.className = 'status-badge online';
      } else {
        popupScribeBadgeEl.textContent = 'Offline';
        popupScribeBadgeEl.className = 'status-badge offline';
      }
    }

    syncStreamControlLabels();
  }

  function syncStreamControlLabels() {
    if (streamMuteBtn && hiddenMute) {
      var muteText = hiddenMute.textContent.trim();
      var isMuted = muteText.toLowerCase().indexOf('unmute') >= 0;
      streamMuteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
      if (isMuted) {
        streamMuteBtn.classList.add('active');
      } else {
        streamMuteBtn.classList.remove('active');
      }
    }

    if (streamHideBtn && hiddenVideo) {
      var videoText = hiddenVideo.textContent.trim();
      var isHidden = videoText.toLowerCase().indexOf('show') >= 0;
      streamHideBtn.textContent = isHidden ? 'Show' : 'Hide';
      if (isHidden) {
        streamHideBtn.classList.add('active');
      } else {
        streamHideBtn.classList.remove('active');
      }
    }

    var btnAudio = document.getElementById('btnAudio');
    if (streamPauseBtn && btnAudio) {
      if (btnAudio.disabled) {
        streamPauseBtn.textContent = 'Pause';
        streamPauseBtn.classList.remove('active');
      } else {
        var audioLabel = document.getElementById('audioLabel');
        var lbl = audioLabel ? audioLabel.textContent.trim().toLowerCase() : '';
        if (lbl === 'pause') {
          streamPauseBtn.textContent = 'Pause';
          streamPauseBtn.classList.remove('active');
        } else {
          streamPauseBtn.textContent = 'Play';
          streamPauseBtn.classList.add('active');
        }
      }
    }
  }

  function syncTranscript() {
    var chipEl = document.getElementById('chipLastCmd');
    if (!chipEl) return;
    var text = chipEl.textContent || '';

    if (text && text !== 'Heard: ...' && hcTranscriptCurrent) {
      var clean = text.replace(/^(Heard|Listening):\s*/i, '').trim();
      if (clean) {
        var prev = hcTranscriptCurrent.textContent || '';
        if (prev && prev !== clean) {
          if (hcTranscriptPrev) hcTranscriptPrev.textContent = prev;
        }
        hcTranscriptCurrent.textContent = clean;
      }
    }
  }

  var waveAnimFrame = null;
  var waveCtx = hcWaveCanvas ? hcWaveCanvas.getContext('2d') : null;

  function startStreamWaveAnimation() {
    if (!hcWaveCanvas || !waveCtx) return;
    var W = hcWaveCanvas.width;
    var H = hcWaveCanvas.height;
    var t = 0;

    function drawFrame() {
      waveCtx.clearRect(0, 0, W, H);
      t++;

      var xrCanvas = window._xrCanvas;
      var hasLive = xrCanvas && xrCanvas.analyser && xrCanvas.listening && xrCanvas.dataArr;
      var amp = 0;

      if (hasLive) {
        xrCanvas.analyser.getByteTimeDomainData(xrCanvas.dataArr);
        var rms = 0;
        for (var i = 0; i < xrCanvas.dataArr.length; i++) {
          var v = (xrCanvas.dataArr[i] / 128) - 1;
          rms += v * v;
        }
        amp = Math.min(Math.sqrt(rms / xrCanvas.dataArr.length) * 7, 1);
      }

      var layers = [
        { r: 100, g: 200, b: 255, lw: 2, al: 0.7 },
        { r: 150, g: 180, b: 255, lw: 1.2, al: 0.4 },
        { r: 200, g: 160, b: 255, lw: 0.8, al: 0.2 }
      ];

      for (var li = 0; li < layers.length; li++) {
        var L = layers[li];
        var cy = H * 0.5;
        var phOff = li * 1.2;

        waveCtx.beginPath();
        for (var x = 0; x <= W; x++) {
          var u = x / W;
          var baseY = Math.sin(u * Math.PI * 2 * 2.2 + t * 0.03 + phOff) * H * 0.12 +
            Math.sin(u * Math.PI * 2 * 1.1 + t * 0.02 + phOff) * H * 0.08;

          var micY = 0;
          if (hasLive && xrCanvas.dataArr) {
            var idx = Math.floor(u * (xrCanvas.dataArr.length - 1));
            var val = (xrCanvas.dataArr[idx] / 128) - 1;
            micY = val * H * 0.3 * amp;
          }

          var idle = Math.max(0, 1 - amp * 1.5);
          var y = cy + (baseY * idle + micY) * Math.sin(u * Math.PI);

          if (x === 0) waveCtx.moveTo(x, y);
          else waveCtx.lineTo(x, y);
        }

        var grad = waveCtx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',0)');
        grad.addColorStop(0.1, 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',' + L.al + ')');
        grad.addColorStop(0.5, 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',' + Math.min(L.al * 1.2, 1) + ')');
        grad.addColorStop(0.9, 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',' + L.al + ')');
        grad.addColorStop(1, 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',0)');

        waveCtx.strokeStyle = grad;
        waveCtx.lineWidth = L.lw;
        waveCtx.shadowColor = 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',0.5)';
        waveCtx.shadowBlur = 8;
        waveCtx.stroke();
      }

      waveCtx.shadowBlur = 0;
      waveAnimFrame = requestAnimationFrame(drawFrame);
    }

    drawFrame();
  }

  function stopStreamWaveAnimation() {
    if (waveAnimFrame) {
      cancelAnimationFrame(waveAnimFrame);
      waveAnimFrame = null;
    }
  }

  if (hiddenMsgList) {
    var hcMsgObserver = new MutationObserver(function () {
      if (msgPopup && msgPopup.classList.contains('show')) {
        syncMessages();
      }
    });

    hcMsgObserver.observe(hiddenMsgList, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  setInterval(syncConnectionStatus, 500);
  setInterval(syncTranscript, 300);

  setTimeout(function () {
    syncConnectionStatus();
    syncMessages();
  }, 1000);

  if (hiddenStream) {
    var lastStreamText = hiddenStream.textContent.trim().toLowerCase();
    var streamObserver = new MutationObserver(function () {
      var newText = hiddenStream.textContent.trim().toLowerCase();
      if (newText === lastStreamText) return;
      lastStreamText = newText;
      var nowActive = newText.indexOf('stop') >= 0;
      if (nowActive) {
        openStreamPopup();
      } else {
        closeStreamPopup();
      }
    });
    streamObserver.observe(hiddenStream, { childList: true, subtree: true, characterData: true });
  }

  if (hiddenMute) {
    var muteObserver = new MutationObserver(function () {
      syncStreamControlLabels();
    });
    muteObserver.observe(hiddenMute, { childList: true, subtree: true, characterData: true });
  }

  if (hiddenVideo) {
    var videoObserver = new MutationObserver(function () {
      syncStreamControlLabels();
    });
    videoObserver.observe(hiddenVideo, { childList: true, subtree: true, characterData: true });
  }

})();
