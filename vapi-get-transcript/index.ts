import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { callId } = await req.json();

    if (!callId) {
      throw new Error('callId is required');
    }

    const vapiApiKey = Deno.env.get('VAPI_API_KEY');
    if (!vapiApiKey) {
      throw new Error('VAPI_API_KEY not configured');
    }

    console.log('Fetching transcript for call:', callId);

    // Fetch call details from VAPI API
    const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('VAPI API error:', response.status, errorText);
      throw new Error(`Failed to fetch call from VAPI: ${response.status}`);
    }

    const callData = await response.json();

    // Extract relevant transcript information
    const result = {
      callId: callData.id,
      status: callData.status,
      startedAt: callData.startedAt,
      endedAt: callData.endedAt,
      transcript: callData.transcript || '',
      messages: callData.messages || [],
      summary: callData.summary || null,
      duration: callData.endedAt && callData.startedAt
        ? Math.round((new Date(callData.endedAt).getTime() - new Date(callData.startedAt).getTime()) / 1000)
        : null,
      endedReason: callData.endedReason || null,
      recordingUrl: callData.recordingUrl || null,
      cost: callData.cost || null,
    };

    console.log('Transcript fetched successfully, length:', result.transcript?.length || 0);

    return new Response(JSON.stringify({
      success: true,
      data: result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in vapi-get-transcript:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to fetch transcript',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});