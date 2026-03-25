// public/js/voice.js
// Azure Speech STT VoiceController: MediaRecorder-based WAV recording with server-side transcription
// Replaces Web Speech API with Azure Cognitive Services Speech-to-Text
//
// Commands recognized (case-insensitive):
//   connect, disconnect
//   start stream, stop stream
//   mute (mic), unmute (mic)
//   hide video, show video
//   send urgent message / urgent message
//   note  -> starts note-taking mode (partial transcripts throttled)
//   create -> stops note-taking mode and emits final note
//
// Callbacks:
//   onCommand(action, rawText)       action ∈ ['connect','disconnect','start_stream','stop_stream','mute','unmute','hide_video','show_video','urgent','start_note','stop_note']
//   onTranscript(text, isFinal)      partial/final transcript text
//   onListenStateChange(isListening) true/false when recognition starts/stops
//   onError(error)                   string message/code
//
// Usage example:
//   import { VoiceController } from '/public/js/voice.js';
//   const voice = new VoiceController({
//     onCommand: (a, t) => console.log(a, t),
//     onTranscript: (txt, fin) => console.log(fin ? 'FINAL' : 'PART', txt),
//   });
//   voice.start(); // must be triggered from a user gesture

export class VoiceController {
  /**
   * @param {Object} opts
   * @param {string} [opts.lang='en-US']
   * @param {boolean} [opts.continuous=true]
   * @param {boolean} [opts.interimResults=true]
   * @param {number} [opts.partialThrottleMs=800]
   * @param {(action:string, rawText:string)=>void} [opts.onCommand]
   * @param {(text:string, isFinal:boolean)=>void} [opts.onTranscript]
   * @param {(isListening:boolean)=>void} [opts.onListenStateChange]
   * @param {(err:string)=>void} [opts.onError]
   * @param {Array<{re:RegExp, action:string}>} [opts.customMap]  // optional extra phrases
   */
  constructor(opts = {}) {
    this.lang = opts.lang || 'en-US';
    this.continuous = opts.continuous !== false;
    this.interimResults = opts.interimResults !== false;
    this.partialThrottleMs = Number.isFinite(opts.partialThrottleMs)
      ? opts.partialThrottleMs : 800;

    this.onCommand = typeof opts.onCommand === 'function' ? opts.onCommand : () => { };
    this.onTranscript = typeof opts.onTranscript === 'function' ? opts.onTranscript : () => { };
    this.onListenStateChange = typeof opts.onListenStateChange === 'function' ? opts.onListenStateChange : () => { };
    this.onError = typeof opts.onError === 'function' ? opts.onError : () => { };

    this._customMap = Array.isArray(opts.customMap) ? opts.customMap : [];

    this._mediaRecorder = null;
    this._audioStream = null;
    this._audioChunks = [];
    this._listening = false;
    this._lastPartialAt = 0;

    this._noteMode = false;
    this._noteBuffer = '';

    this._bindHandlers();
  }

  static isAvailable() {
    return !!(typeof window !== 'undefined' && 
              navigator.mediaDevices && 
              navigator.mediaDevices.getUserMedia &&
              window.MediaRecorder);
  }

  isListening() { return this._listening; }

  setLanguage(lang) {
    this.lang = lang || 'en-US';
  }

  async start() {
    if (this._listening) return true;

    try {
      // Request microphone access
      this._audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      // Create MediaRecorder for WAV recording
      const mimeType = this._getBestMimeType();
      this._mediaRecorder = new MediaRecorder(this._audioStream, {
        mimeType: mimeType,
        audioBitsPerSecond: 16000
      });

      this._audioChunks = [];

      this._mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this._audioChunks.push(event.data);
        }
      };

      this._mediaRecorder.onstop = async () => {
        if (this._audioChunks.length === 0) return;

        try {
          // Combine audio chunks
          const audioBlob = new Blob(this._audioChunks, { type: mimeType });
          
          // Convert to WAV if needed
          const wavBlob = await this._convertToWAV(audioBlob);
          
          // Send to server for transcription
          await this._transcribeAudio(wavBlob);
          
          // Clear chunks and restart recording if continuous
          this._audioChunks = [];
          if (this._listening && this.continuous) {
            this._mediaRecorder.start();
          }
        } catch (error) {
          this.onError(this._errString(error));
        }
      };

      // Start recording
      this._mediaRecorder.start();
      
      // Auto-stop and restart for continuous transcription
      if (this.continuous) {
        this._startContinuousRecording();
      }

