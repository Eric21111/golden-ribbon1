import type { DiscrepancyType, Product } from './models';

export type ReturnStatus = 'draft' | 'in_transit' | 'received' | 'received_with_discrepancy' | 'cancelled';

export type ReturnStock = {
  product_id: string;
  product_name: string;
  product_sku: string;
  is_active: boolean;
  quantity_on_hand: number;
};

export type StockReturn = {
  id: string;
  return_number: string;
  from_branch_id: string;
  to_branch_id: string;
  status: ReturnStatus;
  created_by: string;
  returned_by: string;
  returned_at: string;
  received_by: string | null;
  received_at: string | null;
  received_by_name: string | null;
  receive_idempotency_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  from_branch_name: string;
  to_branch_name: string;
  returned_by_name: string;
};

export type ReturnItem = {
  id: string;
  stock_return_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity_returned: number;
  quantity_received: number | null;
  created_at: string;
  updated_at: string;
};

export type ReturnDiscrepancy = {
  id: string;
  stock_return_id: string;
  stock_return_item_id: string;
  product_id: string;
  quantity_expected: number;
  quantity_received: number;
  difference: number;
  discrepancy_type: DiscrepancyType;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  product?: Product | null;
  stock_return?: StockReturn | null;
};

export type StockReturnDetails = StockReturn & {
  items: ReturnItem[];
  discrepancies: ReturnDiscrepancy[];
};

export type ReturnRequest = {
  p_items: { product_id: string; quantity_returned: number }[];
  p_notes: string | null;
  p_idempotency_key: string;
};

export type ReceiveReturnInput = {
  returnId: string;
  items: Array<{ stock_return_item_id: string; quantity_received: number }>;
  notes: string | null;
  idempotencyKey: string;
};
