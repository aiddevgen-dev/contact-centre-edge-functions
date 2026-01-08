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
    const { action, conferenceId } = await req.json();
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }
    const auth = btoa(`${accountSid}:${authToken}`);
    if (action === 'connect_agent') {
      // Create a call to connect the agent to the conference
      const callData = new URLSearchParams({
        'Url': `https://wtradfuzjapqkowjpmew.supabase.co/functions/v1/twilio-agent-connect?conference=${conferenceId}`,
        'To': '+15076974335',
        'From': '+15076974335',
        'Method': 'POST'
      });
      const callResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: callData.toString()
      });
      if (!callResponse.ok) {
        const error = await callResponse.text();
        throw new Error(`Twilio API error: ${error}`);
      }
      const result = await callResponse.json();
      return new Response(JSON.stringify({
        success: true,
        callSid: result.sid
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'end_call') {
      // End the conference
      const updateResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Conferences/${conferenceId}.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'Status': 'completed'
        }).toString()
      });
      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Twilio API error: ${error}`);
      }
      return new Response(JSON.stringify({
        success: true
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      error: 'Invalid action'
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in twilio-call-controls:', error);
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
