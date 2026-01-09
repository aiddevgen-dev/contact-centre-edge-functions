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

// Available promotions
const PROMOS = {
  '5-line-ipad': {
    id: '5-line-ipad',
    name: '5-Line Free iPad Promo',
    description: 'Get a free iPad device when your account has 5 total lines',
    requirement: 5,
    benefit: 'Free iPad',
    deviceValue: 799,
  },
  'family-plan': {
    id: 'family-plan',
    name: 'Family Plan Discount',
    description: '10% discount on 4+ lines',
    requirement: 4,
    benefit: '10% off monthly bill',
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log('=== VAPI Pink Mobile Apply Promo ===');
    console.log('Request body:', JSON.stringify(body, null, 2));

    // Extract parameters from VAPI function call
    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};

    const customerId = functionArgs?.customerId ||
                      functionArgs?.customer_id ||
                      body.customerId;

    const promoId = functionArgs?.promoId ||
                   functionArgs?.promo_id ||
                   functionArgs?.promo ||
                   body.promoId ||
                   '5-line-ipad';

    const totalLines = parseInt(functionArgs?.totalLines ||
                                functionArgs?.total_lines ||
                                body.totalLines || '0', 10);

    const shippingAddress = functionArgs?.shippingAddress ||
                           functionArgs?.shipping_address ||
                           functionArgs?.address ||
                           body.shippingAddress;

    console.log('Customer ID:', customerId);
    console.log('Promo ID:', promoId);
    console.log('Total Lines:', totalLines);
    console.log('Shipping Address:', shippingAddress);

    if (!customerId) {
      return new Response(JSON.stringify({
        success: false,
        message: "I need to verify your account first before applying promotions."
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const promo = PROMOS[promoId as keyof typeof PROMOS];
    if (!promo) {
      return new Response(JSON.stringify({
        success: false,
        message: "I couldn't find that promotion. Let me tell you about our current offers..."
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check eligibility
    if (totalLines < promo.requirement) {
      const linesNeeded = promo.requirement - totalLines;
      return new Response(JSON.stringify({
        success: false,
        eligible: false,
        promoId: promo.id,
        promoName: promo.name,
        requirement: promo.requirement,
        currentLines: totalLines,
        linesNeeded,
        message: `You need ${linesNeeded} more line${linesNeeded > 1 ? 's' : ''} to qualify for the ${promo.name}. Would you like to add more lines?`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Apply promo
    const appliedPromo = {
      promoId: promo.id,
      promoName: promo.name,
      benefit: promo.benefit,
      appliedAt: new Date().toISOString(),
      shippingAddress: shippingAddress || 'To be confirmed',
      estimatedDelivery: '3-5 business days',
    };

    // Log to database
    try {
      await supabase.from('ai_actions').insert({
        session_id: customerId,
        action_type: 'apply_promo',
        details: appliedPromo,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('Could not log to ai_actions:', e);
    }

    let message = '';
    if (promoId === '5-line-ipad') {
      message = shippingAddress
        ? `I've applied the ${promo.name}. Your free iPad will be shipped to ${shippingAddress} and should arrive in 3 to 5 business days.`
        : `I've applied the ${promo.name}. Your free iPad is ready to ship. Should I send it to your address on file?`;
    } else {
      message = `I've applied the ${promo.name} to your account. ${promo.benefit}`;
    }

    return new Response(JSON.stringify({
      success: true,
      promoApplied: true,
      promo: appliedPromo,
      message,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in vapi-pink-apply-promo:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to apply promo',
      message: "I'm having trouble applying the promotion right now. Please try again."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
