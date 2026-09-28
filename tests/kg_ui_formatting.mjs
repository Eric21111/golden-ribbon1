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
  formatSellingBranchOnHand,
  formatSnapshottedQuantity,
  formatTransferDifference,
  formatTransferLineSummary,
  formatTransferReceivedQuantity,
  isValidInventoryQuantity,
} = loadTs('src/lib/format.ts');

const { getStockStatus } = loadTs('src/features/inventory/inventoryStatus.ts');

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

function inventoryItem({ mode, main, qty, updatedAt = '2026-09-01T00:00:00+08:00' }) {
  return {
    product: { inventory_mode: mode },
    branch: { is_main_branch: main },
    quantity_on_hand: qty,
    updated_at: updatedAt,
  };
}

// A. KG formatting
assert.equal(formatInventoryQuantity(10, 'kg_meal'), '10.000 kg');
assert.equal(formatInventoryQuantity(10.5, 'kg_meal'), '10.500 kg');
assert.equal(formatInventoryQuantity(10.125, 'kg_meal'), '10.125 kg');
assert.equal(formatLiveStock(10.5, 'kg_meal'), '10.500 kg');

// B. Piece formatting — integer-equivalent only
assert.equal(formatInventoryQuantity(24, 'piece_stock'), '24 pcs');
assert.equal(formatInventoryQuantity('24', 'piece_stock'), '24 pcs');
assert.equal(formatInventoryQuantity('24.000', 'piece_stock'), '24 pcs');
assert.equal(formatLiveStock(24, 'piece_stock'), '24 pcs');
assert.equal(formatInventoryQuantity(24.5, 'piece_stock'), INVALID_QUANTITY_LABEL);
assert.equal(formatInventoryQuantity('24.500', 'piece_stock'), INVALID_QUANTITY_LABEL);
assert.notEqual(formatInventoryQuantity(24.5, 'piece_stock'), '24 pcs');
assert.notEqual(formatInventoryQuantity(24.5, 'piece_stock'), '24.500 pcs');

// C. KG input precision
assert.equal(isValidInventoryQuantity('125.750', 'kg_meal'), true);
assert.equal('125.750'.length > 6, true);
assert.equal(KG_QUANTITY_MAX_LENGTH, 10);
assert.equal(PIECE_QUANTITY_MAX_LENGTH, 6);
assert.equal(isValidInventoryQuantity('125.7501', 'kg_meal'), false);
assert.equal(isValidInventoryQuantity('24.5', 'piece_stock'), false);
assert.match(setupSource, /KG_QUANTITY_MAX_LENGTH/);
assert.match(createTransferSource, /KG_QUANTITY_MAX_LENGTH/);
assert.doesNotMatch(setupSource, /maxLength=\{6\}/);
assert.doesNotMatch(createTransferSource, /maxLength=\{6\}/);

// D. Selling-branch KG
assert.equal(formatSellingBranchOnHand(0, 'kg_meal'), 'Not tracked');
assert.equal(formatSellingBranchOnHand(10.5, 'kg_meal'), 'Not tracked');
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: false, qty: 0 })), 'not_set');
assert.notEqual(getStockStatus(inventoryItem({ mode: 'kg_meal', main: false, qty: 0 })), 'out');
assert.match(branchPerf, /formatSellingBranchOnHand/);
assert.match(branchPerf, /useProducts/);
assert.doesNotMatch(branchPerf, /quantity_on_hand\} in stock/);

// E. Main KG — in stock, no piece low-stock threshold of 5
assert.equal(formatLiveStock(10.5, 'kg_meal'), '10.500 kg');
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: true, qty: 10.5 })), 'in_stock');
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: true, qty: 3 })), 'in_stock');
assert.equal(getStockStatus(inventoryItem({ mode: 'kg_meal', main: true, qty: 0 })), 'out');
assert.equal(getStockStatus(inventoryItem({ mode: 'piece_stock', main: true, qty: 3 })), 'low');
assert.match(managerInventory, /formatLiveStock|formatSellingBranchOnHand/);

// F. Confirmed KG receipt
assert.equal(formatTransferReceivedQuantity('received', null, 'kg_meal'), 'Unmeasured');
assert.equal(formatTransferReceivedQuantity('received', '', 'kg_meal'), 'Unmeasured');
assert.notEqual(formatTransferReceivedQuantity('received', null, 'kg_meal'), 'Pending');
assert.notEqual(formatSnapshottedQuantity(null, 'kg_meal'), '0.000 kg');
assert.equal(formatTransferLineSummary('received', 10.5, null, 'kg_meal'), 'Sent 10.500 kg · Received Unmeasured');

// G. Pending KG shipment
assert.equal(formatTransferReceivedQuantity('pending_receipt', null, 'kg_meal'), 'Pending');
assert.equal(formatTransferReceivedQuantity('draft', null, 'kg_meal'), 'Pending');
assert.equal(formatTransferReceivedQuantity('cancelled', null, 'kg_meal'), 'Cancelled');
assert.notEqual(formatTransferReceivedQuantity('pending_receipt', null, 'kg_meal'), 'Unmeasured');
assert.match(cashierIncoming, /formatTransferReceivedQuantity/);
assert.match(managerTransfer, /formatTransferLineSummary/);

// H. Piece receipt
assert.equal(formatSnapshottedQuantity(24, 'piece_stock'), '24 pcs');
assert.equal(formatSnapshottedQuantity(22, 'piece_stock'), '22 pcs');
assert.equal(formatTransferLineSummary('received', 24, 22, 'piece_stock'), 'Sent 24 pcs · Received 22 pcs');
assert.equal(formatTransferDifference('received', 24, 22, 'piece_stock'), '2 pcs');

// I. Mixed transfer + received_with_discrepancy
assert.equal(formatTransferReceivedQuantity('received_with_discrepancy', null, 'kg_meal'), 'Unmeasured');
assert.equal(formatTransferReceivedQuantity('received_with_discrepancy', 22, 'piece_stock'), '22 pcs');
assert.equal(
  formatTransferLineSummary('received_with_discrepancy', 10.5, null, 'kg_meal'),
  'Sent 10.500 kg · Received Unmeasured',
);
assert.equal(
  formatTransferLineSummary('received_with_discrepancy', 24, 22, 'piece_stock'),
  'Sent 24 pcs · Received 22 pcs',
);
assert.notEqual(formatTransferReceivedQuantity('received_with_discrepancy', null, 'kg_meal'), 'Pending');

// J. POS meal count — not KG
assert.match(posInventory, /MAX_POS_MEAL_QUANTITY = 999999/);
assert.match(posInventory, /not derived from KG delivered/i);
assert.match(cartStore, /MAX_POS_MEAL_QUANTITY/);
assert.match(posCard, /maxLength=\{6\}/);
assert.match(posSheet, /maxLength=\{6\}/);
assert.match(posRow, /KG-delivered meal/);
assert.doesNotMatch(posSheet, /Remaining KG|3 kg/);
assert.doesNotMatch(posCard, /3 kg|Remaining KG/);

// K. Historical snapshot stays on snapshotted mode
assert.equal(formatSnapshottedQuantity(5, 'piece_stock'), '5 pcs');
assert.equal(formatSnapshottedQuantity(5, 'kg_meal'), '5.000 kg');
assert.notEqual(formatSnapshottedQuantity(5, 'piece_stock'), '5.000 kg');

console.log('KG UI formatting tests passed: A–K plus received_with_discrepancy mixed transfer and invalid 24.500 pcs.');
