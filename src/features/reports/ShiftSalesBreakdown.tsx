import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { managerColors } from '@/components/dashboard/theme';
import { useManagerShiftPayments } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { paymentLabel, PRICING_PROGRAM_LABELS, shiftPaymentBreakdown, type PricingProgramKey, type ShiftPaymentRow } from '@/features/sales/paymentMethods';

export function ShiftSalesBreakdownContent({ rows }: { rows: ShiftPaymentRow[] }) {
  return (
    <View style={styles.content}>
      <Text style={styles.note}>These are sales totals, not remitted cash. Voided amounts are excluded.</Text>
      {(['cash', 'gcash', 'unrecorded'] as const).map((method) => {
        const summary = shiftPaymentBreakdown(rows, method);
        if (method === 'unrecorded' && !rows.some((row) => !row.method || row.method === method)) return null;
        return <SummaryCard key={method} title={`${paymentLabel(method)} sales`} rows={[
          ...Object.entries(summary.groups).map(([program, amount]) => ({
            label: PRICING_PROGRAM_LABELS[program as PricingProgramKey], value: formatMoney(amount),
          })),
          { label: 'Total sales', value: formatMoney(summary.total), emphasis: true },
          { label: 'Employee / guest meal orders', value: String(summary.employeeMeals) },
        ]} />;
      })}
    </View>
  );
}

export function ShiftSalesBreakdown({ shiftId }: { shiftId: string }) {
  const [expanded, setExpanded] = useState(false);
  const query = useManagerShiftPayments(shiftId, expanded);
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={() => setExpanded((value) => !value)} style={styles.button}>
      <Text style={styles.label}>{expanded ? 'Hide sales breakdown' : 'Show sales breakdown'}</Text>
    </Pressable>
    {expanded ? query.isLoading ? <LoadingState label="Loading sales breakdown…" />
      : query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        : <ShiftSalesBreakdownContent rows={query.data ?? []} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  button: { paddingVertical: 14, minHeight: 48 },
  label: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  note: { color: managerColors.subtext, fontSize: 13 },
});
