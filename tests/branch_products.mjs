import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);

const migrations = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .sort();
const milestone12 = '20260918133000_milestone_12_branch_products.sql';
const applyMigration = (file) =>
  db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );

for (const file of migrations.filter((file) => file < milestone12)) {
  await applyMigration(file);
}

const id = (n) => `12000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainManager = id(2);
const manager1 = id(3);
const manager2 = id(4);
const cashier1 = id(5);
const cashier2 = id(6);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const chicken = id(20);
const burger = id(21);
const spaghetti = id(22);
const inactive = id(23);

// This data predates Milestone 12. Only existing selling-branch inventory rows
// should become catalog entries when the migration is applied.
await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),
    ('${mainManager}','main-manager@test'),
    ('${manager1}','manager-1@test'),
    ('${manager2}','manager-2@test'),
    ('${cashier1}','cashier-1@test'),
    ('${cashier2}','cashier-2@test');

  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch1}','Branch 1','B1',false,true),
    ('${branch2}','Branch 2','B2',false,true);

  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainManager}','Main Manager','manager','${main}'),
    ('${manager1}','Manager 1','manager','${branch1}'),
    ('${manager2}','Manager 2','manager','${branch2}'),
    ('${cashier1}','Cashier 1','cashier','${branch1}'),
    ('${cashier2}','Cashier 2','cashier','${branch2}');

  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${chicken}','Chicken Butter','CHK',80,true),
    ('${burger}','Burger','BURG',70,true),
    ('${spaghetti}','Spaghetti','SPAG',75,true),
    ('${inactive}','Inactive Product','OLD',10,false);

  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch1}','${chicken}',5),
    ('${branch1}','${burger}',0),
    ('${branch2}','${chicken}',5);

  insert into public.inventory_movements(
    branch_id,product_id,movement_type,quantity,reference_type,created_by
  ) values
    ('${branch1}','${chicken}','opening_stock',5,'opening_stock','${mainManager}'),
    ('${branch2}','${chicken}','opening_stock',5,'opening_stock','${mainManager}');
`);

await applyMigration(milestone12);
for (const file of migrations.filter((file) => file > milestone12)) {
  await applyMigration(file);
}

const migrated = (
  await db.query(
    'select branch_id,product_id,selling_price from public.branch_products order by branch_id,product_id',
  )
).rows;
assert.equal(migrated.length, 3, 'only selling-branch inventory rows are backfilled');
assert.ok(migrated.every((row) => row.branch_id !== main), 'Main Branch has no branch catalog');
assert.ok(
  migrated.some(
    (row) =>
      row.branch_id === branch1 &&
      row.product_id === chicken &&
      Number(row.selling_price) === 80,
  ),
  'base product price initializes existing catalog rows',
);
assert.ok(
  !migrated.some((row) => row.product_id === spaghetti),
  'products without existing branch inventory are not cross-joined',
);

const asUser = async (userId, fn) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

const configure = (branchId, items) =>
  db.query('select public.configure_branch_products($1,$2::jsonb)', [
    branchId,
    JSON.stringify(items),
  ]);

await asUser(mainManager, async () => {
  await configure(branch1, [
    { product_id: chicken, selling_price: 80, is_active: true },
    { product_id: burger, selling_price: 70, is_active: true },
    { product_id: spaghetti, selling_price: 75, is_active: false },
  ]);
  await configure(branch2, [
    { product_id: chicken, selling_price: 95, is_active: true },
    { product_id: burger, selling_price: 70, is_active: false },
    { product_id: spaghetti, selling_price: 75, is_active: true },
  ]);
  await db.query(
    `select public.initialize_main_branch_inventory(
      '[{"product_id":"${chicken}","quantity":100},{"product_id":"${burger}","quantity":20},{"product_id":"${spaghetti}","quantity":20}]'::jsonb,
      'Milestone 12 opening stock'
    )`,
  );
});

assert.equal(
  Number(
    (
      await db.query(
        'select count(*) n from public.branch_products where product_id=$1',
        [burger],
      )
    ).rows[0].n,
  ),
  1,
  'a never-carried disabled item does not create a branch catalog row',
);

