import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Runs the real getOwnerTodayBranchSales against a scripted Supabase client.
const stubs = {
  '@/lib/supabase': `
    export const calls = [];
    export const responses = {};
    export const supabase = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        const next = responses[name];
        return typeof next === 'function' ? next(args) : next;
      },
    };
  `,
  '@/lib/format': `export const getTodayRangeManila = () => ({ start: '', end: '' });`,
};
const srcRoot = pathToFileURL(`${process.cwd()}/src/`).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) {
      return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      return { url: `${srcRoot}${specifier.slice(2)}.ts`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { getOwnerTodayBranchSales } = await import('../src/services/saleService.ts');
const { calls, responses } = await import('@/lib/supabase');

const activeRows = [
  { branch_id: 'a', branch_name: 'SM1', transaction_count: 2, total_sales: '240.00' },
  { branch_id: 'b', branch_name: 'SM2', transaction_count: 0, total_sales: 0 },
];

// Deployed: the new RPC result is used as-is; the old report is not called.
responses.get_owner_today_branch_sales = {
  data: { business_date: '2026-11-08', branches: [{ ...activeRows[0], is_active: false }] },
  error: null,
};
calls.length = 0;
let result = await getOwnerTodayBranchSales();
assert.equal(result.business_date, '2026-11-08');
assert.equal(result.branches[0].is_active, false);
assert.deepEqual(calls.map((c) => c.name), ['get_owner_today_branch_sales']);

// Not deployed (exact body returned by the live project on 2026-11-08): falls back to today's report.
responses.get_owner_today_branch_sales = {
  data: null,
  error: {
    code: 'PGRST202',
    message: 'Could not find the function public.get_owner_today_branch_sales without parameters in the schema cache',
  },
};
responses.report_sales_by_branch = { data: activeRows, error: null };
calls.length = 0;
result = await getOwnerTodayBranchSales();
assert.equal(result.business_date, null);
assert.deepEqual(result.branches, activeRows);
assert.deepEqual(calls, [
  { name: 'get_owner_today_branch_sales', args: undefined },
  { name: 'report_sales_by_branch', args: { p_range_type: 'today', p_start_date: null, p_end_date: null } },
]);

// Message-only variant (no code) also falls back.
responses.get_owner_today_branch_sales = {
  data: null,
  error: { message: 'Could not find the function public.get_owner_today_branch_sales without parameters' },
};
result = await getOwnerTodayBranchSales();
assert.equal(result.business_date, null);

// Fallback failure surfaces the report's error.
responses.report_sales_by_branch = { data: null, error: { code: '42501', message: 'Owner access required.' } };
await assert.rejects(() => getOwnerTodayBranchSales(), (error) => /Owner access required/.test(error.message));

// Any other error from the new RPC is thrown, never masked by the fallback.
responses.get_owner_today_branch_sales = {
  data: null,
  error: { code: '42501', message: 'Unauthorized: Owner access required.' },
};
responses.report_sales_by_branch = { data: activeRows, error: null };
calls.length = 0;
await assert.rejects(() => getOwnerTodayBranchSales(), (error) => /Owner access required/.test(error.message));
assert.deepEqual(calls.map((c) => c.name), ['get_owner_today_branch_sales'], 'no fallback on authorization errors');

// A different missing function does not trigger this fallback.
responses.get_owner_today_branch_sales = {
  data: null,
  error: { code: '42883', message: 'Could not find the function public.is_owner' },
};
await assert.rejects(() => getOwnerTodayBranchSales(), (error) => /is_owner/.test(error.message));

// Empty/null payloads are normalised.
responses.get_owner_today_branch_sales = { data: null, error: null };
assert.deepEqual(await getOwnerTodayBranchSales(), { business_date: null, branches: [] });

console.log('Owner Today Quickview fallback tests passed: deployed path, PGRST202 fallback, errors not masked.');
