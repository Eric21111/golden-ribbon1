import { supabase } from '@/lib/supabase';
import type { BranchProduct, BranchProductVariant } from '@/types/models';

export async function listBranchProducts(
  branchId: string,
  activeOnly = false,
): Promise<BranchProduct[]> {
  let query = supabase
    .from('branch_products')
    .select('*')
    .eq('branch_id', branchId)
    .order('product_id');

  if (activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    selling_price: Number(row.selling_price),
  }));
}

export async function configureBranchProducts(
  branchId: string,
  items: Array<{ product_id: string; selling_price: number; is_active: boolean }>,
): Promise<void> {
  const { error } = await supabase.rpc('configure_branch_products', {
    p_branch_id: branchId,
    p_items: items,
  });
  if (error) throw error;
}

export async function listBranchProductVariants(
  branchId: string,
  productId: string,
): Promise<BranchProductVariant[]> {
  const { data, error } = await supabase
    .from('branch_product_variants')
    .select('*')
    .eq('branch_id', branchId)
    .eq('product_id', productId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    selling_price: Number(row.selling_price),
  }));
}

export async function configureBranchProductVariants(
  branchId: string,
  productId: string,
  variants: Array<{ name: string; selling_price: number; is_active: boolean }>,
): Promise<void> {
  const { error } = await supabase.rpc('configure_branch_product_variants', {
    p_branch_id: branchId,
    p_product_id: productId,
    p_variants: variants,
  });
  if (error) throw error;
}
