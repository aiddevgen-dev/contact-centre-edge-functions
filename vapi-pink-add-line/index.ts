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

// Pricing
const PRICING = {
  phone: 35,
  tablet: 10,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log('=== VAPI Pink Mobile Add Line ===');
    console.log('Request body:', JSON.stringify(body, null, 2));

    // Extract parameters from VAPI function call
    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};
    const toolCallId = toolCall?.id || 'unknown';

    const customerId = functionArgs?.customerId ||
                      functionArgs?.customer_id ||
                      body.customerId;

    const lineType = (functionArgs?.lineType ||
                     functionArgs?.line_type ||
                     functionArgs?.type ||
                     body.lineType ||
                     'phone').toLowerCase();

    const deviceType = functionArgs?.deviceType ||
                      functionArgs?.device_type ||
                      functionArgs?.device ||
                      body.deviceType;

    const quantity = parseInt(functionArgs?.quantity || body.quantity || '1', 10);

    console.log('Customer ID:', customerId);
    console.log('Line Type:', lineType);
    console.log('Device Type:', deviceType);
    console.log('Quantity:', quantity);

    if (!customerId) {
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            message: "I need to verify your account first before adding a new line. What's the phone number on your account?"
          })
        }]
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Normalize line type
    const normalizedLineType = lineType.includes('tablet') || lineType.includes('ipad') ? 'tablet' : 'phone';
    const monthlyPrice = PRICING[normalizedLineType as keyof typeof PRICING];

    const device = deviceType || (normalizedLineType === 'phone' ? 'iPhone' : 'iPad');

    // Insert line(s) into pink_lines table
    const linesToInsert = [];
    for (let i = 0; i < quantity; i++) {
      linesToInsert.push({
        id: `line_${Date.now()}_${i}`,
        customer_id: customerId,
        line_type: normalizedLineType,
        device: device,
        phone_number: `+1-555-${Math.floor(1000 + Math.random() * 9000)}`,
        monthly_price: monthlyPrice,
      });
    }

    const { data: insertedLines, error: insertError } = await supabase
      .from('pink_lines')
      .insert(linesToInsert)
      .select();

    if (insertError) {
      console.error('Error inserting lines:', insertError);
      return new Response(JSON.stringify({
        results: [{
          toolCallId,
          result: JSON.stringify({
            success: false,
            message: "I'm having trouble adding the line right now. Please try again."
          })
        }]
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get updated line count for this customer
    const { data: allLines } = await supabase
      .from('pink_lines')
      .select('monthly_price')
      .eq('customer_id', customerId);

    const totalLines = allLines?.length || 0;
    const totalMonthlyBill = allLines?.reduce((sum: number, l: any) => sum + (parseFloat(l.monthly_price) || 0), 0) || 0;
    const linesNeeded = 5 - totalLines;

    // Check if eligible for 5-line promo
    let promoMessage = "";
    if (totalLines >= 5) {
      promoMessage = " Great news - you now qualify for the FREE iPad promotion!";
    } else if (linesNeeded > 0 && linesNeeded <= 2) {
      promoMessage = ` Add ${linesNeeded} more line${linesNeeded > 1 ? 's' : ''} to get a FREE iPad!`;
    }

    // Log to ai_actions
    try {
      await supabase.from('ai_actions').insert({
        session_id: customerId,
        action_type: 'add_line',
        details: { lineType: normalizedLineType, device, quantity, monthlyPrice },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('Could not log to ai_actions:', e);
    }

    const deviceName = quantity > 1 ? `${quantity} new ${device} lines` : `a new ${device} line`;

    return new Response(JSON.stringify({
      results: [{
        toolCallId,
        result: JSON.stringify({
          success: true,
          lineAdded: true,
          linesAdded: insertedLines,
          totalLines,
          totalMonthlyBill,
          pricing: {
            lineType: normalizedLineType,
            monthlyPrice,
            totalForNewLines: quantity * monthlyPrice,
          },
          message: `I've added ${deviceName} to your account. The ${normalizedLineType} line is ${monthlyPrice} dollars per month. You now have ${totalLines} total lines.${promoMessage}`
        })
      }]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in vapi-pink-add-line:', error);
    return new Response(JSON.stringify({
      results: [{
        toolCallId: 'unknown',
        result: JSON.stringify({
          success: false,
          error: 'Failed to add line',
          message: "I'm having trouble adding the line right now. Please try again."
        })
      }]
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
