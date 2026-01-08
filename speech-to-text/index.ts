import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// μ-law to linear PCM conversion table
const ULAW_TO_LINEAR = new Int16Array([
  -32124,
  -31100,
  -30076,
  -29052,
  -28028,
  -27004,
  -25980,
  -24956,
  -23932,
  -22908,
  -21884,
  -20860,
  -19836,
  -18812,
  -17788,
  -16764,
  -15996,
  -15484,
  -14972,
  -14460,
  -13948,
  -13436,
  -12924,
  -12412,
  -11900,
  -11388,
  -10876,
  -10364,
  -9852,
  -9340,
  -8828,
  -8316,
  -7932,
  -7676,
  -7420,
  -7164,
  -6908,
  -6652,
  -6396,
  -6140,
  -5884,
  -5628,
  -5372,
  -5116,
  -4860,
  -4604,
  -4348,
  -4092,
  -3900,
  -3772,
  -3644,
  -3516,
  -3388,
  -3260,
  -3132,
  -3004,
  -2876,
  -2748,
  -2620,
  -2492,
  -2364,
  -2236,
  -2108,
  -1980,
  -1884,
  -1820,
  -1756,
  -1692,
  -1628,
  -1564,
  -1500,
  -1436,
  -1372,
  -1308,
  -1244,
  -1180,
  -1116,
  -1052,
  -988,
  -924,
  -876,
  -844,
  -812,
  -780,
  -748,
  -716,
  -684,
  -652,
  -620,
  -588,
  -556,
  -524,
  -492,
  -460,
  -428,
  -396,
  -372,
  -356,
  -340,
  -324,
  -308,
  -292,
  -276,
  -260,
  -244,
  -228,
  -212,
  -196,
  -180,
  -164,
  -148,
  -132,
  -120,
  -112,
  -104,
  -96,
  -88,
  -80,
  -72,
  -64,
  -56,
  -48,
  -40,
  -32,
  -24,
  -16,
  -8,
  0,
  32124,
  31100,
  30076,
  29052,
  28028,
  27004,
  25980,
  24956,
  23932,
  22908,
  21884,
  20860,
  19836,
  18812,
  17788,
  16764,
  15996,
  15484,
  14972,
  14460,
  13948,
  13436,
  12924,
  12412,
  11900,
  11388,
  10876,
  10364,
  9852,
  9340,
  8828,
  8316,
  7932,
  7676,
  7420,
  7164,
  6908,
  6652,
  6396,
  6140,
  5884,
  5628,
  5372,
  5116,
  4860,
  4604,
  4348,
  4092,
  3900,
  3772,
  3644,
  3516,
  3388,
  3260,
  3132,
  3004,
  2876,
  2748,
  2620,
  2492,
  2364,
  2236,
  2108,
  1980,
  1884,
  1820,
  1756,
  1692,
  1628,
  1564,
  1500,
  1436,
  1372,
  1308,
  1244,
  1180,
  1116,
  1052,
  988,
  924,
  876,
  844,
  812,
  780,
  748,
  716,
  684,
  652,
  620,
  588,
  556,
  524,
  492,
  460,
  428,
  396,
  372,
  356,
  340,
  324,
  308,
  292,
  276,
  260,
  244,
  228,
  212,
  196,
  180,
  164,
  148,
  132,
  120,
  112,
  104,
  96,
  88,
  80,
  72,
  64,
  56,
  48,
  40,
  32,
  24,
  16,
  8,
  0
]);
// Convert μ-law to linear PCM
function ulawToLinear(ulawByte) {
  return ULAW_TO_LINEAR[ulawByte & 0xFF];
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { audio, track, callId, audioSize } = await req.json();
    if (!audio) {
      throw new Error('No audio data provided');
    }
    console.log(`Processing audio for ${track} track, callId: ${callId}, size: ${audio.length}, audioSize: ${audioSize}`);
    // Decode base64 audio to binary (μ-law encoded)
    const binaryAudio = atob(audio);
    const ulawBytes = new Uint8Array(binaryAudio.length);
    for(let i = 0; i < binaryAudio.length; i++){
      ulawBytes[i] = binaryAudio.charCodeAt(i);
    }
    // Convert μ-law to 16-bit linear PCM
    const pcmSamples = new Int16Array(ulawBytes.length);
    for(let i = 0; i < ulawBytes.length; i++){
      pcmSamples[i] = ulawToLinear(ulawBytes[i]);
    }
    // Create WAV header for 16-bit PCM, 8kHz, mono
    const createWavHeader = (audioLength)=>{
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      // RIFF chunk descriptor
      view.setUint32(0, 0x52494646, false); // "RIFF"
      view.setUint32(4, 36 + audioLength, true); // File size
      view.setUint32(8, 0x57415645, false); // "WAVE"
      // fmt sub-chunk
      view.setUint32(12, 0x666d7420, false); // "fmt "
      view.setUint32(16, 16, true); // Subchunk size
      view.setUint16(20, 1, true); // Audio format (PCM)
      view.setUint16(22, 1, true); // Number of channels (mono)
      view.setUint32(24, 8000, true); // Sample rate (8kHz)
      view.setUint32(28, 16000, true); // Byte rate (8000 * 1 * 16 / 8)
      view.setUint16(32, 2, true); // Block align (1 * 16 / 8)
      view.setUint16(34, 16, true); // Bits per sample
      // data sub-chunk
      view.setUint32(36, 0x64617461, false); // "data"
      view.setUint32(40, audioLength, true); // Data size
      return new Uint8Array(header);
    };
    // Convert PCM samples to byte array (little endian)
    const pcmBytes = new Uint8Array(pcmSamples.length * 2);
    for(let i = 0; i < pcmSamples.length; i++){
      const sample = pcmSamples[i];
      pcmBytes[i * 2] = sample & 0xFF; // Low byte
      pcmBytes[i * 2 + 1] = sample >> 8 & 0xFF; // High byte
    }
    // Create complete WAV file
    const wavHeader = createWavHeader(pcmBytes.length);
    const wavFile = new Uint8Array(wavHeader.length + pcmBytes.length);
    wavFile.set(wavHeader);
    wavFile.set(pcmBytes, wavHeader.length);
    console.log(`Created WAV file: ${wavFile.length} bytes`);
    // Enhanced form data preparation with quality parameters
    const formData = new FormData();
    const blob = new Blob([
      wavFile
    ], {
      type: 'audio/wav'
    });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('temperature', '0.2'); // Lower temperature for more consistent results
    formData.append('response_format', 'verbose_json'); // Get confidence scores
    // Send to OpenAI Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`
      },
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }
    const result = await response.json();
    const transcribedText = result.text || '';
    const confidence = result.segments ? result.segments.reduce((avg, seg)=>avg + (seg.avg_logprob || 0), 0) / result.segments.length : 0;
    console.log(`Transcription result for ${track} (confidence: ${confidence}): ${transcribedText}`);
    // Enhanced transcript validation with confidence scoring
    const isValidTranscript = (text, confidenceScore)=>{
      const trimmedText = text.trim().toLowerCase();
      // Filter out very short transcripts (likely noise)
      if (trimmedText.length < 3) return false;
      // Filter out low confidence transcriptions (threshold: -1.0)
      if (confidenceScore < -1.0) {
        console.log(`Low confidence transcription filtered: ${trimmedText} (confidence: ${confidenceScore})`);
        return false;
      }
      // Enhanced false positive detection with common phrases and system sounds
      const falsePositives = [
        'thank you',
        'thanks',
        'you',
        'yeah',
        'yes',
        'no',
        'ok',
        'okay',
        'um',
        'uh',
        'ah',
        'oh',
        'hmm',
        'mm',
        'hello',
        'hi',
        'bye',
        'goodbye',
        'the',
        'and',
        'but',
        'or',
        'so',
        'well',
        'now',
        'then',
        'here',
        'there',
        'music',
        'sound',
        'noise',
        'beep',
        'ring',
        'tone',
        'click',
        'buzz',
        'please hold',
        'hold please',
        'one moment',
        'please wait',
        'connecting',
        'transferred',
        'transfer',
        'hold on',
        'just a moment',
        'standby'
      ];
      // If it's only a false positive word, filter it out
      if (falsePositives.includes(trimmedText)) return false;
      // Filter out single character repeated
      if (/^(.)\1{2,}$/.test(trimmedText.replace(/\s/g, ''))) return false;
      // Enhanced system sound detection with more patterns
      const systemSounds = [
        /^[a-z]\s*[a-z]\s*[a-z]$/,
        /^(la|na|da|ta|ka|pa|ba|ma|ra|sa|ha|wa|ya|ga|fa|va|za|ja|ca|xa){3,}$/,
        /^\d+$/,
        /^[^\w\s]+$/,
        /^(music|instrumental|singing|humming|whistling|breathing|coughing|sniffing|dial tone|busy signal|ringing)$/i,
        /^(test|testing|check|checking|one two three|1 2 3)$/i,
        /^(.)\1{4,}$/,
        /^(beep|boop|ring|ding|ping|buzz|click|static|noise|silence)$/i // System sounds
      ];
      if (systemSounds.some((pattern)=>pattern.test(trimmedText))) return false;
      // Must contain at least one word with 2+ characters
      const words = trimmedText.split(/\s+/);
      const hasValidWord = words.some((word)=>word.length >= 2 && /^[a-z]+$/.test(word));
      return hasValidWord;
    };
    // Only return valid transcripts with confidence check
    const filteredText = isValidTranscript(transcribedText, confidence) ? transcribedText : '';
    if (filteredText) {
      console.log(`Valid transcription for ${track}: ${filteredText}`);
    } else {
      console.log(`Filtered out low-quality transcription for ${track}: ${transcribedText}`);
    }
    return new Response(JSON.stringify({
      text: filteredText,
      track: track,
      confidence: confidence,
      callId: callId,
      processed: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Speech-to-text error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