await asUser(owner, async () => {
  await assert.rejects(
    configure(branch1, [{ product_id: chicken, selling_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.exec(
      `update public.branch_products set selling_price=1 where branch_id='${branch1}'`,
    ),
    /permission denied/,
  );
});

await asUser(manager1, async () => {
  const own = (await db.query('select * from public.branch_products')).rows;
  assert.ok(own.length >= 2);
  assert.ok(own.every((row) => row.branch_id === branch1));
  await assert.rejects(
    configure(branch2, [{ product_id: chicken, selling_price: 1, is_active: true }]),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.exec(
      `update public.branch_products set selling_price=1 where branch_id='${branch1}'`,
    ),
    /permission denied/,
  );
});

const shifts = {};
await asUser(cashier1, async () => {
  const beforeShift = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  assert.deepEqual(
    new Set(beforeShift.map((row) => row.product_id)),
    new Set([chicken, burger]),
  );
  assert.equal(
    Number(beforeShift.find((row) => row.product_id === chicken).selling_price),
    80,
  );
  assert.equal(
    Number(beforeShift.find((row) => row.product_id === burger).quantity_on_hand),
    0,
    'assigned out-of-stock products remain in the POS catalog',
  );
  assert.ok(beforeShift.every((row) => row.product_id !== inactive));

  shifts.branch1 = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const prices = (
    await db.query(
      `select * from public.get_cashier_product_prices(array['${chicken}','${burger}']::uuid[])`,
    )
  ).rows;
  assert.equal(
    Number(prices.find((row) => row.product_id === chicken).selling_price),
    80,
  );
  await assert.rejects(
    db.query(
      `select * from public.get_cashier_product_prices(array['${spaghetti}']::uuid[])`,
    ),
    /not available in this branch catalog/,
  );

  const first = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [
        shifts.branch1,
        JSON.stringify([{ product_id: chicken, quantity: 2, unit_price: 0.01 }]),
        '200.00',
        'branch1-price-sale-key01',
      ],
    )
  ).rows[0];
  assert.equal(Number(first.total_amount), 160);
  assert.equal(Number(first.change_amount), 40);
  shifts.branch1FirstSale = first.id;

  const retry = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [
        shifts.branch1,
        JSON.stringify([{ product_id: chicken, quantity: 2 }]),
        '200.00',
        'branch1-price-sale-key01',
      ],
    )
  ).rows[0];
  assert.equal(retry.id, first.id, 'sale confirmation remains idempotent');

  await assert.rejects(
    db.query(
      'select public.confirm_sale($1,$2::jsonb,$3,$4)',
      [
        shifts.branch1,
        JSON.stringify([{ product_id: burger, quantity: 1 }]),
        '100.00',
        'branch1-oos-sale-key001',
      ],
    ),
    /Insufficient stock/,
  );
  assert.equal(
    (await db.query('select * from public.branch_products')).rows.length,
    0,
    'cashiers cannot read branch pricing directly',
  );
  await assert.rejects(
    db.exec(
      `update public.branch_products set selling_price=1 where branch_id='${branch1}'`,
    ),
    /permission denied/,
  );
});

await asUser(cashier2, async () => {
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  assert.deepEqual(
    new Set(pos.map((row) => row.product_id)),
    new Set([chicken, spaghetti]),
  );
  assert.equal(
    Number(pos.find((row) => row.product_id === chicken).selling_price),
    95,
  );
  assert.ok(pos.every((row) => row.product_id !== burger));

  shifts.branch2 = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const sale = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [
        shifts.branch2,
        JSON.stringify([{ product_id: chicken, quantity: 2 }]),
        '200.00',
        'branch2-price-sale-key01',
      ],
    )
  ).rows[0];
  assert.equal(Number(sale.total_amount), 190);
  await assert.rejects(
    db.query(
      'select public.confirm_sale($1,$2::jsonb,$3,$4)',
      [
        shifts.branch2,
        JSON.stringify([{ product_id: burger, quantity: 1 }]),
        '100.00',
        'branch2-burger-reject01',
      ],
    ),
    /not available in this branch catalog/,
  );
});

await asUser(mainManager, async () => {
  // Transfer-driven branch catalog: sending a never-carried product without a
  // destination price is rejected instead of silently defaulting a price.
  await assert.rejects(
    db.query(
      `select public.send_stock_transfer(
        '${branch2}',
        '[{"product_id":"${burger}","quantity_sent":1}]'::jsonb,
        null,
        'branch2-burger-noprice01'
      )`,
    ),
    /destination price/i,
  );
  assert.equal(
    Number(
      (
        await db.query(
          `select quantity_on_hand from public.branch_inventory
           where branch_id='${main}' and product_id='${burger}'`,
        )
      ).rows[0].quantity_on_hand,
    ),
    20,
    'rejected transfer does not deduct Main Branch stock',
  );
  assert.equal(
    Number(
      (
        await db.query(
          'select count(*) n from public.branch_products where branch_id=$1 and product_id=$2',
          [branch2, burger],
        )
      ).rows[0].n,
    ),
    0,
    'rejected transfer does not create a branch catalog row',
  );

  // A destination price provisions the branch catalog without it needing to
  // be configured beforehand, and never copies another branch's price.
  await db.query(
    `select public.send_stock_transfer(
      '${branch2}',
      '[{"product_id":"${burger}","quantity_sent":3,"destination_price":65}]'::jsonb,
      null,
      'branch2-burger-newprice01'
    )`,
  );
  const createdCatalog = (
    await db.query(
      'select selling_price,is_active from public.branch_products where branch_id=$1 and product_id=$2',
      [branch2, burger],
    )
  ).rows[0];
  assert.equal(
    Number(createdCatalog.selling_price),
    65,
    'destination price is used, not copied from another branch (branch1 sells burger at 70)',
  );
  assert.equal(createdCatalog.is_active, true);
  assert.equal(
    Number(
      (
        await db.query(
          `select quantity_on_hand from public.branch_inventory
           where branch_id='${main}' and product_id='${burger}'`,
        )
      ).rows[0].quantity_on_hand,
    ),
    17,
    'accepted transfer deducts Main Branch stock',
  );

  // Deactivating the catalog entry and sending again reactivates it and
  // preserves its existing price when no new price is given.
  await configure(branch2, [
    { product_id: burger, selling_price: 65, is_active: false },
  ]);
  await db.query(
    `select public.send_stock_transfer(
      '${branch2}',
      '[{"product_id":"${burger}","quantity_sent":2}]'::jsonb,
      null,
      'branch2-burger-reactivate01'
    )`,
  );
  const reactivatedCatalog = (
    await db.query(
      'select selling_price,is_active from public.branch_products where branch_id=$1 and product_id=$2',
      [branch2, burger],
    )
  ).rows[0];
  assert.equal(reactivatedCatalog.is_active, true, 'transfer reactivates an inactive catalog entry');
  assert.equal(Number(reactivatedCatalog.selling_price), 65, 'reactivation preserves the existing price');

  await configure(branch1, [
    { product_id: chicken, selling_price: 90, is_active: true },
  ]);
});

