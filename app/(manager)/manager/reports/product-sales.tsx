import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProductSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, toNextDayStartManila, toStartOfDayManila } from '@/lib/format';

type DateFilterType = 'today' | 'all_time' | 'custom';

const RANGE_OPTIONS: { label: string; value: DateFilterType }[] = [
  { label: 'Today (PH)', value: 'today' },
  { label: 'All Time', value: 'all_time' },
  { label: 'Custom', value: 'custom' },
];

export default function ManagerProductSalesScreen() {
  const { profile } = useAuth();
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  const query = useProductSales(
    rangeType,
    undefined,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined,
  );

  const products = query.data ?? [];
  const totalUnitsSold = products.reduce((acc, p) => acc + Number(p.quantity_sold), 0);
  const totalProductRevenue = products.reduce((acc, p) => acc + Number(p.total_revenue), 0);

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Product Sales" subtitle={`${profile?.branch?.name ?? 'Branch'} product sales`} />

      <ConstrainedWidth style={styles.column}>
        <FilterChipRow options={RANGE_OPTIONS} value={rangeType} onChange={setRangeType} />

        {rangeType === 'custom' ? (
          <View style={styles.customDateRow}>
            <View style={styles.customDateField}>
              <FormField
                label="Start date"
                placeholder="YYYY-MM-DD"
                value={customStart}
                onChangeText={setCustomStart}
                accentColor={managerColors.royalBlue}
                labelStyle={styles.fieldLabel}
                style={styles.fieldInput}
              />
            </View>
            <View style={styles.customDateField}>
              <FormField
                label="End date"
                placeholder="YYYY-MM-DD"
                value={customEnd}
                onChangeText={setCustomEnd}
                accentColor={managerColors.royalBlue}
                labelStyle={styles.fieldLabel}
                style={styles.fieldInput}
              />
            </View>
          </View>
        ) : null}

        <SummaryCard
          title="Totals"
          rows={[
            { label: 'Total units sold', value: String(totalUnitsSold) },
            { label: 'Total revenue', value: formatMoney(totalProductRevenue), emphasis: true },
          ]}
        />

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <LoadingState label="Calculating product sales…" />
        ) : rangeType === 'custom' && !query.isFetched ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : products.length === 0 ? (
          <EmptyState title="No product sales" message="No completed product sales for this range." />
        ) : (
          <FlatList
            data={products}
            keyExtractor={(item) => item.product_id}
            contentContainerStyle={styles.listContent}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <ListRowCard
                icon="bar-chart-outline"
                iconColor="blue"
                title={item.product_name}
                subtitle={item.product_sku}
                meta={`${item.quantity_sold} sold`}
                trailing={<Text style={styles.revenueText}>{formatMoney(item.total_revenue)}</Text>}
              />
            )}
          />
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1 },
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  customDateRow: { flexDirection: 'row', gap: 12 },
  customDateField: { flex: 1 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  listContent: { gap: 0 },
  separator: { height: 10 },
  revenueText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 14 },
});
