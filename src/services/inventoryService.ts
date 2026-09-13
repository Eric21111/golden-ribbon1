import { supabase } from '@/lib/supabase';
import { listProducts } from '@/services/productService';
import type { Branch, BranchInventory, InventoryItem, Product } from '@/types/models';

type CashierPosInventoryRow = {
  branch_id: string;
  branch_name: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  selling_price: number;
  quantity_on_hand: number;
  updated_at: string | null;
};

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

export async function listCashierPosInventory(): Promise<InventoryItem[]> {
  const { data, error } = await supabase.rpc('list_cashier_pos_inventory');
  if (error) throw error;

  return ((data ?? []) as CashierPosInventoryRow[]).map((row) => {
    const branch: Branch = {
      id: row.branch_id,
      name: row.branch_name,
      code: '',
      address: null,
      is_main_branch: false,
      is_active: true,
      created_at: '',
      updated_at: '',
    };
    const product: Product = {
      id: row.product_id,
      name: row.product_name,
      sku: row.product_sku,
      description: null,
      selling_price: Number(row.selling_price),
      is_active: true,
      created_at: '',
      updated_at: '',
    };
    return {
      branch,
      product,
      quantity_on_hand: Number(row.quantity_on_hand),
      updated_at: row.updated_at,
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
