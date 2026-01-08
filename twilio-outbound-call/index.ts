import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // This function is called by TwiML App when agent initiates outbound call via device.connect()
    // It receives form data from Twilio
    const contentType = req.headers.get('content-type') || '';

    let To: string | null = null;
    let From: string | null = null;
    let CallSid: string | null = null;
    let agentId: string | null = null;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Called by Twilio TwiML App
      const formData = await req.formData();
      const webhookData = Object.fromEntries(formData.entries());
      console.log('Twilio Outbound Webhook Data:', webhookData);

      To = webhookData.To as string;
      From = webhookData.From as string;
      CallSid = webhookData.CallSid as string;
      // Agent ID might be passed as custom parameter
      agentId = webhookData.agentId as string || null;
    } else {
      // Called directly from frontend (JSON)
      const body = await req.json();
      console.log('Direct API Call Body:', body);

      To = body.to || body.To;
      agentId = body.agentId;
    }

    if (!To) {
      console.error('No destination number provided');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No destination number provided.</Say><Hangup/></Response>',
        { headers: { ...corsHeaders, 'Content-Type': 'application/xml' } }
      );
    }

    console.log('Outbound call request:', { To, From, CallSid, agentId });

    // If we have a CallSid, this is the TwiML App callback - create call record and return TwiML
    if (CallSid) {
      // Find the agent making the call (from the Twilio Client identity or passed agentId)
      let assignedAgentId = agentId;

      if (!assignedAgentId) {
        // Try to find an online agent (the one making the call)
        const { data: onlineAgent } = await supabase
          .from('agents')
          .select('id')
          .eq('status', 'online')
          .limit(1)
          .single();

        if (onlineAgent) {
          assignedAgentId = onlineAgent.id;
        }
      }

      // Create call record for outbound call
      const { data: callRecord, error: callError } = await supabase
        .from('calls')
        .insert({
          twilio_call_sid: CallSid,
          customer_number: To,
          call_status: 'ringing',
          call_direction: 'outbound',
          agent_id: assignedAgentId,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (callError) {
        console.error('Error creating outbound call record:', callError);
      } else {
        console.log('Outbound call record created:', callRecord);
      }

      // Find or create customer profile
      const { data: existingProfile } = await supabase
        .from('customer_profiles')
        .select('*')
        .eq('phone_number', To)
        .single();

      if (!existingProfile) {
        await supabase.from('customer_profiles').insert({
          phone_number: To,
          call_history_count: 1,
          last_interaction_at: new Date().toISOString()
        });
      } else {
        await supabase.from('customer_profiles').update({
          call_history_count: existingProfile.call_history_count + 1,
          last_interaction_at: new Date().toISOString()
        }).eq('id', existingProfile.id);
      }

      // Use your Twilio number as caller ID for outbound calls
      const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER') || '+17656763105';

      // Return TwiML to dial the customer with dual audio streams for transcription
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Start>
          <Stream url="wss://pzyhbgfnbnvkmcdmzzcq.supabase.co/functions/v1/twilio-audio-stream-v2" track="inbound_track" name="customer-stream" />
        </Start>
        <Start>
          <Stream url="wss://pzyhbgfnbnvkmcdmzzcq.supabase.co/functions/v1/twilio-audio-stream-v2" track="outbound_track" name="agent-stream" />
        </Start>
        <Dial callerId="${twilioPhoneNumber}"
              timeout="30"
              record="record-from-ringing"
              recordingStatusCallback="https://pzyhbgfnbnvkmcdmzzcq.supabase.co/functions/v1/twilio-call-status"
              action="https://pzyhbgfnbnvkmcdmzzcq.supabase.co/functions/v1/twilio-call-status">
          <Number>${To}</Number>
        </Dial>
      </Response>`;

      console.log('Returning TwiML for outbound call:', twiml);

      return new Response(twiml, {
        headers: { ...corsHeaders, 'Content-Type': 'application/xml' }
      });
    }

    // Direct API call - just acknowledge (actual call is made via Twilio Device)
    return new Response(
      JSON.stringify({ success: true, message: 'Use Twilio Device to initiate call' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in twilio-outbound-call:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
