import { STOCK_UNITS, type StockUnitCode } from '@/lib/stockUnits';
import type { CorrectionHistory } from '@/services/stockCorrectionService';

import { correctionChange } from './stockCorrectionDisplay';
import { SCAN_HARD_MAX_PAGES, canLoadOlder, correctionDateWindow, type CorrectionDateRange, type CorrectionScan } from './stockCorrectionFilters';

/**
 * Stock corrections > All branches overview and the individual branch history.
 * Same flow as Void logs and Waste History: an overview with summary cards, a date range and a row per branch; a tap opens that
 * branch with the same date range. Free of React so it can be unit-tested.
 *
 * Two things are never hidden:
 *  - STOCK UNITS. A correction of 10 eggs counted in half-egg units is not 10 pieces, so quantities are never added across units:
 *    every figure is kept per unit ("+12 pcs · −2 half-egg units").
 *  - HOW FAR BACK WE LOOKED. The server can only list pages, so the newest 500 corrections are loaded first and older ones are added on
 *    request ("Load older corrections"). A figure built from what is loaded is only called complete when it provably is (see
 *    `correctionCoverage`).
 */
const UNIT_ORDER: StockUnitCode[] = ['piece', 'half_egg', 'half_serving', 'quarter_serving'];

export type UnitChange = { unit: StockUnitCode; increase: number; decrease: number; net: number };

export type CorrectionTotals = {
  corrections: number;
  increases: number;
  decreases: number;
  /** Quantities, per stock unit. Never summed across units. */
  byUnit: UnitChange[];
};

const unitOf = (row: CorrectionHistory): StockUnitCode => row.stock_unit_code ?? 'piece';

export function summarizeCorrections(rows: readonly CorrectionHistory[]): CorrectionTotals {
  let increases = 0;
  let decreases = 0;
  const units = new Map<StockUnitCode, UnitChange>();
  for (const row of rows) {
    const change = correctionChange(row.details);
    if (change > 0) increases += 1;
    else if (change < 0) decreases += 1;
    const unit = unitOf(row);
    const entry = units.get(unit) ?? { unit, increase: 0, decrease: 0, net: 0 };
    if (change > 0) entry.increase += change;
    else if (change < 0) entry.decrease += -change;
    entry.net += change;
    units.set(unit, entry);
  }
  const byUnit = [...units.values()].sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit));
  return { corrections: rows.length, increases, decreases, byUnit };
}

/** "12 pcs" / "1 half-egg unit": an amount in its own unit. */
export function unitAmountLabel(amount: number, code: StockUnitCode | null | undefined): string {
  const unit = STOCK_UNITS[code ?? 'piece'];
  return `${amount} ${Math.abs(amount) === 1 ? unit.singular : unit.plural}`;
}

/** "+12 pcs", "−2 half-egg units" (a real minus sign), "0 pcs". */
export function signedUnitAmount(amount: number, code: StockUnitCode | null | undefined): string {
  const unit = STOCK_UNITS[code ?? 'piece'];
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const abs = Math.abs(amount);
  return `${sign}${abs} ${abs === 1 ? unit.singular : unit.plural}`;
}

/** The net stock change as words, one part per unit: "+12 pcs · −2 half-egg units". Nothing to say without corrections. */
export function netChangeText(totals: Pick<CorrectionTotals, 'corrections' | 'byUnit'>): string {
  if (totals.corrections === 0) return '';
  const parts = totals.byUnit.map((entry) => signedUnitAmount(entry.net, entry.unit));
  return parts.length > 0 ? `Net ${parts.join(' · ')}` : '';
}

export type CorrectionCoverage = {
  /** Every correction in the range was loaded, so the figures are the whole story. */
  complete: boolean;
  /** Words for the screen when it is not complete (null when it is). */
  note: string | null;
  /** Older corrections can still be loaded (the screen offers "Load older corrections"). */
  canLoadOlder: boolean;
  /** How many corrections are loaded. */
  loaded: number;
  /** The date of the oldest correction that was loaded, when the list was cut short. */
  loadedBack: string | null;
};

/** "Nov 3" in Manila time. */
function shortDate(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
}

/**
 * Can the figures for this date range be called complete?
 *  - The server returned every correction: yes.
 *  - It was cut off at the newest SCAN_MAX_ROWS: the list is newest first, so a range that starts AFTER the oldest loaded correction
 *    is still fully covered (everything newer was loaded). A range that reaches back further, or All Time, is not.
 */
