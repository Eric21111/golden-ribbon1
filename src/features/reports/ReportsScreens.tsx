import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import {
  DateRangeFilter,
  resolveReportRange,
  shouldShowBranchOrderLog,
  type DateFilterType,
} from '@/features/reports/DateRangeFilter';
import { accentForRank } from '@/features/reports/reportAccents';
import { useBranches } from '@/hooks/useBranches';
import { useBranchDailySales, useBranchSalesLog, useProductSales, useSalesByBranch } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatManilaDate, formatMoney } from '@/lib/format';
import type { BranchSalesReportItem, ProductSalesReportItem } from '@/types/models';

function BranchSalesCard({
  rank,
  item,
  expanded,
  onToggle,
  filterType,
  rangeType,
  startIso,
  endIso,
}: {
  rank: number;
  item: BranchSalesReportItem;
  expanded: boolean;
  onToggle: () => void;
  filterType: DateFilterType;
  rangeType: 'today' | 'custom' | 'all_time';
  startIso?: string;
  endIso?: string;
}) {
  const accent = accentForRank(rank);
  const showOrders = shouldShowBranchOrderLog(filterType, startIso, endIso);
  const log = useBranchSalesLog(expanded && showOrders ? item.branch_id : '', rangeType, startIso, endIso);
  const days = useBranchDailySales(expanded && !showOrders ? item.branch_id : '', rangeType, startIso, endIso);
  const detail = showOrders ? log : days;

  return (
    <View style={styles.rankRowCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${showOrders ? 'orders' : 'daily totals'} for ${item.branch_name}`}
        onPress={onToggle}
      >
        <View style={styles.rankRowTop}>
          <View style={[styles.rankBadge, { backgroundColor: accent.gradient[0] }]}>
            <Text style={[styles.rankBadgeLabel, { color: accent.icon }]}>#{rank}</Text>
          </View>
          <LinearGradient
            colors={accent.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconChip}
          >
            <Ionicons name="storefront-outline" size={18} color={accent.icon} />
          </LinearGradient>
          <Text style={styles.rankRowTitle} numberOfLines={1}>
            {item.branch_name}
          </Text>
          <Text style={styles.rankRowAmount}>{formatMoney(item.total_sales)}</Text>
        </View>
        <Text style={styles.rankRowMeta}>
          Transactions: {item.transaction_count}
          {expanded ? ' · Hide' : showOrders ? ' · Orders' : ' · Sales by day'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.logBlock}>
          <Text style={styles.logTitle}>{showOrders ? 'ORDERS' : 'SALES BY DAY'}</Text>
          {detail.isLoading ? <LoadingState label={showOrders ? 'Loading sales…' : 'Loading daily totals…'} /> : null}
          {detail.error ? (
            <ErrorState message={getErrorMessage(detail.error)} onRetry={() => void detail.refetch()} />
          ) : null}
          {detail.data?.length === 0 ? (
            <Text style={styles.logEmpty}>
              {showOrders
                ? 'No completed sales in this range. Older detailed sales may have been archived.'
                : 'No completed sales in this range.'}
            </Text>
          ) : null}
          {showOrders
            ? log.data?.map((sale) => (
                <ListRowCard
                  key={sale.id}
                  title={sale.sale_number}
                  meta={`${formatDate(sale.sold_at)} · ${sale.cashier?.full_name ?? 'Cashier'}`}
                  trailing={<Text style={styles.rankRowAmount}>{formatMoney(sale.total_amount)}</Text>}
                />
              ))
            : days.data?.map((row) => (
                <ListRowCard
                  key={row.business_date}
                  title={formatManilaDate(row.business_date)}
                  meta={`${row.transaction_count} ${Number(row.transaction_count) === 1 ? 'sale' : 'sales'}`}
                  trailing={<Text style={styles.rankRowAmount}>{formatMoney(row.total_sales)}</Text>}
                />
              ))}
        </View>
      ) : null}
    </View>
  );
}

function ProductSalesRow({ rank, item, share }: { rank: number; item: ProductSalesReportItem; share: number }) {
  const accent = accentForRank(rank);
  const barColors = [accent.icon, accent.gradient[0]] as const;

  return (
    <View style={styles.rankRowCard}>
      <View style={styles.rankRowTop}>
        <View style={[styles.rankBadge, { backgroundColor: accent.gradient[0] }]}>
          <Text style={[styles.rankBadgeLabel, { color: accent.icon }]}>#{rank}</Text>
        </View>
        <View style={styles.rankRowTitleBlock}>
          <Text style={styles.rankRowTitle} numberOfLines={1}>
            {item.product_name}
          </Text>
          <View style={styles.skuTag}>
            <Text style={styles.skuTagLabel} numberOfLines={1}>
              {item.product_sku}
            </Text>
          </View>
        </View>
        <Text style={styles.rankRowAmount}>{formatMoney(item.total_revenue)}</Text>
      </View>
      <Text style={styles.rankRowMeta}>Quantity sold: {item.quantity_sold}</Text>
      <View style={styles.barRow}>
        <View style={styles.barTrack}>
          <LinearGradient
            colors={barColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.barFill, { width: `${Math.max(share, 0)}%` }]}
          />
        </View>
        <Text style={[styles.barPercent, { color: accent.icon }]}>{share.toFixed(0)}%</Text>
      </View>
    </View>
  );
}

export function SalesByBranchScreen() {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [openBranchId, setOpenBranchId] = useState<string | null>(null);

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useSalesByBranch(rpcRangeType, startIso, endIso);

  const report = query.data ?? [];
  const activeBranches = report.filter((item) => Number(item.transaction_count) > 0);
  const totalCompletedTx = activeBranches.reduce((acc, r) => acc + Number(r.transaction_count), 0);
  const totalCompletedSales = activeBranches.reduce((acc, r) => acc + Number(r.total_sales), 0);
  const rankedBranches = useMemo(
    () => [...activeBranches].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
    [activeBranches],
  );

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Sales by Branch" showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} icon="receipt-outline" label="Transactions" value={totalCompletedTx} />
          <StatTile
            style={styles.statHalf}
            emphasis
            icon="cash-outline"
            label="Total sales"
            value={formatMoney(totalCompletedSales)}
          />
        </View>

        {query.isLoading ? <LoadingState label="Aggregating sales by branch…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {activeBranches.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState title="No sales recorded" message="Selling branches have no completed sales for this range." />
        ) : null}

        {rankedBranches.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>BRANCHES</Text>
            {rankedBranches.map((item, index) => (
              <BranchSalesCard
                key={item.branch_id}
                rank={index + 1}
                item={item}
                expanded={openBranchId === item.branch_id}
                onToggle={() => setOpenBranchId((current) => (current === item.branch_id ? null : item.branch_id))}
                filterType={rangeType}
                rangeType={rpcRangeType}
                startIso={startIso}
                endIso={endIso}
              />
            ))}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

export function ProductSalesSummaryScreen({ role }: { role: 'owner' | 'manager' }) {
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');

  const branches = useBranches();

  // For manager, branch is automatically locked on server-side
  const branchId = role === 'owner' ? (selectedBranchId || undefined) : undefined;

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useProductSales(rpcRangeType, branchId, startIso, endIso);

  const products = query.data ?? [];
  const totalUnitsSold = products.reduce((acc, p) => acc + Number(p.quantity_sold), 0);
  const totalProductRevenue = products.reduce((acc, p) => acc + Number(p.total_revenue), 0);
  const rankedProducts = useMemo(
    () => [...products].sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue)),
    [products]
  );

  const branchOptions = [
    { label: 'All branches', value: '' },
    ...(branches.data?.filter((b) => !b.is_main_branch).map((b) => ({ label: b.name, value: b.id })) ?? []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Product Sales" showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        {role === 'owner' ? (
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Branch</Text>
            <FilterChipRow options={branchOptions} value={selectedBranchId} onChange={setSelectedBranchId} />
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} icon="cube-outline" label="Total units sold" value={totalUnitsSold} />
          <StatTile
            style={styles.statHalf}
            emphasis
            icon="cash-outline"
            label="Total revenue"
            value={formatMoney(totalProductRevenue)}
          />
        </View>

        {query.isLoading ? <LoadingState label="Calculating product sales…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {products.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState title="No product sales" message="No completed product sales for this range." />
        ) : null}

        {rankedProducts.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PRODUCTS</Text>
            {rankedProducts.map((item, index) => (
              <ProductSalesRow
                key={item.product_id}
                rank={index + 1}
                item={item}
                share={totalProductRevenue > 0 ? (Number(item.total_revenue) / totalProductRevenue) * 100 : 0}
              />
            ))}
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 14 },
  filterGroup: { gap: 6 },
  filterLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11.5,
    letterSpacing: 0.4,
  },
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
  section: { gap: 8 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  rankRowCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  rankRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankBadge: {
    minWidth: 26,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankRowTitleBlock: { flex: 1, minWidth: 0, gap: 4 },
  rankRowTitle: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rankRowAmount: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  rankRowMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  skuTag: {
    alignSelf: 'flex-start',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  skuTagLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5, letterSpacing: 0.3 },
  logBlock: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: managerColors.cardBorder },
  logTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11.5,
    letterSpacing: 0.6,
  },
  logEmpty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EDEFF5',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 5, minWidth: 4 },
  barPercent: { fontFamily: 'Inter_700Bold', fontSize: 12.5, minWidth: 34, textAlign: 'right' },
});
