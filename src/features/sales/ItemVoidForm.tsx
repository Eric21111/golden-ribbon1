import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppButton } from '@/components/AppButton';
import { FilterDropdown } from '@/components/FilterDropdown';
import { useAuth } from '@/features/auth/AuthProvider';
import { confirmAction } from '@/lib/confirmAction';
import { formatMoney } from '@/lib/format';
import { voidCashierSaleItem, type SaleItem } from '@/services/saleService';

const reasons = ['Wrong item', 'Wrong quantity', 'Duplicate entry', 'Customer changed order', 'Order cancelled', 'Other'];
const options = [{ label: 'Select a reason', value: '' }, ...reasons.map(reason => ({ label: reason, value: reason }))];

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
  if (!editing) return <AppButton label="Void item" onPress={() => setEditing(true)} />;
  const count = Number(quantity);
  const valid = /^\d+$/.test(quantity) && count > 0 && count <= item.quantity && !!reason && (reason !== 'Other' || !!note.trim());
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
  return <View style={{ gap: 8, paddingVertical: 10 }}>
    <Text>Quantity to void (up to {item.quantity})</Text>
    <TextInput accessibilityLabel="Quantity to void" keyboardType="number-pad" value={quantity} onChangeText={setQuantity} editable={!pending} maxLength={6} />
    <FilterDropdown label="Reason for void" options={options} value={reason} onChange={setReason} />
    {reason === 'Other' && <TextInput placeholder="Enter the reason" accessibilityLabel="Other reason" value={note} onChangeText={setNote} editable={!pending} maxLength={250} />}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <AppButton label="Review void" disabled={!valid || pending} onPress={() => confirmAction(
      'Void this item?', `${count} × ${name}\nDeduct ${formatMoney(item.unit_price * count)} from this sale and restore its stock.\nReason: ${reason === 'Other' ? note : reason}`,
      () => void submit(), { confirm: 'Confirm void', tone: 'danger' }
    )} />
    <AppButton label="Cancel" disabled={pending} onPress={() => setEditing(false)} />
  </View>;
}
