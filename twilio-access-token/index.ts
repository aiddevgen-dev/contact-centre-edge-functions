import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// @deno-types="npm:@types/twilio"
import twilio from "npm:twilio@5.8.1";
const { AccessToken } = twilio.jwt;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
serve(async (req)=>{
  // Handle browser preflight (CORS check)
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // Force refresh environment variables
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const apiKey = Deno.env.get("TWILIO_API_KEY");
    const apiSecret = Deno.env.get("TWILIO_API_KEY_SECRET");
    const appSid = Deno.env.get("TWILIO_TWIML_APP_SID");
    console.log("=== TWILIO ACCESS TOKEN FUNCTION v2.1 ===");
    console.log("Environment variable check:");
    console.log("TWILIO_ACCOUNT_SID:", accountSid ? `✓ Present (${accountSid.length} chars)` : "✗ Missing");
    console.log("TWILIO_API_KEY:", apiKey ? `✓ Present (${apiKey.length} chars)` : "✗ Missing");
    console.log("TWILIO_API_KEY_SECRET:", apiSecret ? `✓ Present (${apiSecret.length} chars)` : "✗ Missing");
    console.log("TWILIO_TWIML_APP_SID:", appSid ? `✓ Present (${appSid.length} chars)` : "✗ Missing");
    // Debug: Show all env vars starting with TWILIO (values masked)
    console.log("All TWILIO env vars:");
    for (const [key, value] of Object.entries(Deno.env.toObject())){
      if (key.startsWith('TWILIO_')) {
        console.log(`  ${key}: ${value ? 'SET' : 'UNSET'}`);
      }
    }
    // Log actual values (first few chars only for security)
    console.log("Account SID starts with:", accountSid?.substring(0, 6));
    console.log("API Key starts with:", apiKey?.substring(0, 6));
    console.log("App SID starts with:", appSid?.substring(0, 6));

    // DETAILED DEBUG
    console.log("=== DETAILED API KEY DEBUG ===");
    console.log("API Key full value (masked):", apiKey ? `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}` : "NULL");
    console.log("API Key length:", apiKey?.length);
    console.log("API Key first char code:", apiKey?.charCodeAt(0));
    console.log("API Key second char code:", apiKey?.charCodeAt(1));
    console.log("Checking startsWith('SK'):", apiKey?.startsWith('SK'));
    console.log("Trimmed API Key starts with:", apiKey?.trim().startsWith('SK'));
    if (!accountSid || !apiKey || !apiSecret || !appSid) {
      console.error("Missing Twilio credentials - function will fail");
      return new Response(JSON.stringify({
        error: "Twilio credentials not configured"
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
    // Validate credential formats
    if (!accountSid?.startsWith('AC')) {
      console.error("Invalid Account SID format - should start with 'AC'");
      return new Response(JSON.stringify({
        error: "Invalid Account SID format"
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
    if (!apiKey?.startsWith('SK')) {
      console.error("Invalid API Key format - should start with 'SK'");
      return new Response(JSON.stringify({
        error: "Invalid API Key format"
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
    if (!appSid?.startsWith('AP')) {
      console.error("Invalid TwiML App SID format - should start with 'AP'");
      return new Response(JSON.stringify({
        error: "Invalid TwiML App SID format"
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
    const identity = "agent";
    console.log("Using Twilio's official AccessToken library...");
    // Create AccessToken using Twilio's official library
    const accessToken = new AccessToken(accountSid, apiKey, apiSecret, {
      identity: identity,
      ttl: 3600 // 1 hour
    });
    // Create VoiceGrant for voice calls
    const voiceGrant = new AccessToken.VoiceGrant({
      incomingAllow: true,
      outgoingApplicationSid: appSid
    });
    // Add the voice grant to the token
    accessToken.addGrant(voiceGrant);
    // Generate the JWT token using Twilio's library
    const token = accessToken.toJwt();
    console.log("✓ JWT token generated successfully using Twilio's AccessToken library");
    console.log("Token length:", token.length);
    console.log("Identity:", identity);
    return new Response(JSON.stringify({
      token,
      identity
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("Error generating Twilio token:", err);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: err.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
