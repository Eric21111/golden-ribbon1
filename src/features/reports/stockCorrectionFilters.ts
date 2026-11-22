import { getThisMonthRangeManila, getThisWeekRangeManila, getTodayRangeManila, toNextDayStartManila, toStartOfDayManila } from '@/lib/format';
import type { CorrectionHistory } from '@/services/stockCorrectionService';

import { CORRECTIONS_PAGE_SIZE } from './stockCorrectionDisplay';

/**
 * Stock corrections: filters for the owner / Main Branch Manager screen.
 *
 * The server function that lists corrections (`list_stock_count_corrections`) takes only a page offset. It cannot filter by branch,
 * date or product, so those filters are applied here, on the corrections that were loaded. To keep that honest:
 *  - with no filter the screen pages through the server's own pages, exactly as before;
 *  - with a filter it loads up to SCAN_MAX_PAGES pages of the newest corrections (SCAN_MAX_PAGES x 50), filters them, and says whether
 *    older corrections were left out.
 * Free of React so it can be unit-tested.
 */
export const SCAN_MAX_PAGES = 10;
export const SCAN_MAX_ROWS = SCAN_MAX_PAGES * CORRECTIONS_PAGE_SIZE;
/** "Load older corrections" adds SCAN_MAX_PAGES pages at a time, up to this many pages in all (a ceiling so one screen never holds unbounded rows). */
export const SCAN_HARD_MAX_PAGES = 200;
export const SCAN_HARD_MAX_ROWS = SCAN_HARD_MAX_PAGES * CORRECTIONS_PAGE_SIZE;

export type CorrectionDateRange = 'all_time' | 'today' | 'this_week' | 'this_month' | 'custom';

export type CorrectionFilters = {
  /** Product name search. */
  search: string;
  /** A branch name, or 'all'. (The server returns the branch name, not its id.) */
  branch: string;
  rangeType: CorrectionDateRange;
  customStart: string;
  customEnd: string;
};

export const NO_CORRECTION_FILTERS: CorrectionFilters = { search: '', branch: 'all', rangeType: 'all_time', customStart: '', customEnd: '' };

/** The date window as [start, end) instants, or null for "no date filter" (All Time, or a custom range that is not complete yet). */
export function correctionDateWindow(filters: Pick<CorrectionFilters, 'rangeType' | 'customStart' | 'customEnd'>): { start: number; end: number } | null {
  let range: { start?: string; end?: string } | null = null;
  if (filters.rangeType === 'today') range = getTodayRangeManila();
  else if (filters.rangeType === 'this_week') range = getThisWeekRangeManila();
  else if (filters.rangeType === 'this_month') range = getThisMonthRangeManila();
  else if (filters.rangeType === 'custom') range = { start: toStartOfDayManila(filters.customStart), end: toNextDayStartManila(filters.customEnd) };
  if (!range?.start || !range.end) return null;
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/** Is any filter narrowing the list? (An incomplete custom range does not count: it narrows nothing.) */
export function hasCorrectionFilters(filters: CorrectionFilters): boolean {
  return filters.search.trim() !== '' || filters.branch !== 'all' || correctionDateWindow(filters) !== null;
}

export function filterCorrections(rows: CorrectionHistory[], filters: CorrectionFilters): CorrectionHistory[] {
  const term = filters.search.trim().toLowerCase();
  const window = correctionDateWindow(filters);
  return rows.filter((row) => {
    if (filters.branch !== 'all' && row.branch_name !== filters.branch) return false;
    if (term && !row.product_name.toLowerCase().includes(term)) return false;
    if (window) {
      const at = Date.parse(row.created_at);
      if (!Number.isFinite(at) || at < window.start || at >= window.end) return false;
    }
    return true;
  });
}

export type CorrectionScan = {
  rows: CorrectionHistory[];
  /** The server had no more corrections: every correction was searched. */
  complete: boolean;
  pages: number;
};

/**
 * Loads pages of the newest corrections, one after another, until the server has no more or `maxPages` pages are loaded in all.
 * With `previous` it CONTINUES from where that scan stopped (the same server offsets: no backend change). A correction made in
 * between shifts the pages by a row, so a row seen twice is kept once (it is never dropped, and never counted twice).
 */
export async function scanCorrections(
  fetchPage: (offset: number) => Promise<CorrectionHistory[]>,
  maxPages: number = SCAN_MAX_PAGES,
  previous?: CorrectionScan,
): Promise<CorrectionScan> {
  if (previous?.complete) return previous; // nothing older: nothing to fetch
  const limit = Math.min(maxPages, SCAN_HARD_MAX_PAGES);
  const seen = new Set<string>((previous?.rows ?? []).map((row) => row.id));
  const rows: CorrectionHistory[] = [...(previous?.rows ?? [])];
  let pages = previous?.pages ?? 0;
  let complete = previous?.complete ?? false;
  while (!complete && pages < limit) {
    const page = (await fetchPage(pages * CORRECTIONS_PAGE_SIZE)) ?? [];
    pages += 1;
    for (const row of page) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
    if (page.length < CORRECTIONS_PAGE_SIZE) complete = true;
  }
  return { rows, complete, pages };
}

/** Load the next SCAN_MAX_PAGES pages of older corrections after the ones already loaded. */
export function extendScan(
  fetchPage: (offset: number) => Promise<CorrectionHistory[]>,
  previous: CorrectionScan,
  morePages: number = SCAN_MAX_PAGES,
): Promise<CorrectionScan> {
  return scanCorrections(fetchPage, previous.pages + morePages, previous);
}

/** Can older corrections still be loaded? (Not once the server has no more, nor at the ceiling.) */
export function canLoadOlder(scan: Pick<CorrectionScan, 'complete' | 'pages'> | undefined): boolean {
  return Boolean(scan) && !scan!.complete && scan!.pages < SCAN_HARD_MAX_PAGES;
}

/** The empty-state copy: nothing recorded at all, a filter that matches nothing, or the end of the pages. */
export function correctionEmptyState(input: { filtering: boolean; page: number; complete?: boolean }): { title: string; message: string } {
  if (input.filtering) {
    return {
      title: 'No matching corrections',
      message: input.complete === false
        ? 'Nothing among the newest corrections matches. Older corrections are not searched.'
        : 'Try another branch, dates or product.',
    };
  }
  if (input.page > 0) return { title: 'No more corrections', message: 'That was the last page.' };
  // only the newest corrections were loaded: "none yet" would be a claim nobody checked
  if (input.complete === false) return { title: 'None among the newest corrections', message: 'Older corrections are not loaded, so earlier ones may exist.' };
  return { title: 'No stock corrections yet', message: 'Recounts and stock added by cashiers will appear here.' };
}
