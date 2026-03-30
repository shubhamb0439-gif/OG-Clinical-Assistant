// azure-speech-tts.js
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { getAzureSpeechToken } = require('./azure-speech-token');

const AZURE_SPEECH_CUSTOM_DOMAIN = process.env.AZURE_SPEECH_CUSTOM_DOMAIN || 'ogh-speech-ss';
const SYNTHESIS_TIMEOUT_MS = 60000;

async function synthesizeSpeech(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Invalid input: text must be a non-empty string');
  }

  let synthesizer = null;

  try {
    // Step 1: Acquire AAD token
    console.log('[AZURE-TTS] 🔄 Step 1: Acquiring AAD token...');
    const aadToken = await getAzureSpeechToken();
    console.log(`[AZURE-TTS] ✅ Step 1 DONE: token length=${aadToken.length}`);

    // 🔍 DEBUG: Independently verify token
    try {
      const { ManagedIdentityCredential, ClientSecretCredential } = require('@azure/identity');
      let credential;
      if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
        credential = new ClientSecretCredential(process.env.AZURE_TENANT_ID, process.env.AZURE_CLIENT_ID, process.env.AZURE_CLIENT_SECRET);
        console.log('[TTS] 🔍 Debug: Using SP credential');
      } else {
        credential = new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID_MI);
        console.log('[TTS] 🔍 Debug: Using MI credential');
      }
      const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
      console.log('[TTS] ✅ Debug token acquired:', tokenResponse.token.substring(0, 20) + '...');
      console.log('[TTS] 🔍 Token expiry:', new Date(tokenResponse.expiresOnTimestamp).toISOString());
    } catch (err) {
      console.error('[TTS] ❌ Debug token error:', err.message);
    }

    // Step 2: Build SpeechConfig
    console.log('[AZURE-TTS] 🔄 Step 2: Building SpeechConfig...');
    const endpoint = `wss://${AZURE_SPEECH_CUSTOM_DOMAIN}.cognitiveservices.azure.com/tts/cognitiveservices/websocket/v1`;
    console.log(`[AZURE-TTS] 🔗 Endpoint: ${endpoint}`);
    const speechConfig = sdk.SpeechConfig.fromEndpoint(new URL(endpoint));
    speechConfig.authorizationToken = `aad#${process.env.AZURE_SPEECH_RESOURCE_ID}#${aadToken}`;
    speechConfig.speechSynthesisVoiceName = 'en-IN-NeerjaNeural';
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
    console.log('[AZURE-TTS] ✅ Step 2 DONE: SpeechConfig ready');

    // Step 3: Create synthesizer
    console.log('[AZURE-TTS] 🔄 Step 3: Creating SpeechSynthesizer...');
    synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    console.log('[AZURE-TTS] ✅ Step 3 DONE: Synthesizer created');

    // Step 4: Synthesize with timeout
    console.log(`[AZURE-TTS] 🔄 Step 4: Synthesizing (${text.trim().length} chars)...`);

    const synthesisPromise = new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text.trim(),
        (result) => {
          try {
            console.log('[TTS] Result reason:', result.reason);
            console.log('[TTS] Audio data length:', result.audioData?.byteLength ?? 'undefined');
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              const audioBuffer = Buffer.from(result.audioData);
              console.log(`[AZURE-TTS] ✅ Step 4 DONE: ${audioBuffer.length} bytes WAV`);
              console.log('[AZURE-TTS] 🟢 TTS FEATURE: CONNECTED AND WORKING');
              resolve(audioBuffer);
            } else if (result.reason === sdk.ResultReason.Canceled) {
              const cancellation = sdk.CancellationDetails.fromResult(result);
              const reason = cancellation?.reason ?? 'Unknown';
              const details = cancellation?.errorDetails ?? 'No details';
              console.error(`[AZURE-TTS] ❌ Canceled: ${reason} - ${details}`);
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

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        if (synthesizer) { synthesizer.close(); synthesizer = null; }
        console.error('[AZURE-TTS] ❌ TIMEOUT: synthesis did not complete within 60s');
        console.error('[AZURE-TTS] ❌ CHECK: Azure Portal → Speech resource → Networking → whitelist App Service outbound IPs');
        reject(new Error('TTS synthesis timed out after 60s'));
      }, SYNTHESIS_TIMEOUT_MS)
    );

    return await Promise.race([synthesisPromise, timeoutPromise]);

  } catch (error) {
    if (synthesizer) { synthesizer.close(); synthesizer = null; }
    console.error('[AZURE-TTS] ❌ Failed:', error?.message || error);
    throw error;
  }
}

module.exports = { synthesizeSpeech };