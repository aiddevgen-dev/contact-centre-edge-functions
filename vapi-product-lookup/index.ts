import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
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
    const productQuery = message?.parameters?.product || message?.parameters?.query || message?.product || message?.query || body.product || body.query;
    const category = message?.parameters?.category || message?.category || body.category;
    const brand = message?.parameters?.brand || message?.brand || body.brand;
    console.log('VAPI Product Lookup:', {
      productQuery,
      category,
      brand,
      rawMessage: message
    });
    let products = [];
    let searchAttempted = false;
    let searchType = null;
    // Enhanced search with validation and error handling
    if (productQuery && typeof productQuery === 'string' && productQuery.trim()) {
      searchType = 'query';
      searchAttempted = true;
      console.log('Searching products by query:', productQuery);
      try {
        products = await searchProducts(productQuery.trim(), category, brand);
      } catch (error) {
        console.error('Error searching products by query:', error);
      }
    } else if (category && typeof category === 'string' && category.trim()) {
      searchType = 'category';
      searchAttempted = true;
      console.log('Searching products by category:', category);
      try {
        products = await getProductsByCategory(category.trim());
      } catch (error) {
        console.error('Error searching products by category:', error);
      }
    } else {
      // Get popular/featured products as fallback
      searchType = 'featured';
      searchAttempted = true;
      try {
        products = await getFeaturedProducts();
      } catch (error) {
        console.error('Error getting featured products:', error);
      }
    }
    const response = {
      result: products.map(formatProductData),
      count: products.length,
      searchType,
      searchAttempted,
      parameters: {
        productQuery,
        category,
        brand
      },
      message: generateProductResponseMessage(products, {
        productQuery,
        category,
        brand
      }, searchAttempted)
    };
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in vapi-product-lookup:', error);
    return new Response(JSON.stringify({
      error: 'Failed to lookup product information',
      message: "I'm having trouble searching for products right now. Could you please tell me what product you're looking for? You can mention a product name, category, or brand.",
      suggestion: "Try saying 'Show me shirts' or 'I'm looking for Nike products'"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function searchProducts(query, category, brand) {
  console.log('Searching products:', {
    query,
    category,
    brand
  });
  let queryBuilder = supabase.from('products').select('*').eq('is_active', true);
  // Search in name and description
  queryBuilder = queryBuilder.or(`name.ilike.%${query}%,description.ilike.%${query}%`);
  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }
  if (brand) {
    queryBuilder = queryBuilder.eq('brand', brand);
  }
  const { data, error } = await queryBuilder.order('stock_quantity', {
    ascending: false
  }).limit(10);
  if (error) throw error;
  return data || [];
}
async function getProductsByCategory(category) {
  console.log('Getting products by category:', category);
  const { data, error } = await supabase.from('products').select('*').eq('is_active', true).eq('category', category).order('stock_quantity', {
    ascending: false
  }).limit(10);
  if (error) throw error;
  return data || [];
}
async function getFeaturedProducts() {
  console.log('Getting featured products');
  const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('stock_quantity', {
    ascending: false
  }).limit(5);
  if (error) throw error;
  return data || [];
}
function generateProductResponseMessage(products, params, searchAttempted) {
  const { productQuery, category, brand } = params;
  if (products.length > 0) {
    if (productQuery) {
      return `Found ${products.length} product${products.length > 1 ? 's' : ''} matching "${productQuery}". ${products.length > 1 ? 'Here are your options:' : 'Here are the details:'}`;
    } else if (category) {
      return `Found ${products.length} product${products.length > 1 ? 's' : ''} in ${category}. ${products.length > 1 ? 'Here are your options:' : 'Here are the details:'}`;
    } else {
      return `Here are ${products.length} popular product${products.length > 1 ? 's' : ''} for you to browse:`;
    }
  } else if (searchAttempted) {
    if (productQuery || category) {
      const searchTerm = productQuery || category;
      return `I couldn't find any products ${searchTerm ? `matching "${searchTerm}"` : 'with those criteria'}. Would you like to try a different search term or browse a specific category?`;
    }
  }
  return "I can help you find products by name, category, or brand. What are you looking for today?";
}
function formatProductData(product) {
  const price = product?.price ? parseFloat(product.price) : 0;
  const stock = product?.stock_quantity || 0;
  return {
    id: product?.id || 'unknown',
    name: product?.name || 'Unknown Product',
    description: product?.description || 'No description available',
    price: price,
    category: product?.category || 'Uncategorized',
    brand: product?.brand || 'Unknown Brand',
    stock: stock,
    inStock: stock > 0,
    sizes: product?.sizes || [],
    colors: product?.colors || [],
    images: product?.images || [],
    availability: stock > 0 ? `In stock (${stock} available)` : 'Out of stock',
    priceFormatted: price > 0 ? `$${price.toFixed(2)}` : 'Price not available'
  };
}
