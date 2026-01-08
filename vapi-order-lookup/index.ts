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
  try {
    const body = await req.json().catch(()=>({}));
    const { message = {} } = body;
    // Enhanced parameter extraction with multiple fallback paths
    const orderId = message?.parameters?.orderId || message?.parameters?.order_id || message?.orderId || message?.order_number || body.orderId || body.order_id;
    const email = message?.parameters?.email || message?.email || message?.customer?.email || body.email;
    console.log('VAPI Order Lookup:', {
      orderId,
      email,
      rawMessage: message
    });
    let orders = [];
    let searchAttempted = false;
    // Try order ID lookup with validation
    if (orderId && typeof orderId === 'string' && orderId.trim()) {
      searchAttempted = true;
      console.log('Attempting order lookup by ID:', orderId);
      try {
        const order = await getOrderById(orderId.trim());
        if (order) orders = [
          order
        ];
      } catch (error) {
        console.error('Error looking up order by ID:', error);
      }
    }
    // Try email lookup if no order found and email provided
    if (orders.length === 0 && email && typeof email === 'string' && email.trim()) {
      searchAttempted = true;
      console.log('Attempting order lookup by email:', email);
      try {
        orders = await getOrdersByEmail(email.trim());
      } catch (error) {
        console.error('Error looking up orders by email:', error);
      }
    }
    // Enhanced response with better messaging
    const response = {
      result: orders.map(formatOrderData),
      count: orders.length,
      searchAttempted,
      parameters: {
        orderId,
        email
      },
      message: generateResponseMessage(orders, orderId, email, searchAttempted)
    };
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in vapi-order-lookup:', error);
    return new Response(JSON.stringify({
      error: 'Failed to lookup order information',
      message: "I'm having trouble accessing order information right now. Could you please provide your order number (like JD1, JD2) or email address? I can help you find your order details once I have the right information.",
      suggestion: "Try saying 'My order number is JD1' or 'My email is customer@example.com'"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function getOrderById(orderId) {
  console.log('Getting order by ID:', orderId);
  // First try to find by order_number (JD1, JD2, etc.)
  let { data, error } = await supabase.from('orders').select(`
      *,
      order_items (
        *,
        products (*)
      ),
      users (*)
    `).eq('order_number', orderId).single();
  // If not found by order_number, try by UUID (for backward compatibility)
  if (error && error.code === 'PGRST116') {
    console.log('Order not found by order_number, trying UUID...');
    const result = await supabase.from('orders').select(`
        *,
        order_items (
          *,
          products (*)
        ),
        users (*)
      `).eq('id', orderId).single();
    data = result.data;
    error = result.error;
  }
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}
async function getOrdersByEmail(email) {
  console.log('Getting orders by email:', email);
  // First get the user ID
  const { data: userData } = await supabase.from('users').select('id').eq('email', email).single();
  if (!userData) return [];
  const { data, error } = await supabase.from('orders').select(`
      *,
      order_items (
        *,
        products (*)
      ),
      users (*)
    `).eq('user_id', userData.id).order('created_at', {
    ascending: false
  }).limit(5);
  if (error) throw error;
  return data || [];
}
function formatOrderData(order) {
  return {
    id: order.id,
    orderNumber: order.order_number || `ORD-${order.id.slice(-8)}`,
    status: order.status,
    total: order.total_amount,
    totalFormatted: `$${parseFloat(order.total_amount).toFixed(2)}`,
    created: new Date(order.created_at).toLocaleDateString(),
    updated: new Date(order.updated_at).toLocaleDateString(),
    shippingAddress: order.shipping_address,
    customer: {
      name: order.users?.full_name,
      email: order.users?.email
    },
    items: order.order_items?.map((item)=>({
        id: item.id,
        productName: item.products?.name,
        quantity: item.quantity,
        price: item.price,
        priceFormatted: `$${parseFloat(item.price).toFixed(2)}`,
        size: item.size,
        color: item.color,
        product: {
          category: item.products?.category,
          brand: item.products?.brand,
          description: item.products?.description
        }
      })) || [],
    itemCount: order.order_items?.length || 0,
    statusMessage: getStatusMessage(order.status)
  };
}
function generateResponseMessage(orders, orderId, email, searchAttempted) {
  if (orders.length > 0) {
    if (orders.length === 1) {
      return `Found your order ${orders[0].order_number || '#' + orders[0].id.slice(-8)}. ${getStatusMessage(orders[0].status)}`;
    } else {
      return `Found ${orders.length} orders for ${email}. Your most recent order is ${orders[0].order_number || '#' + orders[0].id.slice(-8)}`;
    }
  } else if (searchAttempted) {
    if (orderId && email) {
      return `I couldn't find any orders with ID "${orderId}" or for email "${email}". Please double-check your order number (like JD1, JD2) or email address.`;
    } else if (orderId) {
      return `I couldn't find an order with ID "${orderId}". Please check your order number - it should look like JD1, JD2, etc. You can also try providing your email address.`;
    } else if (email) {
      return `I couldn't find any orders for "${email}". Please verify your email address or try providing your order number instead.`;
    }
  }
  return "I need either your order number (like JD1, JD2) or email address to look up your order. Could you please provide one of these?";
}
function getStatusMessage(status) {
  switch(status){
    case 'pending':
      return 'Your order is being processed';
    case 'confirmed':
      return 'Your order has been confirmed and is being prepared';
    case 'shipped':
      return 'Your order has been shipped and is on the way';
    case 'delivered':
      return 'Your order has been delivered';
    case 'cancelled':
      return 'Your order has been cancelled';
    default:
      return `Order status: ${status}`;
  }
}
