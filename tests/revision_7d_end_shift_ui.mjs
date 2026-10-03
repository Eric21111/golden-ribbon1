import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

function loadTsWithAlias(entryPath, aliasRoot = 'src') {
  const cache = new Map();

  function load(filePath) {
    const abs = path.resolve(filePath);
    if (cache.has(abs)) return cache.get(abs);

    const source = readFileSync(abs, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: abs,
    });

    const module = { exports: {} };
    const localRequire = (id) => {
      if (id.startsWith('@/')) {
        const resolved = path.resolve(aliasRoot, id.slice(2));
        const candidates = [`${resolved}.ts`, `${resolved}.tsx`, resolved];
        for (const candidate of candidates) {
          try {
            return load(candidate);
          } catch {
            // try next
          }
        }
        throw new Error(`Unable to resolve ${id}`);
      }
      if (id === 'react-native' || id.startsWith('react')) {
        return new Proxy({}, { get: () => () => null });
      }
      return require(id);
    };

    const sandbox = {
      module,
      exports: module.exports,
      require: localRequire,
      console,
      Number,
      Math,
      Boolean,
      Array,
      Object,
      String,
      RegExp,
      Error,
      Date,
      Intl,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      Infinity,
      undefined,
    };
    vm.runInNewContext(outputText, sandbox, { filename: abs });
    cache.set(abs, module.exports);
    return module.exports;
  }

  return load(entryPath);
}

const closeDisplay = loadTsWithAlias('src/features/shifts/closeDisplay.ts');
const {
  ACTUAL_REMAINING_HELPER,
  BEGIN_CLOSE_CONFIRM_MESSAGE,
  WASTE_HELPER,
  expectedRemainingBeforeActual,
  formatCashResultLabel,
  formatCloseSuccessSummary,
  formatExpectedRemainingLabel,
  formatInventoryResultLabel,
  incompleteProductCount,
  isNetworkishError,
  isValidClosePieceQuantity,
  parseClosePieceQuantity,
  previewInventoryResult,
} = closeDisplay;

const { previewCashResult } = loadTsWithAlias('src/lib/format.ts');

const dashboard = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8');
const closeForm = readFileSync('src/features/shifts/CashierShiftCloseForm.tsx', 'utf8');
const closeDisplaySource = readFileSync('src/features/shifts/closeDisplay.ts', 'utf8');
const errorsSource = readFileSync('src/lib/errors.ts', 'utf8');
const shiftService = readFileSync('src/services/shiftService.ts', 'utf8');
const useShifts = readFileSync('src/hooks/useShifts.ts', 'utf8');

// --- Helpers: blank actual is not zero ---
assert.equal(isValidClosePieceQuantity(''), false);
assert.equal(isValidClosePieceQuantity('   '), false);
assert.equal(parseClosePieceQuantity(''), null);
assert.equal(previewInventoryResult(5, '', '0'), null);
assert.equal(previewInventoryResult(5, '', '10'), null);
assert.equal(formatInventoryResultLabel(null), '—');
assert.equal(formatExpectedRemainingLabel(-5, false), '—');
assert.equal(incompleteProductCount(
  [{ product_id: 'a' }, { product_id: 'b' }],
  { a: { actualRemaining: '' }, b: { actualRemaining: '1' } },
), 1);

// Zero is valid only when explicitly entered
assert.equal(isValidClosePieceQuantity('0'), true);
assert.equal(previewInventoryResult(5, '0', '0')?.result, 'shortage');
assert.equal(previewInventoryResult(5, '0', '0')?.magnitude, 5);

