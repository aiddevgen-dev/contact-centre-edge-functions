import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    // Generate embeddings for all knowledge base entries that don't have them
    const { data: entries, error: fetchError } = await supabase.from('knowledge_base').select('id, title, content').is('embedding', null).eq('is_active', true);
    if (fetchError) {
      throw fetchError;
    }
    console.log(`Processing ${entries?.length || 0} knowledge base entries`);
    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({
        message: 'No entries to process',
        processed: 0,
        success: true
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    let processed = 0;
    for (const entry of entries){
      try {
        // Combine title and content for embedding
        const textToEmbed = `${entry.title}\n\n${entry.content}`;
        // Generate embedding using OpenAI
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: textToEmbed
          })
        });
        if (!embeddingResponse.ok) {
          console.error(`Failed to generate embedding for entry ${entry.id}`);
          continue;
        }
        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;
        // Update the knowledge base entry with the embedding
        const { error: updateError } = await supabase.from('knowledge_base').update({
          embedding
        }).eq('id', entry.id);
        if (updateError) {
          console.error(`Failed to update embedding for entry ${entry.id}:`, updateError);
        } else {
          processed++;
          console.log(`Generated embedding for: ${entry.title}`);
        }
      } catch (error) {
        console.error(`Error processing entry ${entry.id}:`, error);
      }
    }
    return new Response(JSON.stringify({
      message: `Successfully processed ${processed} entries`,
      processed,
      total: entries.length,
      success: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in generate-embeddings function:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