export function correctionCoverage(
  scan: Pick<CorrectionScan, 'rows' | 'complete' | 'pages'> | undefined,
  filters: { rangeType: CorrectionDateRange; customStart: string; customEnd: string },
): CorrectionCoverage {
  if (!scan || scan.complete) return { complete: true, note: null, loadedBack: null, canLoadOlder: false, loaded: scan?.rows.length ?? 0 };
  let oldest = Number.POSITIVE_INFINITY;
  let oldestIso = '';
  for (const row of scan.rows) {
    const at = Date.parse(row.created_at);
    if (Number.isFinite(at) && at < oldest) {
      oldest = at;
      oldestIso = row.created_at;
    }
  }
  const window = correctionDateWindow(filters);
  const loaded = scan.rows.length;
  if (window && Number.isFinite(oldest) && window.start > oldest) return { complete: true, note: null, loadedBack: null, canLoadOlder: false, loaded };
  const back = oldestIso ? shortDate(oldestIso) : '';
  const more = canLoadOlder(scan);
  return {
    complete: false,
    loadedBack: back || null,
    canLoadOlder: more,
    loaded,
    note: `Only the newest ${loaded} corrections were loaded${back ? ` (back to ${back})` : ''}. Older corrections are not counted, so these figures may be incomplete.${more ? '' : ` That is the most this report can load (${SCAN_HARD_MAX_PAGES * 50}).`}`,
  };
}

export type CorrectionBranchRow = {
  branchId: string | null;
  branchName: string;
  isActive: boolean;
  totals: CorrectionTotals;
};

/**
 * One row per selling branch (the Main Branch makes no corrections), plus any branch name that appears in the corrections but not
 * in the branch list (kept, not tappable). A branch with none in range shows 0: whether that is "none" or "none among the newest
 * 500" is stated by the screen through `correctionCoverage`. Most corrections first.
 */
export function buildCorrectionBranchRows(
  branches: ReadonlyArray<{ id: string; name: string; is_active: boolean; is_main_branch?: boolean }>,
  rows: readonly CorrectionHistory[],
): CorrectionBranchRow[] {
  const selling = branches.filter((branch) => !branch.is_main_branch);
  const grouped = new Map<string, CorrectionHistory[]>();
  for (const row of rows) {
    const list = grouped.get(row.branch_name);
    if (list) list.push(row);
    else grouped.set(row.branch_name, [row]);
  }
  const result = new Map<string, CorrectionBranchRow>();
  for (const branch of selling) {
    result.set(branch.name, { branchId: branch.id, branchName: branch.name, isActive: branch.is_active, totals: summarizeCorrections(grouped.get(branch.name) ?? []) });
  }
  for (const [name, group] of grouped) {
    if (!result.has(name)) result.set(name, { branchId: null, branchName: name, isActive: false, totals: summarizeCorrections(group) });
  }
  return [...result.values()].sort((a, b) => b.totals.corrections - a.totals.corrections || a.branchName.localeCompare(b.branchName));
}

/** "8 corrections" / "1 correction" / "No corrections in this range". */
export function correctionCountLabel(count: number): string {
  return count === 0 ? 'No corrections in this range' : `${count} ${count === 1 ? 'correction' : 'corrections'}`;
}

/** The meta under a branch row: the count, and the net change per unit. */
export function correctionBranchMeta(totals: CorrectionTotals, coverage: Pick<CorrectionCoverage, 'complete'>): { subtitle: string; meta?: string } {
  if (totals.corrections === 0) {
    return { subtitle: coverage.complete ? 'No corrections in this range' : 'None among the newest corrections' };
  }
  return { subtitle: correctionCountLabel(totals.corrections), meta: netChangeText(totals) || undefined };
}

/** Where a branch row goes: that branch's history, with the same date range. */
export function correctionBranchHref(args: {
  role: 'owner' | 'manager';
  branchId: string;
  rangeType: string;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  const base = args.role === 'owner' ? '/owner/reports/stock-count-changes' : '/manager/reports/stock-count-changes';
  return `${base}/${args.branchId}?${params.toString()}`;
}

/** The corrections in a date range (All Time, or an incomplete custom range, keeps everything). */
export function correctionsInRange(
  rows: readonly CorrectionHistory[],
  filters: { rangeType: CorrectionDateRange; customStart: string; customEnd: string },
): CorrectionHistory[] {
  const window = correctionDateWindow(filters);
  if (!window) return [...rows];
  return rows.filter((row) => {
    const at = Date.parse(row.created_at);
    return Number.isFinite(at) && at >= window.start && at < window.end;
  });
}
