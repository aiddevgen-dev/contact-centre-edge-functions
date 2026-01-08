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
    const url = new URL(req.url);
    const conferenceId = url.searchParams.get('conference');
    if (!conferenceId) {
      throw new Error('Conference ID required');
    }
    // Generate TwiML to connect agent to the conference
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="alice">Connecting you to the customer.</Say>
      <Dial>
        <Conference 
          startConferenceOnEnter="true"
          endConferenceOnExit="true"
          muted="false"
          beep="false"
        >${conferenceId}</Conference>
      </Dial>
    </Response>`;
    return new Response(twiml, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    });
  } catch (error) {
    console.error('Error in twilio-agent-connect:', error);
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
