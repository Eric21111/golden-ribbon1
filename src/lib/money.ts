export function toCents(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter a valid amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 999999999999) throw new Error('Amount is too large.');
  return result;
}
export function centsDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid money amount.');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
export function cartTotalCents(items: { quantity: number; unit_price: number }[]): number {
  const total = items.reduce((sum, item) => sum + toCents(item.unit_price) * item.quantity, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Order is too large.');
  return total;
}
