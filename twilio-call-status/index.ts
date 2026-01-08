import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";
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
    // Parse Twilio webhook data
    const formData = await req.formData();
    const webhookData = Object.fromEntries(formData.entries());
    console.log('Twilio Call Status Webhook:', webhookData);
    const { CallSid, CallStatus, From, To, Direction, CallDuration, RecordingUrl, RecordingDuration, CallerCountry, CallerState, CallerCity, ConferenceSid } = webhookData;
    // Find or create customer profile
    let customerProfile = null;
    if (From) {
      const { data: existingProfile } = await supabase.from('customer_profiles').select('*').eq('phone_number', From).single();
      if (!existingProfile) {
        const { data: newProfile } = await supabase.from('customer_profiles').insert({
          phone_number: From,
          call_history_count: 1,
          last_interaction_at: new Date().toISOString()
        }).select().single();
        customerProfile = newProfile;
      } else {
        // Update existing profile
        const { data: updatedProfile } = await supabase.from('customer_profiles').update({
          call_history_count: existingProfile.call_history_count + 1,
          last_interaction_at: new Date().toISOString()
        }).eq('id', existingProfile.id).select().single();
        customerProfile = updatedProfile;
      }
    }
    // Find or create call record
    let callRecord = null;
    const { data: existingCall } = await supabase.from('calls').select('*').eq('twilio_call_sid', CallSid).single();
    if (!existingCall) {
      // Create new call record
      const { data: newCall } = await supabase.from('calls').insert({
        customer_number: From,
        twilio_call_sid: CallSid,
        twilio_conference_sid: ConferenceSid,
        call_status: CallStatus,
        call_direction: Direction,
        caller_country: CallerCountry,
        caller_state: CallerState,
        caller_city: CallerCity,
        call_duration: CallDuration ? parseInt(CallDuration) : null,
        recording_url: RecordingUrl,
        recording_duration: RecordingDuration ? parseInt(RecordingDuration) : null,
        started_at: new Date().toISOString()
      }).select().single();
      callRecord = newCall;
    } else {
      // Update existing call record
      const updateData = {
        call_status: CallStatus,
        call_duration: CallDuration ? parseInt(CallDuration) : existingCall.call_duration,
        recording_url: RecordingUrl || existingCall.recording_url,
        recording_duration: RecordingDuration ? parseInt(RecordingDuration) : existingCall.recording_duration
      };
      if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
        updateData.ended_at = new Date().toISOString();
      }
      const { data: updatedCall } = await supabase.from('calls').update(updateData).eq('id', existingCall.id).select().single();
      callRecord = updatedCall;
    }
    // Create recording record if URL provided
    if (RecordingUrl && callRecord) {
      await supabase.from('call_recordings').upsert({
        call_id: callRecord.id,
        twilio_recording_sid: CallSid + '_recording',
        recording_url: RecordingUrl,
        duration: RecordingDuration ? parseInt(RecordingDuration) : null
      });
    }
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    });
  } catch (error) {
    console.error('Error in twilio-call-status webhook:', error);
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
