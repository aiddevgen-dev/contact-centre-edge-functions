import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  // Handle GET requests for testing
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const phoneNumber = url.searchParams.get('phoneNumber');
    if (phoneNumber) {
      console.log('=== GET Request Test ===');
      console.log('Phone Number from URL:', phoneNumber);
      try {
        const customerData = await lookupByPhone(phoneNumber);
        const response = {
          result: customerData ? formatCustomerData(customerData) : null,
          searchMethod: 'phone',
          searchAttempted: true,
          parameters: {
            phoneNumber
          },
          message: generateCustomerResponseMessage(customerData, {
            phoneNumber
          }, true)
        };
        return new Response(JSON.stringify(response), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      } catch (error) {
        console.error('GET request error:', error);
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
    }
    return new Response('GET request - provide phoneNumber as query parameter', {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain'
      }
    });
  }
  try {
    const body = await req.json().catch(()=>({}));
    console.log('=== VAPI Customer Lookup Request ===');
    console.log('Full request body:', JSON.stringify(body, null, 2));
    console.log('Request headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
    const { message = {} } = body;
    // Extract parameters from VAPI function call arguments
    const toolCall = message?.toolCalls?.[0] || message?.tool_calls?.[0];
    const functionArgs = toolCall?.function?.arguments || body.arguments || {};
    console.log('Tool call data:', JSON.stringify(toolCall, null, 2));
    console.log('Function arguments:', JSON.stringify(functionArgs, null, 2));
    // Enhanced parameter extraction with VAPI function arguments priority
    const phoneNumber = functionArgs?.phoneNumber || functionArgs?.phone || functionArgs?.phone_number || message?.call?.customer?.number || message?.call?.from || message?.phoneNumber || message?.phone || message?.parameters?.phone || message?.parameters?.phoneNumber || body.phoneNumber || body.phone || body.parameters?.phoneNumber || body.parameters?.phone;
    const email = functionArgs?.email || functionArgs?.emailAddress || message?.parameters?.email || message?.email || message?.customer?.email || body.email || body.parameters?.email;
    const orderId = functionArgs?.orderId || functionArgs?.order_id || functionArgs?.orderNumber || message?.parameters?.orderId || message?.parameters?.order_id || message?.orderId || body.orderId || body.parameters?.orderId;
    console.log('=== Extracted Parameters ===');
    console.log('Phone Number:', phoneNumber);
    console.log('Email:', email);
    console.log('Order ID:', orderId);
    console.log('Raw Message:', JSON.stringify(message, null, 2));
    let customerData = null;
    let searchMethod = null;
    let searchAttempted = false;
    if (phoneNumber && typeof phoneNumber === 'string' && phoneNumber.trim()) {
      searchMethod = 'phone';
      searchAttempted = true;
      console.log('Attempting customer lookup by phone:', phoneNumber);
      try {
        customerData = await lookupByPhone(phoneNumber.trim());
      } catch (error) {
        console.error('Error looking up customer by phone:', error);
      }
    }
    if (!customerData && email && typeof email === 'string' && email.trim()) {
      searchMethod = 'email';
      searchAttempted = true;
      console.log('Attempting customer lookup by email:', email);
      try {
        customerData = await lookupByEmail(email.trim());
      } catch (error) {
        console.error('Error looking up customer by email:', error);
      }
    }
    if (!customerData && orderId && typeof orderId === 'string' && orderId.trim()) {
      searchMethod = 'orderId';
      searchAttempted = true;
      console.log('Attempting customer lookup by order ID:', orderId);
      try {
        customerData = await lookupByOrderId(orderId.trim());
        if (customerData) {
          // Extract customer data from order data
          customerData = customerData.users || customerData;
        }
      } catch (error) {
        console.error('Error looking up customer by order ID:', error);
      }
    }
    const response = {
      result: customerData ? formatCustomerData(customerData) : null,
      searchMethod,
      searchAttempted,
      parameters: {
        phoneNumber,
        email,
        orderId
      },
      message: generateCustomerResponseMessage(customerData, {
        phoneNumber,
        email,
        orderId
      }, searchAttempted)
    };
    console.log('=== Final Response ===');
    console.log('Customer Data Found:', !!customerData);
    console.log('Search Method:', searchMethod);
    console.log('Response:', JSON.stringify(response, null, 2));
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in vapi-customer-lookup:', error);
    return new Response(JSON.stringify({
      error: 'Failed to lookup customer information',
      message: "I'm having trouble accessing customer information right now. Could you please provide your email address or order number? This will help me look up your account details and assist you better.",
      suggestion: "Try saying 'My email is customer@example.com' or 'My order number is JD1'"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return [];
  const cleaned = phone.trim();
  const variants = [
    cleaned
  ];
  // If phone starts with +, also try without +
  if (cleaned.startsWith('+')) {
    variants.push(cleaned.substring(1));
  } else {
    // If phone doesn't start with +, also try with +
    variants.push('+' + cleaned);
  }
  return variants;
}
async function lookupByPhone(phoneNumber) {
  console.log('Looking up by phone:', phoneNumber);
  const phoneVariants = normalizePhoneNumber(phoneNumber);
  console.log('Phone variants to try:', phoneVariants);
  for (const variant of phoneVariants){
    console.log('Trying phone variant:', variant);
    // Try users table first (primary source)
    const { data: userData, error: userError } = await supabase.from('users').select('*').eq('phone_number', variant).maybeSingle();
    if (userError) {
      console.error('Error looking up user:', userError);
    }
    if (userData) {
      console.log('Found user data with variant:', variant);
      // Get additional customer profile data if exists
      const { data: profileData } = await supabase.from('customer_profiles').select('*').eq('phone_number', variant).maybeSingle();
      // Merge user data with profile data, giving priority to user data
      return {
        ...profileData,
        ...userData,
        profileData
      };
    }
    // Fallback: Try customer_profiles if no user found
    const { data: profileData, error: profileError } = await supabase.from('customer_profiles').select('*').eq('phone_number', variant).maybeSingle();
    if (profileError) {
      console.error('Error looking up customer profile:', profileError);
    }
    if (profileData) {
      console.log('Found customer profile with variant:', variant);
      return profileData;
    }
  }
  console.log('No customer found with any phone variant');
  return null;
}
async function lookupByEmail(email) {
  console.log('Looking up by email:', email);
  const { data: userData, error: userError } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (userError) {
    console.error('Error looking up user by email:', userError);
  }
  if (userData) {
    console.log('Found user data by email:', email);
    // Get additional customer profile data if exists
    const { data: profileData } = await supabase.from('customer_profiles').select('*').eq('email', email).maybeSingle();
    // Merge user data with profile data, giving priority to user data
    return {
      ...profileData,
      ...userData,
      profileData
    };
  }
  // Fallback: Try customer_profiles if no user found
  const { data: profileData, error: profileError } = await supabase.from('customer_profiles').select('*').eq('email', email).maybeSingle();
  if (profileError) {
    console.error('Error looking up customer profile by email:', profileError);
  }
  if (profileData) {
    console.log('Found customer profile by email:', email);
    return profileData;
  }
  return null;
}
async function lookupByOrderId(orderId) {
  console.log('Looking up by order ID:', orderId);
  // First try by order_number (JD1, JD2, etc.) - case insensitive
  let { data: orderData } = await supabase.from('orders').select(`
      *,
      order_items (
        *,
        products (*)
      ),
      users (*)
    `).ilike('order_number', orderId).single();
  // If not found by order_number, try by UUID
  if (!orderData) {
    const result = await supabase.from('orders').select(`
        *,
        order_items (
          *,
          products (*)
        ),
        users (*)
      `).eq('id', orderId).single();
    orderData = result.data;
  }
  return orderData;
}
function generateCustomerResponseMessage(customerData, params, searchAttempted) {
  if (customerData) {
    const name = customerData.name || customerData.full_name || customerData.userData?.full_name;
    const email = customerData.email || customerData.userData?.email;
    return `Found customer information for ${name || email || 'this account'}. How can I help you today?`;
  } else if (searchAttempted) {
    const { phoneNumber, email, orderId } = params;
    if (phoneNumber || email || orderId) {
      return `I couldn't find customer information with the provided details. Please verify your ${phoneNumber ? 'phone number' : email ? 'email address' : 'order number'} or try a different lookup method.`;
    }
  }
  return "I can help you look up your account details using your email address or order number. Could you please provide one of these?";
}
function formatCustomerData(customerData) {
  const formatted = {
    name: customerData?.name || customerData?.full_name || customerData?.userData?.full_name || 'Unknown',
    email: customerData?.email || customerData?.userData?.email || 'Not provided',
    phone: customerData?.phone_number || customerData?.userData?.phone_number || 'Not provided',
    totalOrders: customerData?.total_orders || 0,
    totalSpent: customerData?.total_spent || 0,
    loyaltyTier: customerData?.loyalty_tier || 'bronze',
    recentOrders: [],
    callHistory: customerData?.call_history_count || 0,
    lastInteraction: customerData?.last_interaction_at || null,
    preferredLanguage: customerData?.preferred_language || 'en',
    customerNotes: customerData?.customer_notes || '',
    tags: customerData?.tags || [],
    communicationPreference: customerData?.communication_preference || 'email'
  };
  // Add order information if available
  if (customerData.order_items) {
    formatted.recentOrders = [
      {
        id: customerData.order_number || customerData.id,
        status: customerData.status,
        total: customerData.total_amount,
        items: customerData.order_items.map((item)=>({
            product: item.products?.name,
            quantity: item.quantity,
            price: item.price
          }))
      }
    ];
  }
  return formatted;
}
