export const PRICE_PATTERN = /^[0-9]{1,10}(\.[0-9]{1,2})?$/;

/**
 * A selling price for a product that is sold in the cashier POS: a valid amount of more than ₱0. An empty field, a malformed
 * amount and ₱0 / ₱0.00 are all refused, so an empty price is never turned into ₱0.00. Stock-only products have no price.
 */
export function isSellingPrice(raw: string): boolean {
  const trimmed = raw.trim();
  return PRICE_PATTERN.test(trimmed) && Number(trimmed) > 0;
}
