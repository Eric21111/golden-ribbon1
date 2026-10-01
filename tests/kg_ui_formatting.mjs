import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function loadTs(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports }, { filename: sourcePath });
  return module.exports;
}

const {
  INVALID_QUANTITY_LABEL,
  KG_QUANTITY_MAX_LENGTH,
  PIECE_QUANTITY_MAX_LENGTH,
  formatInventoryQuantity,
  formatLiveStock,
  formatReportLiveOnHand,
  formatSellingBranchOnHand,
  formatSnapshottedQuantity,
  formatTransferDifference,
  formatTransferLineSummary,
  formatTransferReceivedQuantity,
  isValidInventoryQuantity,
  isValidPieceQuantity,
} = loadTs('src/lib/format.ts');

const { getStockStatus, stockStatusLabelForItem } = loadTs('src/features/inventory/inventoryStatus.ts');

const setupSource = readFileSync('src/features/inventory/InventorySetupScreen.tsx', 'utf8');
const createTransferSource = readFileSync('src/features/transfers/CreateTransferScreen.tsx', 'utf8');
const posCard = readFileSync('src/features/pos/PosProductCard.tsx', 'utf8');
const posSheet = readFileSync('src/features/pos/PosItemSheet.tsx', 'utf8');
const posRow = readFileSync('src/features/pos/PosProductRow.tsx', 'utf8');
const cartStore = readFileSync('src/stores/cartStore.ts', 'utf8');
const posInventory = readFileSync('src/features/pos/posInventory.ts', 'utf8');
const branchPerf = readFileSync('src/features/reports/BranchPerformanceScreens.tsx', 'utf8');
const managerInventory = readFileSync('app/(manager)/manager/inventory/index.tsx', 'utf8');
const managerTransfer = readFileSync('app/(manager)/manager/transfers/[id].tsx', 'utf8');
const cashierIncoming = readFileSync('app/(cashier)/cashier/incoming.tsx', 'utf8');
const managerIncomingDetail = readFileSync('app/(manager)/manager/incoming/[id].tsx', 'utf8');
const ownerInventory = readFileSync('app/(owner)/owner/inventory-by-branch.tsx', 'utf8');

function inventoryItem({ mode, main, qty, updatedAt = '2026-09-01T00:00:00+08:00' }) {
  return {
    product: { inventory_mode: mode },
    branch: { is_main_branch: main },
    quantity_on_hand: qty,
    updated_at: updatedAt,
  };
}

// A. Historical KG formatting (snapshots / labels)
assert.equal(formatInventoryQuantity(10, 'kg_meal'), '10.000 kg');
assert.equal(formatInventoryQuantity(10.5, 'kg_meal'), '10.500 kg');
assert.equal(formatInventoryQuantity(10.125, 'kg_meal'), '10.125 kg');

// B. Live operational inventory is PCS-only
assert.equal(formatLiveStock(24, 'kg_meal'), '24 pcs');
assert.equal(formatLiveStock(24, 'piece_stock'), '24 pcs');
assert.equal(formatSellingBranchOnHand(0, 'kg_meal'), '0 pcs');
assert.equal(formatSellingBranchOnHand(24, 'kg_meal'), '24 pcs');
assert.equal(formatReportLiveOnHand(0, 'kg_meal', false), '0 pcs');
assert.equal(formatReportLiveOnHand(24, 'kg_meal', true), '24 pcs');
assert.equal(formatReportLiveOnHand(24, 'piece_stock', true), '24 pcs');
assert.equal(formatReportLiveOnHand(0, undefined, false), '0 pcs');

