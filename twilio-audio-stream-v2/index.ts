import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Audio processing utilities
function base64ToBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for(let i = 0; i < binaryString.length; i++){
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function bufferToBase64(buffer) {
  let binary = '';
  for(let i = 0; i < buffer.length; i++){
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}
// Convert MuLaw to PCM16 (simplified conversion)
function muLawToPcm16(muLawData) {
  const pcmData = new Int16Array(muLawData.length);
  const muLawBias = 0x84;
  const muLawMax = 0x7F;
  for(let i = 0; i < muLawData.length; i++){
    let muLawByte = ~muLawData[i];
    let sign = muLawByte & 0x80;
    let exponent = muLawByte >> 4 & 0x07;
    let mantissa = muLawByte & 0x0F;
    let sample = mantissa << exponent + 3;
    sample += muLawBias << exponent;
    if (exponent === 0) sample += muLawBias >> 1;
    pcmData[i] = sign ? -sample : sample;
  }
  // Convert to Uint8Array (little endian)
  const result = new Uint8Array(pcmData.length * 2);
  for(let i = 0; i < pcmData.length; i++){
    result[i * 2] = pcmData[i] & 0xFF;
    result[i * 2 + 1] = pcmData[i] >> 8 & 0xFF;
  }
  return result;
}
Deno.serve(async (req)=>{
  console.log("🚀 Twilio Audio Stream V2 started!");
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (req.headers.get("upgrade") !== "websocket") {
    console.log("❌ Expected websocket upgrade");
    return new Response("Expected websocket", {
      status: 400
    });
  }
  // Environment variables
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
  console.log("🔧 Environment check:");
  console.log("- SUPABASE_URL:", !!SUPABASE_URL);
  console.log("- SUPABASE_SERVICE_ROLE_KEY:", !!SUPABASE_SERVICE_ROLE_KEY);
  console.log("- ASSEMBLYAI_API_KEY:", !!ASSEMBLYAI_API_KEY);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ASSEMBLYAI_API_KEY) {
    console.error("❌ Missing required environment variables");
    console.log("🔍 Available env vars:", Object.keys(Deno.env.toObject()));
    return new Response("Server configuration error", {
      status: 500
    });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // State variables
  let callSid = null;
  let callId = null;
  let callDirection = null; // 'inbound' or 'outbound' - affects role mapping
  let streamTrack = null; // Fixed track for this stream (set once from first media event)
  let streamRole = null; // Fixed role based on stream track and call direction
  let assemblySocket = null;
  let audioChunks = [];
  let isAssemblyConnected = false;
  // Initialize AssemblyAI WebSocket connection
  async function initializeAssemblyAI() {
    try {
      console.log("🔌 Connecting to AssemblyAI Universal-Streaming v3...");
      assemblySocket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?sample_rate=8000&format_turns=true&token=${ASSEMBLYAI_API_KEY}`);
      // Wait for connection
      await new Promise((resolve, reject)=>{
        const timeout = setTimeout(()=>{
          console.error("⏰ AssemblyAI connection timeout");
          assemblySocket?.close();
          reject(new Error("Connection timeout"));
        }, 10000);
        assemblySocket.onopen = ()=>{
          clearTimeout(timeout);
          isAssemblyConnected = true;
          console.log("✅ AssemblyAI WebSocket connected!");
          resolve();
        };
        assemblySocket.onerror = (error)=>{
          clearTimeout(timeout);
          console.error("❌ AssemblyAI WebSocket error:", error);
          reject(error);
        };
      });
      // Handle incoming messages from AssemblyAI
      assemblySocket.onmessage = async (event)=>{
        try {
          const response = JSON.parse(event.data);
          console.log("📥 AssemblyAI response:", JSON.stringify(response, null, 2));
          if (response.type === "Begin") {
            console.log("🎬 AssemblyAI session began:", response.id);
          } else if (response.type === "Turn") {
            const transcript = response.transcript || "";
            const isFormatted = response.turn_is_formatted;
            console.log("💬 Transcript received:", transcript, "- Formatted:", isFormatted);
            if (isFormatted && transcript.trim() && callId && streamRole) {
              // Use fixed role based on stream track (set once when stream started)
              console.log("🎯 Using fixed stream role:", streamRole, "(track:", streamTrack, ")");
              // Save transcript to database
              const { error: transcriptError } = await supabase.from("transcripts").insert({
                call_id: callId,
                speaker: streamRole,
                text: transcript.trim(),
                created_at: new Date().toISOString()
              });
              if (transcriptError) {
                console.error("❌ Save transcript error:", transcriptError);
              } else {
                console.log("✅ Transcript saved for", streamRole);
                // Generate AI suggestion for customer messages
                if (streamRole === "customer") {
                  console.log("🤖 Generating suggestion...");
                  try {
                    const { data: suggestionData, error: suggestionError } = await supabase.functions.invoke("generate-suggestion", {
                      body: {
                        callId,
                        customerMessage: transcript.trim()
                      }
                    });
                    if (!suggestionError && suggestionData?.suggestion) {
                      console.log("💡 AI suggests:", suggestionData.suggestion);
                      await supabase.from("suggestions").insert({
                        call_id: callId,
                        text: suggestionData.suggestion,
                        created_at: new Date().toISOString()
                      });
                      console.log("✅ Suggestion saved!");
                    }
                  } catch (err) {
                    console.error("❌ Suggestion error:", err);
                  }
                }
              }
            }
          } else if (response.type === "Termination") {
            console.log("🏁 AssemblyAI session terminated");
          }
        } catch (error) {
          console.error("❌ AssemblyAI message processing error:", error);
        }
      };
      assemblySocket.onclose = (event)=>{
        isAssemblyConnected = false;
        console.log(`🔌 AssemblyAI WebSocket closed: ${event.code} - ${event.reason}`);
      };
      assemblySocket.onerror = (error)=>{
        isAssemblyConnected = false;
        console.error("❌ AssemblyAI WebSocket error:", error);
      };
    } catch (error) {
      console.error("❌ Failed to initialize AssemblyAI:", error);
      throw error;
    }
  }
  // Send audio chunk to AssemblyAI
  function sendAudioChunk() {
    if (audioChunks.length >= 5 && isAssemblyConnected && assemblySocket?.readyState === WebSocket.OPEN) {
      try {
        // Combine chunks
        const totalLength = audioChunks.reduce((acc, chunk)=>acc + chunk.length, 0);
        const combinedBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of audioChunks){
          combinedBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        // Send raw binary audio data (not JSON) as per official documentation
        assemblySocket.send(combinedBuffer);
        console.log("📤 Sent audio chunk:", combinedBuffer.length, "bytes");
        audioChunks = []; // Clear chunks after sending
      } catch (error) {
        console.error("❌ Error sending audio chunk:", error);
      }
    }
  }
  // Twilio WebSocket handlers
  socket.onopen = ()=>{
    console.log("🌐 Twilio WebSocket connected");
  };
  socket.onmessage = async (event)=>{
    try {
      const message = JSON.parse(event.data);
      console.log("📨 Twilio event:", message.event);
      if (message.event === "connected") {
        console.log("🔗 Twilio connected");
      } else if (message.event === "start") {
        callSid = message.start?.callSid;
        console.log("▶️ Call started:", callSid);
        // Find call record (including call_direction for role mapping)
        if (callSid) {
          const { data: callRecord, error } = await supabase.from("calls").select("id, call_direction").eq("twilio_call_sid", callSid).single();
          if (callRecord) {
            callId = callRecord.id;
            callDirection = callRecord.call_direction;
            console.log("✅ Call ID:", callId, "Direction:", callDirection);
          } else {
            console.log("⚠️ No call record found for:", callSid);
          }
        }
        // Initialize AssemblyAI connection
        try {
          await initializeAssemblyAI();
          console.log("🎯 Ready for transcription!");
        } catch (error) {
          console.error("❌ AssemblyAI initialization failed:", error);
        }
      } else if (message.event === "media") {
        const track = message.media?.track;
        const audioPayload = message.media?.payload;
        // Set fixed track and role on FIRST media event (stream is single-track now)
        // Role mapping depends on call direction:
        // - INBOUND calls: inbound_track=customer, outbound_track=agent
        // - OUTBOUND calls: inbound_track=agent (we initiated), outbound_track=customer
        if (track && !streamTrack) {
          streamTrack = track;
          if (callDirection === 'outbound') {
            // Outbound call: tracks are reversed
            streamRole = track === "outbound" ? "customer" : "agent";
          } else {
            // Inbound call (default): standard mapping
            streamRole = track === "outbound" ? "agent" : "customer";
          }
          console.log("🎯 Stream track fixed:", streamTrack, "→ role:", streamRole, "(call direction:", callDirection, ")");
        }
        if (audioPayload && isAssemblyConnected) {
          try {
            // Decode base64 audio from Twilio (MuLaw format)
            const muLawData = base64ToBuffer(audioPayload);
            // Convert MuLaw to PCM16
            const pcmData = muLawToPcm16(muLawData);
            // Add to chunks
            audioChunks.push(pcmData);
            // Send chunk when we have enough data
            sendAudioChunk();
          } catch (error) {
            console.error("❌ Audio processing error:", error);
          }
        }
      } else if (message.event === "stop") {
        console.log("🛑 Call ended");
        // Send final audio chunk if any
        if (audioChunks.length > 0) {
          sendAudioChunk();
        }
        // Terminate AssemblyAI session
        if (assemblySocket && isAssemblyConnected) {
          assemblySocket.send(JSON.stringify({
            type: "Terminate"
          }));
          assemblySocket.close();
          assemblySocket = null;
          isAssemblyConnected = false;
        }
      }
    } catch (error) {
      console.error("❌ Twilio message processing error:", error);
    }
  };
  socket.onclose = ()=>{
    console.log("🔌 Twilio WebSocket closed");
    if (assemblySocket) {
      assemblySocket.send(JSON.stringify({
        type: "Terminate"
      }));
      assemblySocket.close();
      assemblySocket = null;
      isAssemblyConnected = false;
    }
  };
  socket.onerror = (error)=>{
    console.error("❌ Twilio WebSocket error:", error);
  };
  return response;
});
