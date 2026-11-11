import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as native from 'react-native-web';
import { loadTs } from './_load_ts.mjs';

const id = '40000000-0000-4000-8000-000000000001';
const box = ({ children }) => React.createElement('div', null, children);
const buttons = new Map();
const Button = props => { buttons.set(props.label, props); return React.createElement('button', { disabled: props.disabled }, props.label); };
let navigation;
const router = { replace: path => { navigation = path; }, canGoBack: () => false };
const base = {
  'react-native': { ...native, Modal: ({ visible, children }) => visible ? box({ children }) : null },
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  'expo-router': { router, useLocalSearchParams: () => ({ id }), Redirect: ({ href }) => React.createElement('div', null, `Redirect ${href}`) },
  '@/components/Screen': { Screen: box },
  '@/components/SignOutButton': { SignOutButton: () => React.createElement('button', null, 'Log out') },
  '@/components/ConstrainedWidth': { ConstrainedWidth: box },
  '@/components/AppButton': { AppButton: Button },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: Button },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/ManagerFeedback': {
    ErrorState: ({ message }) => React.createElement('div', null, message),
    LoadingState: ({ label = 'Loading' }) => React.createElement('div', null, label),
  },
};
let saleQuery = {};
const { SaleDetailsBody } = loadTs('src/features/sales/SalesScreens.tsx', {
  ...base,
  './ItemVoidForm': { ItemVoidForm: () => React.createElement('button', null, 'Void item') },
  '@/hooks/useSales': { useSale: () => saleQuery },
  '@/components/dashboard/ManagerBadge': { ManagerBadge: ({ label }) => React.createElement('span', null, label) },
  '@/components/dashboard/SummaryCard': { SummaryCard: () => null },
});
const details = saleId => renderToStaticMarkup(React.createElement(SaleDetailsBody, { saleId, showBack: true }));
assert.match(details(''), /sale link is invalid/);
saleQuery = { error: { code: 'PGRST116' } };
assert.match(details(id), /unavailable to your account/);
saleQuery = { error: new Error('offline') };
assert.match(details(id), /does not mean the sale was not saved/);
saleQuery = { data: { id, sale_number: 'SALE-1', sold_at: '2026-11-10T00:00:00Z', status: 'completed', total_amount: 25,
  items: [{ id: 'line', product_id: id, product: { name: 'Meal' }, drink_name: 'Cola', quantity: 1, unit_price: 25, subtotal: 25 }] } };
assert.match(details(id), /Meal · Cola/);
saleQuery.data.shift = {status:'open', started_at:'2026-11-10T00:00:00Z'};
saleQuery.data.items[0].stock_per_unit = {ingredient: 1};
assert.match(details(id), /Void item/);
saleQuery.data.shift.status = 'closed';
assert.doesNotMatch(details(id), /Void item/);
assert.doesNotMatch(details(id), /Unable to load/);

// Test payment recovery at its actual button handler, with an empty cart and no open shift.
let submitted;
const request = { shiftId: id, key: 'saved-original-request-key', amountPaid: '25.00', items: [{ product_id: id, quantity: 1 }], pricingProgram: 'standard' };
let checkout = { request, items: [], sale: null, pending: false, error: '', recoveryError: false,
  submit: attempt => { submitted = attempt; }, reset: () => true };
let shift = { data: null, isLoading: false, error: new Error('offline shift lookup') };
const { default: PaymentScreen } = loadTs('app/(cashier)/cashier/payment.tsx', {
  ...base,
  '@tanstack/react-query': { useQuery: () => ({}), useQueryClient: () => ({}) },
  '@/features/auth/AuthProvider': { useAuth: () => ({ profile: { id: 'cashier' } }) },
  '@/features/pos/OrderSummary': { OrderSummary: () => null },
  '@/hooks/useShifts': { useActiveShift: () => shift },
  '@/lib/layout': { useLayout: () => ({ paymentMaxWidth: 520 }) },
  '@/lib/queryClient': { invalidateCompletedSaleQueries: () => Promise.resolve() },
  '@/services/inventoryService': {}, '@/services/productService': {}, '@/services/saleService': {},
  '@/stores/cartStore': { useCartStore: Object.assign(() => [], { getState: () => ({ clearCart() {} }) }) },
  '@/stores/checkoutStore': { useCheckoutStore: () => checkout },
  '@/lib/confirmAction': {},
});
let html = renderToStaticMarkup(React.createElement(PaymentScreen));
assert.match(html, /Original payment:/);
assert.doesNotMatch(html, /Redirect|Refreshing current prices|Unable to verify your shift/);
assert.equal(buttons.get('Retry').disabled, false);
buttons.get('Retry').onPress();
assert.equal(submitted, request, 'retry sends the original request even without open shift/prices/cart');

checkout = { ...checkout, sale: saleQuery.data };
html = renderToStaticMarkup(React.createElement(PaymentScreen));
assert.match(html, /Order confirmed/);
buttons.get('View sale').onPress();
assert.equal(navigation, `/cashier/sales/${id}`);
checkout.reset = () => false; navigation = null;
renderToStaticMarkup(React.createElement(PaymentScreen));
buttons.get('Done').onPress();
assert.equal(navigation, null, 'failed durable acknowledgement cannot dismiss recovery');

checkout = { ...checkout, sale: null, request: null, recoveryError: true, error: 'Saved checkout cannot be read' };
html = renderToStaticMarkup(React.createElement(PaymentScreen));
assert.match(html, /Saved checkout cannot be read/);
assert.doesNotMatch(html, /Redirect/);
console.log('Sales/checkout UI passed: receipt rendering, invalid/inaccessible IDs, recovery without a shift, and confirmation navigation.');
