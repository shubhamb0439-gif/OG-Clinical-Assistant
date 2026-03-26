// azure-speech-tts.js
// Azure Cognitive Services Text-to-Speech
// SP/MI auth — NO API KEY, NO token exchange (Token API disabled by VNet)
// Uses custom subdomain + AAD token directly via fromEndpoint
// Voice: en-IN-NeerjaNeural | Output: WAV Riff24Khz16BitMonoPcm

const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { getAzureSpeechToken, AZURE_SPEECH_REGION } = require('./azure-speech-token');

const AZURE_SPEECH_CUSTOM_DOMAIN = process.env.AZURE_SPEECH_CUSTOM_DOMAIN || 'osss-speech-ss';

async function synthesizeSpeech(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Invalid input: text must be a non-empty string');
  }

  let synthesizer = null;

  try {
    // Step 1: Get AAD token via SP → MI fallback
    console.log('[AZURE-TTS] 🔄 Step 1: Acquiring AAD token...');
    const aadToken = await getAzureSpeechToken();
    console.log(`[AZURE-TTS] ✅ Step 1 DONE: AAD token acquired (length: ${aadToken.length})`);

    // Step 2: Build SpeechConfig using fromEndpoint + AAD token directly
    // Token API is disabled by VNet — so we skip /sts/v1.0/issueToken entirely
    // and pass the AAD token directly to the custom subdomain WebSocket endpoint
    console.log('[AZURE-TTS] 🔄 Step 2: Building SpeechConfig with custom subdomain endpoint...');
    const endpoint = `wss://${AZURE_SPEECH_CUSTOM_DOMAIN}.cognitiveservices.azure.com/tts/cognitiveservices/websocket/v1`;
    console.log(`[AZURE-TTS] 🔗 Endpoint: ${endpoint}`);

    const speechConfig = sdk.SpeechConfig.fromEndpoint(new URL(endpoint));
    speechConfig.authorizationToken = `aad#${process.env.AZURE_SPEECH_RESOURCE_ID}#${aadToken}`;
    speechConfig.speechSynthesisVoiceName = 'en-IN-NeerjaNeural';
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
    console.log('[AZURE-TTS] ✅ Step 2 DONE: SpeechConfig ready');

    // Step 3: Create synthesizer — null audioConfig = in-memory output
    console.log('[AZURE-TTS] 🔄 Step 3: Creating SpeechSynthesizer...');
    synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    console.log('[AZURE-TTS] ✅ Step 3 DONE: Synthesizer created');

    // Step 4: Synthesize
    console.log(`[AZURE-TTS] 🔄 Step 4: Synthesizing text (${text.trim().length} chars)...`);
    return await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text.trim(),
        (result) => {
          try {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              const audioBuffer = Buffer.from(result.audioData);
              console.log(`[AZURE-TTS] ✅ Step 4 DONE: ${text.trim().length} chars → ${audioBuffer.length} bytes WAV`);
              console.log('[AZURE-TTS] 🟢 TTS FEATURE: CONNECTED AND WORKING');
              resolve(audioBuffer);
            } else if (result.reason === sdk.ResultReason.Canceled) {
              const cancellation = sdk.CancellationDetails.fromResult(result);
              const reason = cancellation?.reason ?? 'Unknown';
              const details = cancellation?.errorDetails ?? 'No details';
              console.error(`[AZURE-TTS] ❌ Step 4 FAILED: ${reason} - ${details}`);
              if (details.includes('401')) {
                console.error('[AZURE-TTS] ❌ ISSUE: AAD token rejected. Ensure SP has "Cognitive Services User" role on Speech resource.');
              } else if (details.includes('403') || details.includes('VNet')) {
                console.error('[AZURE-TTS] ❌ ISSUE: VNet blocking WebSocket. Check Azure Portal → Speech resource → Networking.');
              } else if (details.includes('AZURE_SPEECH_RESOURCE_ID')) {
                console.error('[AZURE-TTS] ❌ ISSUE: AZURE_SPEECH_RESOURCE_ID env var is missing. Add it to your .env file.');
              }
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
          console.error('[AZURE-TTS] ❌ TTS FEATURE: NOT WORKING — check logs above');
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });

  } catch (error) {
    if (synthesizer) { synthesizer.close(); synthesizer = null; }
    console.error('[AZURE-TTS] ❌ Failed:', error?.message || error);
    console.error('[AZURE-TTS] ❌ TTS FEATURE: NOT WORKING — check logs above');
    throw error;
  }
}

module.exports = { synthesizeSpeech };