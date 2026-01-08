import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { customer_phone, interaction_type = 'voice', topic, agent_id, duration_seconds, resolution_status = 'pending' } = await req.json();
    console.log('Logging interaction:', {
      customer_phone,
      interaction_type,
      topic
    });
    if (!customer_phone) {
      throw new Error('Customer phone number is required');
    }
    // Log the interaction
    const { data: interaction, error: logError } = await supabase.from('interaction_history').insert({
      customer_phone,
      interaction_type,
      topic,
      agent_id,
      duration_seconds,
      resolution_status
    }).select().single();
    if (logError) {
      console.error('Error logging interaction:', logError);
      throw logError;
    }
    // Update customer profile interaction count
    const { error: updateError } = await supabase.from('customer_profiles').update({
      call_history_count: supabase.rpc('increment_call_count'),
      last_interaction_at: new Date().toISOString()
    }).eq('phone_number', customer_phone);
    if (updateError) {
      console.log('Note: Could not update customer profile:', updateError.message);
    }
    return new Response(JSON.stringify({
      result: interaction,
      message: 'Interaction logged successfully'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in vapi-interaction-log:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Failed to log interaction'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
