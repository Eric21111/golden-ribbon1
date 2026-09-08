export const PAGE_SIZE = 8;
/** Show pager only when the full filtered list has at least this many cards. */
export const PAGINATION_MIN_ITEMS = 8;

export function totalPagesFor(count: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

export function slicePage<T>(items: T[], page: number, pageSize = PAGE_SIZE): T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

/** Compact page index list with ellipsis markers (-1). */
export function visiblePageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages = new Set<number>([0, total - 1, current]);
  for (let i = current - 1; i <= current + 1; i += 1) {
    if (i > 0 && i < total - 1) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const page = sorted[i]!;
    if (i > 0 && page - sorted[i - 1]! > 1) result.push(-1);
    result.push(page);
  }
  return result;
}