await asUser(cashier1, async () => {
  const prices = (
    await db.query(
      `select * from public.get_cashier_product_prices(array['${chicken}']::uuid[])`,
    )
  ).rows;
  assert.equal(Number(prices[0].selling_price), 90);

  const next = (
    await db.query(
      'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
      [
        shifts.branch1,
        JSON.stringify([{ product_id: chicken, quantity: 1 }]),
        '100.00',
        'branch1-new-price-key001',
      ],
    )
  ).rows[0];
  assert.equal(Number(next.total_amount), 90);
  shifts.branch1SecondSale = next.id;
});

assert.equal(
  Number(
    (
      await db.query(
        'select unit_price from public.sale_items where sale_id=$1',
        [shifts.branch1FirstSale],
      )
    ).rows[0].unit_price,
  ),
  80,
  'old sale keeps its snapshotted unit price',
);
assert.equal(
  Number(
    (
      await db.query(
        'select unit_price from public.sale_items where sale_id=$1',
        [shifts.branch1SecondSale],
      )
    ).rows[0].unit_price,
  ),
  90,
  'new sale uses the changed branch price',
);

await asUser(mainManager, async () => {
  await configure(branch1, [
    { product_id: chicken, selling_price: 90, is_active: false },
  ]);
});

await asUser(cashier1, async () => {
  const pos = (await db.query('select * from public.list_cashier_pos_inventory()')).rows;
  assert.ok(pos.every((row) => row.product_id !== chicken));
  await assert.rejects(
    db.query(
      'select public.confirm_sale($1,$2::jsonb,$3,$4)',
      [
        shifts.branch1,
        JSON.stringify([{ product_id: chicken, quantity: 1 }]),
        '100.00',
        'disabled-product-sale01',
      ],
    ),
    /not available in this branch catalog/,
  );
});

await asUser(manager1, async () => {
  const returnable = (await db.query('select * from public.list_return_inventory()')).rows;
  assert.ok(
    returnable.some(
      (row) => row.product_id === chicken && Number(row.quantity_on_hand) === 2,
    ),
    'disabled catalog products with stock remain returnable',
  );
  const returnId = (
    await db.query(
      `select public.create_stock_return(
        '[{"product_id":"${chicken}","quantity_returned":1}]'::jsonb,
        'disabled catalog return',
        'disabled-product-return01'
      ) id`,
    )
  ).rows[0].id;
  assert.ok(returnId);
});

await asUser(owner, async () => {
  const result = (
    await db.query('select public.report_inventory_reconciliation() result')
  ).rows[0].result;
  const reconciliation = typeof result === 'string' ? JSON.parse(result) : result;
  assert.ok(
    reconciliation.every((row) => Number(row.variance) === 0),
    'catalog changes do not disturb inventory reconciliation',
  );
});

const cleanupProduct = id(99);
await db.exec(`
  insert into public.products(id,name,sku,selling_price)
  values ('${cleanupProduct}','Cleanup Product','CLEANUP',1);
  insert into public.branch_products(branch_id,product_id,selling_price)
  values ('${branch1}','${cleanupProduct}',1);
  delete from public.products where id='${cleanupProduct}';
`);
assert.equal(
  Number(
    (
      await db.query(
        'select count(*) n from public.branch_products where product_id=$1',
        [cleanupProduct],
      )
    ).rows[0].n,
  ),
  0,
  'fixture product cleanup cascades catalog-only child rows',
);

await db.close();
console.log(
  'Branch product tests passed: migration backfill, branch pricing/catalogs, POS, checkout, transfers, historical prices, out-of-stock, returns, RLS, idempotency, negative-stock prevention, and reconciliation.',
);
