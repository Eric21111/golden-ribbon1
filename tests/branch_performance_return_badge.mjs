import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/reports/BranchPerformanceScreens.tsx', 'utf8');
assert.match(source, /useState<DateFilterType>\('all_time'\)/);
assert.equal((source.match(/useState<DateFilterType>\('all_time'\)/g) || []).length, 2);
assert.doesNotMatch(source, /useState<DateFilterType>\('today'\)/);
assert.match(source, /Return discrepancies appear after Main counts/);
assert.match(source, /showOlderReturnHint/);
assert.match(source, /None in this range/);
assert.match(source, /does not create a/);

console.log('Branch Performance return-badge tests passed: All Time default and older-issue hint.');