      this._listening = true;
      this.onListenStateChange(true);
      return true;

    } catch (e) {
      this._listening = false;
      this.onListenStateChange(false);
      this.onError(this._errString(e));
      return false;
    }
  }

  stop() {
    if (!this._listening) return;

    this._listening = false;

    if (this._continuousTimer) {
      clearInterval(this._continuousTimer);
      this._continuousTimer = null;
    }

    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.stop();
    }

    if (this._audioStream) {
      this._audioStream.getTracks().forEach(track => track.stop());
      this._audioStream = null;
    }

    this.onListenStateChange(false);

    // If in note mode, finalize
    if (this._noteMode) this._emitStopNote();
  }

  destroy() {
    try { this.stop(); } catch { }
    this._mediaRecorder = null;
  }

  // ---------------------- internals ----------------------

  _bindHandlers() {
    // Handlers are already bound in the constructor
  }

  _getBestMimeType() {
    // Prefer WAV if supported, otherwise use webm/opus
    const types = [
      'audio/wav',
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return ''; // Browser will use default
  }

  async _convertToWAV(blob) {
    // If already WAV, return as-is
    if (blob.type.includes('wav')) {
      return blob;
    }

    // Convert to WAV using Web Audio API
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create WAV file
      const wavBuffer = this._audioBufferToWAV(audioBuffer);
      return new Blob([wavBuffer], { type: 'audio/wav' });
    } catch (error) {
      console.warn('[VOICE] WAV conversion failed, using original blob:', error);
      return blob;
    }
  }

  _audioBufferToWAV(audioBuffer) {
    const numberOfChannels = 1; // Mono
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const channelData = audioBuffer.getChannelData(0);
    const samples = new Int16Array(channelData.length);

    // Convert float samples to 16-bit PCM
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // Write WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * bitDepth / 8, true);
    view.setUint16(32, numberOfChannels * bitDepth / 8, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      view.setInt16(offset, samples[i], true);
      offset += 2;
    }

    return buffer;
  }

  async _transcribeAudio(audioBlob) {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');

      const response = await fetch('/ehr/ai/speech-to-text', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status}`);
      }

      const result = await response.json();
      const transcript = result.transcript || '';

      if (transcript) {
        this._handleTranscript(transcript, true);
      }

    } catch (error) {
      console.error('[VOICE] Transcription error:', error);
      this.onError(this._errString(error));
    }
  }

  _startContinuousRecording() {
    // Stop and restart recording every 5 seconds for continuous transcription
    this._continuousTimer = setInterval(() => {
      if (!this._listening || !this._mediaRecorder) return;

      if (this._mediaRecorder.state === 'recording') {
        this._mediaRecorder.stop();
      }
    }, 5000);
  }

  _handleTranscript(text, isFinal) {
    if (!text) return;

    const formattedText = this._formatMRN(text.toLowerCase());

    // If in note mode, buffer
    if (this._noteMode) {
      this._noteBuffer += (this._noteBuffer ? ' ' : '') + formattedText;
      this.onTranscript(formattedText, true);
      
      // "create" stops note mode
      if (/\bcreate\b/.test(text)) {
        this._emitStopNote();
      }
      return;
    }

    // Normal command mode
    const action = this._parseCommand(text);
    if (action) {
      this.onCommand(action, formattedText);
    } else {
      // Deliver final transcript even if no command matched
      this.onTranscript(formattedText, true);
    }
  }

  _errString(e) {
    if (!e) return 'speech_error';
    if (typeof e === 'string') return e;
    return e.message || e.name || 'speech_error';
  }

  /**
   * Format MRN numbers in transcript text
   * SIMPLIFIED LOGIC: "MRN-" is a constant template
   * When user says "MRN" + any letters/numbers, format as MRN-XXXXXXX (no spaces, no length limit)
   *
   * Examples:
   *   "MRN ABA 121" -> "MRN-ABA121"
   *   "MRN A BA 123" -> "MRN-ABA123"
   *   "MRN aba121" -> "MRN-ABA121" (captures ALL characters)
   *   "MRNA BA 121" -> "MRN-BA121"
   *   "m r n zero one two" -> "MRN-012"
   *   "MRN VERYLONGCODE123" -> "MRN-VERYLONGCODE123" (no length limit)
   *
   * After the MRN code, normal transcription continues
   */
  _formatMRN(text) {
    if (!text) return text;

    const numberWords = {
      'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
      'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
    };

    // Words that signal end of MRN code
    const stopWords = /^(is|the|number|patient|id|medical|record|on|in|at|to|for|with|from|by|of|off|file|arrived|was|has|note|consultation|and|or|hi|doctor|hello|came|went|had)$/i;

    let formatted = text;

    // SINGLE SIMPLE PATTERN: Catch "MRN" + any following alphanumeric content
    // Handles: "MRN", "mrn", "m r n", "MRNA" (misheard), etc.
    // Takes ALL alphanumeric after MRN (no length limit)
    formatted = formatted.replace(
      /\b(MRNA|m\s*r\s*n|mrn)\s+((?:[a-z0-9]+\s*)+)/gi,
      (match, prefix, codeRaw) => {
        // Extract all words/characters after "MRN"
        const words = codeRaw.trim().split(/\s+/);
        const validWords = [];

        // Collect everything until we hit a stop word
        for (const w of words) {
          if (!w) continue;
          if (stopWords.test(w)) break;
          validWords.push(w);
        }

        // Convert to alphanumeric code (remove spaces, convert number words)
        const cleanCode = validWords
          .map(w => {
            const lower = w.toLowerCase();
            // Convert number words to digits
            if (numberWords[lower]) return numberWords[lower];
            // Keep all alphanumeric characters
            return w.toUpperCase();
          })
          .join('') // JOIN WITHOUT SPACES
          .replace(/[^A-Z0-9]/g, ''); // Remove any non-alphanumeric chars

        // Format if we have at least 3 characters (NO MAX LIMIT)
        if (cleanCode.length >= 3) {
          return `MRN-${cleanCode}`;
        }
        return match;
      }
    );

    return formatted;
  }

  _emitStartNote() {
    if (this._noteMode) return;
    this._noteMode = true;
    this._noteBuffer = '';
    this.onCommand('start_note', 'note');
  }

  _emitStopNote() {
    if (!this._noteMode) return;
    this._noteMode = false;
    const finalNote = this._noteBuffer.trim();
    this._noteBuffer = '';
    // Emit final transcript of the note and a stop_note command
    if (finalNote) this.onTranscript(finalNote, true);
    this.onCommand('stop_note', 'create');
  }

  // ------------------ command parsing ------------------

  _parseCommand(s) {
    const text = String(s || '').toLowerCase().trim();
    if (!text) return null;

    // Custom overrides first
    for (const { re, action } of this._customMap) {
      if (re.test(text)) return action;
    }

    // Note-taking first (so "note" doesn't hit other rules)
    if (/\bnote\b/.test(text)) return (this._emitStartNote(), 'start_note');
    if (/\bcreate\b/.test(text)) return (this._emitStopNote(), 'stop_note');

    // Connect / disconnect
    if (/\bdisconnect\b/.test(text)) return 'disconnect';
    if (/\bconnect\b/.test(text)) return 'connect';

    // Unmute before mute to avoid matching "unmute" as "mute"
    if (/\bunmute(\s+mic(rophone)?)?\b/.test(text)) return 'unmute';
    if (/\bmute(\s+mic(rophone)?)?\b/.test(text)) return 'mute';

    // Start/Stop stream
    if (/\bstart( the)? (stream|video|camera)\b/.test(text)) return 'start_stream';
    if (/\bstop( the)? (stream|video|camera)\b/.test(text)) return 'stop_stream';

    // Hide/Show video
    if (/\bhide( the)? (video|camera|preview)?\b/.test(text)) return 'hide_video';
    if (/\bshow( the)? (video|camera|preview)?\b/.test(text)) return 'show_video';

    // Urgent message
    if (/\bsend( an)? urgent (message|alert)\b/.test(text)) return 'urgent';
    if (/\burgent\b.*\bmessage\b/.test(text)) return 'urgent';

    return null;
  }
}

// ---- ASR control helpers for UI (safe, additive) ----
// Allow UI to start/stop recognition without needing a direct ref.
// We look for a globally stored instance: window.voiceController or window.voice.
export function startRecognition() {
  try {
    const inst = (typeof window !== 'undefined') && (window.voiceController || window.voice);
    if (inst && typeof inst.start === 'function') inst.start();
  } catch { }
}

export function stopRecognition() {
  try {
    const inst = (typeof window !== 'undefined') && (window.voiceController || window.voice);
    if (inst && typeof inst.stop === 'function') inst.stop();
  } catch { }
}

// Optional: if a voice instance already exists on window, add helpers onto it.
// This does not override existing start()/stop(); it just adds new methods.
try {
  if (typeof window !== 'undefined') {
    const inst = window.voiceController || window.voice;
    if (inst && typeof inst === 'object') {
      inst.startRecognition = startRecognition;
      inst.stopRecognition = stopRecognition;
    }
  }
} catch { }


export default VoiceController;
