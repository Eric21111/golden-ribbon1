import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { SwitchField } from '@/components/SwitchField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { formatMoney, previewCashResult } from '@/lib/format';

type Meal = { id: string; name: string };

export function CashierShiftCloseForm({
  title,
  expectedCash,
  meals,
  submitLabel,
  loading,
  onSubmit,
  onCancel,
}: {
  title: string;
  expectedCash: number;
  meals: Meal[];
  submitLabel: string;
  loading?: boolean;
  onSubmit: (actualCash: string, waste: Array<{ product_id: string }>) => void;
  onCancel?: () => void;
}) {
  const [actualCash, setActualCash] = useState('');
  const [wasteIds, setWasteIds] = useState<Record<string, boolean>>({});
  const preview = previewCashResult(expectedCash, actualCash);
  const waste = useMemo(
    () => meals.filter((meal) => wasteIds[meal.id]).map((meal) => ({ product_id: meal.id })),
    [meals, wasteIds],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sales}>Sales total {formatMoney(expectedCash)}</Text>
      <Text style={styles.note}>
        Actual cash is recorded by the server. Pending shifts stay unknown until you enter the counted cash.
      </Text>
      {meals.length > 0 ? (
        <View style={styles.waste}>
          <Text style={styles.section}>KG-delivered meal waste</Text>
          {meals.map((meal) => (
            <SwitchField
              key={meal.id}
              label={meal.name}
              description="Record that this meal had waste. No quantity is stored."
              value={Boolean(wasteIds[meal.id])}
              onValueChange={(selected) => setWasteIds((current) => ({ ...current, [meal.id]: selected }))}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.note}>No KG-delivered meals are in this branch catalog.</Text>
      )}
      <FormField
        label="Actual cash"
        value={actualCash}
        onChangeText={setActualCash}
        keyboardType="decimal-pad"
        placeholder="0.00"
        accentColor={managerColors.royalBlue}
      />
      <Text style={styles.preview}>
        {preview === 'exact'
          ? 'Preview: exact'
          : preview === 'shortage'
            ? 'Preview: shortage'
            : preview === 'excess'
              ? 'Preview: excess'
              : 'Enter actual cash, including 0.00 when the drawer is empty.'}
      </Text>
      <ManagerActionButton
        label={submitLabel}
        loading={loading}
        disabled={preview == null}
        onPress={() => onSubmit(actualCash.trim(), waste)}
      />
      {onCancel ? <ManagerActionButton label="Cancel" variant="secondary" disabled={loading} onPress={onCancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  sales: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  waste: { gap: 8 },
  section: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.6 },
  preview: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
