import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
    console.log("🧪 Testing AssemblyAI integration...");
    console.log("🔑 API Key available:", !!ASSEMBLYAI_API_KEY);
    if (!ASSEMBLYAI_API_KEY) {
      throw new Error("AssemblyAI API key not found");
    }
    console.log("🔑 API Key (first 10 chars):", ASSEMBLYAI_API_KEY.substring(0, 10) + "...");
    // Test 1: Test WebSocket connection directly (v3 Universal-Streaming)
    console.log("📡 Test 1: Testing WebSocket connection with v3 Universal-Streaming...");
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=8000&format_turns=true&token=${ASSEMBLYAI_API_KEY}`;
    const testResult = await new Promise((resolve)=>{
      const testSocket = new WebSocket(wsUrl);
      const timeout = setTimeout(()=>{
        testSocket.close();
        resolve({
          success: false,
          error: "Connection timeout"
        });
      }, 10000);
      testSocket.onopen = ()=>{
        clearTimeout(timeout);
        console.log("✅ WebSocket connected successfully!");
        testSocket.close();
        resolve({
          success: true
        });
      };
      testSocket.onerror = (error)=>{
        clearTimeout(timeout);
        console.error("❌ WebSocket error:", error);
        resolve({
          success: false,
          error: "WebSocket connection failed"
        });
      };
      testSocket.onclose = (event)=>{
        console.log("🔌 WebSocket closed:", event.code, event.reason);
      };
    });
    return new Response(JSON.stringify({
      success: true,
      message: "AssemblyAI v3 Universal-Streaming integration test completed",
      tests: {
        apiKeyAvailable: !!ASSEMBLYAI_API_KEY,
        websocketTest: testResult
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("❌ AssemblyAI test failed:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      details: "Check the edge function logs for more details"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
