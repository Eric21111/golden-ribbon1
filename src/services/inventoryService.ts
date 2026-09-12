import { supabase } from '@/lib/supabase';
import { listProducts } from '@/services/productService';
import type { Branch, BranchInventory, InventoryItem } from '@/types/models';

export async function listInventory(branch: Branch, activeOnly = false): Promise<InventoryItem[]> {
  const [products, balancesResult] = await Promise.all([
    listProducts({ activeOnly }),
    supabase.from('branch_inventory').select('*').eq('branch_id', branch.id),
  ]);
  if (balancesResult.error) throw balancesResult.error;

  const balances = new Map(
    (balancesResult.data as BranchInventory[]).map((balance) => [balance.product_id, balance]),
  );

  return products.map((product) => {
    const balance = balances.get(product.id);
    return {
      branch,
      product,
      quantity_on_hand: balance?.quantity_on_hand ?? 0,
      updated_at: balance?.updated_at ?? null,
    };
  });
}

export async function initializeMainInventory(
  items: Array<{ product_id: string; quantity: number }>,
  notes: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('initialize_main_branch_inventory', { p_items: items, p_notes: notes });
  if (error) throw error;
}
