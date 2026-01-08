import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";
// @deno-types="npm:@types/twilio"
import twilio from "npm:twilio@5.8.1";
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
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { callId } = await req.json();
    if (!callId) {
      throw new Error('Call ID is required');
    }
    console.log('Ending call:', callId);
    // Get the call record to find the Twilio Call SID
    const { data: callRecord, error: callError } = await supabase.from('calls').select('twilio_call_sid, call_status').eq('id', callId).single();
    if (callError || !callRecord) {
      throw new Error('Call record not found');
    }
    console.log('Found call record:', callRecord);
    // Initialize Twilio client
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }
    const client = twilio(accountSid, authToken);
    // End the actual Twilio call if it's still active
    if (callRecord.twilio_call_sid && callRecord.call_status !== 'completed') {
      try {
        console.log('Hanging up Twilio call:', callRecord.twilio_call_sid);
        await client.calls(callRecord.twilio_call_sid).update({
          status: 'completed'
        });
        console.log('Successfully ended Twilio call');
      } catch (twilioError) {
        console.error('Error ending Twilio call:', twilioError);
      // Continue to update our database even if Twilio call couldn't be ended
      }
    }
    // Update the call record in our database
    const { error: updateError } = await supabase.from('calls').update({
      call_status: 'completed',
      ended_at: new Date().toISOString()
    }).eq('id', callId);
    if (updateError) {
      console.error('Error updating call record:', updateError);
      throw updateError;
    }
    console.log('Call ended successfully');
    return new Response(JSON.stringify({
      success: true,
      message: 'Call ended successfully'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error ending call:', error);
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
