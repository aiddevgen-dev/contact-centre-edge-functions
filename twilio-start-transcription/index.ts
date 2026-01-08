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
    console.log('Starting transcription for call:', callId);
    // Get the call record to find the Twilio Call SID
    const { data: callRecord, error: callError } = await supabase.from('calls').select('twilio_call_sid, call_status, customer_number').eq('id', callId).maybeSingle();
    if (callError) {
      console.error('Database error fetching call:', callError);
      throw new Error(`Database error: ${callError.message}`);
    }
    if (!callRecord) {
      console.error('Call record not found for ID:', callId);
      throw new Error('Call record not found');
    }
    console.log('Found call record:', callRecord);
    if (!callRecord.twilio_call_sid) {
      console.log('No Twilio Call SID found for call:', callId);
      console.log('This might be a simulated call or Twilio SID not set yet');
      // Return success but indicate no transcription started
      return new Response(JSON.stringify({
        success: true,
        message: 'Call found but no Twilio SID available for transcription',
        callId: callId,
        hasTranscription: false
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Twilio client
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured');
    }
    const client = twilio(accountSid, authToken);
    try {
      // First check the actual call status in Twilio
      console.log('Checking Twilio call status for SID:', callRecord.twilio_call_sid);
      const call = await client.calls(callRecord.twilio_call_sid).fetch();
      console.log('Twilio call status:', call.status, 'Direction:', call.direction);
      // Only proceed if call is active/in-progress or ringing (which means it's about to be answered)
      if (call.status !== 'in-progress' && call.status !== 'ringing') {
        console.log('Call is not active in Twilio, status:', call.status);
        // Update our database to match Twilio status
        const statusMapping = {
          'completed': 'completed',
          'failed': 'failed',
          'busy': 'failed',
          'no-answer': 'failed',
          'canceled': 'failed'
        };
        const newStatus = statusMapping[call.status] || 'failed';
        await supabase.from('calls').update({
          call_status: newStatus,
          ended_at: new Date().toISOString()
        }).eq('id', callId);
        console.log('Updated database call status from', callRecord.call_status, 'to', newStatus, 'to match Twilio:', call.status);
        return new Response(JSON.stringify({
          success: true,
          message: `Call status is ${call.status}, transcription not available`,
          callId: callId,
          hasTranscription: false,
          twilioStatus: call.status
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Start live transcription on the call - proceed even if status is ringing since it will be answered
      console.log('Creating transcription stream for call with status:', call.status);
      // Create TWO separate streams - one for customer (inbound) and one for agent (outbound)
      // This ensures accurate speaker attribution for transcription
      const timestamp = Date.now();
      // Stream for customer audio (inbound_track)
      const inboundStreamConfig = {
        url: `wss://blgjdtftopdkszdioskv.supabase.co/functions/v1/twilio-audio-stream-v2`,
        name: `transcription-inbound-${callRecord.twilio_call_sid}-${timestamp}`,
        track: 'inbound_track'
      };
      // Stream for agent audio (outbound_track)
      const outboundStreamConfig = {
        url: `wss://blgjdtftopdkszdioskv.supabase.co/functions/v1/twilio-audio-stream-v2`,
        name: `transcription-outbound-${callRecord.twilio_call_sid}-${timestamp}`,
        track: 'outbound_track'
      };
      console.log('Creating dual streams for accurate speaker detection');
      console.log('Inbound (customer) stream config:', inboundStreamConfig);
      console.log('Outbound (agent) stream config:', outboundStreamConfig);
      // Create both streams
      const [inboundStream, outboundStream] = await Promise.all([
        client.calls(callRecord.twilio_call_sid).streams.create(inboundStreamConfig),
        client.calls(callRecord.twilio_call_sid).streams.create(outboundStreamConfig)
      ]);
      console.log('Started inbound stream:', inboundStream.sid);
      console.log('Started outbound stream:', outboundStream.sid);
      return new Response(JSON.stringify({
        success: true,
        message: 'Transcription started (dual streams)',
        inboundStreamSid: inboundStream.sid,
        outboundStreamSid: outboundStream.sid,
        hasTranscription: true
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } catch (twilioError) {
      console.error('Error starting Twilio transcription:', twilioError);
      // If it's a 404, the call doesn't exist - update our database
      if (twilioError.status === 404) {
        console.log('Call not found in Twilio, updating database status');
        await supabase.from('calls').update({
          call_status: 'failed',
          ended_at: new Date().toISOString()
        }).eq('id', callId);
      }
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to start transcription: ${twilioError.message}`,
        callId: callId,
        hasTranscription: false
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('Error starting transcription:', error);
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
