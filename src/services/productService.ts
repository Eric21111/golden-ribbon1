import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import type { Product, ProductInput } from '@/types/models';

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

export async function getCashierProductSellingPrices(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const uniqueIds = [...new Set(ids)];
  const { data, error } = await supabase.rpc('get_cashier_product_prices', {
    p_product_ids: uniqueIds,
  });
  if (error) throw error;
  if ((data ?? []).length !== uniqueIds.length) {
    throw new Error('A product is no longer available in this branch catalog.');
  }
  return Object.fromEntries(
    (data ?? []).map((row) => [row.product_id, Number(row.selling_price)]),
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
