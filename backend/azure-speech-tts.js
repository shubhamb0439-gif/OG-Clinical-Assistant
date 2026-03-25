// azure-speech-tts.js
// Azure Cognitive Services Text-to-Speech
// SP/MI auth — NO API KEY
// Uses custom subdomain endpoint for AAD token auth
// Voice: en-IN-NeerjaNeural | Output: WAV Riff24Khz16BitMonoPcm

const sdk = require('microsoft-cognitiveservices-speech-sdk');
const https = require('https');
const { getAzureSpeechToken, AZURE_SPEECH_REGION } = require('./azure-speech-token');

const AZURE_SPEECH_CUSTOM_DOMAIN = process.env.AZURE_SPEECH_CUSTOM_DOMAIN || 'osss-speech-ss';

/**
 * Exchange AAD token → Speech Service token via custom subdomain
 * Required by Microsoft when using SP/MI without API key
 */
function getSpeechServiceToken(aadToken) {
  return new Promise((resolve, reject) => {
    const hostname = `${AZURE_SPEECH_CUSTOM_DOMAIN}.cognitiveservices.azure.com`;
    const path = '/sts/v1.0/issueToken';

    console.log(`[AZURE-TTS] Exchanging token at https://${hostname}${path}`);

    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aadToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': 0
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[AZURE-TTS] ✅ Speech Service token obtained');
          resolve(data.trim());
        } else {
          reject(new Error(`Speech token exchange failed: HTTP ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Token exchange network error: ${err.message}`)));
    req.end();
  });
}

/**
 * Synthesize speech from text using Azure TTS
 * @param {string} text
 * @returns {Promise<Buffer>} WAV audio buffer
 */
async function synthesizeSpeech(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Invalid input: text must be a non-empty string');
  }

  let synthesizer = null;

  try {
    // Step 1: Get AAD token via SP → MI fallback
    const aadToken = await getAzureSpeechToken();

    // Step 2: Exchange AAD token → Speech Service token via custom domain
    const speechToken = await getSpeechServiceToken(aadToken);

    // Step 3: Build SpeechConfig using custom domain endpoint
    const endpoint = `wss://${AZURE_SPEECH_CUSTOM_DOMAIN}.cognitiveservices.azure.com/tts/cognitiveservices/websocket/v1`;
    const speechConfig = sdk.SpeechConfig.fromEndpoint(new URL(endpoint));
    speechConfig.authorizationToken = speechToken;

    // Step 4: Set voice and output format
    speechConfig.speechSynthesisVoiceName = 'en-IN-NeerjaNeural';
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;

    // Step 5: Create synthesizer
    synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    // Step 6: Speak
    return await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text.trim(),
        (result) => {
          try {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              const audioBuffer = Buffer.from(result.audioData);
              console.log(`[AZURE-TTS] ✅ Synthesized ${text.trim().length} chars → ${audioBuffer.length} bytes WAV`);
              resolve(audioBuffer);
            } else if (result.reason === sdk.ResultReason.Canceled) {
              const cancellation = sdk.CancellationDetails.fromResult(result);
              const reason = cancellation?.reason ?? 'Unknown';
              const details = cancellation?.errorDetails ?? 'No details';
              console.error(`[AZURE-TTS] ❌ TTS canceled: ${reason} - ${details}`);
              reject(new Error(`TTS canceled: ${reason} - ${details}`));
            } else {
              reject(new Error(`TTS failed with reason: ${result.reason}`));
            }
          } finally {
            if (synthesizer) { synthesizer.close(); synthesizer = null; }
          }
        },
        (error) => {
          if (synthesizer) { synthesizer.close(); synthesizer = null; }
          console.error('[AZURE-TTS] ❌ Synthesis error:', error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });

  } catch (error) {
    if (synthesizer) { synthesizer.close(); synthesizer = null; }
    console.error('[AZURE-TTS] ❌ Failed to synthesize speech:', error?.message || error);
    throw error;
  }
}

module.exports = { synthesizeSpeech };