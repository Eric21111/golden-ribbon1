/** Build a catalog SKU from a product name (letters, numbers, hyphens). */
export function skuFromName(name: string): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  const base = (cleaned || 'ITEM').slice(0, 40);
  return base.length >= 2 ? base : `${base}X`.slice(0, 40);
}

/** Prefer the base SKU; append -2, -3, … when taken (case-insensitive). */
export function uniqueSku(base: string, existingSkus: Iterable<string>): string {
  const taken = new Set(
    [...existingSkus].map((sku) => sku.trim().toUpperCase()).filter(Boolean),
  );
  const normalized = skuFromName(base);
  if (!taken.has(normalized)) return normalized;

  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${normalized.slice(0, Math.max(2, 40 - suffix.length))}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${normalized.slice(0, 28)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}

export function generateSkuFromName(name: string, existingSkus: Iterable<string> = []): string {
  return uniqueSku(skuFromName(name), existingSkus);
}
