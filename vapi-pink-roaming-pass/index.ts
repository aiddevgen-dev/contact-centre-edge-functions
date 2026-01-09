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

// Roaming pass pricing by region
const ROAMING_PASSES = {
  europe: {
    id: 'europe-pass',
    name: 'Europe Travel Pass',
    regions: ['Europe', 'EU', 'UK', 'European Union'],
    dailyRate: 10,
    features: ['Unlimited voice', 'Unlimited text', 'Data at home rates'],
    autoStop: true,
  },
  asia: {
    id: 'asia-pass',
    name: 'Asia Travel Pass',
    regions: ['Asia', 'Japan', 'Korea', 'China', 'Southeast Asia'],
    dailyRate: 15,
    features: ['Unlimited voice', 'Unlimited text', 'Data at home rates'],
    autoStop: true,
  },
  americas: {
    id: 'americas-pass',
    name: 'Americas Travel Pass',
    regions: ['Canada', 'Mexico', 'South America', 'Central America'],
    dailyRate: 10,
    features: ['Unlimited voice', 'Unlimited text', 'Data at home rates'],
    autoStop: true,
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log('=== VAPI Pink Mobile Roaming Pass ===');
    console.log('Request body:', JSON.stringify(body, null, 2));

    // Extract parameters from VAPI function call
    const { message = {} } = body;
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};

    const customerId = functionArgs?.customerId ||
                      functionArgs?.customer_id ||
                      body.customerId;

    const destination = functionArgs?.destination ||
                       functionArgs?.region ||
                       functionArgs?.country ||
                       body.destination ||
                       'Europe';

    const startDate = functionArgs?.startDate ||
                     functionArgs?.start_date ||
                     functionArgs?.departureDate ||
                     body.startDate;

    const endDate = functionArgs?.endDate ||
                   functionArgs?.end_date ||
                   functionArgs?.returnDate ||
                   body.endDate;

    const activate = functionArgs?.activate !== false && body.activate !== false;

    console.log('Customer ID:', customerId);
    console.log('Destination:', destination);
    console.log('Start Date:', startDate);
    console.log('End Date:', endDate);
    console.log('Activate:', activate);

    if (!customerId) {
      return new Response(JSON.stringify({
        success: false,
        message: "I need to verify your account first before setting up roaming."
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find matching roaming pass
    let selectedPass = ROAMING_PASSES.europe; // default
    const destinationLower = destination.toLowerCase();

    for (const [key, pass] of Object.entries(ROAMING_PASSES)) {
      if (pass.regions.some(r => destinationLower.includes(r.toLowerCase()))) {
        selectedPass = pass;
        break;
      }
    }

    // Calculate estimated cost if dates provided
    let estimatedCost = null;
    let travelDays = null;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      travelDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      estimatedCost = travelDays * selectedPass.dailyRate;
    }

    const roamingPass = {
      passId: selectedPass.id,
      passName: selectedPass.name,
      destination,
      dailyRate: selectedPass.dailyRate,
      features: selectedPass.features,
      autoStop: selectedPass.autoStop,
      startDate: startDate || 'When you arrive',
      endDate: endDate || 'When you return',
      travelDays,
      estimatedMaxCost: estimatedCost,
      activatedAt: activate ? new Date().toISOString() : null,
      status: activate ? 'active' : 'pending',
    };

    // Log to database
    try {
      await supabase.from('ai_actions').insert({
        session_id: customerId,
        action_type: 'roaming_pass',
        details: roamingPass,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log('Could not log to ai_actions:', e);
    }

    let message = '';
    if (activate) {
      message = `Done! Your ${selectedPass.name} is now active. `;
      if (startDate && endDate) {
        message += `It covers ${startDate} to ${endDate}. `;
      }
      message += `You'll be charged ${selectedPass.dailyRate} dollars per day only on days your phone connects to a ${destination} network. `;
      message += `The pass stops automatically when you return home - no action needed from you.`;
    } else {
      message = `The ${selectedPass.name} gives you unlimited voice and text for ${selectedPass.dailyRate} dollars per day. `;
      message += `You're only charged on days you actually roam. Would you like me to activate it?`;
    }

    return new Response(JSON.stringify({
      success: true,
      passActivated: activate,
      roamingPass,
      message,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in vapi-pink-roaming-pass:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to setup roaming pass',
      message: "I'm having trouble setting up the roaming pass right now. Please try again."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
