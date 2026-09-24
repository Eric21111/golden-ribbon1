import type {
  Branch,
  BranchInventory,
  BranchProduct,
  BranchProductVariant,
  BranchReceivingMode,
  DiscrepancyResolutionReason,
  DiscrepancyResolutionStatus,
  DiscrepancyType,
  ProductVariant,
  EmployeeRecord,
  EmployeeRole,
  InventoryMovement,
  InventoryMovementType,
  Product,
  Profile,
  Shift,
  ShiftStatus,
  StockTransfer,
  StockTransferItem,
  TransferDiscrepancy,
  TransferStatus,
  UserRole,
  ShiftSummary,
  BranchDailySalesItem,
  BranchSalesReportItem,
  ProductSalesReportItem,
  OwnerDashboardMetrics,
  ManagerDashboardMetrics,
  BranchPerformanceItem,
  BranchPerformanceDetails,
  TransferDiscrepancyReportItem,
  ReturnDiscrepancyReportItem,
  InventoryReconciliationItem,
  OwnerDailyProductSummaryItem,
  ArchiveStatus,
  DataArchiveRecord,
  ArchiveExportPackage,
} from './models';

import type { Sale, SaleWithRelations } from '@/services/saleService';
import type {
  StockReturn,
  ReturnItem,
  ReturnStock,
  ReturnRequest,
  LeftoverReturnRequest,
  ReturnDiscrepancy,
  ReturnStatus,
} from './returns';

type BranchInsert = Omit<Branch, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type ProductInsert = Omit<Product, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};
type BranchInventoryInsert = Omit<BranchInventory, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type BranchProductInsert = Omit<BranchProduct, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};
type InventoryMovementInsert = Omit<InventoryMovement, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};
type StockTransferInsert = Omit<StockTransfer, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type StockTransferItemInsert = Omit<StockTransferItem, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type TransferDiscrepancyInsert = Omit<
  TransferDiscrepancy,
  'id' | 'created_at' | 'status' | 'resolved_by' | 'resolved_at' | 'resolution_reason' | 'resolution_note'
