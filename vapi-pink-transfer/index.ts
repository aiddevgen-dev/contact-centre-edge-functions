import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Contact Centre phone number - the Twilio number for human agents
const CONTACT_CENTRE_NUMBER = Deno.env.get('CONTACT_CENTRE_NUMBER') || '+17656763105';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log('=== VAPI Pink Mobile Transfer to Contact Centre ===');
    console.log('Request body:', JSON.stringify(body, null, 2));

    // Extract parameters from VAPI function call
    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};

    const customerId = functionArgs?.customerId ||
                      functionArgs?.customer_id ||
                      body.customerId;

    const customerName = functionArgs?.customerName ||
                        functionArgs?.customer_name ||
                        body.customerName;

    const customerPhone = functionArgs?.customerPhone ||
                         functionArgs?.customer_phone ||
                         message?.call?.customer?.number ||
                         body.customerPhone;

    const reason = functionArgs?.reason ||
                  functionArgs?.transferReason ||
                  body.reason ||
                  'Customer requested human agent';

    const context = functionArgs?.context ||
                   functionArgs?.callContext ||
                   body.context ||
                   {};

    const callId = message?.call?.id ||
                  functionArgs?.callId ||
                  body.callId;

    console.log('Customer ID:', customerId);
    console.log('Customer Name:', customerName);
    console.log('Customer Phone:', customerPhone);
    console.log('Transfer Reason:', reason);
    console.log('Call ID:', callId);

    // Create escalation record
    const escalation = {
      id: `ESC-${Date.now()}`,
      customerId,
      customerName,
      customerPhone,
      reason,
      context,
      callId,
      transferTo: CONTACT_CENTRE_NUMBER,
      createdAt: new Date().toISOString(),
      status: 'transferring',
    };

    // Log escalation to database
    try {
      await supabase.from('ai_escalations').insert({
        id: escalation.id,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        reason,
        context,
        call_id: callId,
        transfer_to: CONTACT_CENTRE_NUMBER,
        status: 'transferring',
        created_at: escalation.createdAt,
      });

      // Also update any active AI session
      if (customerId) {
        await supabase
          .from('ai_sessions')
          .update({
            status: 'escalated',
            escalation_reason: reason,
            ended_at: new Date().toISOString(),
          })
          .eq('customer_id', customerId)
          .eq('status', 'active');
      }

      console.log('Escalation logged:', escalation.id);
    } catch (e) {
      console.log('Could not log escalation to database:', e);
    }

    // Create a call record for the Contact Centre to pick up
    try {
      await supabase.from('calls').insert({
        customer_number: customerPhone,
        call_direction: 'inbound',
        call_status: 'ringing',
        call_type: 'escalation',
        notes: `Escalated from AI: ${reason}. Customer: ${customerName || 'Unknown'}`,
        metadata: {
          escalationId: escalation.id,
          fromAI: true,
          context,
        },
        created_at: new Date().toISOString(),
      });
      console.log('Call record created for Contact Centre');
    } catch (e) {
      console.log('Could not create call record:', e);
    }

    // Get the toolCallId from the request
    const toolCallId = toolCall?.id || 'unknown';

    // Return VAPI-specific transfer format
    // VAPI expects: { results: [...], destination: { type, number, message } }
    return new Response(JSON.stringify({
      results: [
        {
          toolCallId: toolCallId,
          result: `Transferring to human agent. Reason: ${reason}`
        }
      ],
      destination: {
        type: 'number',
        number: CONTACT_CENTRE_NUMBER,
        message: 'Please hold while I connect you with a specialist.',
        description: `Escalation: ${reason}`
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in vapi-pink-transfer:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to transfer call',
      message: "I'm having trouble connecting you to an agent. Please try calling back."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
