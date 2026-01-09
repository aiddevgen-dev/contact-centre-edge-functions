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
    console.log('=== VAPI Pink Mobile Customer Lookup ===');

    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};

    const phoneNumber = functionArgs?.phoneNumber ||
                       functionArgs?.phone ||
                       message?.call?.customer?.number ||
                       body.phoneNumber ||
                       body.phone;

    console.log('Phone Number (raw):', phoneNumber);

    const toolCallId = toolCall?.id || 'unknown';

    if (!phoneNumber) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            message: "Please provide a phone number to look up the account."
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Normalize phone number
    let normalizedPhone = phoneNumber.replace(/\D/g, '');
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    console.log('Phone Number (normalized):', normalizedPhone);

    // Query database
    const { data: customer, error } = await supabase
      .from('pink_customers')
      .select('id, name, phone, email')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (error) {
      console.error('Database error:', error);
    }

    if (customer) {
      // Get line count
      const { count } = await supabase
        .from('pink_lines')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customer.id);

      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: true,
            customerFound: true,
            customer: {
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              totalLines: count || 0
            },
            message: `Found customer ${customer.name}. Please ask for their 4-digit security PIN to verify identity.`
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      results: [{
        toolCallId,
        result: JSON.stringify({
          success: false,
          customerFound: false,
          message: "I couldn't find an account with that phone number. Please verify the number."
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
          message: "I'm having trouble accessing customer information. Please try again."
        })
      }]
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
