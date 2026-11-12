import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { formatLiveStock, formatMoney, previewCashResult } from '@/lib/format';
import type { ShiftClosePreview, ShiftReturnSelection } from '@/types/models';
import { formatCashResultLabel } from './closeDisplay';

export function SelectedReturnCloseForm({ preview, operator, loading, footerExtra, onSubmit }: {
  preview: ShiftClosePreview;
  operator: string;
  loading: boolean;
  footerExtra?: ReactNode;
  onSubmit: (cash: string, gcash: string | undefined, selection: ShiftReturnSelection) => void;
}) {
  const [cash, setCash] = useState('');
  const [gcash, setGcash] = useState('');
  const [sheet, setSheet] = useState<'returns' | 'waste' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waste, setWaste] = useState<Record<string, string>>({});
  const split = preview.expected_gcash != null;
  const cashResult = previewCashResult(preview.expected_cash, cash);
  const gcashResult = previewCashResult(preview.expected_gcash ?? 0, gcash);
  const rows = preview.products.filter(p => p.system_balance_before_waste > 0).map(p => {
    const lost = Number(waste[p.product_id] || 0);
    const available = p.system_balance_before_waste - Number(p.previously_held ?? 0);
    return { ...p, lost, available, remaining: p.system_balance_before_waste - lost };
  });
  const eligible = rows.filter(p => p.returnable && p.remaining > 0);
  const productIds = eligible.filter(p => selected.has(p.product_id)).map(p => p.product_id);
  const allSelected = eligible.length > 0 && productIds.length === eligible.length;
  const invalidWaste = rows.some(p => p.lost > p.available);
  const ready = cashResult != null && (!split || gcashResult != null) && !invalidWaste && productIds.length <= 200;
  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Return items</Text>
      <Text>Select the stock going back to Main Branch. The manager will count it on arrival. Unselected items stay here.</Text>
      <ManagerActionButton variant="secondary" label={`Select return items (${productIds.length})`} onPress={() => setSheet('returns')} />
      {eligible.filter(p => selected.has(p.product_id)).map(p => <Text key={p.product_id}>{p.product_name_snapshot} · {formatLiveStock(p.remaining, undefined, p.stock_unit_code)}</Text>)}
      {productIds.length > 200 && <Text>Select up to 200 products.</Text>}
      <ManagerActionButton variant="secondary" label={`Review waste (${rows.filter(p => p.lost > 0).length})`} onPress={() => setSheet('waste')} />
      <Text style={styles.heading}>Remittance</Text>
      <Text>Operator · {operator}</Text>
      <FormField label={split ? 'Cash on hand' : 'Total collections'} keyboardType="decimal-pad" value={cash} onChangeText={setCash} placeholder="Enter amount" />
      <Text>Expected {formatMoney(preview.expected_cash)} · {formatCashResultLabel(preview.expected_cash, cash, cashResult)}</Text>
      {!split && <Text>This shift includes receipts without a payment method. Enter combined collections.</Text>}
      {split && <>
        <FormField label="GCash received" keyboardType="decimal-pad" value={gcash} onChangeText={setGcash} placeholder="Enter amount" />
        <Text>Expected {formatMoney(preview.expected_gcash!)} · {formatCashResultLabel(preview.expected_gcash!, gcash, gcashResult)}</Text>
      </>}
    </ScrollView>
    <View style={styles.footer}>
      {footerExtra}
      <ManagerActionButton label="Complete End Shift" loading={loading} disabled={!ready || loading} onPress={() => {
        if (ready && !loading) onSubmit(cash.trim(), split ? gcash.trim() : undefined, {
          productIds, waste: Object.fromEntries(rows.filter(p => p.lost > 0).map(p => [p.product_id, p.lost])),
        });
      }} />
    </View>
    <ManagerBottomSheet visible={sheet !== null} title={sheet === 'waste' ? 'Record waste' : 'Return items'} onClose={() => setSheet(null)} scroll>
      <View style={styles.content}>
        {sheet === 'returns' ? <>
          {eligible.length ? <ManagerActionButton variant="secondary" label={allSelected ? 'Clear selection' : 'Select all'} onPress={() => setSelected(new Set(allSelected ? [] : eligible.map(p => p.product_id)))} /> : <Text>No returnable stock remains.</Text>}
          {eligible.map(p => <Pressable key={p.product_id} accessibilityRole="checkbox" accessibilityState={{checked: selected.has(p.product_id)}}
            onPress={() => toggle(p.product_id)} style={styles.row}>
            <Text style={styles.name}>{selected.has(p.product_id) ? '☑' : '☐'}  {p.product_name_snapshot}</Text>
            <Text>{formatLiveStock(p.remaining, undefined, p.stock_unit_code)}</Text>
          </Pressable>)}
        </> : sheet === 'waste' ? <>
          <Text>Enter only waste that has not already been recorded. Waste reduces the quantity available to return.</Text>
          {preview.products.filter(p => Number(p.already_recorded_waste) > 0).map(p =>
            <Text key={p.product_id}>{p.product_name_snapshot} - Already recorded: {formatLiveStock(Number(p.already_recorded_waste), undefined, p.stock_unit_code)}</Text>)}
          {rows.filter(p => p.available > 0).map(p => <FormField key={p.product_id}
            label={`${p.product_name_snapshot} · ${formatLiveStock(p.available, undefined, p.stock_unit_code)} available`}
            value={waste[p.product_id] ?? ''} placeholder="0" keyboardType="number-pad" maxLength={6}
            error={p.lost > p.available ? 'Waste exceeds available stock.' : undefined}
            onChangeText={value => { if (/^\d*$/.test(value)) setWaste(previous => ({...previous,[p.product_id]:value})); }} />)}
        </> : null}
        <ManagerActionButton label="Done" disabled={sheet === 'waste' && invalidWaste} onPress={() => setSheet(null)} />
      </View>
    </ManagerBottomSheet>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, gap: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: managerColors.ink },
  footer: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  name: { flex: 1, fontWeight: '600' },
});
