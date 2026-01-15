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
    // Get the call record to find the Twilio Call SID and started_at for duration calc
    const { data: callRecord, error: callError } = await supabase.from('calls').select('twilio_call_sid, call_status, started_at, customer_number, agent_id').eq('id', callId).single();
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
    // Calculate call duration
    const endedAt = new Date();
    let callDuration = 0;
    if (callRecord.started_at) {
      const startedAt = new Date(callRecord.started_at);
      callDuration = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000); // duration in seconds
    }

    // Get transcript for this call
    const { data: transcripts } = await supabase
      .from('transcripts')
      .select('speaker, text')
      .eq('call_id', callId)
      .order('created_at', { ascending: true });

    // Combine transcripts into notes
    const notes = transcripts?.map(t => `${t.speaker}: ${t.text}`).join('\n') || '';

    // Update the call record in our database
    const { error: updateError } = await supabase.from('calls').update({
      call_status: 'completed',
      ended_at: endedAt.toISOString(),
      call_duration: callDuration,
      resolution_status: 'resolved',
      notes: notes || null
    }).eq('id', callId);
    if (updateError) {
      console.error('Error updating call record:', updateError);
      throw updateError;
    }
    console.log('Call ended successfully. Duration:', callDuration, 'seconds');
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
