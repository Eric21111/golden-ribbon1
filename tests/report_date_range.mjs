import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const formatSource = ts.transpileModule(readFileSync('src/lib/format.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { toStartOfDayManila, toNextDayStartManila, isReportRangeReady } = await import(
  `data:text/javascript;base64,${Buffer.from(formatSource).toString('base64')}`
);

assert.equal(isReportRangeReady('today'), true);
assert.equal(isReportRangeReady('all_time'), true);
assert.equal(isReportRangeReady('custom'), false);
assert.equal(isReportRangeReady('custom', '2026-09-01T00:00:00+08:00'), false);
assert.equal(isReportRangeReady('custom', undefined, '2026-09-07T00:00:00+08:00'), false);
assert.equal(
  isReportRangeReady('custom', '2026-09-01T00:00:00+08:00', '2026-09-07T00:00:00+08:00'),
  true
);

assert.equal(toStartOfDayManila('2026-09-01'), '2026-09-01T00:00:00+08:00');
assert.equal(toNextDayStartManila('2026-09-06'), '2026-09-07T00:00:00+08:00');
assert.equal(toStartOfDayManila(''), undefined);
assert.equal(toNextDayStartManila(''), undefined);

console.log('Report date-range tests passed: custom queries stay disabled until both dates exist; Sep 1–6 uses exclusive Manila end of Sep 7 00:00.');
