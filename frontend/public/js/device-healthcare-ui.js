,' + L.b + ',' + L.al + ')');
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

})();
