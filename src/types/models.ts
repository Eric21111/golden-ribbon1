export type UserRole = 'owner' | 'manager' | 'cashier';
export type BranchReceivingMode = 'counted' | 'cashier_confirm';
export type InventoryMovementType =
  | 'opening_stock'
  | 'transfer_out'
  | 'transfer_in'
  | 'adjustment'
  | 'sale'
  | 'return_out'
  | 'return_in'
  | 'waste'
  | 'unsold';
export type TransferStatus = 'draft' | 'pending_receipt' | 'received' | 'received_with_discrepancy' | 'cancelled';
export type DiscrepancyType = 'missing' | 'excess';
export type ShiftStatus = 'open' | 'closed';
export type SaleStatus = 'completed' | 'voided';
export type EmployeeRole = 'manager' | 'cashier';
export type InventoryMode = 'piece_stock' | 'kg_meal';
export type ClosingStockBehavior = 'keep_at_branch' | 'record_as_unsold';
export type CashReconciliationResult = 'exact' | 'shortage' | 'excess';

export type Branch = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  is_main_branch: boolean;
  is_active: boolean;
  /** How this selling branch receives stock transfers. Unused by the Main Branch. */
  receiving_mode: BranchReceivingMode;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileWithBranch = Profile & {
  branch: Branch | null;
};

export type Shift = {
  id: string;
  branch_id: string;
  cashier_id: string;
  status: ShiftStatus;
  started_at: string;
  ended_at: string | null;
  sales_cutoff_at?: string | null;
  created_at: string;
  updated_at: string;
  reconciliation_required?: boolean;
  inventory_reconciliation_required?: boolean;
};

