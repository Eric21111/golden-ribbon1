import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

const { changeEmailSchema } = loadTsModule('src/features/profile/changeEmailSchema.ts');
const { getChangeEmailErrorMessage } = loadTsModule('src/lib/errors.ts');
const { canChangeOwnEmail } = loadTsModule('src/features/auth/roles.ts');

function issues(currentEmail, values) {
  const result = changeEmailSchema(currentEmail).safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

assert.deepEqual(issues('owner@example.com', {
  current_password: 'Current#1',
  new_email: 'owner-new@example.com',
  confirm_email: 'owner-new@example.com',
}), []);

assert.deepEqual(issues('owner@example.com', {
  current_password: 'Current#1',
  new_email: '  owner-new@example.com  ',
  confirm_email: 'owner-new@example.com',
}), []);

assert.ok(issues('owner@example.com', {
  current_password: '',
  new_email: 'owner-new@example.com',
  confirm_email: 'owner-new@example.com',
}).some((message) => message.includes('Current password is required.')));

assert.ok(issues('owner@example.com', {
  current_password: 'Current#1',
  new_email: 'not-an-email',
  confirm_email: 'not-an-email',
}).some((message) => message.includes('Enter a valid email address.')));

const mismatch = issues('owner@example.com', {
  current_password: 'Current#1',
  new_email: 'a@example.com',
  confirm_email: 'b@example.com',
});
assert.ok(mismatch.some((message) => message.includes('Emails do not match.')));

assert.ok(issues('owner@example.com', {
  current_password: 'Current#1',
  new_email: 'owner@example.com',
  confirm_email: 'owner@example.com',
}).some((message) => message.includes('New email must be different from the current email.')));

assert.ok(issues('Owner@Example.com', {
  current_password: 'Current#1',
  new_email: 'owner@example.com',
  confirm_email: 'owner@example.com',
}).some((message) => message.includes('New email must be different from the current email.')));

assert.equal(
  getChangeEmailErrorMessage(new Error('Invalid login credentials')),
  'Current password is incorrect.'
);
assert.equal(
  getChangeEmailErrorMessage({ message: 'Auth session missing' }),
  'Your session has expired. Sign in again.'
);
assert.equal(
  getChangeEmailErrorMessage(new Error('Unauthorized: email changes are limited to the Owner and Main Branch Manager.')),
  'You are not authorized to change this email.'
);
assert.equal(
  getChangeEmailErrorMessage(new Error('A user with this email address has already been registered')),
  'That email is already registered.'
);
assert.equal(
  getChangeEmailErrorMessage(new Error('Unable to validate email address: invalid format')),
  'Enter a valid email address.'
);
assert.equal(
  getChangeEmailErrorMessage(new Error('TypeError: Failed to fetch')),
  'Unable to connect. Check your internet connection and try again.'
);
assert.equal(
  getChangeEmailErrorMessage(new Error('unexpected gotrue stack at AuthApiError')),
  'The email could not be changed. Please try again.'
);

const secret = 'SuperSecretPassword!42';
const leaked = getChangeEmailErrorMessage(new Error(`Invalid login credentials for ${secret}`));
assert.equal(leaked, 'Current password is incorrect.');
assert.equal(leaked.includes(secret), false);

assert.equal(canChangeOwnEmail({ role: 'owner', branch: null }), true);
assert.equal(canChangeOwnEmail({ role: 'manager', branch: { is_main_branch: true } }), true);
assert.equal(canChangeOwnEmail({ role: 'manager', branch_id: 'x', branch: { is_main_branch: false } }), false);
assert.equal(canChangeOwnEmail({ role: 'cashier', branch: { is_main_branch: false } }), false);

const service = readFileSync('src/services/accountService.ts', 'utf8');
assert.match(service, /export async function changeOwnEmail\(currentPassword: string, newEmail: string\)/);
assert.match(service, /assert_can_change_own_email/);
assert.match(service, /supabase\.auth\.signInWithPassword/);
assert.match(service, /supabase\.auth\.updateUser\(\{\s*email:/);
assert.equal(service.includes('userId'), false);
assert.equal(service.includes('user_id'), false);
assert.equal(service.includes('employeeId'), false);
assert.equal(service.includes('updateUserById'), false);
assert.equal(service.includes('service_role'), false);
assert.equal(service.includes('console.log'), false);
assert.equal(service.includes('end_cashier_shift'), false);
assert.equal(service.includes('confirm_sale'), false);
assert.equal(service.includes('branch_inventory'), false);
assert.equal(service.includes('.from(\'profiles\')'), false);

const form = readFileSync('src/features/profile/ChangeEmailForm.tsx', 'utf8');
assert.equal(form.includes('console.log'), false);
assert.equal(form.includes('user_id'), false);
assert.equal(form.includes('userId'), false);
assert.match(form, /secureTextEntry/);
assert.match(form, /Verification has been sent to your email/);

const account = readFileSync('src/features/profile/AccountScreen.tsx', 'utf8');
assert.match(account, /canChangeOwnEmail/);
assert.match(account, /Change email/);
assert.match(account, /Waiting for verification/);

const ownerRoute = readFileSync('app/(owner)/owner/change-email.tsx', 'utf8');
const managerRoute = readFileSync('app/(manager)/manager/change-email.tsx', 'utf8');
assert.match(ownerRoute, /EmailChangeGuard/);
assert.match(managerRoute, /EmailChangeGuard/);
assert.equal(existsSync('app/(cashier)/cashier/change-email.tsx'), false);

const guard = readFileSync('src/features/auth/EmailChangeGuard.tsx', 'utf8');
assert.match(guard, /canChangeOwnEmail/);
assert.match(guard, /Selling Branch Managers cannot change their own email/);

const migration = readFileSync('supabase/migrations/20260912120000_milestone_11_1_change_own_email.sql', 'utf8');
assert.match(migration, /is_owner\(\) or public\.is_main_branch_manager\(\)/);
assert.equal(migration.includes('service_role'), false);

console.log('Change-email tests passed: validation, authorization, no target user id, and pending-verification copy.');
