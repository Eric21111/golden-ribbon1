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
        for (const candidate of [`${resolved}.ts`, `${resolved}.tsx`, resolved]) {
          try {
            return load(candidate);
          } catch {
            // continue
          }
        }
        throw new Error(`Unable to resolve ${id}`);
      }
      if (id === 'react-native' || id.startsWith('react')) {
        return new Proxy({}, { get: () => () => null });
      }
      return require(id);
    };
    vm.runInNewContext(
      outputText,
      {
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
      },
      { filename: abs },
    );
    cache.set(abs, module.exports);
    return module.exports;
  }
  return load(entryPath);
}

const reportDisplay = loadTsWithAlias('src/features/reports/reportDisplay.ts');
const format = loadTsWithAlias('src/lib/format.ts');

const remittance = readFileSync('src/features/reports/ShiftRemittanceScreen.tsx', 'utf8');
const remittanceDetail = readFileSync('src/features/reports/ShiftRemittanceDetailScreen.tsx', 'utf8');
const wasteUi = readFileSync('src/features/reports/WasteHistoryScreen.tsx', 'utf8');
const shiftService = readFileSync('src/services/shiftService.ts', 'utf8');
const invRecon = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
const branchPerf = readFileSync('src/features/reports/BranchPerformanceScreens.tsx', 'utf8');
const productSales = readFileSync('src/features/reports/ReportsScreens.tsx', 'utf8');
const ownerHub = readFileSync('app/(owner)/owner/reports/index.tsx', 'utf8');
const managerDash = readFileSync('app/(manager)/manager/dashboard.tsx', 'utf8');
const transferDetail = readFileSync('src/features/transfers/TransferDetailsView.tsx', 'utf8');
const returnDetail = readFileSync('src/features/returns/ReturnDetailPane.tsx', 'utf8');
const receiveReturn = readFileSync('src/features/returns/ReceiveReturnScreen.tsx', 'utf8');
const m105 = readFileSync('tests/milestone10_5_live_verification.mjs', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const concurrency = readFileSync('tests/revision_7e_concurrency_postgres.mjs', 'utf8');

// Cash semantics
assert.equal(reportDisplay.formatRemittanceCashResult('pending', null, null), 'Pending reconciliation');
assert.equal(reportDisplay.formatRemittanceCashResult('reconciled', 'exact', 0), 'Exact');
assert.match(reportDisplay.formatRemittanceCashResult('reconciled', 'shortage', 50), /shortage/);
assert.match(reportDisplay.formatRemittanceCashResult('reconciled', 'excess', -25), /excess/);

// Inventory semantics from persisted discrepancy sign
assert.equal(reportDisplay.formatPersistedInventoryResult('exact', 0), 'Exact');
assert.equal(reportDisplay.formatPersistedInventoryResult('shortage', -2), '2 pcs shortage');
assert.equal(reportDisplay.formatPersistedInventoryResult('excess', 3), '3 pcs excess');

// Live PCS
assert.equal(reportDisplay.formatPcsQty(25), '25 pcs');
assert.equal(reportDisplay.formatPcsQty(null), '—');
assert.equal(format.formatLiveStock(0), '0 pcs');

// Movement labels
assert.equal(format.formatMovementType('opening_stock'), 'Opening stock');
assert.equal(format.formatMovementType('transfer_in'), 'Received transfer');
assert.equal(format.formatMovementType('transfer_out'), 'Sent transfer');
assert.equal(format.formatMovementType('return_out'), 'Returned leftover');
assert.equal(format.formatMovementType('unsold'), 'Unsold at close');
assert.equal(format.formatMovementType('waste'), 'Waste');

// Remittance UI
assert.match(remittance, /remittanceRowBadge/);
assert.match(remittance, /detailBase\/\$\{row\.shift_id\}|shift-remittances/);
assert.match(remittanceDetail, /product_name_snapshot/);
assert.match(remittanceDetail, /Unsold/);
assert.match(remittanceDetail, /Carried/);
assert.match(remittanceDetail, /Cash reconciliation only|inventory close was not required/i);
assert.match(remittanceDetail, /Pending|not available yet/i);
assert.doesNotMatch(remittanceDetail, /keep_at_branch|record_as_unsold/);
assert.match(shiftService, /getShiftCloseReportDetail/);
assert.match(shiftService, /shift_product_reconciliations/);
assert.match(shiftService, /listShiftRemittances\(null, 'all_time'\)/);

// Waste enrichment by stable keys
assert.match(shiftService, /shift_id:\$\{item\.product_id\}|\$\{shift\.shift_id\}:\$\{item\.product_id\}/);
assert.match(wasteUi, /occurrence_id|pcs waste|formatPcsQty/);
assert.doesNotMatch(ownerHub, /KG-meal waste/);
assert.doesNotMatch(managerDash, /KG-meal waste/);
assert.match(ownerHub, /Quantified PCS waste|PCS waste/);

// Branch performance / product sales / inventory recon
assert.match(branchPerf, /formatLiveStock/);
assert.doesNotMatch(branchPerf, /Not tracked|Unmeasured/);
assert.match(productSales, /Items sold|Total items sold/);
assert.doesNotMatch(productSales, /\bKG\b|kilogram/i);
assert.match(invRecon, /formatLiveStock/);
assert.doesNotMatch(invRecon, /formatSnapshottedQuantity/);

// Historical snapshot paths preserved
assert.match(transferDetail, /formatSnapshottedQuantity/);
assert.match(returnDetail, /formatSnapshottedQuantity/);
assert.match(receiveReturn, /does not restock Main/i);
assert.doesNotMatch(receiveReturn, /Restocked to Main/i);

// No invented modules
assert.doesNotMatch(ownerHub, /Unsold History|Inventory History|\/owner\/movements/);
assert.doesNotMatch(readFileSync('app/(owner)/_layout.tsx', 'utf8'), /owner\/movements/);

// Deprecated RPC cleanup in active scripts/docs
assert.doesNotMatch(m105, /close_cashier_shift/);
assert.match(m105, /begin_cashier_shift_close/);
assert.match(m105, /finalize_cashier_shift_reconciliation/);
assert.match(readme, /begin_cashier_shift_close/);
assert.doesNotMatch(readme, /close_cashier_shift`: cashier-only close/);

// Client write audit (services)
assert.doesNotMatch(shiftService, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
assert.match(readFileSync('src/services/inventoryService.ts', 'utf8'), /\.select\(/);
assert.doesNotMatch(readFileSync('src/services/inventoryService.ts', 'utf8'), /branch_inventory'\)\.(insert|update|upsert|delete)/);

// Concurrency script prepared
assert.match(concurrency, /TRUE POSTGRES CONCURRENCY/);
assert.match(concurrency, /begin_cashier_shift_close/);
assert.match(concurrency, /finalize_cashier_shift_reconciliation/);

// Stale InventoryModeField removed from active product features
assert.doesNotMatch(
  readFileSync('src/features/products/CreateProductWizard.tsx', 'utf8'),
  /InventoryModeField|kg_meal/,
);

console.log('revision_7e_reports_history: ok');
