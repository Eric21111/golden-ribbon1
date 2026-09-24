import { supabase } from '@/lib/supabase';
import { formatCatalogPrice } from '@/lib/format';
import { cartLineKey } from '@/lib/money';
import type { Database } from '@/types/database';
import type { Product, ProductInput, ProductVariant } from '@/types/models';

type ProductInsert = Database['public']['Tables']['products']['Insert'];

interface ProductFilters {
  search?: string;
  activeOnly?: boolean;
}

export async function listProducts(filters: ProductFilters = {}): Promise<Product[]> {
  let query = supabase.from('products').select('*').order('name');
  const search = filters.search?.trim();

  if (filters.activeOnly) query = query.eq('is_active', true);
  if (search) {
    const safeSearch = search.replace(/[,%()]/g, ' ').trim();
    if (safeSearch) query = query.or(`name.ilike.%${safeSearch}%,sku.ilike.%${safeSearch}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getProduct(id: string): Promise<Product> {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Refreshes checkout prices for cart lines (product + optional variant). Keyed by cartLineKey. */
export async function getCashierLineSellingPrices(
  lines: Array<{ product_id: string; variant_id: string | null }>,
): Promise<Record<string, number>> {
  if (!lines.length) return {};
  const { data, error } = await supabase.rpc('get_cashier_line_prices', {
    p_lines: lines.map(({ product_id, variant_id }) => ({ product_id, variant_id })),
  });
  if (error) throw error;
  if ((data ?? []).length !== lines.length) {
    throw new Error('A product or variant is no longer available in this branch catalog.');
  }
  return Object.fromEntries(
    (data ?? []).map((row) => [cartLineKey(row.product_id, row.variant_id), Number(row.selling_price)]),
  );
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const values: ProductInsert = { ...input, sku: input.sku.trim().toUpperCase() };
  const { data, error } = await supabase
    .from('products')
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
  const values: Partial<ProductInsert> = { ...input, sku: input.sku.trim().toUpperCase() };
  const { data, error } = await supabase
    .from('products')
    .update(values)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listProductVariants(productId: string): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, default_price: Number(row.default_price) }));
}

export async function configureProductVariants(
  productId: string,
  variants: Array<{ name: string; default_price: number; is_active: boolean }>,
): Promise<void> {
  const { error } = await supabase.rpc('configure_product_variants', {
    p_product_id: productId,
    p_variants: variants.map((variant) => ({
      name: variant.name,
      default_price: formatCatalogPrice(variant.default_price),
      is_active: variant.is_active,
    })),
  });
  if (error) throw error;
}
