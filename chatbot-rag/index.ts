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
// Helper function to generate embeddings
async function generateEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text
    })
  });
  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }
  const data = await response.json();
  return data.data[0].embedding;
}
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { message, sessionId, userId, isHandoverResponse } = await req.json();
    if (!message || !sessionId) {
      throw new Error('Message and session ID are required');
    }
    console.log('Processing message:', message, 'for session:', sessionId, 'user:', userId || 'anonymous');
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    // Check if session is escalated or assigned to a human agent
    // Skip this check if it's a handover response from an agent
    const { data: sessionData, error: sessionError } = await supabase.from('chat_sessions').select('status, agent_id').eq('id', sessionId).single();
    if (sessionError) {
      console.error('Error fetching session:', sessionError);
      throw new Error('Failed to verify session status');
    }
    console.log('Session status check:', {
      sessionId,
      status: sessionData.status,
      agent_id: sessionData.agent_id,
      isHandoverResponse
    });
    // If session is escalated or assigned to human agent AND it's not a handover response, don't process AI response
    if (!isHandoverResponse && (sessionData.status === 'escalated' || sessionData.status === 'closed' || sessionData.agent_id)) {
      console.log('Session is handled by human agent, skipping AI response');
      // Save user message to database but don't generate AI response
      const { error: userMessageError } = await supabase.from('messages').insert({
        session_id: sessionId,
        sender_type: 'user',
        content: message,
        metadata: {
          user_id: userId || null,
          blocked_ai_response: true
        }
      });
      if (userMessageError) {
        console.error('Error saving user message:', userMessageError);
      }
      return new Response(JSON.stringify({
        message: "A human agent is now handling your chat. They will respond to you shortly.",
        needsEscalation: false,
        humanTakeover: true,
        contextUsed: {
          message: 'Human agent takeover - AI response blocked'
        },
        success: true
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Generate embedding for the user's message for semantic search
    const queryEmbedding = await generateEmbedding(message);
    // Search knowledge base using vector similarity
    const { data: knowledgeResults, error: knowledgeError } = await supabase.rpc('search_knowledge_base', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: 3
    });
    if (knowledgeError) {
      console.error('Error searching knowledge base:', knowledgeError);
    }
    // Get user-specific context if user is logged in
    let userContext = '';
    let userOrders = '';
    let userCart = '';
    if (userId) {
      try {
        // Fetch user's recent orders/accounts
        const { data: orders, error: ordersError } = await supabase.from('orders').select(`
            id,
            order_number,
            total_amount,
            status,
            created_at,
            order_items (
              quantity,
              price,
              size,
              color,
              product:products (
                name,
                brand
              )
            )
          `).eq('user_id', userId).order('created_at', {
          ascending: false
        }).limit(5);
        if (orders && orders.length > 0) {
          userOrders = orders.map((order)=>`Account ${order.order_number || '#' + order.id.slice(-8)}: $${order.total_amount} - ${order.status} - ${new Date(order.created_at).toLocaleDateString()}`).join('\n');
        }
        userContext = `
Customer Account Information:
${userOrders ? `Recent Accounts:\n${userOrders}\n` : 'No account records found.\n'}`;
      } catch (userError) {
        console.error('Error fetching user context:', userError);
      }
    }
    // Get session history for context
    const { data: messages, error: messagesError } = await supabase.from('messages').select('content, sender_type').eq('session_id', sessionId).order('created_at', {
      ascending: true
    }).limit(10);
    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
    }
    // Build comprehensive context
    const knowledgeContext = knowledgeResults?.map((kb)=>`${kb.title}: ${kb.content} (Category: ${kb.category})`).join('\n\n') || '';
    const conversationHistory = messages?.map((m)=>`${m.sender_type}: ${m.content}`).join('\n') || '';
    // Determine if escalation is needed
    const escalationKeywords = [
      'complaint',
      'problem',
      'issue',
      'manager',
      'speak to human',
      'human agent',
      'dissatisfied',
      'angry',
      'legal',
      'lawyer',
      'solicitor',
      'ombudsman'
    ];
    const needsEscalation = escalationKeywords.some((keyword)=>message.toLowerCase().includes(keyword));
    // Create enhanced AI prompt with Complete Credit Solutions context
    const isHandover = isHandoverResponse || false;
    const systemPrompt = `You are a helpful customer service assistant for Complete Credit Solutions (CCS), an Australian debt collection and financial recovery company. You have access to comprehensive information including knowledge base and customer-specific data.

${isHandover ? 'IMPORTANT: You are resuming this conversation after a human agent has handed the chat back to you. Welcome the customer back naturally and ask how you can continue to help them.' : ''}

ABOUT COMPLETE CREDIT SOLUTIONS:
Complete Credit Solutions (CCS) is a dynamic and forward-thinking Australian owned and operated business. We are fuelled by a sense of compassion for customers facing financial hardships. Through a sustainable and customer-centric approach, CCS fosters meaningful relationships with customers, clients, suppliers, and staff.

OUR VALUES:
- Collaboration: We work together to achieve the best results
- Customer Focus: We prioritise delivering sustainable and meaningful change to customers' financial situation
- Accountability: We are proud of how we conduct ourselves
- Excellence: We hold ourselves to the highest standards
- Continuous Improvement: We pursue new ideas that drive positive change

CONTACT INFORMATION:
- Phone: 1300 930 070 or (02) 8836 4300
- International: +61 2 8836 4300
- Email: info@completecredit.com.au
- Complaints: complaints@completecredit.com.au
- Hardship: hardship@completecredit.com.au
- Insolvency: insolvency@completecredit.com.au
- Address: PO Box W167, Parramatta Westfield Parramatta NSW 2150
- Office Hours: Mon-Fri: 8:30am – 5pm AEDT/AEST

INTERPRETER SERVICES:
- TIS National (Translating and Interpreting Service): Call 131 450 for phone interpreters in 150+ languages
- National Relay Service (NRS) for deaf/hard of hearing: TTY users call 133 677, Speak and Listen call 1300 555 727

CAPABILITIES:
1. Payment arrangement inquiries and guidance
2. Financial hardship assistance information
3. Account balance and status inquiries
4. Complaint handling and escalation
5. General information about CCS policies and services
6. Guidance on authorising representatives

FINANCIAL HARDSHIP ASSISTANCE:
CCS understands that unexpected circumstances can affect financial positions. We focus on helping customers meet obligations within their current financial means. Options available include:
- Flexible payment arrangements
- Hardship application submission
- Working with customers respectfully to achieve the best outcome

${knowledgeContext ? `KNOWLEDGE BASE:\n${knowledgeContext}\n` : ''}

${userContext ? `${userContext}` : 'Customer is not logged in - cannot access account information.\n'}

CONVERSATION HISTORY:
${conversationHistory}

GUIDELINES:
- Be friendly, professional, and empathetic - remember customers may be experiencing financial stress
- Use specific information from the knowledge base when relevant
- Reference customer's account information when answering questions
- For account inquiries, use the provided account information if available
- If customer asks about specific accounts but isn't logged in, suggest they log in
- Always mention our hardship assistance options when customers express financial difficulty
- Keep responses concise but helpful
- If you don't have specific information, be honest and offer alternatives
- Never be judgmental about financial situations
- Emphasize that CCS is here to help find solutions
${isHandover ? '- Welcome the customer back warmly and seamlessly continue the conversation' : ''}

${needsEscalation && !isHandover ? 'IMPORTANT: The customer seems to need human assistance. Acknowledge their concern and suggest connecting them with a human agent or directing them to the appropriate email address.' : ''}`;
    // Call OpenAI API with enhanced model
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 600,
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    const aiResponse = await response.json();
    const aiMessage = aiResponse.choices[0].message.content;
    console.log('AI response:', aiMessage);
    // Skip saving user message if this is a handover response
    if (!isHandoverResponse) {
      // Save user message to database
      const { error: userMessageError } = await supabase.from('messages').insert({
        session_id: sessionId,
        sender_type: 'user',
        content: message,
        metadata: {
          user_id: userId || null
        }
      });
      if (userMessageError) {
        console.error('Error saving user message:', userMessageError);
      }
    }
    // Save AI response to database
    const { error: aiMessageError } = await supabase.from('messages').insert({
      session_id: sessionId,
      sender_type: 'ai',
      content: aiMessage,
      metadata: {
        escalation_suggested: needsEscalation,
        knowledge_base_results: knowledgeResults?.length || 0,
        user_context_used: !!userId,
        has_user_orders: !!userOrders
      }
    });
    if (aiMessageError) {
      console.error('Error saving AI message:', aiMessageError);
    }
    return new Response(JSON.stringify({
      message: aiMessage,
      needsEscalation,
      contextUsed: {
        knowledgeBase: knowledgeResults?.length || 0,
        userOrders: userOrders ? 'yes' : 'no'
      },
      success: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in chatbot-rag function:', error);
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
