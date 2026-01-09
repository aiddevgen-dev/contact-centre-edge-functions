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
    console.log('=== VAPI Pink Mobile Account Info ===');

    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};

    const customerId = functionArgs?.customerId || functionArgs?.customer_id || body.customerId;
    const toolCallId = toolCall?.id || 'unknown';

    console.log('Customer ID:', customerId);

    if (!customerId) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            message: "Please verify the customer first before getting account info."
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get customer from database
    const { data: customer, error: customerError } = await supabase
      .from('pink_customers')
      .select('id, name, phone, email, address')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) {
      console.error('Database error:', customerError);
    }

    if (!customer) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            message: "Customer not found. Please look up the customer again."
          })
        }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get lines from database
    const { data: lines, error: linesError } = await supabase
      .from('pink_lines')
      .select('id, line_type, device, phone_number, monthly_price')
      .eq('customer_id', customerId);

    if (linesError) {
      console.error('Lines error:', linesError);
    }

    const customerLines = lines || [];
    const totalLines = customerLines.length;
    const linesNeeded = 5 - totalLines;
    const eligibleForFreeIpad = linesNeeded > 0 && linesNeeded <= 2;

    // Build line descriptions
    const lineDescriptions = customerLines.map((l: any) =>
      `${l.device || l.line_type} (${l.phone_number})`
    ).join(', ');

    const monthlyBill = customerLines.reduce((sum: number, l: any) =>
      sum + (parseFloat(l.monthly_price) || 35), 0
    );

    let summary = `${customer.name} has ${totalLines} line${totalLines !== 1 ? 's' : ''}: ${lineDescriptions || 'none'}. Monthly bill: $${monthlyBill}.`;

    if (eligibleForFreeIpad) {
      summary += ` Add ${linesNeeded} more line${linesNeeded > 1 ? 's' : ''} to get a FREE iPad!`;
    }

    return new Response(JSON.stringify({
      results: [{
        toolCallId,
        result: JSON.stringify({
          success: true,
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address
          },
          lines: customerLines.map((l: any) => ({
            device: l.device,
            type: l.line_type,
            phoneNumber: l.phone_number,
            monthlyPrice: l.monthly_price
          })),
          totalLines,
          monthlyBill,
          promoEligible: eligibleForFreeIpad,
          linesNeededForPromo: linesNeeded,
          message: summary
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
          message: "I'm having trouble accessing account information. Please try again."
        })
      }]
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
