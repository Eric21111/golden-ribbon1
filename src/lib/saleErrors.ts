export function isSaleId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Log the failed read stage, never session credentials or checkout payloads. */
export function reportSaleReadError(stage: 'header' | 'items' | 'list', error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'NETWORK';
  console.warn('[sale-read]', { stage, code });
}

export function saleReadErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'INVALID_SALE_ID') return 'This sale link is invalid. Open the sale again from Sales.';
  if (code === 'PGRST116') return 'This sale is unavailable to your account. Check the signed-in cashier and open it from Sales.';
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') {
    return 'Your account could not access this sale. Check your session and try again.';
  }
  if (code === 'PGRST200' || code === 'PGRST201' || code === '42703') {
    return 'Sale details are temporarily unavailable. Ask support to check app and server compatibility. Do not submit the sale again.';
  }
  return 'Unable to load sale details. Check your connection and retry. This does not mean the sale was not saved.';
}
