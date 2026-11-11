import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';

import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';

type Row = { id: string; name: string; maximum?: number };

export function BulkQuantityPicker({ rows, onApply }: {
  rows: Row[];
  onApply: (ids: Set<string>, quantity: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState('');
  const chosen = rows.filter(row => selected.has(row.id));
  const exceeds = chosen.find(row => row.maximum !== undefined && Number(quantity) > row.maximum);
  function close() {
    setOpen(false);
    setSelected(new Set());
    setQuantity('');
  }
  if (!open) return <ManagerActionButton label="Set quantity for multiple products" variant="secondary" disabled={!rows.length} onPress={() => setOpen(true)} />;
  return <ManagerBottomSheet visible={open} title="Set quantities" onClose={close} scroll><View style={{ gap: 8, paddingVertical: 12 }}>
    <Text>Select products and enter the quantity to put in each row.</Text>
    {rows.map(row => <Pressable key={row.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(row.id) }}
      style={{paddingVertical: 10}} onPress={() => setSelected(previous => {
        const next = new Set(previous);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      })}>
      <Text>{selected.has(row.id) ? '☑' : '☐'}  {row.name}</Text>
    </Pressable>)}
    <TextInput accessibilityLabel="Quantity per selected product" placeholder="Quantity per product" keyboardType="number-pad"
      style={{borderWidth: 1, borderRadius: 8, padding: 10}} value={quantity} maxLength={6} onChangeText={value => {
        if (/^\d*$/.test(value)) setQuantity(value);
      }} />
    {exceeds && <Text>{exceeds.name} only has {exceeds.maximum} available.</Text>}
    <ManagerActionButton label={`Apply to ${chosen.length} products`} disabled={!chosen.length || !Number(quantity) || !!exceeds} onPress={() => {
      onApply(new Set(chosen.map(row => row.id)), String(Number(quantity)));
      close();
    }} />
    <ManagerActionButton label="Cancel" variant="secondary" onPress={close} />
  </View></ManagerBottomSheet>;
}