> & {
  id?: string;
  created_at?: string;
  status?: TransferDiscrepancy['status'];
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_reason?: TransferDiscrepancy['resolution_reason'];
  resolution_note?: string | null;
};
type ShiftInsert = Omit<Shift, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type Database = {
  public: {
    Tables: {
      stock_returns: { Row: StockReturn; Insert: never; Update: never; Relationships: [] };
      stock_return_items: { Row: ReturnItem; Insert: never; Update: never; Relationships: [
        { foreignKeyName: 'stock_return_items_stock_return_id_fkey'; columns: ['stock_return_id']; isOneToOne: false; referencedRelation: 'stock_returns'; referencedColumns: ['id'] },
      ] };
      return_discrepancies: {
        Row: ReturnDiscrepancy;
        Insert: never;
        Update: never;
        Relationships: [
          { foreignKeyName: 'return_discrepancies_stock_return_id_fkey'; columns: ['stock_return_id']; isOneToOne: false; referencedRelation: 'stock_returns'; referencedColumns: ['id'] },
          { foreignKeyName: 'return_discrepancies_stock_return_item_id_fkey'; columns: ['stock_return_item_id']; isOneToOne: true; referencedRelation: 'stock_return_items'; referencedColumns: ['id'] },
          { foreignKeyName: 'return_discrepancies_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
          { foreignKeyName: 'return_discrepancies_recorded_by_fkey'; columns: ['recorded_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ];
      };
      sales: { Row: Sale; Insert: never; Update: never; Relationships: [] };
      branches: {
        Row: Branch;
        Insert: BranchInsert;
        Update: Partial<BranchInsert>;
        Relationships: [];
      };
      products: {
        Row: Product;
        Insert: ProductInsert;
        Update: Partial<ProductInsert>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: Partial<ProfileInsert>;
        Relationships: [
          {
            foreignKeyName: 'profiles_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
        ];
      };
      shifts: {
        Row: Shift;
        Insert: ShiftInsert;
        Update: Partial<ShiftInsert>;
        Relationships: [
          { foreignKeyName: 'shifts_branch_id_fkey'; columns: ['branch_id']; isOneToOne: false; referencedRelation: 'branches'; referencedColumns: ['id'] },
          { foreignKeyName: 'shifts_cashier_id_fkey'; columns: ['cashier_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ];
      };
      branch_inventory: {
        Row: BranchInventory;
        Insert: BranchInventoryInsert;
        Update: Partial<BranchInventoryInsert>;
        Relationships: [
          { foreignKeyName: 'branch_inventory_branch_id_fkey'; columns: ['branch_id']; isOneToOne: false; referencedRelation: 'branches'; referencedColumns: ['id'] },
          { foreignKeyName: 'branch_inventory_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      branch_products: {
        Row: BranchProduct;
        Insert: BranchProductInsert;
        Update: Partial<BranchProductInsert>;
        Relationships: [
          { foreignKeyName: 'branch_products_branch_id_fkey'; columns: ['branch_id']; isOneToOne: false; referencedRelation: 'branches'; referencedColumns: ['id'] },
          { foreignKeyName: 'branch_products_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      branch_product_variants: {
        Row: BranchProductVariant;
        Insert: never;
        Update: never;
        Relationships: [
          { foreignKeyName: 'branch_product_variants_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      product_variants: {
        Row: ProductVariant;
        Insert: never;
        Update: never;
        Relationships: [
          { foreignKeyName: 'product_variants_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      inventory_movements: {
        Row: InventoryMovement;
        Insert: InventoryMovementInsert;
        Update: Partial<InventoryMovementInsert>;
        Relationships: [
          { foreignKeyName: 'inventory_movements_branch_id_fkey'; columns: ['branch_id']; isOneToOne: false; referencedRelation: 'branches'; referencedColumns: ['id'] },
          { foreignKeyName: 'inventory_movements_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'inventory_movements_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      stock_transfers: {
        Row: StockTransfer;
        Insert: StockTransferInsert;
        Update: Partial<StockTransferInsert>;
        Relationships: [
          { foreignKeyName: 'stock_transfers_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'stock_transfers_from_branch_id_fkey'; columns: ['from_branch_id']; isOneToOne: false; referencedRelation: 'branches'; referencedColumns: ['id'] },
          { foreignKeyName: 'stock_transfers_received_by_fkey'; columns: ['received_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'stock_transfers_sent_by_fkey'; columns: ['sent_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'stock_transfers_to_branch_id_fkey'; columns: ['to_branch_id']; isOneToOne: false; referencedRelation: 'branches'; referencedColumns: ['id'] },
        ];
      };
      stock_transfer_items: {
        Row: StockTransferItem;
        Insert: StockTransferItemInsert;
        Update: Partial<StockTransferItemInsert>;
        Relationships: [
          { foreignKeyName: 'stock_transfer_items_stock_transfer_id_fkey'; columns: ['stock_transfer_id']; isOneToOne: false; referencedRelation: 'stock_transfers'; referencedColumns: ['id'] },
          { foreignKeyName: 'stock_transfer_items_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
      transfer_discrepancies: {
        Row: TransferDiscrepancy;
        Insert: TransferDiscrepancyInsert;
        Update: Partial<TransferDiscrepancyInsert>;
        Relationships: [
          { foreignKeyName: 'transfer_discrepancies_recorded_by_fkey'; columns: ['recorded_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'transfer_discrepancies_stock_transfer_id_fkey'; columns: ['stock_transfer_id']; isOneToOne: false; referencedRelation: 'stock_transfers'; referencedColumns: ['id'] },
          { foreignKeyName: 'transfer_discrepancies_stock_transfer_item_id_fkey'; columns: ['stock_transfer_item_id']; isOneToOne: true; referencedRelation: 'stock_transfer_items'; referencedColumns: ['id'] },
          { foreignKeyName: 'transfer_discrepancies_product_id_fkey'; columns: ['product_id']; isOneToOne: false; referencedRelation: 'products'; referencedColumns: ['id'] },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      list_return_inventory: { Args: Record<string, never>; Returns: ReturnStock[] };
      configure_branch_products: {
        Args: {
          p_branch_id: string;
          p_items: Array<{ product_id: string; selling_price: number | string; is_active: boolean }>;
        };
        Returns: undefined;
      };
      get_cashier_product_prices: {
        Args: { p_product_ids: string[] };
        Returns: Array<{ product_id: string; selling_price: number }>;
      };
      get_cashier_line_prices: {
        Args: { p_lines: Array<{ product_id: string; variant_id?: string | null }> };
        Returns: Array<{ product_id: string; variant_id: string | null; selling_price: number; variant_name: string | null }>;
      };
      configure_branch_product_variants: {
        Args: {
          p_branch_id: string;
          p_product_id: string;
          p_variants: Array<{ name: string; selling_price: number | string; is_active: boolean }>;
        };
        Returns: undefined;
      };
      configure_product_variants: {
        Args: {
          p_product_id: string;
          p_variants: Array<{ name: string; default_price: number | string; is_active: boolean }>;
        };
        Returns: undefined;
      };
      create_complete_product: {
        Args: {
          p_name: string;
          p_sku: string;
          p_description: string | null;
          p_variants: Array<{ name: string; default_price: string }>;
          p_branches: Array<{
            branch_id: string;
            selling_price?: string;
            variants?: Array<{ name: string; selling_price: string }>;
          }>;
          p_selling_price?: string | null;
        };
        Returns: Product;
      };
      update_product_variant: {
        Args: {
          p_variant_id: string;
          p_new_name: string;
          p_new_default_price: string;
        };
        Returns: ProductVariant;
      };
      update_branch_product_variant_price: {
        Args: {
          p_branch_variant_id: string;
          p_selling_price: string;
        };
        Returns: BranchProductVariant;
      };
      list_cashier_pos_inventory: {
        Args: Record<string, never>;
        Returns: Array<{
          branch_id: string;
          branch_name: string;
          product_id: string;
          product_name: string;
          product_sku: string;
          selling_price: number;
          quantity_on_hand: number;
          updated_at: string | null;
          variants: Array<{ id: string; name: string; selling_price: number }>;
        }>;
      };
      create_stock_return: { Args: ReturnRequest; Returns: string };
      return_leftover_stock: { Args: LeftoverReturnRequest; Returns: string };
      close_overdue_shifts: {
        Args: Record<string, never>;
        Returns: { closed_count: number; leftover_return_count: number; cutoff_at: string };
      };
      confirm_sale: {
        Args: {
          p_shift_id: string;
          p_items: { product_id: string; variant_id?: string | null; quantity: number }[];
          p_amount_paid: string;
          p_idempotency_key: string;
        };
        Returns: Sale;
      };
      current_user_branch_id: { Args: Record<string, never>; Returns: string | null };
      current_user_role: { Args: Record<string, never>; Returns: UserRole | null };
      is_owner: { Args: Record<string, never>; Returns: boolean };
      is_main_branch_manager: { Args: Record<string, never>; Returns: boolean };
      can_change_own_email: { Args: Record<string, never>; Returns: boolean };
      assert_can_change_own_email: { Args: Record<string, never>; Returns: undefined };
      update_own_name: { Args: { p_full_name: string }; Returns: Profile };
      start_cashier_shift: { Args: Record<string, never>; Returns: string };
      end_cashier_shift: { Args: { p_shift_id: string }; Returns: ShiftSummary };
      get_shift_summary: { Args: { p_shift_id: string }; Returns: ShiftSummary };
      report_sales_by_branch: {
        Args: { p_range_type?: string; p_start_date?: string | null; p_end_date?: string | null };
        Returns: BranchSalesReportItem[];
      };
      report_branch_daily_sales: {
        Args: {
          p_branch_id: string;
          p_range_type?: string;
          p_start_date?: string | null;
          p_end_date?: string | null;
        };
        Returns: BranchDailySalesItem[];
      };
      report_product_sales: {
        Args: { p_range_type?: string; p_branch_id?: string | null; p_start_date?: string | null; p_end_date?: string | null };
        Returns: ProductSalesReportItem[];
      };
      get_owner_dashboard_metrics: { Args: Record<string, never>; Returns: OwnerDashboardMetrics };
      get_owner_daily_product_summary: { Args: Record<string, never>; Returns: OwnerDailyProductSummaryItem[] };
      get_manager_dashboard_metrics: { Args: Record<string, never>; Returns: ManagerDashboardMetrics };
      get_manager_recent_sales: { Args: { p_limit?: number }; Returns: SaleWithRelations[] };
      list_employees: { Args: Record<string, never>; Returns: EmployeeRecord[] };
      owner_update_employee: {
        Args: { p_employee_id: string; p_full_name: string; p_role: EmployeeRole; p_branch_id: string; p_is_active: boolean };
        Returns: undefined;
      };
      initialize_main_branch_inventory: {
        Args: { p_items: Array<{ product_id: string; quantity: number }>; p_notes?: string | null };
        Returns: undefined;
      };
      send_stock_transfer: {
        Args: {
          p_to_branch_id: string;
          p_items: Array<{ product_id: string; quantity_sent: number }>;
          p_notes: string | null;
          p_idempotency_key: string;
        };
        Returns: string;
      };
      receive_stock_transfer: {
        Args: { p_transfer_id: string; p_items: Array<{ stock_transfer_item_id: string; quantity_received: number }>; p_notes: string | null; p_idempotency_key: string };
        Returns: TransferStatus;
      };
      set_branch_receiving_mode: {
        Args: { p_branch_id: string; p_receiving_mode: BranchReceivingMode };
        Returns: undefined;
      };
      list_cashier_pending_transfers: {
        Args: Record<string, never>;
        Returns: Array<{
          id: string;
          transfer_number: string;
          from_branch_id: string;
          from_branch_name: string;
          sent_at: string | null;
          notes: string | null;
          items: Array<{
            stock_transfer_item_id: string;
            product_id: string;
            product_name: string;
            product_sku: string;
            quantity_sent: number;
          }>;
        }>;
      };
      confirm_shipment_arrival: {
        Args: { p_transfer_id: string; p_idempotency_key: string };
        Returns: TransferStatus;
      };
      report_shipment_issue: {
        Args: {
          p_transfer_id: string;
          p_items: Array<{ stock_transfer_item_id: string; quantity_received: number }>;
          p_notes: string;
          p_idempotency_key: string;
        };
        Returns: TransferStatus;
      };
      receive_stock_return: {
        Args: { p_return_id: string; p_items: Array<{ stock_return_item_id: string; quantity_received: number }>; p_notes?: string | null; p_idempotency_key: string };
        Returns: ReturnStatus;
      };
      report_branch_performance: {
        Args: { p_range_type?: string; p_start_date?: string | null; p_end_date?: string | null };
        Returns: BranchPerformanceItem[];
      };
      get_branch_performance_details: {
        Args: { p_branch_id: string; p_range_type?: string; p_start_date?: string | null; p_end_date?: string | null };
        Returns: BranchPerformanceDetails;
      };
      report_transfer_discrepancies: {
        Args: { p_branch_id?: string | null; p_discrepancy_type?: string | null; p_range_type?: string; p_start_date?: string | null; p_end_date?: string | null };
        Returns: TransferDiscrepancyReportItem[];
      };
      report_return_discrepancies: {
        Args: { p_branch_id?: string | null; p_discrepancy_type?: string | null; p_range_type?: string; p_start_date?: string | null; p_end_date?: string | null };
        Returns: ReturnDiscrepancyReportItem[];
      };
      report_inventory_reconciliation: {
        Args: { p_branch_id?: string | null };
        Returns: InventoryReconciliationItem[];
      };
      resolve_return_discrepancy: {
        Args: { p_id: string; p_reason: string; p_note?: string | null };
        Returns: Record<string, unknown>;
      };
      resolve_transfer_discrepancy: {
        Args: { p_id: string; p_reason: string; p_note?: string | null };
        Returns: Record<string, unknown>;
      };
      get_archive_status: { Args: Record<string, never>; Returns: ArchiveStatus };
      dismiss_archive_reminder: { Args: Record<string, never>; Returns: ArchiveStatus };
      prepare_sales_archive: { Args: Record<string, never>; Returns: DataArchiveRecord };
      get_archive_export: { Args: { p_archive_id: string }; Returns: ArchiveExportPackage };
      verify_sales_archive: { Args: { p_archive_id: string }; Returns: DataArchiveRecord };
      cleanup_archived_sales: { Args: { p_archive_id: string; p_confirmation: string }; Returns: DataArchiveRecord };
    };

    Enums: {
      user_role: UserRole;
      inventory_movement_type: InventoryMovementType;
      stock_transfer_status: TransferStatus;
      stock_return_status: ReturnStatus;
      transfer_discrepancy_type: DiscrepancyType;
      discrepancy_resolution_status: DiscrepancyResolutionStatus;
      discrepancy_resolution_reason: DiscrepancyResolutionReason;
      shift_status: ShiftStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
