import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  paymentBreakdown,
  paymentLabel,
  PRICING_PROGRAM_LABELS,
  type PaymentFilter,
  type PricingProgramKey,
} from '@/features/sales/paymentMethods';
import { useActiveShift } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { listShiftSales } from '@/services/saleService';

type PaymentMethod = Exclude<PaymentFilter, 'all'>;

const PROGRAM_KEYS = Object.keys(PRICING_PROGRAM_LABELS) as PricingProgramKey[];

const METHOD_META: Record<
  PaymentMethod,
  { icon: 'cash-outline' | 'phone-portrait-outline' | 'help-circle-outline'; emphasis?: boolean }
> = {
  cash: { icon: 'cash-outline', emphasis: true },
  gcash: { icon: 'phone-portrait-outline' },
  unrecorded: { icon: 'help-circle-outline' },
};

export default function PaymentTotals() {
  const { profile } = useAuth();
  const shift = useActiveShift(profile?.id ?? '');
  const id = shift.data?.id;
  const sales = useQuery({
    queryKey: ['shift-sales', id],
    queryFn: () => listShiftSales(id!),
    enabled: !!id,
  });
  const { refetch } = sales;
  useFocusEffect(
    useCallback(() => {
      if (id) void refetch();
    }, [id, refetch]),
  );
  const [expanded, setExpanded] = useState<PaymentMethod | ''>('');

  const methods = useMemo(() => {
    const rows = sales.data ?? [];
    return (['cash', 'gcash', 'unrecorded'] as const)
      .map((method) => {
        const row = paymentBreakdown(rows, method);
        return { method, row };
      })
      .filter((entry) => entry.method !== 'unrecorded' || entry.row.orders > 0);
  }, [sales.data]);

  const hasSales = methods.some((entry) => entry.row.orders > 0 || entry.row.total > 0);
  const refreshing = sales.isRefetching || shift.isRefetching;

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      scroll={false}
      contentContainerStyle={styles.screenContent}
      refreshing={refreshing}
      onRefresh={() => {
        void shift.refetch();
        if (id) void refetch();
      }}
    >
      <ManagerScreenHeader title="Current shift sales" showBack />
      <ConstrainedWidth style={styles.column}>
        {shift.error || sales.error ? (
          <ErrorState
            message={getErrorMessage(shift.error ?? sales.error)}
            onRetry={() => {
              void shift.refetch();
              if (id) void refetch();
            }}
          />
        ) : shift.isPending || (id && sales.isPending) ? (
          <LoadingState label="Loading sales…" />
        ) : !id ? (
          <View style={styles.centered}>
            <EmptyState title="No active shift" message="Start a shift to see its sales." />
          </View>
        ) : !hasSales ? (
          <View style={styles.centered}>
            <EmptyState
              title="No sales this shift"
              message="Completed orders will show here by payment method."
            />
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {methods.map(({ method, row }) => {
              const meta = METHOD_META[method];
              const open = expanded === method;
              return (
                <View key={method} style={styles.block}>
                  <StatTile
                    layout="wide"
                    emphasis={meta.emphasis}
                    icon={meta.icon}
                    label={paymentLabel(method)}
                    value={formatMoney(row.total / 100)}
                    onPress={() => setExpanded(open ? '' : method)}
                  />
                  {open ? (
                    <>
                      <SummaryCard
                        rows={PROGRAM_KEYS.map((key) => ({
                          label:
                            key === 'employee_meal'
                              ? `${PRICING_PROGRAM_LABELS[key]} · ${row.employeeMeals} ${row.employeeMeals === 1 ? 'order' : 'orders'}`
                              : PRICING_PROGRAM_LABELS[key],
                          value: formatMoney(row.groups[key] / 100),
                          emphasis: key === 'standard',
                        }))}
                      />
                      <ManagerActionButton
                        label="View receipts"
                        variant="secondary"
                        onPress={() =>
                          router.push({ pathname: '/cashier/sales', params: { method } })
                        }
                      />
                    </>
                  ) : null}
                </View>
              );
            })}
            <Text style={styles.hint}>Tap a payment method to see the pricing-program breakdown.</Text>
          </ScrollView>
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16, gap: 14 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  list: { flex: 1 },
  listContent: { gap: 14, paddingBottom: 24 },
  block: { gap: 10 },
  hint: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
});
