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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log('=== VAPI Pink Mobile PIN Verification ===');

    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};

    const customerId = functionArgs?.customerId || body.customerId;
    const pin = functionArgs?.pin || body.pin;

    const toolCallId = toolCall?.id || 'unknown';

    console.log('Customer ID:', customerId);
    console.log('PIN provided:', pin ? '****' : 'none');

    if (!pin) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            verified: false,
            message: "Please provide the 4-digit security PIN."
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!customerId) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            verified: false,
            message: "Please look up the customer first before verifying PIN."
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Query database for customer PIN
    const { data: customer, error } = await supabase
      .from('pink_customers')
      .select('id, name, phone, pin')
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      console.error('Database error:', error);
    }

    if (!customer) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            verified: false,
            message: "Customer not found. Please look up the customer again."
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify PIN
    const providedPin = pin.toString().slice(-4);
    const storedPin = (customer.pin || '').toString().slice(-4);
    const pinVerified = providedPin === storedPin;

    console.log('PIN verified:', pinVerified);

    if (pinVerified) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: true,
            verified: true,
            customerId: customer.id,
            customerName: customer.name,
            message: `PIN verified. Identity confirmed for ${customer.name}. You can now help with their account.`
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      results: [{
        toolCallId,
        result: JSON.stringify({
          success: false,
          verified: false,
          message: "That PIN doesn't match our records. Please ask the customer to try again."
        })
      }]
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      results: [{
        toolCallId: 'unknown',
        result: JSON.stringify({
          success: false,
          message: "I'm having trouble verifying the PIN. Please try again."
        })
      }]
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
