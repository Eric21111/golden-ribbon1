import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { useAuth } from '@/features/auth/AuthProvider';
import { useActiveShift } from '@/hooks/useShifts';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';
import { cartUsage } from '@/features/pos/posAvailability';
import { CORRECTION_REASONS, parseStockCount, readPendingCorrection, savePendingCorrection } from '@/features/pos/stockCorrection';
import { correctStock, listCorrectionStock, type CorrectionRequest, type CorrectionStock } from '@/services/stockCorrectionService';
import { stockUnit } from '@/lib/stockUnits';
import { getErrorMessage } from '@/lib/errors';

export default function CorrectStockScreen() {
  const { profile } = useAuth();
  const userId = profile?.id ?? '';
  const client = useQueryClient();
  const shift = useActiveShift(userId);
  const stock = useQuery({ queryKey: ['correction-stock', userId], queryFn: listCorrectionStock, enabled: !!userId, staleTime: 0 });
  const cart = useCartStore();
  const checkoutPending = useCheckoutStore(state => !!state.request);
  const usage = useMemo(() => cart.stockContext ? cartUsage(cart.stockContext, cart.items) : new Map<string, number>(), [cart.stockContext, cart.items]);
  const [selected, setSelected] = useState<CorrectionStock | null>(null);
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [review, setReview] = useState(false);
  const [recovery] = useState(() => {
    try { return { request: readPendingCorrection(userId), error: '' }; }
    catch { return { request: null, error: 'Unable to read the saved correction. Reopen the app; do not clear app data until its result has been checked.' }; }
  });
  const [pending, setPending] = useState<CorrectionRequest | null>(recovery.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const sending = useRef(false);
  const actual = parseStockCount(count);
  const unit = stockUnit(selected?.stock_unit_code)?.plural ?? 'pcs';
  const needed = selected ? usage.get(selected.product_id) ?? 0 : 0;
  const submit = async () => {
    if (sending.current) return;
    const request = pending ?? (selected && actual !== null && shift.data ? {
      p_shift_id: shift.data.id, p_product_id: selected.product_id, p_expected_quantity: selected.quantity,
      p_expected_updated_at: selected.updated_at, p_actual_quantity: actual, p_reason: reason,
      p_idempotency_key: `correction_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    } : null);
    if (!request) return;
    sending.current = true; setBusy(true); setError('');
    try {
      savePendingCorrection(userId, request); setPending(request);
      await correctStock(request);
      savePendingCorrection(userId, null); setPending(null); setSaved(true);
      void client.invalidateQueries({ queryKey: ['inventory'] });
      void client.invalidateQueries({ queryKey: ['stock-corrections'] });
      void client.invalidateQueries({ queryKey: ['correction-stock'] });
    } catch (e) {
      const code = (e as { code?: string }).code;
      // These database rejections are definitive: the transaction did not commit.
      if (code && ['40001','22023','42501','55000','23514'].includes(code)) {
        savePendingCorrection(userId, null); setPending(null); setReview(false); setSelected(null);
        void stock.refetch();
      }
      setError(getErrorMessage(e));
    } finally { sending.current = false; setBusy(false); }
  };
  return <Screen backgroundColor="#FFFFFF" constrain>
    <ManagerScreenHeader title="Correct stock count" showBack />
    {error ? <Text accessibilityRole="alert" style={{ color: '#B42318' }}>{error}</Text> : null}
    {recovery.error ? <Text accessibilityRole="alert">{recovery.error}</Text> : saved ? <>
      <Text>Stock correction saved. Your cart is unchanged. Check availability before completing checkout.</Text>
      <ManagerActionButton label="Back to order" onPress={() => router.back()} />
    </> : pending ? <>
      <Text>A correction is awaiting confirmation. Retry to check its result; it will not be recorded twice.</Text>
      <Text>Count: {pending.p_expected_quantity} → {pending.p_actual_quantity} · {pending.p_reason}</Text>
      <ManagerActionButton label="Confirm correction result" loading={busy} onPress={() => void submit()} />
    </> : checkoutPending ? <Text>Resolve the pending checkout before correcting stock.</Text>
      : !shift.data || shift.data.status !== 'open' ? <Text>Start an active shift and complete pending remittance before correcting stock.</Text>
      : !selected ? <>
        <Text>Count the stock physically available at your branch, before serving the next order.</Text>
        <TextInput accessibilityLabel="Search stock item" placeholder="Search rice or another stock item" value={search} onChangeText={setSearch} style={{ borderWidth: 1, borderColor: '#CBD5E1', padding: 14, borderRadius: 10 }} />
        {stock.isPending ? <Text>Loading stock…</Text> : stock.error ? <><Text>{getErrorMessage(stock.error)}</Text><ManagerActionButton label="Retry" onPress={() => void stock.refetch()} /></> : null}
        {!stock.isPending && !stock.error && !(stock.data ?? []).some(row => row.product_name.toLowerCase().includes(search.toLowerCase())) ? <Text>No matching branch stock items.</Text> : null}
        {(stock.data ?? []).filter(row => row.product_name.toLowerCase().includes(search.toLowerCase())).map(row => <Pressable key={row.product_id} accessibilityRole="button" onPress={() => { setSelected(row); setCount(''); setReason(''); setReview(false); }} style={{ padding: 16, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10 }}>
          <Text style={{ fontWeight: '700' }}>{row.product_name}</Text>
          <Text>System: {row.quantity} {stockUnit(row.stock_unit_code)?.plural ?? 'pcs'}{usage.has(row.product_id) ? ` · Order needs ${usage.get(row.product_id)}` : ''}</Text>
        </Pressable>)}
        <ManagerActionButton label="Correction history" variant="secondary" onPress={() => router.push('/cashier/stock-corrections' as never)} />
      </> : <View style={{ gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>{selected.product_name}</Text>
        <Text>System count: {selected.quantity} {unit}</Text>
        <Text>{stockUnit(selected.stock_unit_code)?.hint ?? 'Count using the same stock unit used by your branch.'}</Text>
        {review ? <>
          <Text>Update stock: {selected.quantity} → {actual} {unit}</Text>
          <Text>This cart uses {needed} {unit}.{actual !== null && actual >= needed ? ` Expected remaining: ${actual - needed} ${unit}.` : ' The cart still exceeds available stock; reduce the order before checkout.'}</Text>
          <Text>Reason: {reason}</Text>
          <Text>Confirm that you checked the physical stock. This correction will appear in history and remittance.</Text>
          <ManagerActionButton label="Confirm stock correction" loading={busy} onPress={() => void submit()} />
          <ManagerActionButton label="Edit count" variant="secondary" disabled={busy} onPress={() => setReview(false)} />
        </> : <>
          <Text>Actual remaining stock BEFORE this order ({unit})</Text>
          <TextInput accessibilityLabel={`Actual remaining ${unit}`} keyboardType="number-pad" value={count} onChangeText={setCount} style={{ borderWidth: 1, borderColor: '#CBD5E1', padding: 16, borderRadius: 10 }} />
          {count && actual === null ? <Text>Enter a whole number from 0 to 999999.</Text> : null}
          {actual === selected.quantity ? <Text>The count is unchanged; no correction is needed.</Text> : null}
          <Text>Reason</Text>
          {CORRECTION_REASONS.map(value => <ManagerActionButton key={value} label={`${reason === value ? '✓ ' : ''}${value}`} variant="secondary" onPress={() => setReason(value)} />)}
          <ManagerActionButton label="Review correction" disabled={actual === null || actual === selected.quantity || !reason} onPress={() => setReview(true)} />
          <ManagerActionButton label="Choose another item" variant="secondary" onPress={() => setSelected(null)} />
        </>}
      </View>}
  </Screen>;
}
