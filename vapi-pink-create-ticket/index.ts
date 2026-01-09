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
    console.log('=== VAPI Pink Mobile Create Ticket ===');
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

    const channel = functionArgs?.channel || body.channel || 'voice';

    const intentsDetected = functionArgs?.intentsDetected ||
                           functionArgs?.intents_detected ||
                           functionArgs?.intents ||
                           body.intentsDetected ||
                           [];

    const actionsTaken = functionArgs?.actionsTaken ||
                        functionArgs?.actions_taken ||
                        functionArgs?.actions ||
                        body.actionsTaken ||
                        [];

    const financialImpact = functionArgs?.financialImpact ||
                           functionArgs?.financial_impact ||
                           functionArgs?.mrr ||
                           body.financialImpact;

    const resolution = functionArgs?.resolution ||
                      body.resolution ||
                      'Completed by AI';

    const summary = functionArgs?.summary || body.summary;

    const escalated = functionArgs?.escalated || body.escalated || false;

    console.log('Customer ID:', customerId);
    console.log('Channel:', channel);
    console.log('Intents:', intentsDetected);
    console.log('Actions:', actionsTaken);
    console.log('Financial Impact:', financialImpact);

    // Generate ticket ID
    const ticketId = `PMK-${Math.floor(1000 + Math.random() * 9000)}`;

    const ticket = {
      ticketId,
      customerId,
      customerName: customerName || 'Unknown',
      channel,
      intentsDetected: Array.isArray(intentsDetected) ? intentsDetected : [intentsDetected],
      actionsTaken: Array.isArray(actionsTaken) ? actionsTaken : [actionsTaken],
      financialImpact: financialImpact || null,
      resolution: escalated ? 'Escalated to Contact Centre' : resolution,
      summary: summary || generateSummary(intentsDetected, actionsTaken, financialImpact),
      escalated,
      createdAt: new Date().toISOString(),
      status: escalated ? 'escalated' : 'completed',
    };

    // Try to save to database
    try {
      await supabase.from('ai_tickets').insert({
        id: ticketId,
        session_id: customerId,
        customer_name: ticket.customerName,
        channel: ticket.channel,
        intents_detected: ticket.intentsDetected,
        actions_taken: ticket.actionsTaken,
        financial_impact: ticket.financialImpact,
        resolution: ticket.resolution,
        summary: ticket.summary,
        escalated: ticket.escalated,
        status: ticket.status,
        created_at: ticket.createdAt,
      });
      console.log('Ticket saved to database:', ticketId);
    } catch (e) {
      console.log('Could not save ticket to database (table may not exist):', e);
    }

    return new Response(JSON.stringify({
      success: true,
      ticketCreated: true,
      ticket,
      message: `Ticket ${ticketId} has been created for this interaction.`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in vapi-pink-create-ticket:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to create ticket',
      message: "I couldn't create the ticket record."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function generateSummary(intents: any, actions: any, financialImpact: any): string {
  const intentList = Array.isArray(intents) ? intents : [intents];
  const actionList = Array.isArray(actions) ? actions : [actions];

  let summary = '';

  if (intentList.length > 0) {
    summary += `Customer inquiry: ${intentList.filter(Boolean).join(', ')}. `;
  }

  if (actionList.length > 0) {
    summary += `Actions: ${actionList.filter(Boolean).join('; ')}. `;
  }

  if (financialImpact) {
    summary += `Financial impact: ${financialImpact}.`;
  }

  return summary.trim() || 'Interaction completed.';
}
