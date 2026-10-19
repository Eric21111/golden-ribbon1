import { readFileSync, writeFileSync } from 'node:fs';

const path = 'supabase/migrations/20261019140000_phase3_inventory_operations.sql';
let sql = readFileSync(path, 'utf8');
const start = sql.indexOf('-- ---------------------------------------------------------------------------\n-- 5) create_complete_product');
const end = sql.indexOf('-- ---------------------------------------------------------------------------\n-- 6) initialize_main');
if (start < 0 || end < 0) {
  console.log('markers missing or already stripped', start, end);
  process.exit(0);
}
const replacement = `-- ---------------------------------------------------------------------------
-- 5) create_complete_product — keep Revision 7A body.
--    Enable KG after create via set_product_inventory_mode when balances are clear.
-- ---------------------------------------------------------------------------

`;
sql = sql.slice(0, start) + replacement + sql.slice(end);
writeFileSync(path, sql);
console.log('stripped create_complete_product rewrite', sql.length);
