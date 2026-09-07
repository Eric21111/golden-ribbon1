import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranches } from '@/hooks/useBranches';
import { useProductSales, useSalesByBranch } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney, toNextDayStartManila, toStartOfDayManila } from '@/lib/format';

type DateFilterType = 'today' | 'all_time' | 'custom';

export function SalesByBranchScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  const query = useSalesByBranch(
    rangeType,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined
  );

  const report = query.data ?? [];
  const totalCompletedTx = report.reduce((acc, r) => acc + Number(r.transaction_count), 0);
  const totalCompletedSales = report.reduce((acc, r) => acc + Number(r.total_sales), 0);

  return (
    <Screen>
      <PageHeader
        title="Sales by Branch"
        subtitle="Completed sales and transactions aggregated by branch."
      />

      {/* Date Range Selector */}
      <View style={styles.rangeSelector}>
        <Text
          onPress={() => setRangeType('today')}
          style={[styles.rangeTab, rangeType === 'today' && styles.rangeTabActive]}
        >
          Today (PH)
        </Text>
        <Text
          onPress={() => setRangeType('all_time')}
          style={[styles.rangeTab, rangeType === 'all_time' && styles.rangeTabActive]}
        >
          All Time
        </Text>
        <Text
          onPress={() => setRangeType('custom')}
          style={[styles.rangeTab, rangeType === 'custom' && styles.rangeTabActive]}
        >
          Custom
        </Text>
      </View>

      {rangeType === 'custom' && (
        <View style={styles.customDateCard}>
          <Text style={styles.filterTitle}>Custom Date Range</Text>
          <View style={styles.customDateRow}>
            <TextInput
              style={styles.dateInput}
              placeholder="Start Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customStart}
              onChangeText={setCustomStart}
            />
            <TextInput
              style={styles.dateInput}
              placeholder="End Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customEnd}
              onChangeText={setCustomEnd}
            />
          </View>
        </View>
      )}

      {/* Overall Summary Card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Company Total</Text>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Completed Transactions:</Text>
          <Text style={styles.value}>{totalCompletedTx}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Sales:</Text>
          <Text style={styles.grandTotal}>{formatMoney(totalCompletedSales)}</Text>
        </View>
      </View>

      {query.isLoading && <LoadingState label="Aggregating sales by branch…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {rangeType === 'custom' && !query.isFetched && !query.isLoading && (
        <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
      )}
      {report.length === 0 && !query.isLoading && query.isFetched && (
        <EmptyState title="No sales recorded" message="Branches have no completed sales for this range." />
      )}

      {report.map((item) => (
        <View key={item.branch_id} style={styles.card}>
          <Text style={styles.branchTitle}>{item.branch_name}</Text>
          <View style={styles.auditRow}>
            <Text style={styles.label}>Transactions:</Text>
            <Text style={styles.value}>{item.transaction_count}</Text>
          </View>
          <View style={styles.auditRow}>
            <Text style={styles.label}>Branch Total:</Text>
            <Text style={styles.totalValue}>{formatMoney(item.total_sales)}</Text>
          </View>
        </View>
      ))}
    </Screen>
  );
}

export function ProductSalesSummaryScreen({ role }: { role: 'owner' | 'manager' }) {
  const { profile } = useAuth();
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');

  const branches = useBranches();

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  // For manager, branch is automatically locked on server-side
  const branchId = role === 'owner' ? (selectedBranchId || undefined) : undefined;

  const query = useProductSales(
    rangeType,
    branchId,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined
  );

  const products = query.data ?? [];
  const totalUnitsSold = products.reduce((acc, p) => acc + Number(p.quantity_sold), 0);
  const totalProductRevenue = products.reduce((acc, p) => acc + Number(p.total_revenue), 0);

  return (
    <Screen>
      <PageHeader
        title="Product Sales"
        subtitle={
          role === 'owner'
            ? 'Units sold and revenue aggregated by product.'
            : `${profile?.branch?.name ?? 'Branch'} product sales.`
        }
      />

      {/* Date Range Selector */}
      <View style={styles.rangeSelector}>
        <Text
          onPress={() => setRangeType('today')}
          style={[styles.rangeTab, rangeType === 'today' && styles.rangeTabActive]}
        >
          Today (PH)
        </Text>
        <Text
          onPress={() => setRangeType('all_time')}
          style={[styles.rangeTab, rangeType === 'all_time' && styles.rangeTabActive]}
        >
          All Time
        </Text>
        <Text
          onPress={() => setRangeType('custom')}
          style={[styles.rangeTab, rangeType === 'custom' && styles.rangeTabActive]}
        >
          Custom
        </Text>
      </View>

      {rangeType === 'custom' && (
        <View style={styles.customDateCard}>
          <Text style={styles.filterTitle}>Custom Date Range</Text>
          <View style={styles.customDateRow}>
            <TextInput
              style={styles.dateInput}
              placeholder="Start Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customStart}
              onChangeText={setCustomStart}
            />
            <TextInput
              style={styles.dateInput}
              placeholder="End Date (YYYY-MM-DD)"
              placeholderTextColor={colors.muted}
              value={customEnd}
              onChangeText={setCustomEnd}
            />
          </View>
        </View>
      )}

      {/* Branch Filter for Owner */}
      {role === 'owner' && (
        <View style={styles.chipCard}>
          <Text style={styles.label}>Filter by Branch:</Text>
          <View style={styles.chipRow}>
            <Text
              onPress={() => setSelectedBranchId('')}
              style={[styles.chip, !selectedBranchId && styles.chipActive]}
            >
              All Branches
            </Text>
            {branches.data
              ?.filter((b) => !b.is_main_branch)
              .map((b) => (
                <Text
                  key={b.id}
                  onPress={() => setSelectedBranchId(b.id)}
                  style={[styles.chip, selectedBranchId === b.id && styles.chipActive]}
                >
                  {b.name}
                </Text>
              ))}
          </View>
        </View>
      )}

      {/* Overall Summary Card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Totals</Text>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Units Sold:</Text>
          <Text style={styles.value}>{totalUnitsSold}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Revenue:</Text>
          <Text style={styles.grandTotal}>{formatMoney(totalProductRevenue)}</Text>
        </View>
      </View>

      {query.isLoading && <LoadingState label="Calculating product sales…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {rangeType === 'custom' && !query.isFetched && !query.isLoading && (
        <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
      )}
      {products.length === 0 && !query.isLoading && query.isFetched && (
        <EmptyState title="No product sales" message="No completed product sales for this range." />
      )}

      {products.map((item) => (
        <View key={item.product_id} style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.productName}>{item.product_name}</Text>
            <Text style={styles.revenueText}>{formatMoney(item.total_revenue)}</Text>
          </View>
          <Text style={styles.skuText}>{item.product_sku}</Text>
          <View style={styles.auditRow}>
            <Text style={styles.label}>Quantity Sold:</Text>
            <Text style={styles.statValue}>{item.quantity_sold}</Text>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  branchTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  productName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  revenueText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '900',
  },
  skuText: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  statValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  rangeSelector: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: radius.md,
    padding: 3,
    gap: 4,
  },
  rangeTab: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: 8,
    borderRadius: radius.sm,
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  rangeTabActive: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontWeight: '800',
  },
  customDateCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  customDateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dateInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 13,
  },
  chipCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: '#F3F4F6',
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  chipActive: {
    backgroundColor: colors.primary,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  totalValue: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  grandTotal: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '900',
  },
});
