import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";
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
    // Parse Twilio transcription webhook data
    const formData = await req.formData();
    const webhookData = Object.fromEntries(formData.entries());
    console.log('Twilio Transcription Webhook:', webhookData);
    const { CallSid, TranscriptionText, TranscriptionStatus, SequenceNumber, Track, TranscriptionSid, Timestamp, PartialResult } = webhookData;
    // Find the call record
    const { data: callRecord } = await supabase.from('calls').select('*').eq('twilio_call_sid', CallSid).single();
    if (!callRecord) {
      console.error('Call not found for CallSid:', CallSid);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/xml'
        }
      });
    }
    // Determine the role based on the track
    // Track 'inbound_leg' = customer, Track 'outbound_leg' = agent
    const role = Track === 'inbound_leg' ? 'customer' : 'agent';
    // Enhanced transcription processing with better filtering
    if (TranscriptionText && TranscriptionText.trim().length > 0) {
      const transcriptText = TranscriptionText.trim();
      // Skip processing if it's a partial result and too short (less than 3 words)
      if (PartialResult === 'true' && transcriptText.split(' ').length < 3) {
        console.log('Skipping short partial result:', transcriptText);
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/xml'
          }
        });
      }
      // Enhanced duplicate detection
      const { data: recentTranscripts } = await supabase.from('transcripts').select('text, created_at').eq('call_id', callRecord.id).eq('role', role).order('created_at', {
        ascending: false
      }).limit(10);
      // Check for duplicates in the last 30 seconds
      const isDuplicate = recentTranscripts?.some((transcript)=>transcript.text.toLowerCase().trim() === transcriptText.toLowerCase().trim() && Date.now() - new Date(transcript.created_at).getTime() < 30000);
      // Skip low-quality transcripts
      const isLowQuality = transcriptText.length < 3 || /^(uh|um|ah|er|hmm|well|so|like|you know|thank you|thanks|ok|okay|yes|no|yeah|yep|bye|hello|hi)\s*[.!?]*\s*$/i.test(transcriptText) || /^[.!?]+\s*$/.test(transcriptText);
      if (isDuplicate || isLowQuality) {
        console.log(`Skipping ${isDuplicate ? 'duplicate' : 'low-quality'} transcript: ${transcriptText}`);
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/xml'
          }
        });
      }
      // Only insert completed transcriptions or longer partial results
      if (TranscriptionStatus === 'completed' || PartialResult === 'true' && transcriptText.split(' ').length >= 5) {
        const { error: insertError } = await supabase.from('transcripts').insert({
          call_id: callRecord.id,
          role: role,
          text: transcriptText,
          created_at: new Date().toISOString()
        });
        if (insertError) {
          console.error('Error inserting transcript:', insertError);
        } else {
          console.log(`Inserted ${role} transcript: ${transcriptText}`);
          // Generate AI suggestion for customer messages (only for completed transcripts)
          if (role === 'customer' && TranscriptionStatus === 'completed' && transcriptText.split(' ').length >= 4) {
            // Check if we generated a suggestion recently (within 15 seconds)
            const { data: recentSuggestions } = await supabase.from('suggestions').select('created_at').eq('call_id', callRecord.id).order('created_at', {
              ascending: false
            }).limit(1);
            const canGenerateSuggestion = !recentSuggestions?.length || Date.now() - new Date(recentSuggestions[0].created_at).getTime() > 15000;
            if (canGenerateSuggestion) {
              try {
                const { data: suggestionData, error: suggestionError } = await supabase.functions.invoke('generate-suggestion', {
                  body: {
                    callId: callRecord.id,
                    customerMessage: transcriptText
                  }
                });
                if (suggestionError) {
                  console.error('Error generating AI suggestion:', suggestionError);
                } else if (suggestionData?.suggestion && suggestionData.suggestion.length > 10) {
                  await supabase.from('suggestions').insert({
                    call_id: callRecord.id,
                    text: suggestionData.suggestion,
                    created_at: new Date().toISOString()
                  });
                  console.log('AI suggestion generated and inserted');
                }
              } catch (error) {
                console.error('Error generating AI suggestion:', error);
              }
            }
          }
        }
      }
    }
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/xml'
      }
    });
  } catch (error) {
    console.error('Error in twilio-transcription webhook:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