// C. Piece formatting — integer-equivalent only
assert.equal(formatInventoryQuantity(24, 'piece_stock'), '24 pcs');
assert.equal(formatInventoryQuantity('24', 'piece_stock'), '24 pcs');
assert.equal(formatInventoryQuantity('24.000', 'piece_stock'), '24 pcs');
assert.equal(formatInventoryQuantity(24.5, 'piece_stock'), INVALID_QUANTITY_LABEL);
assert.equal(isValidPieceQuantity('24'), true);
assert.equal(isValidPieceQuantity('24.5'), false);
assert.equal(isValidInventoryQuantity('125.750', 'kg_meal'), true);
assert.equal(KG_QUANTITY_MAX_LENGTH, 10);
assert.equal(PIECE_QUANTITY_MAX_LENGTH, 6);
assert.doesNotMatch(setupSource, /KG_QUANTITY_MAX_LENGTH/);
assert.doesNotMatch(createTransferSource, /KG_QUANTITY_MAX_LENGTH/);
assert.match(setupSource, /PIECE_QUANTITY_MAX_LENGTH/);
assert.match(createTransferSource, /PIECE_QUANTITY_MAX_LENGTH/);

// D. Selling-branch live stock uses PCS status (no KG "not tracked")
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: false, qty: 0 })), 'out');
assert.equal(stockStatusLabelForItem(inventoryItem({ mode: 'kg_meal', main: false, qty: 0 })), 'Out');
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: true, qty: 10 })), 'in_stock');
assert.match(branchPerf, /formatLiveStock/);
assert.doesNotMatch(branchPerf, /formatReportLiveOnHand/);
assert.doesNotMatch(ownerInventory, /Not tracked/);
assert.match(managerIncomingDetail, /Cashiers confirm arrival/);
assert.doesNotMatch(managerIncomingDetail, /useReceiveTransfer|receiveTransfer\(/);
assert.doesNotMatch(readFileSync('src/services/transferService.ts', 'utf8'), /receive_stock_transfer/);
assert.doesNotMatch(readFileSync('src/hooks/useTransfers.ts', 'utf8'), /receiveTransfer/);

// E. Main branch low-stock threshold applies to PCS live stock
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: true, qty: 3 })), 'low');
assert.equal(getStockStatus(inventoryItem({ mode: 'piece_stock', main: true, qty: 3 })), 'low');
assert.match(managerInventory, /formatLiveStock/);

// F. Confirmed KG receipt (historical)
assert.equal(formatTransferReceivedQuantity('received', null, 'kg_meal'), 'Unmeasured');
assert.equal(formatTransferLineSummary('received', 10.5, null, 'kg_meal'), 'Sent 10.500 kg · Received Unmeasured');

// G. Pending KG shipment (historical)
assert.equal(formatTransferReceivedQuantity('pending_receipt', null, 'kg_meal'), 'Pending');
assert.match(cashierIncoming, /formatSnapshottedQuantity/);
assert.doesNotMatch(cashierIncoming, /isKgMeal/);
assert.match(managerTransfer, /formatTransferLineSummary/);

// H. Piece receipt
assert.equal(formatSnapshottedQuantity(24, 'piece_stock'), '24 pcs');
assert.equal(formatTransferDifference('received', 24, 22, 'piece_stock'), '2 pcs');

// I. Mixed transfer + received_with_discrepancy (historical KG)
assert.equal(formatTransferReceivedQuantity('received_with_discrepancy', null, 'kg_meal'), 'Unmeasured');

// J. POS — PCS stock caps, no KG meal mode
assert.doesNotMatch(posInventory, /MAX_POS_MEAL_QUANTITY/);
assert.doesNotMatch(cartStore, /MAX_POS_MEAL_QUANTITY/);
assert.match(posCard, /maxLength=\{6\}/);
assert.match(posSheet, /maxLength=\{6\}/);
assert.match(posRow, /Available:.*pcs/);
assert.doesNotMatch(posSheet, /Remaining KG|3 kg|KG-delivered meal/);
assert.doesNotMatch(posCard, /3 kg|Remaining KG|KG-delivered meal/);

// K. Historical snapshot stays mode-aware
assert.equal(formatSnapshottedQuantity(5, 'piece_stock'), '5 pcs');
assert.equal(formatSnapshottedQuantity(5, 'kg_meal'), '5.000 kg');

console.log('KG UI formatting tests passed: live PCS + historical KG snapshots.');
