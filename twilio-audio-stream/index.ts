import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
Deno.serve(async (req)=>{
  console.log("🔧 Audio stream function started!");
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
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
  console.log("🔧 Environment check:");
  console.log("- SUPABASE_URL:", !!SUPABASE_URL);
  console.log("- SUPABASE_SERVICE_ROLE_KEY:", !!SUPABASE_SERVICE_ROLE_KEY);
  console.log("- ASSEMBLYAI_API_KEY:", !!ASSEMBLYAI_API_KEY);
  console.log("🔍 All environment variables:", Object.keys(Deno.env.toObject()));
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ASSEMBLYAI_API_KEY) {
    console.error("❌ Missing required environment variables");
    return new Response("Server configuration error", {
      status: 500
    });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // State variables
  let callSid = null;
  let callId = null;
  let lastTrack = null;
  let aaiSocket = null;
  let isConnected = false;
  // Simplified AssemblyAI connection with extensive debugging
  async function connectToAssemblyAI() {
    try {
      console.log("🚀 [DEBUG] Starting AssemblyAI connection process...");
      console.log("🔑 [DEBUG] API Key exists:", !!ASSEMBLYAI_API_KEY);
      console.log("🔑 [DEBUG] API Key length:", ASSEMBLYAI_API_KEY?.length);
      console.log("🔑 [DEBUG] API Key prefix:", ASSEMBLYAI_API_KEY?.substring(0, 10) + "...");
      console.log("📡 [DEBUG] Making token request to AssemblyAI...");
      // Get token
      const tokenResponse = await fetch("https://api.assemblyai.com/v2/realtime/token", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ASSEMBLYAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          expires_in: 3600,
          word_boost: [
            "agent",
            "customer",
            "support",
            "help"
          ],
          format_turns: true
        })
      });
      console.log("📡 [DEBUG] Token response status:", tokenResponse.status);
      console.log("📡 [DEBUG] Token response ok:", tokenResponse.ok);
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("❌ [ERROR] Token request failed:", tokenResponse.status, errorText);
        console.error("❌ [ERROR] Response headers:", [
          ...tokenResponse.headers.entries()
        ]);
        throw new Error(`Token failed: ${tokenResponse.status}`);
      }
      const tokenData = await tokenResponse.json();
      console.log("✅ Got AssemblyAI token");
      // Connect to WebSocket
      const wsUrl = `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=8000&token=${tokenData.token}`;
      console.log("🔌 Connecting to WebSocket:", wsUrl);
      aaiSocket = new WebSocket(wsUrl);
      // Wait for connection
      await new Promise((resolve, reject)=>{
        const timeout = setTimeout(()=>{
          console.error("❌ Connection timeout");
          aaiSocket?.close();
          reject(new Error("Connection timeout"));
        }, 10000);
        aaiSocket.onopen = ()=>{
          clearTimeout(timeout);
          isConnected = true;
          console.log("✅ AssemblyAI connected!");
          resolve();
        };
        aaiSocket.onerror = (error)=>{
          clearTimeout(timeout);
          console.error("❌ WebSocket error:", error);
          reject(error);
        };
      });
      // Set up message handlers
      aaiSocket.onmessage = async (event)=>{
        try {
          const message = JSON.parse(event.data);
          console.log("📥 AssemblyAI message:", message.message_type, message.text || '');
          if (message.message_type === "SessionBegins") {
            console.log("📡 AssemblyAI session started:", message.session_id);
          } else if (message.message_type === "PartialTranscript") {
            if (message.text) {
              console.log(`🔄 Partial: "${message.text}"`);
            }
          } else if (message.message_type === "FinalTranscript") {
            const text = message.text?.trim();
            const confidence = message.confidence || 0;
            console.log(`✨ FINAL: "${text}" (confidence: ${confidence})`);
            if (text && confidence >= 0.3 && callId) {
              const role = lastTrack === "outbound" ? "agent" : "customer";
              console.log(`💾 Saving: ${role} said "${text}"`);
              // Save transcript
              const { error: transcriptError } = await supabase.from("transcripts").insert({
                call_id: callId,
                role,
                text,
                created_at: new Date().toISOString()
              });
              if (transcriptError) {
                console.error("❌ Save error:", transcriptError);
              } else {
                console.log("✅ Transcript saved!");
                // Generate AI suggestion for customer messages
                if (role === "customer") {
                  console.log("🤖 Generating suggestion...");
                  try {
                    const { data: suggestionData, error: suggestionError } = await supabase.functions.invoke("generate-suggestion", {
                      body: {
                        callId,
                        customerMessage: text
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
          } else if (message.message_type === "SessionTerminated") {
            console.log("⚠️ Session terminated");
            isConnected = false;
          }
        } catch (error) {
          console.error("❌ Message processing error:", error);
        }
      };
      aaiSocket.onclose = (event)=>{
        isConnected = false;
        console.log(`🔌 AssemblyAI closed: ${event.code} - ${event.reason}`);
      };
      aaiSocket.onerror = (error)=>{
        isConnected = false;
        console.error("❌ AssemblyAI error:", error);
      };
    } catch (error) {
      console.error("❌ Failed to connect to AssemblyAI:", error);
      isConnected = false;
      throw error;
    }
  }
  // Twilio WebSocket handlers
  socket.onopen = ()=>{
    console.log("🌐 Twilio WebSocket connected");
  };
  socket.onmessage = async (event)=>{
    try {
      const message = JSON.parse(event.data);
      console.log("📨 Twilio message:", message.event);
      if (message.event === "connected") {
        console.log("🔗 Twilio connected");
      } else if (message.event === "start") {
        callSid = message.start?.callSid;
        console.log("▶️ Call started:", callSid);
        // Find call record
        if (callSid) {
          const { data: callRecord, error } = await supabase.from("calls").select("id").eq("twilio_call_sid", callSid).single();
          if (callRecord) {
            callId = callRecord.id;
            console.log("✅ Call ID:", callId);
          } else {
            console.log("⚠️ No call record found for:", callSid);
          }
        }
        // Connect to AssemblyAI
        try {
          await connectToAssemblyAI();
          console.log("🎯 Ready for transcription!");
        } catch (error) {
          console.error("❌ AssemblyAI setup failed:", error);
        }
      } else if (message.event === "media") {
        const track = message.media?.track;
        const audioPayload = message.media?.payload;
        if (track) {
          lastTrack = track;
        }
        if (audioPayload) {
          if (isConnected && aaiSocket?.readyState === WebSocket.OPEN) {
            try {
              // Decode base64 audio from Twilio
              const binaryString = atob(audioPayload);
              const audioBytes = new Uint8Array(binaryString.length);
              for(let i = 0; i < binaryString.length; i++){
                audioBytes[i] = binaryString.charCodeAt(i);
              }
              // Send raw audio to AssemblyAI
              aaiSocket.send(audioBytes.buffer);
              // Log occasionally for debugging
              if (Math.random() < 0.001) {
                console.log("📤 Audio sent:", audioBytes.length, "bytes");
              }
            } catch (error) {
              console.error("❌ Audio error:", error);
            }
          } else {
            console.log("⏳ Audio received but AssemblyAI not connected");
          }
        }
      } else if (message.event === "stop") {
        console.log("🛑 Call ended");
        if (aaiSocket) {
          aaiSocket.close();
          aaiSocket = null;
          isConnected = false;
        }
      }
    } catch (error) {
      console.error("❌ Twilio error:", error);
    }
  };
  socket.onclose = ()=>{
    console.log("🔌 Twilio closed");
    if (aaiSocket) {
      aaiSocket.close();
      aaiSocket = null;
      isConnected = false;
    }
  };
  socket.onerror = (error)=>{
    console.error("❌ Twilio error:", error);
  };
  return response;
});
