import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('VAPI Webhook received:', JSON.stringify(payload, null, 2));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const messageType = payload.message?.type;
    const call = payload.message?.call;
    const callType = call?.type; // 'inboundPhoneCall' or 'outboundPhoneCall'
    const isInbound = callType === 'inboundPhoneCall';

    // Handle end-of-call-report - this contains final transcript and summary
    if (messageType === 'end-of-call-report') {
      const vapiCallId = call?.id;
      const customerNumber = call?.customer?.number;

      console.log('End of call report for VAPI call:', vapiCallId);
      console.log('Customer number:', customerNumber);
      console.log('Call type:', callType, 'isInbound:', isInbound);

      // Find the call record - try vapi_call_id first, then customer_number
      let callRecord = null;

      // First try to find by vapi_call_id (most reliable)
      if (vapiCallId) {
        const { data: callByVapiId } = await supabase
          .from('calls')
          .select('id')
          .eq('vapi_call_id', vapiCallId)
          .limit(1)
          .single();

        if (callByVapiId) {
          callRecord = callByVapiId;
          console.log('Found call by vapi_call_id:', callRecord.id);
        }
      }

      // Fallback to customer_number if no vapi_call_id match
      if (!callRecord && customerNumber) {
        // Try in-progress call
        const { data: inProgressCall } = await supabase
          .from('calls')
          .select('id')
          .eq('customer_number', customerNumber)
          .eq('call_status', 'in-progress')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (inProgressCall) {
          callRecord = inProgressCall;
          console.log('Found in-progress call:', callRecord.id);
        } else {
          // Try recently created call (within last 5 minutes)
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recentCall } = await supabase
            .from('calls')
            .select('id')
            .eq('customer_number', customerNumber)
            .gte('created_at', fiveMinutesAgo)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (recentCall) {
            callRecord = recentCall;
            console.log('Found recent call:', callRecord.id);
          }
        }
      }

      if (!callRecord && !customerNumber) {
        console.log('No customer number and no vapi_call_id match, skipping');
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // For inbound calls, create a call record if none exists
      if (!callRecord && isInbound) {
        console.log('No existing call record for inbound call, creating one...');

        // Find agent dynamically - first find PINK company, then get its agent
        let agentId = null;

        // Step 1: Find company with "PINK" in name
        const { data: companies, error: companyError } = await supabase
          .from('companies')
          .select('id, name')
          .ilike('name', '%pink%')
          .limit(1);

        console.log('Found companies:', companies, 'Error:', companyError);

        if (companies && companies.length > 0) {
          const companyId = companies[0].id;
          console.log('Found PINK company:', companyId, companies[0].name);

          // Step 2: Get an agent from this company
          const { data: agents, error: agentError } = await supabase
            .from('agents')
            .select('id, name')
            .eq('company_id', companyId)
            .limit(1);

          console.log('Found agents for company:', agents, 'Error:', agentError);

          if (agents && agents.length > 0) {
            agentId = agents[0].id;
            console.log('Using agent:', agentId, agents[0].name);
          }
        }

        // Fallback: If no PINK company found, try to find any agent with "smith" in name
        if (!agentId) {
          console.log('No PINK company agent found, trying fallback...');
          const { data: fallbackAgents } = await supabase
            .from('agents')
            .select('id, name')
            .ilike('name', '%smith%')
            .limit(1);

          if (fallbackAgents && fallbackAgents.length > 0) {
            agentId = fallbackAgents[0].id;
            console.log('Using fallback agent:', agentId, fallbackAgents[0].name);
          }
        }

        console.log('Final agent for inbound:', agentId);

        if (agentId) {
          const { data: newCall, error: createError } = await supabase
            .from('calls')
            .insert({
              customer_number: customerNumber,
              agent_id: agentId,
              call_direction: 'inbound',
              call_status: 'in-progress',
              started_at: call?.startedAt || new Date().toISOString(),
              vapi_call_id: vapiCallId // Mark as VAPI call to distinguish from human agent calls
            })
            .select()
            .single();

          if (createError) {
            console.error('Error creating inbound call record:', createError);
          } else {
            callRecord = newCall;
            console.log('Created inbound call record:', callRecord.id, 'vapi_call_id:', vapiCallId);
          }
        } else {
          console.log('No agent found, cannot create call record');
        }
      }

      if (!callRecord) {
        console.log('Could not find or create call record for', customerNumber);
        return new Response(JSON.stringify({ success: true, message: 'No matching call found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Extract data from the payload
      const endedReason = payload.message?.endedReason || 'completed';
      const durationSeconds = call?.duration ? Math.round(call.duration) : 0;

      // Update the call record
      const { error: updateError } = await supabase
        .from('calls')
        .update({
          call_status: 'completed',
          ended_at: new Date().toISOString()
        })
        .eq('id', callRecord.id);

      if (updateError) {
        console.error('Error updating call record:', updateError);
      } else {
        console.log('Call record updated successfully. Duration:', durationSeconds, 'seconds');
      }

      // Store transcript entries if available (only if not already inserted via conversation-update)
      // VAPI sends messages in different locations depending on event type
      const messages = payload.message?.messages
        || payload.message?.artifact?.messages
        || [];

      console.log('Found', messages.length, 'messages in payload');

      if (Array.isArray(messages) && messages.length > 0) {
        // Check if transcripts already exist (from conversation-update events)
        const { count: existingCount } = await supabase
          .from('transcripts')
          .select('*', { count: 'exact', head: true })
          .eq('call_id', callRecord.id);

        console.log('Existing transcripts for this call:', existingCount);

        // Only insert if no transcripts exist yet (avoid duplicates from conversation-update)
        if (!existingCount || existingCount === 0) {
          const transcriptEntries = messages
            .filter((m: any) => m.role && m.role !== 'system' && (m.message || m.content))
            .map((m: any, idx: number) => ({
              call_id: callRecord.id,
              speaker: (m.role === 'bot' || m.role === 'assistant') ? 'agent' : 'customer',
              text: m.message || m.content,
              created_at: new Date(Date.now() + idx).toISOString()
            }));

          console.log('Transcript entries to insert:', transcriptEntries.length);

          if (transcriptEntries.length > 0) {
            const { error: transcriptError } = await supabase
              .from('transcripts')
              .insert(transcriptEntries);

            if (transcriptError) {
              console.error('Error inserting transcripts:', transcriptError);
            } else {
              console.log('Inserted', transcriptEntries.length, 'transcript entries from end-of-call-report');
            }
          }
        } else {
          console.log('Transcripts already exist from conversation-update, skipping end-of-call-report insertion');
        }
      }
    }

    // Handle conversation-update events for LIVE transcripts during call
    if (messageType === 'conversation-update') {
      const vapiCallId = call?.id;
      const customerNumber = call?.customer?.number;
      const conversation = payload.message?.conversation || [];

      console.log('Conversation update for VAPI call:', vapiCallId, '| Messages:', conversation.length);

      if (vapiCallId && conversation.length > 0) {
        // Find call by vapi_call_id first, then by customer_number
        let callRecord = null;

        // Try vapi_call_id first (more reliable)
        const { data: callByVapiId } = await supabase
          .from('calls')
          .select('id')
          .eq('vapi_call_id', vapiCallId)
          .eq('call_status', 'in-progress')
          .limit(1)
          .single();

        if (callByVapiId) {
          callRecord = callByVapiId;
          console.log('Found call by vapi_call_id:', callRecord.id);
        } else if (customerNumber) {
          // Fallback to customer_number
          const { data: callByNumber } = await supabase
            .from('calls')
            .select('id')
            .eq('customer_number', customerNumber)
            .eq('call_status', 'in-progress')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (callByNumber) {
            callRecord = callByNumber;
            console.log('Found call by customer_number:', callRecord.id);

            // Update the call record with vapi_call_id for future lookups
            await supabase
              .from('calls')
              .update({ vapi_call_id: vapiCallId })
              .eq('id', callRecord.id);
          }
        }

        if (callRecord) {
          // Get existing transcript count for this call (for deduplication)
          const { count: existingCount } = await supabase
            .from('transcripts')
            .select('*', { count: 'exact', head: true })
            .eq('call_id', callRecord.id);

          const currentCount = existingCount || 0;
          console.log('Existing transcripts:', currentCount, '| New conversation length:', conversation.length);

          // Filter to only non-system messages
          const validMessages = conversation.filter((m: any) =>
            m.role && m.role !== 'system' && (m.content || m.message)
          );

          // Only insert NEW messages (those beyond what we already have)
          if (validMessages.length > currentCount) {
            const newMessages = validMessages.slice(currentCount);
            console.log('New messages to insert:', newMessages.length);

            const transcriptEntries = newMessages.map((m: any, idx: number) => ({
              call_id: callRecord.id,
              speaker: (m.role === 'bot' || m.role === 'assistant') ? 'agent' : 'customer',
              text: m.content || m.message,
              created_at: new Date(Date.now() + idx).toISOString() // Slight offset for ordering
            }));

            const { error: transcriptError } = await supabase
              .from('transcripts')
              .insert(transcriptEntries);

            if (transcriptError) {
              console.error('Error inserting live transcripts:', transcriptError);
            } else {
              console.log('Inserted', transcriptEntries.length, 'live transcript entries');
            }
          }
        } else {
          console.log('No in-progress call found for conversation-update');
        }
      }
    }

    // Handle status-update events - create inbound call record when call starts
    if (messageType === 'status-update') {
      const status = payload.message?.status;
      const customerNumber = call?.customer?.number;
      console.log('Status update:', status, 'for', customerNumber, '| Call type:', callType);

      // For inbound calls with "in-progress" status, create the call record immediately
      if (isInbound && status === 'in-progress' && customerNumber) {
        console.log('Inbound call in-progress, checking if record exists...');

        // Check if we already have a record for this call
        const { data: existingCall } = await supabase
          .from('calls')
          .select('id')
          .eq('customer_number', customerNumber)
          .eq('call_status', 'in-progress')
          .limit(1)
          .single();

        if (!existingCall) {
          console.log('No existing record, creating inbound call record...');

          // Find agent dynamically - first find PINK company, then get its agent
          let agentId = null;

          const { data: companies } = await supabase
            .from('companies')
            .select('id, name')
            .ilike('name', '%pink%')
            .limit(1);

          if (companies && companies.length > 0) {
            const { data: agents } = await supabase
              .from('agents')
              .select('id, name')
              .eq('company_id', companies[0].id)
              .limit(1);

            if (agents && agents.length > 0) {
              agentId = agents[0].id;
              console.log('Using agent:', agentId, agents[0].name);
            }
          }

          // Fallback
          if (!agentId) {
            const { data: fallbackAgents } = await supabase
              .from('agents')
              .select('id, name')
              .ilike('name', '%smith%')
              .limit(1);

            if (fallbackAgents && fallbackAgents.length > 0) {
              agentId = fallbackAgents[0].id;
            }
          }

          if (agentId) {
            const vapiCallId = call?.id;
            const { data: newCall, error: createError } = await supabase
              .from('calls')
              .insert({
                customer_number: customerNumber,
                agent_id: agentId,
                call_direction: 'inbound',
                call_status: 'in-progress',
                started_at: call?.startedAt || new Date().toISOString(),
                vapi_call_id: vapiCallId // Mark as VAPI call to distinguish from human agent calls
              })
              .select()
              .single();

            if (createError) {
              console.error('Error creating inbound call record:', createError);
            } else {
              console.log('Created inbound call record (LIVE):', newCall.id, 'vapi_call_id:', vapiCallId);
            }
          }
        } else {
          console.log('Inbound call record already exists:', existingCall.id);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('VAPI Webhook Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
