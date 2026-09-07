import { supabase } from '@/lib/supabase';
import type {
  Branch,
  BranchSalesReportItem,
  ManagerDashboardMetrics,
  OwnerDashboardMetrics,
  Product,
  ProductSalesReportItem,
  Profile,
  SaleStatus,
  Shift,
} from '@/types/models';

export type Sale = {
  id: string;
  sale_number: string;
  branch_id: string;
  shift_id: string;
  cashier_id: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_amount: number;
  status: SaleStatus;
  sold_at: string;
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
  product?: Product | null;
};

export type SaleWithRelations = Sale & {
  branch?: Branch | null;
  cashier?: Pick<Profile, 'id' | 'full_name'> | null;
  cashier_name?: string | null;
  shift?: Shift | null;
};

export type SaleDetails = Sale & {
  branch?: Branch | null;
  cashier?: Pick<Profile, 'id' | 'full_name'> | null;
  shift?: Shift | null;
  items: SaleItem[];
};

export type SaleRequest = {
  shiftId: string;
  items: { product_id: string; quantity: number }[];
  amountPaid: string;
  key: string;
};

export interface SaleFilters {
  branchId?: string;
  cashierId?: string;
  date?: string; // YYYY-MM-DD
  startDate?: string; // ISO string
  endDate?: string; // ISO string
}

export async function confirmSale(request: SaleRequest): Promise<Sale> {
  const { data, error } = await supabase.rpc('confirm_sale', {
    p_shift_id: request.shiftId,
    p_items: request.items,
    p_amount_paid: request.amountPaid,
    p_idempotency_key: request.key,
  });
  if (error) throw error;
  return data;
}

export async function listShiftSales(shiftId: string): Promise<SaleWithRelations[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*, branch:branches(*), cashier:profiles!sales_cashier_id_fkey(id, full_name)')
    .eq('shift_id', shiftId)
    .order('sold_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as unknown as SaleWithRelations[];
}

export async function listSales(filters: SaleFilters = {}, page = 0): Promise<SaleWithRelations[]> {
  let query = supabase
    .from('sales')
    .select('*, branch:branches(*), cashier:profiles!sales_cashier_id_fkey(id, full_name)')
    .order('sold_at', { ascending: false });

  if (filters.branchId) {
    query = query.eq('branch_id', filters.branchId);
  }
  if (filters.cashierId) {
    query = query.eq('cashier_id', filters.cashierId);
  }

  if (filters.startDate && filters.endDate) {
    query = query.gte('sold_at', filters.startDate).lt('sold_at', filters.endDate);
  } else if (filters.date) {
    // Philippine timezone day boundary (UTC+8)
    const dayStart = `${filters.date}T00:00:00+08:00`;
    const nextDay = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('sold_at', dayStart).lt('sold_at', nextDay);
  }

  query = query.range(page * 50, page * 50 + 49);

  const { data, error } = await query;
  if (error) throw error;
  return data as unknown as SaleWithRelations[];
}

export async function getSale(id: string): Promise<SaleDetails> {
  const { data: saleData, error: saleError } = await supabase
    .from('sales')
    .select('*, branch:branches(*), cashier:profiles!sales_cashier_id_fkey(id, full_name), shift:shifts(*)')
    .eq('id', id)
    .single();
  if (saleError) throw saleError;

  const { data: itemsData, error: itemsError } = await supabase
    .from('sale_items')
    .select('*, product:products(*)')
    .eq('sale_id', id)
    .order('subtotal', { ascending: false });
  if (itemsError) throw itemsError;

  return {
    ...(saleData as unknown as SaleWithRelations),
    items: (itemsData as unknown as SaleItem[]) ?? [],
  };
}

export async function reportSalesByBranch(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string
): Promise<BranchSalesReportItem[]> {
  const { data, error } = await supabase.rpc('report_sales_by_branch', {
    p_range_type: rangeType,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return (data as unknown as BranchSalesReportItem[]) ?? [];
}

export async function reportProductSales(
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  branchId?: string,
  startDate?: string,
  endDate?: string
): Promise<ProductSalesReportItem[]> {
  const { data, error } = await supabase.rpc('report_product_sales', {
    p_range_type: rangeType,
    p_branch_id: branchId || null,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return (data as unknown as ProductSalesReportItem[]) ?? [];
}

export async function getOwnerDashboardMetrics(): Promise<OwnerDashboardMetrics> {
  const { data, error } = await supabase.rpc('get_owner_dashboard_metrics');
  if (error) throw error;
  return data as unknown as OwnerDashboardMetrics;
}

export async function getManagerDashboardMetrics(): Promise<ManagerDashboardMetrics> {
  const { data, error } = await supabase.rpc('get_manager_dashboard_metrics');
  if (error) throw error;
  return data as unknown as ManagerDashboardMetrics;
}

export async function getManagerRecentSales(limit = 5): Promise<SaleWithRelations[]> {
  const { data, error } = await supabase.rpc('get_manager_recent_sales', {
    p_limit: limit,
  });
  if (error) throw error;
  return (data as unknown as SaleWithRelations[]) ?? [];
}
