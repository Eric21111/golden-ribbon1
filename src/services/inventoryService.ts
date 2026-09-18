import { supabase } from '@/lib/supabase';
import { listProducts } from '@/services/productService';
import type {
  Branch,
  BranchInventory,
  BranchProduct,
  InventoryItem,
  Product,
} from '@/types/models';

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
  const [products, balancesResult, catalogResult] = await Promise.all([
    listProducts({ activeOnly: branch.is_main_branch ? activeOnly : false }),
    supabase.from('branch_inventory').select('*').eq('branch_id', branch.id),
    branch.is_main_branch
      ? Promise.resolve({ data: [] as BranchProduct[], error: null })
      : supabase.from('branch_products').select('*').eq('branch_id', branch.id),
  ]);
  if (balancesResult.error) throw balancesResult.error;
  if (catalogResult.error) throw catalogResult.error;

  const balances = new Map(
    (balancesResult.data as BranchInventory[]).map((balance) => [balance.product_id, balance]),
  );
  const catalog = new Map(
    (catalogResult.data as BranchProduct[]).map((entry) => [entry.product_id, entry]),
  );

  return products.flatMap((product) => {
    const balance = balances.get(product.id);
    const branchProduct = catalog.get(product.id);

    if (
      !branch.is_main_branch &&
      !(branchProduct?.is_active && product.is_active) &&
      (balance?.quantity_on_hand ?? 0) <= 0
    ) {
      return [];
    }

    return [{
      branch,
      product: branchProduct
        ? { ...product, selling_price: Number(branchProduct.selling_price) }
        : product,
      quantity_on_hand: balance?.quantity_on_hand ?? 0,
      updated_at: balance?.updated_at ?? null,
      branch_product: branchProduct
        ? { ...branchProduct, selling_price: Number(branchProduct.selling_price) }
        : null,
    }];
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
      branch_product: {
        branch_id: row.branch_id,
        product_id: row.product_id,
        selling_price: Number(row.selling_price),
        is_active: true,
        created_at: '',
        updated_at: row.updated_at ?? '',
      },
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
