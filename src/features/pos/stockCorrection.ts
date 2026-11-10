import type { CorrectionRequest } from '@/services/stockCorrectionService';

export const CORRECTION_REASONS = ['Incorrect kitchen count', 'Previous count was incorrect', 'Physical recount'];
export function parseStockCount(value: string): number | null {
  return /^(0|[1-9][0-9]{0,5})$/.test(value) ? Number(value) : null;
}
// Persist BEFORE sending; an uncertain response must reuse the exact request after navigation/restart.
const key = (userId: string) => `golden-ribbons-stock-correction:${userId}`;
export function readPendingCorrection(userId: string): CorrectionRequest | null {
  const raw = localStorage.getItem(key(userId));
  if (!raw) return null;
  const value = JSON.parse(raw) as CorrectionRequest;
  if (!value || typeof value.p_shift_id !== 'string' || typeof value.p_product_id !== 'string'
    || typeof value.p_expected_updated_at !== 'string' || typeof value.p_idempotency_key !== 'string'
    || !Number.isInteger(value.p_expected_quantity) || value.p_expected_quantity < 0
    || !Number.isInteger(value.p_actual_quantity) || value.p_actual_quantity < 0 || value.p_actual_quantity > 999999
    || !CORRECTION_REASONS.includes(value.p_reason)) throw new Error('Invalid saved correction.');
  return value;
}
export function savePendingCorrection(userId: string, request: CorrectionRequest | null) {
  if (request) localStorage.setItem(key(userId), JSON.stringify(request));
  else localStorage.removeItem(key(userId));
}