export type CartItem = {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type EmployeeRecord = {
  id: string;
  full_name: string;
  email: string;
  role: EmployeeRole;
  branch_id: string;
  branch_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateEmployeeInput = {
  fullName: string;
  email: string;
  password: string;
  role: EmployeeRole;
  branchId: string;
  isActive: boolean;
};

export type UpdateEmployeeInput = {
  id: string;
  fullName: string;
  role: EmployeeRole;
  branchId: string;
  isActive: boolean;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  selling_price: number;
  is_active: boolean;
  inventory_mode: InventoryMode;
  closing_stock_behavior: ClosingStockBehavior;
  created_at: string;
  updated_at: string;
};

export type BranchInput = Pick<
  Branch,
  'name' | 'code' | 'address' | 'is_main_branch' | 'is_active' | 'receiving_mode'
>;

export type BranchInventory = {
  id: string;
  branch_id: string;
  product_id: string;
  quantity_on_hand: number;
  created_at: string;
  updated_at: string;
};

export type BranchProduct = {
  branch_id: string;
  product_id: string;
  selling_price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  name: string;
  default_price: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BranchProductVariant = {
  id: string;
  branch_id: string;
  product_id: string;
  name: string;
  selling_price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Lightweight shape returned by list_cashier_pos_inventory's variants column. */
export type PosVariant = {
  id: string;
  name: string;
  selling_price: number;
};

export type InventoryItem = {
  branch: Branch;
  product: Product;
  quantity_on_hand: number;
  updated_at: string | null;
  branch_product?: BranchProduct | null;
  /** Active branch price variants for this product. Empty when single-priced. */
  variants?: PosVariant[];
};

export type InventoryMovement = {
  id: string;
  branch_id: string;
  product_id: string;
  movement_type: InventoryMovementType;
  quantity: number;
  reference_type:
    | 'opening_stock'
    | 'stock_transfer'
    | 'adjustment'
    | 'sale'
    | 'stock_return'
    | 'shift_product_reconciliation';
  reference_id: string | null;
  created_by: string;
  notes: string | null;
  created_at: string;
};

export type InventoryMovementWithRelations = InventoryMovement & {
  branch: Branch | null;
  product: Product | null;
  created_by_profile: Pick<Profile, 'id' | 'full_name'> | null;
  transfer: Pick<StockTransfer, 'transfer_number'> | null;
};

export type StockTransfer = {
  id: string;
  transfer_number: string;
  from_branch_id: string;
  to_branch_id: string;
  status: TransferStatus;
  created_by: string;
  sent_by: string | null;
  received_by: string | null;
  sent_at: string | null;
  received_at: string | null;
  notes: string | null;
  send_idempotency_key: string | null;
  receive_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type StockTransferItem = {
  id: string;
  stock_transfer_id: string;
  product_id: string;
  quantity_sent: number;
  quantity_received: number | null;
  inventory_mode: InventoryMode;
  created_at: string;
  updated_at: string;
};

export type DiscrepancyResolutionStatus = 'open' | 'resolved';
export type DiscrepancyResolutionReason =
  | 'confirmed_shortage'
  | 'confirmed_excess'
  | 'counting_error'
  | 'encoding_error'
  | 'transfer_handling_issue'
  | 'return_handling_issue'
  | 'other';

export type TransferDiscrepancy = {
  id: string;
  stock_transfer_id: string;
  stock_transfer_item_id: string;
  product_id: string;
  quantity_expected: number;
  quantity_received: number;
  difference: number;
  discrepancy_type: DiscrepancyType;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  status: DiscrepancyResolutionStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_reason: DiscrepancyResolutionReason | null;
  resolution_note: string | null;
};

export type StockTransferSummary = StockTransfer & {
  from_branch: Branch | null;
  to_branch: Branch | null;
  items: Array<{ id: string }>;
};

export type StockTransferDetails = StockTransfer & {
  from_branch: Branch | null;
  to_branch: Branch | null;
  created_by_profile: Pick<Profile, 'id' | 'full_name'> | null;
  sent_by_profile: Pick<Profile, 'id' | 'full_name'> | null;
  received_by_profile: Pick<Profile, 'id' | 'full_name'> | null;
  items: Array<StockTransferItem & { product: Product | null }>;
  discrepancies: Array<TransferDiscrepancy & { product: Product | null }>;
};

export type CashierPendingTransferItem = {
  stock_transfer_item_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sent: number;
  inventory_mode: InventoryMode;
};

export type CashierPendingTransfer = {
  id: string;
  transfer_number: string;
  from_branch_id: string;
  from_branch_name: string;
  sent_at: string | null;
  notes: string | null;
  items: CashierPendingTransferItem[];
};

export type SendTransferInput = {
  destinationBranchId: string;
  items: Array<{ product_id: string; quantity_sent: number | string }>;
  notes: string | null;
  idempotencyKey: string;
};

export type ReceiveTransferInput = {
  transferId: string;
  items: Array<{ stock_transfer_item_id: string; quantity_received: number }>;
  notes: string | null;
  idempotencyKey: string;
};

export type ShiftSummary = {
  id: string;
  branch_id: string;
  branch_name: string;
  cashier_id: string;
  cashier_name: string;
  status: ShiftStatus;
  started_at: string;
  ended_at: string | null;
  completed_transaction_count: number;
  total_sales: number;
  leftover_return_id?: string | null;
};

export type ShiftProductReconResult = 'exact' | 'shortage' | 'excess';

export type ShiftCloseProductPreview = {
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string | null;
  closing_stock_behavior: ClosingStockBehavior;
  opening_quantity: number;
  received_quantity: number;
  outgoing_quantity: number;
  sold_quantity: number;
  adjustment_quantity: number;
  system_balance_before_waste: number;
};

export type ShiftClosePreview = {
  shift_id: string;
  branch_id: string;
  started_at: string;
  ended_at: string | null;
  sales_cutoff_at: string | null;
  inventory_reconciliation_required: boolean;
  reconciliation_required: boolean;
  mode: 'pcs_inventory_cash' | 'legacy_cash_only';
  expected_cash: number;
  products: ShiftCloseProductPreview[];
  status: 'pending';
};

/** Returned by begin_cashier_shift_close when remittance is already complete. */
export type ShiftCloseAlreadyFinalized = {
  shift_id: string;
  branch_id: string;
  started_at: string;
  ended_at: string | null;
  sales_cutoff_at: string | null;
  inventory_reconciliation_required: false;
  reconciliation_required: false;
  mode: 'pcs_inventory_cash' | 'legacy_cash_only';
  expected_cash: number;
  actual_cash: number;
  difference: number;
  result: CashReconciliationResult;
  products: ShiftCloseProductSummary[];
  status: 'reconciled';
  message?: string;
};

export type ShiftCloseBeginResult = ShiftClosePreview | ShiftCloseAlreadyFinalized;

export type PendingShiftReconciliation = ShiftClosePreview;

export type ShiftCloseProductSummary = {
  product_id: string;
  expected_remaining: number;
  actual_remaining: number;
  waste_quantity: number;
  discrepancy: number;
  result: ShiftProductReconResult;
  unsold_quantity: number;
  carried_quantity: number;
};

export type ShiftCloseFinalizeProduct = {
  product_id: string;
  actual_remaining: string | number;
  waste_quantity?: string | number;
};

export type ShiftCloseResult = {
  shift_id: string;
  expected_cash: number;
  actual_cash: number;
  difference: number;
  result: CashReconciliationResult;
  products?: ShiftCloseProductSummary[];
  status: 'reconciled';
  idempotent?: boolean;
  shift_status?: 'closed';
};

export type ShiftRemittanceRow = {
  business_date: string;
  shift_id: string;
  branch_id: string;
  branch_name: string;
  cashier_id: string;
  cashier_name: string;
  started_at: string;
  ended_at: string | null;
  status: 'pending' | 'reconciled';
  expected_cash: number;
  actual_cash: number | null;
  difference: number | null;
  result: CashReconciliationResult | null;
  reconciled_at: string | null;
};

export type ShiftRemittanceDay = {
  business_date: string;
  expected_cash: number;
  actual_remitted: number | null;
  total_shortage: number;
  total_excess: number;
  reconciled_shift_count: number;
  pending_shift_count: number;
  pending_expected_cash: number;
  shifts: ShiftRemittanceRow[];
};

export type ShiftRemittanceReport = {
  days: ShiftRemittanceDay[];
};

export type ShiftWasteStatus = 'waste_recorded' | 'no_waste' | 'pending';

export type ShiftWasteOccurrenceRow = {
  /** Present when enriched from shift_waste_occurrences; null/omitted for RPC-only legacy rows. */
  occurrence_id?: string | null;
  product_id: string;
  product_name: string;
  recorded_at: string;
  recorded_by: string;
  note: string | null;
  /** Quantified PCS from 7C; null for legacy occurrence-only rows. */
  quantity?: number | null;
};

export type ShiftCloseReportProduct = {
  id: string;
  shift_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string | null;
  closing_stock_behavior: ClosingStockBehavior;
  opening_quantity: number;
  received_quantity: number;
  outgoing_quantity: number;
  sold_quantity: number;
  waste_quantity: number;
  adjustment_quantity: number;
  expected_remaining: number;
  actual_remaining: number;
  discrepancy: number;
  unsold_quantity: number;
  carried_quantity: number;
  result: ShiftProductReconResult;
  reconciled_at: string;
};

export type ShiftCloseReportDetail = {
  shift_id: string;
  branch_id: string;
  branch_name: string;
  cashier_id: string;
  cashier_name: string;
  started_at: string;
  ended_at: string | null;
  sales_cutoff_at: string | null;
  inventory_reconciliation_required: boolean;
  reconciliation_required: boolean;
  cash_status: 'pending' | 'reconciled';
  expected_cash: number;
  actual_cash: number | null;
  difference: number | null;
  cash_result: CashReconciliationResult | null;
  reconciled_at: string | null;
  products: ShiftCloseReportProduct[];
};

export type ShiftWasteShiftRow = {
  shift_id: string;
  business_date: string;
  branch_id: string;
  branch_name: string;
  cashier_id: string;
  cashier_name: string;
  started_at: string;
  ended_at: string | null;
  waste_status: ShiftWasteStatus;
  occurrences: ShiftWasteOccurrenceRow[];
};

export type ShiftWasteDay = {
  business_date: string;
  occurrence_count: number;
  distinct_product_count: number;
  shifts: ShiftWasteShiftRow[];
};

export type ShiftWasteReport = {
  days: ShiftWasteDay[];
};

export type BranchSalesReportItem = {
  branch_id: string;
  branch_name: string;
  transaction_count: number;
  total_sales: number;
};

export type BranchDailySalesItem = {
  business_date: string;
  transaction_count: number;
  total_sales: number;
};

export type ProductSalesReportItem = {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sold: number;
  total_revenue: number;
};

export type OwnerDashboardMetrics = {
  today_sales: number;
  today_transactions: number;
  today_units_sold: number;
  active_products_count: number;
  pending_transfers_count: number;
  in_transit_returns_count: number;
  transfer_discrepancies_count: number;
  return_discrepancies_count: number;
};

export type OwnerDailyProductSummaryItem = {
  product_id: string;
  product_name: string;
  quantity_sold: number;
  quantity_returned: number;
  revenue: number;
  returned_declared_qty: number;
  returned_received_qty: number;
  return_missing_qty: number;
  return_excess_qty: number;
};

export type ManagerDashboardMetrics = {
  today_sales: number;
  today_transactions: number;
  current_inventory_count: number;
  pending_incoming_transfers_count: number;
  returns_in_transit_count: number;
};

export type BranchPerformanceItem = {
  branch_id: string;
  branch_name: string;
  transaction_count: number;
  total_sales: number;
  quantity_sold: number;
  transfer_missing_qty: number;
  transfer_excess_qty: number;
  return_missing_qty: number;
  return_excess_qty: number;
  total_missing_qty: number;
  total_excess_qty: number;
};

export type BranchPerformanceProductSold = {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sold: number;
  total_revenue: number;
};

export type BranchPerformanceInventoryItem = {
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_on_hand: number;
};

export type BranchPerformanceTransferDiscrepancy = {
  id: string;
  stock_transfer_id: string;
  transfer_number: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_expected: number;
  quantity_received: number;
  difference: number;
  discrepancy_type: 'missing' | 'excess';
  created_at: string;
  notes: string | null;
};

export type BranchPerformanceReturnDiscrepancy = {
  id: string;
  stock_return_id: string;
  return_number: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_expected: number;
  quantity_received: number;
  difference: number;
  discrepancy_type: 'missing' | 'excess';
  created_at: string;
  notes: string | null;
};

export type BranchPerformanceRecentTransfer = {
  id: string;
  transfer_number: string;
  status: string;
  sent_at: string | null;
  received_at: string | null;
  items_count: number;
};

export type BranchPerformanceRecentReturn = {
  id: string;
  return_number: string;
  status: string;
  returned_at: string | null;
  received_at: string | null;
  items_count: number;
};

export type BranchPerformanceDetails = {
  branch: { id: string; name: string };
  metrics: {
    transaction_count: number;
    total_sales: number;
    quantity_sold: number;
    transfer_missing_qty: number;
    transfer_excess_qty: number;
    return_missing_qty: number;
    return_excess_qty: number;
    total_missing_qty: number;
    total_excess_qty: number;
  };
  current_inventory: BranchPerformanceInventoryItem[];
  products_sold: BranchPerformanceProductSold[];
  transfer_discrepancies: BranchPerformanceTransferDiscrepancy[];
  return_discrepancies: BranchPerformanceReturnDiscrepancy[];
  recent_transfers: BranchPerformanceRecentTransfer[];
  recent_returns: BranchPerformanceRecentReturn[];
};

export type TransferDiscrepancyReportItem = {
  id: string;
  transfer_id: string;
  transfer_number: string;
  branch_id: string;
  branch_name: string;
  from_branch_name?: string | null;
  to_branch_name?: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_sent: number;
  quantity_received: number;
  difference: number;
  discrepancy_type: 'missing' | 'excess';
  created_at: string;
  notes: string | null;
  status: DiscrepancyResolutionStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_reason: DiscrepancyResolutionReason | null;
  resolution_note: string | null;
  resolved_by_name: string | null;
};

export type ReturnDiscrepancyReportItem = {
  id: string;
  return_id: string;
  return_number: string;
  branch_id: string;
  branch_name: string;
  from_branch_name?: string | null;
  to_branch_name?: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_returned: number;
  quantity_received: number;
  difference: number;
  discrepancy_type: 'missing' | 'excess';
  created_at: string;
  notes: string | null;
  status: DiscrepancyResolutionStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_reason: DiscrepancyResolutionReason | null;
  resolution_note: string | null;
  resolved_by_name: string | null;
};

export type InventoryReconciliationItem = {
  branch_id: string;
  branch_name: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  inventory_mode: InventoryMode;
  opening_stock: number;
  transfer_out: number;
  transfer_in: number;
  sale: number;
  return_out: number;
  adjustment: number;
  calculated_stock: number;
  current_stock: number;
  variance: number;
  has_reconciliation_issue: boolean;
  transfer_missing_qty: number;
  transfer_excess_qty: number;
  return_missing_qty: number;
  return_excess_qty: number;
};

export type DataArchiveStatus = 'prepared' | 'exported' | 'verified' | 'cleaned' | 'failed';

export type DataArchiveRecord = {
  id: string;
  period_start: string;
  period_end: string;
  status: DataArchiveStatus;
  sales_count: number;
  sale_items_count: number;
  shift_count: number;
  revenue_total: number;
  units_sold: number;
  export_generated_at: string | null;
  verified_at: string | null;
  cleaned_at: string | null;
  created_at: string;
};

export type ArchiveStatus = {
  retention_days: number;
  cutoff_at: string;
  oldest_detailed_sale_at: string | null;
  eligible_sales_count: number;
  eligible_sale_items_count: number;
  eligible_shift_count: number;
  estimated_records: number;
  last_successful_archive_at: string | null;
  next_archive_recommended_at: string;
  archive_due: boolean;
  reminder_visible: boolean;
  remind_after: string | null;
  database_size_bytes: number | null;
  active_archive: DataArchiveRecord | null;
};

export type ArchiveExportSale = {
  id: string;
  sale_number: string;
  branch_name: string;
  branch_id: string;
  cashier_id: string;
  cashier_name: string;
  shift_id: string;
  status: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_amount: number;
  sold_at: string;
};

export type ArchiveExportSaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type ArchiveExportShift = {
  id: string;
  cashier_id: string;
  cashier_name: string;
  branch_id: string;
  branch_name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
};

export type ArchiveManifest = {
  archive_id: string;
  package_name: string;
  start_date: string;
  end_date: string;
  generated_at: string;
  sales_row_count: number;
  sale_item_row_count: number;
  shift_row_count: number;
  revenue_total: number;
  units_sold: number;
};

export type ArchiveExportPackage = {
  archive: DataArchiveRecord;
  sales: ArchiveExportSale[];
  sale_items: ArchiveExportSaleItem[];
  shifts: ArchiveExportShift[];
  manifest: ArchiveManifest;
};

export const ARCHIVE_CLEANUP_CONFIRMATION = 'DELETE ARCHIVED DATA';

