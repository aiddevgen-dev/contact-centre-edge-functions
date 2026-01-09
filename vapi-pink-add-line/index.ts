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

// Demo session storage (in production, use database)
const sessionState: Record<string, any> = {};

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
        success: false,
        message: "I need to verify your account first before adding a new line. What's the phone number on your account?"
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate line type
    const validLineTypes = ['phone', 'tablet', 'iphone', 'ipad'];
    const normalizedLineType = lineType.includes('tablet') || lineType.includes('ipad') ? 'tablet' : 'phone';
    const monthlyPrice = PRICING[normalizedLineType as keyof typeof PRICING];

    // Generate new line details
    const newLineId = `line_${Date.now()}`;
    const newPhoneNumber = `+1-555-${Math.floor(1000 + Math.random() * 9000)}`;

    const newLine = {
      id: newLineId,
      type: normalizedLineType,
      device: deviceType || (normalizedLineType === 'phone' ? 'iPhone' : 'iPad'),
      number: newPhoneNumber,
      monthlyPrice,
      status: 'pending_activation',
      addedAt: new Date().toISOString(),
    };

    // Store in session state
    if (!sessionState[customerId]) {
      sessionState[customerId] = { pendingLines: [], appliedPromos: [] };
    }

    for (let i = 0; i < quantity; i++) {
      const line = { ...newLine, id: `${newLineId}_${i}` };
      sessionState[customerId].pendingLines.push(line);
    }

    const totalNewLines = sessionState[customerId].pendingLines.length;
    const totalNewMonthly = sessionState[customerId].pendingLines.reduce(
      (sum: number, l: any) => sum + l.monthlyPrice,
      0
    );

    // Try to log to database
    try {
      await supabase.from('ai_actions').insert({
        session_id: customerId,
        action_type: 'add_line',
        details: {
          lineType: normalizedLineType,
          device: newLine.device,
          quantity,
          monthlyPrice,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('Could not log to ai_actions:', e);
    }

    // Check if eligible for 5-line promo after adding
    // This would need current line count from account info
    const promoMessage = totalNewLines >= 2
      ? " With this addition, you may qualify for our 5-Line Free iPad promotion!"
      : "";

    const deviceName = quantity > 1 ? `${quantity} new ${newLine.device} lines` : `a new ${newLine.device} line`;

    return new Response(JSON.stringify({
      success: true,
      lineAdded: true,
      line: newLine,
      pendingLines: sessionState[customerId].pendingLines,
      totalPendingLines: totalNewLines,
      totalNewMonthlyCharge: totalNewMonthly,
      pricing: {
        lineType: normalizedLineType,
        monthlyPrice,
        totalForNewLines: totalNewMonthly,
      },
      message: `I've added ${deviceName} to your account. The ${normalizedLineType} line is ${monthlyPrice} dollars per month.${promoMessage} Would you like to add anything else?`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in vapi-pink-add-line:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to add line',
      message: "I'm having trouble adding the line right now. Please try again."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
