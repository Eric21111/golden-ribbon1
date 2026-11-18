import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const state = [];
let cursor;
const { SelectedReturnCloseForm } = loadTs('src/features/shifts/SelectedReturnCloseForm.tsx', {
  react: {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (change) => {
          state[index] = typeof change === 'function' ? change(state[index]) : change;
        },
      ];
    },
    useMemo(factory) {
      return factory();
    },
  },
  '@tanstack/react-query': {
    useQuery() {
      return { data: new Map() };
    },
  },
  '@react-native-vector-icons/ionicons': { default: 'icon' },
  'react-native': {
    Pressable: 'checkbox',
    ScrollView: 'scroll',
    View: 'view',
    Text: 'text',
    TextInput: 'input',
    StyleSheet: { create: (x) => x },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  },
  '@/components/FormField': { FormField: 'input' },
  '@/components/dashboard/ListRowCard': { ListRowCard: 'row' },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: 'button' },
  '@/components/dashboard/ManagerBadge': { ManagerBadge: 'badge' },
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: 'sheet' },
  '@/components/dashboard/SearchInput': { SearchInput: 'search' },
  '@/components/dashboard/theme': {
    managerColors: {
      subtext: '#667085',
      green: '#15803D',
      ink: '#101828',
      royalBlue: '#1E3A8A',
      cardBorder: '#EEF1F6',
      cardSurface: '#F7F8FB',
    },
  },
  '@/features/products/CategoryIcon': { CategoryIcon: 'icon' },
  '@/features/products/productCategoryIndicator': {
    categoryRowProps: () => ({ icon: 'help-circle-outline', iconColor: 'gray', iconLabel: 'Category not set' }),
  },
  '@/lib/confirmAction': { alertNotice: () => {} },
  '@/services/inventoryService': {
    listCashierProductCategories: async () => new Map(),
  },
});

const p = (id, stock, returnable) => ({
  product_id: id,
  product_name_snapshot: id,
  system_balance_before_waste: stock,
  returnable,
});
const preview = {
  expected_cash: 20,
  expected_gcash: 10,
  products: [p('Rice', 4, true), p('Egg', 2, true), p('Carryover', 8, false), p('Empty', 0, true)],
};
let submission;

function render() {
  cursor = 0;
  const elements = [];
  function collect(e) {
    if (Array.isArray(e)) return e.forEach(collect);
    if (!e?.props || (e.type === 'sheet' && !e.props.visible)) return;
    elements.push(e);
    collect(e.props.children);
  }
  collect(SelectedReturnCloseForm({ preview, operator: 'Cashier', loading: false, onSubmit: (...args) => { submission = args; } }));
  return elements;
}

const byLabel = (label) =>
  render().find((e) => e.props.label === label || e.props.accessibilityLabel === label);
const submit = () => byLabel('Complete End Shift');
const productChecks = () =>
  render().filter(
    (e) =>
      e.type === 'checkbox' &&
      e.props.accessibilityRole === 'checkbox' &&
      String(e.props.accessibilityLabel || '').includes('quantity'),
  );

assert.equal(submit().props.disabled, true);
byLabel('Cash on hand').props.onChangeText('20');
byLabel('GCash received').props.onChangeText('10');
assert.ok(byLabel('Returns · 2'), 'button shows available returnable count before selection');
byLabel('Returns · 2').props.onPress();
assert.equal(productChecks().length, 2);
assert.equal(
  render()
    .filter((e) => e.type === 'input')
    .some((e) => String(e.props.label || e.props.accessibilityLabel || '').includes('Rice')),
  false,
  'return qty is not an editable input',
);
assert.equal(
  render().some((e) => e.props.accessibilityLabel?.includes?.('Increase') || e.props.accessibilityLabel?.includes?.('Max')),
  false,
  'returns have no +/- or Max controls',
);
byLabel('Select all').props.onPress();
byLabel('Clear selection').props.onPress();
productChecks()[0].props.onPress();
byLabel('Done').props.onPress();
byLabel('Waste (0)').props.onPress();
const wasteInput = () =>
  render().find((e) => e.type === 'input' && (e.props.label === 'Waste qty' || e.props.accessibilityLabel === 'Waste qty'));
wasteInput().props.onChangeText('5');
assert.equal(wasteInput().props.value, '4', 'waste qty is clamped to available stock');
wasteInput().props.onChangeText('1');
byLabel('Done').props.onPress();
assert.ok(byLabel('Returns (1)'));
assert.ok(byLabel('Waste (1)'));
submit().props.onPress();
assert.deepEqual(submission, ['20', '10', { productIds: ['Rice'], waste: { Rice: 1 } }]);

// Older payloads may omit `returnable`; treat that as returnable. Explicit false stays excluded.
state.length = 0;
preview.products = [
  { product_id: 'Soup', product_name_snapshot: 'Soup', system_balance_before_waste: 3 },
  p('Drink', 6, false),
];
preview.expected_gcash = null;
assert.ok(byLabel('Returns · 1'), 'omitted returnable flag still lists leftover stock');
byLabel('Returns · 1').props.onPress();
assert.equal(productChecks().length, 1);
assert.equal(String(productChecks()[0].props.accessibilityLabel).includes('Soup'), true);

console.log('Cashier selection, read-only return quantities, waste validation and remittance submission passed.');
