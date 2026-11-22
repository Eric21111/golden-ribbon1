import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { FilterDropdown } from '@/components/FilterDropdown';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney } from '@/lib/format';
import { voidCashierSaleItem, type SaleItem } from '@/services/saleService';

const reasons = ['Wrong item', 'Wrong quantity', 'Duplicate entry', 'Customer changed order', 'Order cancelled', 'Other'];
const reasonOptions = [{ label: 'Select a reason', value: '' }, ...reasons.map((reason) => ({ label: reason, value: reason }))];

/**
 * "Void item" at the end of a receipt line: a small red icon button that opens a bottom sheet (item, quantity stepper, reason, Cancel | Review void),
 * so the receipt itself stays clean. The checks, the confirmation and the voidCashierSaleItem call are exactly as before.
 */
export function ItemVoidForm({ item, name, cashierId }: { item: SaleItem; name: string; cashierId: string }) {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  if (profile?.role !== 'cashier' || profile.id !== cashierId) return null;
  const count = Number(quantity);
  const valid = /^\d+$/.test(quantity) && count > 0 && count <= item.quantity && !!reason && (reason !== 'Other' || !!note.trim());
  const close = () => {
    if (pending) return;
    setEditing(false);
    setError('');
  };
  async function submit() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      await voidCashierSaleItem(item, count, reason, reason === 'Other' ? note.trim() : '');
      setEditing(false);
    } catch (cause) {
      const message = (cause as {message?: string})?.message;
      setError(message || 'Unable to confirm the void. Check the receipt before retrying.');
    } finally {
      await client.invalidateQueries();
      locked.current = false;
      setPending(false);
    }
  }
  // The red button is always solid; pressing it with something missing says what, instead of a faded button that explains nothing.
  const review = () => {
    if (!(/^d+$/.test(quantity) && count > 0 && count <= item.quantity)) {
      setError(`Enter a quantity from 1 to ${item.quantity}.`);
      return;
    }
    if (!reason) {
      setError('Select a reason.');
      return;
    }
    if (reason === 'Other' && !note.trim()) {
      setError('Enter the reason.');
      return;
    }
    setError('');
    confirmAction(
      'Void this item?', `${count} × ${name}
Deduct ${formatMoney(item.unit_price * count)} from this sale and restore its stock.
Reason: ${reason === 'Other' ? note : reason}`,
      () => void submit(), { confirm: 'Confirm void', tone: 'danger' }
    );
  };
  const step = (delta: number) => {
    const current = Number.isFinite(count) && count > 0 ? count : 1;
    setQuantity(String(Math.min(item.quantity, Math.max(1, current + delta))));
  };
  const atMin = pending || count <= 1;
  const atMax = pending || count >= item.quantity;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Void item: ${name}`}
        onPress={() => setEditing(true)}
        hitSlop={6}
        style={({ pressed }) => [styles.voidButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-undo-outline" size={18} color="#B91C1C" />
      </Pressable>

      <ManagerBottomSheet visible={editing} title="Void item" onClose={close} scroll>
        <View style={styles.sheet}>
          <View style={styles.itemCard}>
            <Text style={styles.itemName}>{name}</Text>
            <Text style={styles.itemMeta}>
              {item.quantity} × {formatMoney(item.unit_price)} · {formatMoney(item.subtotal)}
            </Text>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Quantity to void</Text>
              <Text style={styles.help}>Max {item.quantity}</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="Decrease quantity to void" disabled={atMin} onPress={() => { setError(''); step(-1); }} style={({ pressed }) => [styles.stepButton, atMin && styles.stepOff, pressed && styles.pressed]}>
                <Text style={styles.stepSymbol}>−</Text>
              </Pressable>
              <TextInput accessibilityLabel="Quantity to void" keyboardType="number-pad" value={quantity} onChangeText={(value) => { setError(''); setQuantity(value); }} editable={!pending} maxLength={6} selectTextOnFocus style={styles.qtyInput} />
              <Pressable accessibilityRole="button" accessibilityLabel="Increase quantity to void" disabled={atMax} onPress={() => { setError(''); step(1); }} style={({ pressed }) => [styles.stepButton, atMax && styles.stepOff, pressed && styles.pressed]}>
                <Text style={styles.stepSymbol}>+</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Reason</Text>
            <FilterDropdown label="Reason for void" options={reasonOptions} value={reason} onChange={(value) => { setError(''); setReason(value); }} />
          </View>
          {reason === 'Other' ? (
            <TextInput placeholder="Enter the reason" placeholderTextColor={managerColors.subtext} accessibilityLabel="Other reason" value={note} onChangeText={(value) => { setError(''); setNote(value); }} editable={!pending} maxLength={250} style={styles.input} />
          ) : null}

          {valid ? <Text style={styles.deduct}>Deducts {formatMoney(item.unit_price * count)} from this sale and restores its stock.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <View style={styles.action}>
              <ManagerActionButton label="Cancel" variant="secondary" disabled={pending} onPress={close} />
            </View>
            <View style={styles.action}>
              <ManagerActionButton label="Review void" variant="destructive" disabled={pending} loading={pending} onPress={review} />
            </View>
          </View>
        </View>
      </ManagerBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  // a small red icon button at the end of the receipt line (its name is read out: "Void item: <name>")
  voidButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEE2E2' },
  pressed: { opacity: 0.7 },
  sheet: { gap: 14, paddingHorizontal: 4, paddingBottom: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemCard: { gap: 2, padding: 12, borderRadius: 14, backgroundColor: managerColors.cardSurface },
  itemName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  itemMeta: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  field: { gap: 8 },
  label: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF0FB' },
  stepOff: { opacity: 0.4 },
  stepSymbol: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 26 },
  qtyInput: {
    flex: 1,
    minWidth: 0,
    height: 48,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    textAlign: 'center',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  help: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    color: managerColors.ink,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  deduct: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minWidth: 0 },
});
