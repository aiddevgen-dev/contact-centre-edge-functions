import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { phoneNumber, customerName, agentId } = await req.json();

    if (!phoneNumber) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format phone number
    let formattedPhone = phoneNumber.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = `+1${formattedPhone}`;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    // VAPI Configuration
    const VAPI_PRIVATE_KEY = Deno.env.get('VAPI_PRIVATE_KEY');
    const VAPI_ASSISTANT_ID = Deno.env.get('VAPI_ASSISTANT_ID') || '805978f7-ce8b-44f5-9147-16a90280022b';
    const VAPI_PHONE_NUMBER_ID = Deno.env.get('VAPI_PHONE_NUMBER_ID') || 'b0220ebf-bc0e-46cb-bcf5-9b3bd45e6a23';

    if (!VAPI_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ error: 'VAPI_PRIVATE_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Initiating outbound call to: ${formattedPhone}`);

    // Webhook URL for receiving call events
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const webhookUrl = `${SUPABASE_URL}/functions/v1/vapi-webhook`;
    console.log('Using webhook URL:', webhookUrl);

    // Call VAPI's outbound call API
    const vapiResponse = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_PRIVATE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        customer: {
          number: formattedPhone,
          name: customerName || 'Customer'
        },
        // Override assistant settings to use our webhook
        assistantOverrides: {
          serverUrl: webhookUrl
        }
      }),
    });

    const vapiData = await vapiResponse.json();

    if (!vapiResponse.ok) {
      console.error('VAPI API error:', vapiData);
      return new Response(
        JSON.stringify({ error: vapiData.message || 'Failed to initiate call', details: vapiData }),
        { status: vapiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('VAPI call initiated:', vapiData);

    // Create call record in database if agentId is provided
    let dbCallId = null;
    if (agentId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: callRecord, error: callError } = await supabase
          .from('calls')
          .insert({
            customer_number: formattedPhone,
            agent_id: agentId,
            call_direction: 'outbound',
            call_status: 'in-progress',
            started_at: new Date().toISOString(),
            vapi_call_id: vapiData.id // Store VAPI call ID for webhook matching
          })
          .select()
          .single();

        if (callError) {
          console.error('Error creating call record:', callError);
        } else {
          dbCallId = callRecord.id;
          console.log('Call record created:', dbCallId);
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
        // Don't fail the call if DB insert fails
      }
    } else {
      console.log('No agentId provided, skipping call record creation');
    }

    return new Response(
      JSON.stringify({
        success: true,
        callId: vapiData.id,
        dbCallId: dbCallId,
        status: vapiData.status,
        message: `Calling ${formattedPhone}...`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
