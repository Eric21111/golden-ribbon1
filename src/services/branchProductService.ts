import { formatCatalogPrice } from '@/lib/format';
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
    p_items: items.map((item) => ({
      ...item,
      selling_price: formatCatalogPrice(item.selling_price),
    })),
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
    p_variants: variants.map((variant) => ({
      ...variant,
      selling_price: formatCatalogPrice(variant.selling_price),
    })),
  });
  if (error) throw error;
}

/** Every selling branch's base price for one product — used to pre-fill the Edit wizard's pricing step. */
export async function listProductBranchPrices(productId: string): Promise<BranchProduct[]> {
  const { data, error } = await supabase.from('branch_products').select('*').eq('product_id', productId);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, selling_price: Number(row.selling_price) }));
}

/** Every selling branch's per-variant prices for one product — used to pre-fill the Edit wizard's pricing step. */
export async function listProductBranchVariantPrices(productId: string): Promise<BranchProductVariant[]> {
  const { data, error } = await supabase.from('branch_product_variants').select('*').eq('product_id', productId);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, selling_price: Number(row.selling_price) }));
}
