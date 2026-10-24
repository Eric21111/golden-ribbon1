import type {
  SalePricingProgram,
  SalePricingProgramSetting,
} from '@/features/pos/pricingPrograms';
import { getTodayRangeManila } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type {
  Branch,
  BranchDailySalesItem,
  BranchSalesReportItem,
  ManagerDashboardMetrics,
  OwnerDailyProductSummaryItem,
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
  pricing_program?: SalePricingProgram | null;
  catalog_subtotal?: number | null;
  discount_amount?: number | null;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  variant_id: string | null;
  variant_name: string | null;
  /** The drink chosen with this meal (Drink Choice), if its option includes one. */
  drink_product_id?: string | null;
  drink_name?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  catalog_unit_price?: number | null;
  discount_amount?: number | null;
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
  /** drink_product_id is only present for a meal option that includes a drink (Drink Choice). */
  items: { product_id: string; variant_id: string | null; quantity: number; drink_product_id?: string }[];
  amountPaid: string;
  key: string;
  pricingProgram?: SalePricingProgram;
};

function missingDeployedConfirmSale(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? '');
  return code === 'PGRST202' || /could not find the function public\.confirm_sale/i.test(message);
}

/** Current server pricing, drinks, and shared stock need the pending confirm_sale argument.
 * Until that migration is applied, a standard sale with no drink can still use the deployed function. */
export async function confirmSale(request: SaleRequest): Promise<Sale> {
  const pricingProgram = request.pricingProgram ?? 'standard';
  const full = await supabase.rpc('confirm_sale', {
    p_shift_id: request.shiftId,
    p_items: request.items,
    p_amount_paid: request.amountPaid,
    p_idempotency_key: request.key,
    p_pricing_program: pricingProgram,
  });
  const legacySafe = pricingProgram === 'standard' && request.items.every((item) => !item.drink_product_id);
  if (full.error && missingDeployedConfirmSale(full.error) && legacySafe) {
    const legacy = await supabase.rpc('confirm_sale', {
      p_shift_id: request.shiftId,
      p_items: request.items.map(({ product_id, variant_id, quantity }) => ({
        product_id,
        variant_id,
        quantity,
      })),
      p_amount_paid: request.amountPaid,
      p_idempotency_key: request.key,
    });
    if (legacy.error) throw legacy.error;
    return legacy.data;
  }
  if (full.error) throw full.error;
  return full.data;
}

/** Loads server pricing settings so POS preview matches confirm_sale. */
export async function listSalePricingProgramSettings(): Promise<
  Partial<Record<SalePricingProgram, SalePricingProgramSetting>>
> {
  const { data, error } = await supabase
    .from('sale_pricing_program_settings')
    .select('program, discount_percent, pricing_mode, fixed_amount, label');
  if (error) throw error;
  const map: Partial<Record<SalePricingProgram, SalePricingProgramSetting>> = {};
  for (const row of data ?? []) {
    const program = row.program as SalePricingProgram;
    map[program] = {
      program,
      discount_percent: row.discount_percent == null ? null : Number(row.discount_percent),
      pricing_mode: (row.pricing_mode as SalePricingProgramSetting['pricing_mode']) ?? null,
      fixed_amount: row.fixed_amount == null ? null : Number(row.fixed_amount),
      label: row.label,
    };
  }
  return map;
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

export async function listBranchSalesLog(
  branchId: string,
  rangeType: 'today' | 'custom' | 'all_time' = 'today',
  startDate?: string,
  endDate?: string,
): Promise<SaleWithRelations[]> {
  let query = supabase
    .from('sales')
    .select('*, cashier:profiles!sales_cashier_id_fkey(id, full_name)')
    .eq('branch_id', branchId)
    .eq('status', 'completed')
    .order('sold_at', { ascending: false })
    .limit(100);

  if (rangeType === 'today') {
    const { start, end } = getTodayRangeManila();
    query = query.gte('sold_at', start).lt('sold_at', end);
  } else if (rangeType === 'custom' && startDate && endDate) {
    query = query.gte('sold_at', startDate).lt('sold_at', endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as unknown as SaleWithRelations[];
}

export async function reportBranchDailySales(
  branchId: string,
  rangeType: 'today' | 'custom' | 'all_time' = 'all_time',
  startDate?: string,
  endDate?: string,
): Promise<BranchDailySalesItem[]> {
  const { data, error } = await supabase.rpc('report_branch_daily_sales', {
    p_branch_id: branchId,
    p_range_type: rangeType,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  if (error) throw error;
  return (data as unknown as BranchDailySalesItem[]) ?? [];
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

export async function getOwnerDailyProductSummary(): Promise<OwnerDailyProductSummaryItem[]> {
  const { data, error } = await supabase.rpc('get_owner_daily_product_summary');
  if (error) throw error;
  return (data as unknown as OwnerDailyProductSummaryItem[]) ?? [];
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
