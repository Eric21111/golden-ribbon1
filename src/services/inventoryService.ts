import { supabase } from '@/lib/supabase';
import { listProducts } from '@/services/productService';
import type { Branch, BranchInventory, InventoryItem, InventoryMovementWithRelations } from '@/types/models';

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

export async function listInventoryMovements(branchId = ''): Promise<InventoryMovementWithRelations[]> {
  let query = supabase
    .from('inventory_movements')
    .select('*, branch:branches(*), product:products(*), created_by_profile:profiles!inventory_movements_created_by_fkey(id, full_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  const movements = data as unknown as Array<Omit<InventoryMovementWithRelations, 'transfer'>>;
  const transferIds = [...new Set(movements.flatMap((movement) =>
    movement.reference_type === 'stock_transfer' && movement.reference_id ? [movement.reference_id] : [],
  ))];
  const transferNumbers = new Map<string, string>();
  if (transferIds.length > 0) {
    const transfers = await supabase.from('stock_transfers').select('id, transfer_number').in('id', transferIds);
    if (transfers.error) throw transfers.error;
    transfers.data.forEach((transfer) => transferNumbers.set(transfer.id, transfer.transfer_number));
  }
  return movements.map((movement) => ({
    ...movement,
    transfer: movement.reference_id && transferNumbers.has(movement.reference_id)
      ? { transfer_number: transferNumbers.get(movement.reference_id) as string }
      : null,
  }));
}