// --- Blank actual cash does not show shortage ---
assert.equal(previewCashResult(100, ''), null);
assert.equal(previewCashResult(100, '   '), null);
assert.equal(formatCashResultLabel(100, '', null), '—');
assert.equal(formatCashResultLabel(100, '', 'shortage'), '—');
assert.match(closeForm, /Difference: \{formatCashResultLabel/);
assert.match(closeForm, /placeholder="—"/);

// --- Helper copy distinguishes usable remaining from waste ---
assert.match(ACTUAL_REMAINING_HELPER, /usable items/i);
assert.match(ACTUAL_REMAINING_HELPER, /Do not include waste/i);
assert.match(WASTE_HELPER, /unusable/i);
// Shortened inline copy (not the long closeDisplay constants) still distinguishes the two fields.
assert.match(closeForm, /usable items left at the booth, not including waste/i);
assert.match(closeForm, /unusable pieces/i);
assert.doesNotMatch(ACTUAL_REMAINING_HELPER, /plus waste|including waste|and waste/i);

// --- Waste defaults / validation ---
assert.match(closeForm, /wasteQuantity: '0'/);
assert.equal(isValidClosePieceQuantity('1.5'), false);
assert.equal(isValidClosePieceQuantity('-1'), false);
assert.equal(isValidClosePieceQuantity('10'), true);

// --- Waste > system stock allowed; no expected_remaining clamp ---
assert.equal(expectedRemainingBeforeActual(5, '10'), -5);
const wasteOver = previewInventoryResult(5, '0', '10');
assert.ok(wasteOver);
assert.equal(wasteOver.expectedRemaining, -5);
assert.equal(wasteOver.result, 'excess');
assert.equal(wasteOver.magnitude, 5);
assert.equal(formatExpectedRemainingLabel(-5, true), 'See inventory result');
assert.equal(formatInventoryResultLabel(wasteOver), '5 pcs excess');

// Exact / shortage / excess semantics
assert.equal(previewInventoryResult(10, '8', '2')?.result, 'exact');
assert.equal(previewInventoryResult(10, '7', '2')?.result, 'shortage');
assert.equal(previewInventoryResult(10, '9', '2')?.result, 'excess');
assert.equal(formatInventoryResultLabel(previewInventoryResult(10, '7', '2')), '1 pc shortage');

// Cash preview semantics
assert.equal(previewCashResult(100, '100'), 'exact');
assert.equal(previewCashResult(100, '90'), 'shortage');
assert.equal(previewCashResult(100, '110'), 'excess');
assert.match(formatCashResultLabel(100, '90', 'shortage'), /shortage/);
assert.match(formatCashResultLabel(100, '110', 'excess'), /excess/);

// --- Begin confirmation wording reflects full-day freeze ---
assert.match(BEGIN_CLOSE_CONFIRM_MESSAGE, /Sales and stock transactions for this booth will stop for today/);
assert.match(dashboard, /BEGIN_CLOSE_CONFIRM_MESSAGE/);
assert.match(dashboard, /confirmAction\(/);
assert.match(dashboard, /Start End Shift/);
assert.match(dashboard, /End Shift \/ Remit/);
assert.doesNotMatch(dashboard, /Step 1/);
assert.doesNotMatch(dashboard, /Begin close/);
assert.doesNotMatch(dashboard, /stock operations pause/i);

// Begin only after confirm — not merely by opening UI
assert.match(dashboard, /requestEndShift/);
assert.match(dashboard, /beginCloseMutation\.mutate/);
assert.doesNotMatch(dashboard, /onCancel/);
assert.doesNotMatch(closeForm, /onCancel/);
assert.doesNotMatch(closeForm, /Cancel End Shift|Reopen|Back to selling/i);

// After begin status
assert.match(closeForm, /Sales closed for today/);

// No manual unsold/carried / no closing behavior editor
assert.doesNotMatch(closeForm, /unsold_quantity|carried_quantity|ClosingStockBehaviorField|keep_at_branch|record_as_unsold/);
assert.match(closeForm, /View stock details/);
assert.match(closeForm, /Expected cash/);
assert.match(closeForm, /Actual cash/);
assert.match(closeForm, /Actual remaining/);
assert.match(closeForm, /Waste/);
assert.match(closeForm, /TABLET_MIN_EDGE/);

// Final confirmation + loading protection
assert.match(dashboard, /FINALIZE_CONFIRM_MESSAGE/);
assert.match(dashboard, /remittancePending/);
assert.match(closeForm, /disabled=\{!canSubmit \|\| loading\}/);

// --- Timeout retry uses identical remittance path + payload ---
assert.match(dashboard, /lastFinalizeRef/);
assert.match(dashboard, /Retry same remittance/);
assert.match(dashboard, /isNetworkishError/);
assert.match(dashboard, /runFinalize\(attempt\)/);
assert.match(dashboard, /path: 'legacy' \| 'pcs'|RemittancePath/);
assert.match(dashboard, /attempt\.path === 'legacy'/);
assert.equal(isNetworkishError({ message: 'Network request timed out' }), true);
assert.equal(isNetworkishError({ message: 'different inventory counts' }), false);

// Success summary uses server result shape
const summary = formatCloseSuccessSummary({
  shift_id: 's1',
  expected_cash: 100,
  actual_cash: 90,
  difference: 10,
  result: 'shortage',
  status: 'reconciled',
  products: [
    { result: 'exact' },
    { result: 'shortage' },
    { result: 'excess' },
  ],
});
assert.match(summary, /End Shift Complete/);
assert.match(summary, /Cash:/);
assert.match(summary, /1 exact/);
assert.match(summary, /1 shortage/);
assert.match(summary, /1 excess/);
assert.match(dashboard, /formatCloseSuccessSummary/);

// Pending remittance + same-day closed UI (hint only; server remains authority)
assert.match(dashboard, /Complete Pending Remittance/);
assert.match(dashboard, /useMyFinalizedCloseToday/);
assert.match(dashboard, /sameDayClosedHint/);
assert.match(dashboard, /Start again next business day/);
assert.match(dashboard, /server decides whether a new shift can start/i);
assert.match(shiftService, /hasMyFinalizedCloseToday/);
assert.match(useShifts, /useMyFinalizedCloseToday/);
assert.match(errorsSource, /Today's shift is already closed/);
assert.match(errorsSource, /different inventory/);

// Same-day hint: cashier-authorized reads only (no report RPC / no sales_cutoff_at)
const hintFn = shiftService.match(
  /export async function hasMyFinalizedCloseToday[\s\S]*?\nexport async function/,
)?.[0] ?? '';
assert.match(hintFn, /getTodayRangeManila/);
assert.match(hintFn, /\.from\('shifts'\)/);
assert.match(hintFn, /ended_at/);
assert.match(hintFn, /\.from\('shift_reconciliations'\)/);
assert.match(hintFn, /\.eq\('status',\s*'closed'\)/);
assert.doesNotMatch(hintFn, /listShiftRemittances/);
assert.doesNotMatch(hintFn, /report_branch_shift_remittances/);
assert.doesNotMatch(hintFn, /sales_cutoff_at/);
// Owner/Main Manager reporting still uses the remittance report RPC
assert.match(shiftService, /listShiftRemittances/);
assert.match(shiftService, /report_branch_shift_remittances/);
assert.match(useShifts, /listShiftRemittances/);
// start_cashier_shift remains authoritative
assert.match(shiftService, /start_cashier_shift/);
assert.match(dashboard, /startMutation|useStartShift/);

// Auto-close pending reuse / legacy compatibility via preview.mode
assert.match(closeForm, /legacy_cash_only/);
assert.match(closeForm, /inventory_reconciliation_required/);
assert.match(closeForm, /This historical shift only needs cash reconciliation/);
assert.match(closeForm, /isLegacy|legacy_cash_only/);
// A) Legacy UI: no inventory count fields when legacy; dashboard routes to reconcile
assert.match(dashboard, /isLegacyCashOnlyPreview|legacy_cash_only/);
assert.match(dashboard, /useReconcileClosedShift/);
assert.match(dashboard, /reconcileMutation/);
assert.match(dashboard, /path === 'legacy' \? 'legacy' : 'pcs'|isLegacyCashOnlyPreview\(preview\) \? 'legacy'/);
// B) PCS still uses finalize path
assert.match(dashboard, /useFinalizeCashierShiftReconciliation/);
assert.match(dashboard, /finalizeMutation\.mutate/);
assert.match(useShifts, /finalizeCashierShiftReconciliation/);

// KG closing UI removed from active cashier End Shift surfaces
assert.doesNotMatch(closeForm, /kg_meal|KG-delivered|meal waste|p_waste|close_cashier_shift/i);
assert.doesNotMatch(dashboard, /kg_meal|KG-delivered|meal waste|p_waste|close_cashier_shift/i);
assert.doesNotMatch(closeDisplaySource, /kg_meal|p_waste/i);

// Service RPCs: PCS finalize + legacy reconcile with explicit empty waste
assert.match(shiftService, /begin_cashier_shift_close/);
assert.match(shiftService, /finalize_cashier_shift_reconciliation/);
assert.match(shiftService, /get_my_pending_shift_reconciliation/);
assert.match(shiftService, /reconcile_closed_shift/);
// C) Legacy service call explicitly contains p_waste: []
assert.match(shiftService, /p_waste:\s*\[\s*\]/);

console.log('revision_7d_end_shift_ui: ok');
