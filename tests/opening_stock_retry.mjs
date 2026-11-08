// Opening stock when "which products need stock" cannot be loaded: nothing is listed and nothing can be submitted, a Retry is offered,
// and what was typed stays in the form. A quantity typed for a product that turns out to have no stock of its own is never counted,
// shown or submitted. Source checks for the screen plus the real react-hook-form engine for the form-state facts it relies on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const src = read('src/features/inventory/InventorySetupScreen.tsx');
const at = (needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

// ---------------------------------------------------------------- 1. the failure screen
{
  const errorScreen = at('if (setupData.isError) {');
  assert.ok(src.slice(errorScreen, errorScreen + 500).includes('onRetry={() => void refetchSetup()}'), 'Retry reloads only the setup data (the form is not touched)');
  assert.ok(src.slice(errorScreen, errorScreen + 500).includes("so nothing can be saved yet. What you entered is kept."));
  // it comes AFTER every hook (so the form and the typed quantities stay mounted in this component) and before the list and the review
  const lastHook = Math.max(...[...src.matchAll(/\buse(?:Form|FieldArray|Memo|Effect|Callback|FocusEffect|State|Ref)\(/g)].map((m) => m.index));
  assert.ok(errorScreen > lastHook, 'no hook is skipped by the early return');
  assert.ok(errorScreen < at('const onReview = handleSubmit('));
  assert.ok(errorScreen < at('if (review) {'), 'also replaces the review screen (nothing can be confirmed)');
  // while it loads for the first time nothing is listed either
  assert.ok(src.includes('if (branches.isLoading || inventory.isLoading || setupData.isLoading) {'));
  // the old behaviour (list everything when it cannot be worked out) is gone
  assert.doesNotMatch(src, /every product is listed as before/);
  // submission is blocked even if something slipped through
  assert.ok(src.includes('if (!fresh) return;'), 'never submit without a fresh setup (Review and Confirm both re-check)');
  // the retry path never resets or rewrites the form
  const retryRegion = src.slice(errorScreen, errorScreen + 500);
  assert.doesNotMatch(retryRegion, /reset\(|setValue|setReview/);
  // the form is not told to drop values of fields that are not rendered (the failure screen unmounts the inputs)
  assert.doesNotMatch(src, /shouldUnregister/);
  // the form is only reset when the set of products changes, never because the setup data was refetched
  assert.ok(src.includes('if (nextIds === productIdsRef.current) return;'));
  assert.ok(src.includes('}, [getValues, inventory.data, reset]);'), 'the reset effect does not depend on the setup data');
  console.log('1. failure screen: ok');
}

// ---------------------------------------------------------------- 2. what counts
{
  assert.ok(src.includes('const countableIds = useMemo(() => new Set(countableItems.map((item) => item.product.id)), [countableItems]);'));
  assert.ok(src.includes('const counted = watchedItems.filter((item) => countableIds.has(item.product_id));'));
  assert.ok(src.includes('const completedCount = counted.filter((item) => Number(item.quantity) > 0).length;'), '"completed" ignores a quantity typed for a product with no stock of its own');
  assert.ok(src.includes('const totalSelectedQuantity = counted.reduce('), 'so does the units total');
  assert.ok(src.includes('if (quantity <= 0 || !inventoryItem || !countableIds.has(item.product_id)) return [];'), 'and the review list (what is submitted)');
  assert.ok(src.includes("if (!values.items.some((item) => !fresh.shared.has(item.product_id) && Number(item.quantity) > 0)) {"), 'a quantity on a hidden product alone does not get you to the review');
  assert.ok(src.includes("setError('items.root' as never, { type: 'manual', message: 'Enter an opening quantity for at least one product.' });"));
  assert.ok(src.includes('const totalCount = countableItems.length;'));
  console.log('2. counts and review: ok');
}

// ---------------------------------------------------------------- 3. the form engine facts the screen relies on (real react-hook-form)
{
  const require = createRequire(import.meta.url);
  const { createFormControl } = require('react-hook-form');
  const { formControl, control } = createFormControl({ defaultValues: { items: [{ product_id: 'a', quantity: '' }, { product_id: 'b', quantity: '' }], notes: '' } });
  // what mounted inputs register, then the user types
  formControl.register('items.0.quantity');
  formControl.register('notes');
  formControl.setValue('items.0.quantity', '25');
  formControl.setValue('notes', 'delivery');
  assert.notEqual(control._options.shouldUnregister, true, 'values are kept when their inputs unmount (the failure screen unmounts them)');
  // an input that mounted before and unmounts with the failure screen does not lose its value; a plain getValues after that still has it
  assert.equal(control._formValues.items[0].quantity, '25');
  assert.equal(control._formValues.notes, 'delivery');
  // the root error the screen reads (errors.items.root.message) is exactly where setError('items.root') puts it
  formControl.setError('items.root', { type: 'manual', message: 'Enter an opening quantity for at least one product.' });
  assert.equal(control._formState.errors.items.root.message, 'Enter an opening quantity for at least one product.');
  assert.ok(src.includes('formState.errors.items?.root?.message'), 'the screen shows that message');
  console.log('3. form engine: ok');
}

// ---------------------------------------------------------------- 4. the re-check before Review and before Confirm
{
  const { loadTs } = await import('./_load_ts.mjs');
  const g = loadTs('src/features/inventory/sharedStock.ts');
  // only entered quantities are held back (blank and zero never are), and only for products that are now shared
  const entries = [{ product_id: 'a', quantity: '25' }, { product_id: 'b', quantity: '' }, { product_id: 'c', quantity: '0' }, { product_id: 'd', quantity: '3' }];
  assert.deepEqual(g.newlySharedEntries(entries, new Set(['a', 'b', 'c'])).map((e) => e.product_id), ['a']);
  assert.deepEqual(g.newlySharedEntries(entries, new Set()), []);
  assert.equal(entries[0].quantity, '25', 'the entries themselves are not changed');
  assert.match(g.staleEntriesNotice(['Extra Rice']), /^Extra Rice now takes its stock from other items, so its quantity was left out\./);
  assert.match(g.staleEntriesNotice(['A', 'B']), /^A and B now take their stock/);
  assert.match(g.staleEntriesNotice(['A', 'B', 'C', 'D']), /^A, B and 2 more now take their stock/);

  // the re-check reloads the setup data and never touches the form
  const recheck = src.slice(at('const recheckSetup = useCallback(async () => {'), at('const countableItems = useMemo('));
  assert.ok(recheck.includes('const result = await refetchSetup();'));
  assert.ok(recheck.includes('if (result.isError || !result.data || !inventory.data) return null;'), 'a failed re-check returns null: nothing is saved, the Retry screen shows');
  assert.doesNotMatch(recheck, /reset\(|setValue|setReview|mutate/);
  assert.ok(recheck.includes('setChecking(false);'), 'the busy state always clears');

  // Review decides on the fresh data, before it opens the review
  const review = src.slice(at('const onReview = handleSubmit(async (values) => {'), at('const invalid = values.items.some('));
  assert.ok(review.indexOf('await recheckSetup()') < review.indexOf('setStaleNotice(staleEntriesNotice('), 'check first');
  assert.ok(review.includes('if (!fresh) return;'));
  assert.ok(review.includes('newlySharedEntries(values.items, fresh.shared)'));
  assert.doesNotMatch(review, /reset\(|setValue/, 'what was typed is not cleared when entries are held back');
  assert.ok(review.includes("if (!values.items.some((item) => !fresh.shared.has(item.product_id) && Number(item.quantity) > 0)) {"), 'at least one quantity for a product that still needs stock');

  // Confirm re-checks again and only then saves
  const confirm = src.slice(at('const confirmReview = async () => {'), at('if (review) {'));
  assert.ok(confirm.indexOf('await recheckSetup()') < confirm.indexOf('mutation.mutate('), 'Confirm never saves before the re-check');
  assert.ok(confirm.includes('if (!fresh) return;'));
  assert.ok(confirm.includes('const heldBack = selectedItems.filter((item) => fresh.shared.has(item.product.id));'));
  assert.ok(confirm.includes('setReview(null);\n      return;'), 'held back: back to the form, nothing saved');
  assert.ok(confirm.indexOf('setReview(null);\n      return;') < confirm.indexOf('mutation.mutate('));
  // the reset happens only after a successful save, as before
  assert.ok(confirm.includes('onSuccess: () => {'));
  // after a successful save the user lands on Main Inventory, not on a fresh Opening stock form; a failed save stays put
  const success = confirm.slice(confirm.indexOf('onSuccess: () => {'));
  assert.ok(success.includes("router.dismissTo('/manager/inventory' as never);"), 'saved: go to Main Inventory');
  assert.ok(success.indexOf('reset({') < success.indexOf('router.dismissTo('), 'the form is cleared first');
  assert.equal(confirm.split('dismissTo').length - 1, 1, 'only on success: a held-back or failed save does not navigate');
  assert.ok(src.includes("const router = useRouter();") && src.includes("import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';"));
  assert.ok(src.includes('onPress={confirmReview}'));
  assert.ok(src.includes('loading={mutation.isPending || checking}') && src.includes('loading={checking}'), 'buttons show they are checking; no double taps');
  assert.ok(src.includes('{staleNotice ? <Text style={styles.staleNotice}>{staleNotice}</Text> : null}'), 'the user is told');
  console.log('4. re-check before Review and Confirm: ok');
}

console.log('opening_stock_retry: ALL PASS');
