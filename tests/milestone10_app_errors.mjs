import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sourcePath = 'src/lib/errors.ts';
const source = readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports }, { filename: sourcePath });
const { getErrorMessage, getCheckoutFailure, getInventoryErrorMessage } = module.exports;

const secretBackendError = new Error('SQL failed at public.sales; service_role token=super-secret; stack trace follows');
assert.equal(getErrorMessage(secretBackendError), 'Something went wrong. Please try again.');
assert.ok(!getErrorMessage(secretBackendError).includes('super-secret'));

const networkFailure = getCheckoutFailure(new Error('TypeError: Failed to fetch'));
assert.equal(networkFailure.preserveRequest, true, 'Unknown transport outcome must retain the identical idempotent request');
assert.equal(networkFailure.message, 'Confirmation could not be verified. Retry this same order before making changes.');
assert.ok(!networkFailure.message.includes('Failed to fetch'));

const serializationFailure = getCheckoutFailure({ code: '40001', message: 'could not serialize access due to concurrent update' });
assert.equal(serializationFailure.preserveRequest, true, 'Serialization failures are safe to retry with the same idempotency key');

const deadlockFailure = getCheckoutFailure({ code: '40P01', message: 'deadlock detected in internal relation' });
assert.equal(deadlockFailure.preserveRequest, true, 'Deadlocks are safe to retry with the same idempotency key');

const rejectedFailure = getCheckoutFailure({ code: '42501', message: 'permission denied for relation sales' });
assert.equal(rejectedFailure.preserveRequest, false, 'Definitive authorization rejection must allow the order to be corrected');
assert.ok(!rejectedFailure.message.includes('relation sales'));

assert.equal(
  getInventoryErrorMessage(new Error('Insufficient stock for product CHICKEN')),
  'There is not enough stock to complete this operation.'
);

console.log('Milestone 10 app error tests passed: backend details are sanitized and retryable/unknown checkout outcomes preserve the identical request.');
