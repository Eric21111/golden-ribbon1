import type { ShiftCloseFinalizeProduct, ShiftCloseProductPreview } from '@/types/models';
import type { ProductCounts } from './closeCountList';

/** Only a server-certified idle row can be omitted. Old servers keep the full count list. */
export function requiresRemittanceCount(product: ShiftCloseProductPreview): boolean {
  if (product.requires_count !== false) return true;
  const isZero = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number(value) === 0;
  return [product.opening_quantity, product.received_quantity, product.outgoing_quantity,
    product.sold_quantity, product.adjustment_quantity, product.system_balance_before_waste]
    .some(value => !isZero(value));
}

/** Preserve every baseline required by the transactional RPC, including certified zero rows. */
export function buildFinalizePayload(
  products: ShiftCloseProductPreview[], counts: ProductCounts,
): ShiftCloseFinalizeProduct[] {
  return products.map(product => {
    if (!requiresRemittanceCount(product)) return { product_id: product.product_id, actual_remaining: '0' };
    const row = counts[product.product_id];
    const waste = (row?.wasteQuantity ?? '0').trim() || '0';
    return {
      product_id: product.product_id,
      actual_remaining: (row?.actualRemaining ?? '').trim(),
      ...(waste !== '0' ? { waste_quantity: waste } : {}),
    };
  });
}
