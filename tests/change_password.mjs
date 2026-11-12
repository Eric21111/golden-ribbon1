import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

function loadTsModule(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const module = { exports: {} };
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      require: createRequire(path.resolve(sourcePath)),
    },
    { filename: sourcePath }
  );
  return module.exports;
}

const { changePasswordSchema } = loadTsModule('src/features/profile/changePasswordSchema.ts');
const { getChangePasswordErrorMessage } = loadTsModule('src/lib/errors.ts');

function issues(values) {
  const result = changePasswordSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

assert.deepEqual(issues({
  current_password: 'Current#1',
  new_password: '012345',
  confirm_password: '012345',
}), []);

assert.ok(issues({
  current_password: '',
  new_password: '012345',
  confirm_password: '012345',
}).some((message) => message.includes('Current password is required.')));

assert.ok(issues({
  current_password: 'Current#1',
  new_password: 'short',
  confirm_password: 'short',
}).some((message) => message.includes('Enter exactly six digits.')));

const mismatch = issues({
  current_password: 'Current#1',
  new_password: '012345',
  confirm_password: 'Current#3ok',
});
assert.ok(mismatch.some((message) => message.includes('PINs do not match.')));
assert.equal(mismatch.some((message) => message.toLowerCase().includes('auth')), false, 'Mismatch must be rejected before any Auth request');

assert.ok(issues({
  current_password: '123456',
  new_password: '123456',
  confirm_password: '123456',
}).some((message) => message.includes('Choose a different PIN.')));

assert.equal(
  getChangePasswordErrorMessage(new Error('Invalid login credentials')),
  'Current password is incorrect.'
);
assert.equal(
  getChangePasswordErrorMessage({ message: 'Auth session missing' }),
  'Your session has expired. Sign in again.'
);
assert.equal(
  getChangePasswordErrorMessage(new Error('Password should be different from the old password.')),
  'New password must be different from the current password.'
);
assert.equal(
  getChangePasswordErrorMessage(new Error('Password is known to be leaked and is too weak')),
  'The new PIN was rejected by the account security settings.'
);
assert.equal(
  getChangePasswordErrorMessage(new Error('TypeError: Failed to fetch')),
  'Unable to connect. Check your internet connection and try again.'
);
assert.equal(
  getChangePasswordErrorMessage(new Error('unexpected gotrue stack at AuthApiError')),
  'The password could not be changed. Please try again.'
);

const secret = 'SuperSecretPassword!42';
const leaked = getChangePasswordErrorMessage(new Error(`Invalid login credentials for ${secret}`));
assert.equal(leaked, 'Current password is incorrect.');
assert.equal(leaked.includes(secret), false);

const service = readFileSync('src/services/accountService.ts', 'utf8');
assert.match(service, /export async function changeOwnPassword\(currentPassword: string, newPassword: string\)/);
assert.equal(service.includes('userId'), false);
assert.equal(service.includes('user_id'), false);
assert.equal(service.includes('employeeId'), false);
assert.equal(service.includes('updateUserById'), false);
assert.match(service, /supabase\.auth\.signInWithPassword/);
assert.match(service, /supabase\.auth\.updateUser\(\{\s*password: newPassword\s*\}\)/);
assert.equal(service.includes('console.log'), false);
assert.equal(service.includes('end_cashier_shift'), false);
assert.equal(service.includes('confirm_sale'), false);
assert.equal(service.includes('branch_inventory'), false);
assert.equal(service.includes('profiles'), false);

const screen = readFileSync('src/features/profile/ChangePasswordForm.tsx', 'utf8');
assert.equal(screen.includes('console.log'), false);
assert.equal(screen.includes('user_id'), false);
assert.equal(screen.includes('userId'), false);
assert.match(screen, /<PinField/);
assert.match(readFileSync('src/components/PinField.tsx','utf8'), /secureTextEntry/);

for (const file of [
  'app/(owner)/owner/change-password.tsx',
  'app/(manager)/manager/change-password.tsx',
  'app/(cashier)/cashier/change-password.tsx',
]) {
  const route = readFileSync(file, 'utf8');
  assert.match(route, /export default (function )?ChangePasswordScreen/);
  assert.equal(route.includes('userId'), false);
}

assert.match(readFileSync('app/(owner)/_layout.tsx', 'utf8'), /RoleGuard role="owner"/);
assert.match(readFileSync('app/(manager)/_layout.tsx', 'utf8'), /RoleGuard role="manager"/);
assert.match(readFileSync('app/(cashier)/_layout.tsx', 'utf8'), /RoleGuard role="cashier"/);

console.log('Change-password tests passed: validation, current-password mapping, no target user id, no shift/inventory mutation, and sanitized errors.');
