import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  paymentLabel,
  PRICING_PROGRAM_LABELS,
  type PricingProgramKey,
} from '@/features/sales/paymentMethods';
import { useBranches } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type PaymentMethod = 'cash' | 'gcash' | 'unrecorded';
type PaymentRow = { method: string; program: string; amount: number; orders: number };

const PROGRAM_KEYS = Object.keys(PRICING_PROGRAM_LABELS) as PricingProgramKey[];

const METHOD_META: Record<
  PaymentMethod,
  { icon: 'cash-outline' | 'phone-portrait-outline' | 'help-circle-outline'; emphasis?: boolean }
> = {
  cash: { icon: 'cash-outline', emphasis: true },
  gcash: { icon: 'phone-portrait-outline' },
  unrecorded: { icon: 'help-circle-outline' },
};

export default function TodaySales() {
  const { profile } = useAuth();
  const branches = useBranches();
  const [branch, setBranch] = useState('');
  const [expanded, setExpanded] = useState<PaymentMethod | ''>('');

  const query = useQuery({
    queryKey: ['manager-today-payments', profile?.branch_id, branch],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'manager_today_payments',
        branch ? { p_branch: branch } : {},
      );
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
  });

  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const branchOptions = useMemo(
    () => [
      { value: '', label: 'All branches' },
      ...(branches.data ?? [])
        .filter((row) => !row.is_main_branch)
        .map((row) => ({ value: row.id, label: row.name })),
    ],
    [branches.data],
  );

  const methods = useMemo(() => {
    const rows = query.data ?? [];
    return (['cash', 'gcash', 'unrecorded'] as const)
      .map((method) => {
        const methodRows = rows.filter((row) => row.method === method);
        const total = methodRows.reduce((sum, row) => sum + Number(row.amount), 0);
        return { method, rows: methodRows, total };
      })
      .filter((entry) => entry.method !== 'unrecorded' || entry.rows.length > 0);
  }, [query.data]);

  const hasSales = methods.some((entry) => entry.total > 0 || entry.rows.length > 0);

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
      refreshing={query.isRefetching}
      onRefresh={() => void refetch()}
    >
      <ManagerScreenHeader
        title="Today's sales"
        subtitle={profile?.branch?.is_main_branch ? 'Selling branches' : profile?.branch?.name}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        {profile?.branch?.is_main_branch ? (
          <FilterChipRow
            options={branchOptions}
            value={branch}
            onChange={setBranch}
            bleed={20}
            keepSelectedVisible
          />
        ) : null}

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void refetch()} />
        ) : query.isPending ? (
          <LoadingState label="Loading sales…" />
        ) : !hasSales ? (
          <EmptyState title="No sales today" message="Completed orders will show here by payment method." />
        ) : (
          methods.map(({ method, rows, total }) => {
            const meta = METHOD_META[method];
            const open = expanded === method;
            return (
              <View key={method} style={styles.block}>
                <StatTile
                  layout="wide"
                  emphasis={meta.emphasis}
                  icon={meta.icon}
                  label={paymentLabel(method)}
                  value={formatMoney(total)}
                  onPress={() => setExpanded(open ? '' : method)}
                />
                {open ? (
                  <SummaryCard
                    rows={PROGRAM_KEYS.map((key) => ({
                      label: PRICING_PROGRAM_LABELS[key],
                      value: formatMoney(Number(rows.find((row) => row.program === key)?.amount ?? 0)),
                      emphasis: key === 'standard',
                    }))}
                  />
                ) : null}
              </View>
            );
          })
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 14 },
  block: { gap: 10 },
});
