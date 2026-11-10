import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadTs } from './_load_ts.mjs';

const id = '40000000-0000-4000-8000-000000000001';
const shiftId = '20000000-0000-4000-8000-000000000001';
const branchId = '30000000-0000-4000-8000-000000000001';
const sale = { id, sale_number: 'SALE-1', shift_id: shiftId, total_amount: 25 };
const requests = [];
let respond;
const client = createClient('https://example.test', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(input); requests.push({ url, init });
    const result = respond(url, init);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200,
      headers: { 'content-type': 'application/json', ...(result.headers ?? {}) } });
  } },
});
const stubs = { '@/lib/supabase': { supabase: client } };
const sales = loadTs('src/services/saleService.ts', stubs);
const returns = loadTs('src/services/returnService.ts', stubs);

// Real Supabase query builder and exact outgoing REST embeds, including both FK schema paths.
respond = url => {
  if (url.pathname.endsWith('/sales')) return { body: sale };
  assert.equal(url.searchParams.get('select'), '*,product:products!sale_items_product_id_fkey(*)');
  assert.equal(url.searchParams.get('sale_id'), `eq.${id}`);
  return { body: [{ id: 'line', product_id: 'meal', drink_product_id: 'drink', drink_name: 'Cola', product: { name: 'Meal' } }] };
};
const details = await sales.getSale(id);
assert.equal(details.items[0].product.name, 'Meal');
assert.equal(details.items[0].drink_name, 'Cola');
const before = requests.length;
for (const invalid of ['', 'undefined', [id], 'not-a-uuid']) {
  await assert.rejects(sales.getSale(invalid), e => e.code === 'INVALID_SALE_ID');
}
assert.equal(requests.length, before, 'invalid IDs never reach the server');
respond = () => ({ status: 406, body: { code: 'PGRST116', message: 'No authorized row' } });
await assert.rejects(sales.getSale(id), e => e.code === 'PGRST116');
assert.equal(requests.length, before + 1, 'header failure does not trigger an item query');

const request = { shiftId, items: [], amountPaid: '25.00', key: 'sale-test-request-key' };
for (const malformed of [null, [], [sale], { ...sale, id: undefined }, { ...sale, shift_id: id }, { ...sale, total_amount: null }]) {
  respond = () => ({ body: malformed });
  await assert.rejects(sales.confirmSale(request), /could not be verified/);
}
respond = () => ({ body: sale });
assert.equal((await sales.confirmSale(request)).id, id);
respond = () => ({ status: 404, body: { code: 'PGRST202', message: 'missing signature' } });
const prior = requests.length;
await assert.rejects(sales.confirmSale(request), e => e.code === 'PGRST202');
assert.equal(requests.length, prior + 1, 'no unsafe fallback to legacy inventory semantics');

// Sales beyond the old 100-row cap remain available to client-side filters.
respond = url => ({ body: Array.from({ length: url.searchParams.get('offset') === '0' ? 100 : 7 }, (_, i) => ({ ...sale, id: `${url.searchParams.get('offset')}-${i}` })) });
assert.equal((await sales.listShiftSales(shiftId)).length, 107);

// Pagination/filter query is built at the server, with deterministic ordering and an exact count.
respond = url => {
  assert.equal(url.searchParams.get('offset'), '50');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('status'), 'eq.received');
  assert.equal(url.searchParams.get('returned_at'), 'gte.2026-11-01T00:00:00Z');
  assert.deepEqual(url.searchParams.getAll('returned_at'), ['gte.2026-11-01T00:00:00Z', 'lt.2026-12-01T00:00:00Z']);
  assert.match(url.searchParams.get('or'), /and\(or\(from_branch_id\.eq\./);
  assert.match(url.searchParams.get('or'), /return_number\.ilike\."%RET-000001%"/);
  assert.equal(url.searchParams.get('order'), 'returned_at.asc,id.asc');
  return { body: [{ id, return_number: 'RET-000001' }], headers: { 'content-range': '50-50/51' } };
};
const page = await returns.listReturnsPage({ branchId, status: 'received', search: 'RET-000001', sort: 'oldest',
  start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' }, 5, 10);
assert.equal(page.count, 51);
assert.equal(page.rows[0].return_number, 'RET-000001');
await assert.rejects(returns.listReturnsPage({ branchId: 'bad),status.eq.received' }), /Invalid return branch/);
respond = url => {
  const offset = Number(url.searchParams.get('offset'));
  return { body: Array.from({ length: offset === 0 ? 50 : 11 }, (_, i) => ({ id: offset + i })), headers: { 'content-range': `${offset}-${offset === 0 ? 49 : 60}/61` } };
};
assert.equal((await returns.listReturns()).length, 61, 'shared pane does not truncate history');
respond = () => ({ status: 416, body: { code: 'PGRST103', message: 'Requested range not satisfiable' } });
assert.deepEqual(await returns.listReturnsPage({}, 5, 10), { rows: [], count: 0 });
await assert.rejects(returns.listReturnsPage({}, 0, 10), e => e.code === 'PGRST103');
respond = () => ({ body: null });
await assert.rejects(returns.createStockReturn({}), /could not be verified/);
respond = () => ({ body: id });
assert.equal(await returns.createStockReturn({}), id);
console.log('Sales/returns client contracts passed: explicit joins, IDs, response shapes, no legacy downgrade, and complete filtered history.');
