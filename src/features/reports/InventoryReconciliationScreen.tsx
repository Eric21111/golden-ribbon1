import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors, statChipColors } from '@/components/dashboard/theme';
import { firstSearchParam, parseReportDateFilter } from '@/features/reports/branchHub';
import { DATE_RANGE_OPTIONS, DateRangeFilter, type DateFilterType } from '@/features/reports/DateRangeFilter';
import {
  buildInventoryReconBranchRows,
  inventoryReconBranchHref,
  inventoryReconBranchMeta,
  inventoryReconIssueBadge,
  reconHasOpenReturnIssue,
  reconHasOpenTransferIssue,
  reconHasResolvedDiscrepancy,
  reconHasStockMismatch,
  reconItemHasIssue,
  reconNonZeroMovementLines,
  reconOpenStatusLine,
  reconResolutionReasonLabel,
  reconResolvedRowDetail,
  reconResolvedRows,
  reconResolvedStatusLine,
  reconciliationItemBadge,
  summarizeInventoryRecon,
} from '@/features/reports/inventoryReconOverview';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useInventoryReconciliation } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatLiveStock } from '@/lib/format';
import { accentForName } from '@/lib/nameAccent';
import type {
  InventoryReconciliationItem,
  InventoryReconciliationResolvedDiscrepancy,
} from '@/types/models';

/** Live/current reconciliation quantities are whole PCS after Revision 7. */
function formatReconQty(quantity: number, code?: import('@/lib/stockUnits').StockUnitCode | null): string {
  return formatLiveStock(quantity, undefined, code);
}

function qtyPart(missing: number, excess: number): string {
  const parts = [];
  if (missing > 0) parts.push(`${missing} missing`);
  if (excess > 0) parts.push(`${excess} excess`);
  return parts.join(' · ');
}

export function resolutionReasonLabel(reason: string | null | undefined): string {
  return reconResolutionReasonLabel(reason);
}

export function resolvedRows(
  item: InventoryReconciliationItem,
): InventoryReconciliationResolvedDiscrepancy[] {
  return reconResolvedRows(item);
}

export function hasResolvedDiscrepancy(item: InventoryReconciliationItem): boolean {
  return reconHasResolvedDiscrepancy(item);
}

export function hasAuditDiscrepancy(item: InventoryReconciliationItem): boolean {
  return reconHasOpenReturnIssue(item) || reconHasOpenTransferIssue(item);
}

export function hasVisibleReconciliationIssue(item: InventoryReconciliationItem): boolean {
  return reconItemHasIssue(item);
}

export function reconciliationIssueBadge(item: InventoryReconciliationItem): {
  label: string;
  tone: 'danger' | 'warning' | 'success';
} {
  return reconciliationItemBadge(item);
}

export function auditDiscrepancySummary(item: InventoryReconciliationItem): string | null {
  const transfer = qtyPart(Number(item.transfer_missing_qty), Number(item.transfer_excess_qty));
  const ret = qtyPart(Number(item.return_missing_qty), Number(item.return_excess_qty));
  const parts = [
    transfer ? `Transfer ${transfer}` : '',
    ret ? `Return ${ret}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function resolvedDiscrepancySummary(item: InventoryReconciliationItem): string | null {
  return reconResolvedStatusLine(item);
}

function signedQty(quantity: number, code?: InventoryReconciliationItem['stock_unit_code']): string {
  const abs = formatReconQty(Math.abs(quantity), code);
  if (quantity > 0) return `+${abs}`;
  if (quantity < 0) return `−${abs}`;
  return abs;
}

function rangeLabel(rangeType: DateFilterType): string {
  if (rangeType === 'custom') return 'Custom range';
  return DATE_RANGE_OPTIONS.find((option) => option.value === rangeType)?.label ?? 'All Time';
}

export function InventoryReconciliationScreen() {
  const params = useLocalSearchParams<{
    branchId?: string | string[];
    range?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>();
  const selectedBranchId = firstSearchParam(params.branchId);
  const initialRange = parseReportDateFilter(firstSearchParam(params.range) || 'all_time');
  const initialStart = firstSearchParam(params.start);
  const initialEnd = firstSearchParam(params.end);
  const [rangeType, setRangeType] = useState<DateFilterType>(initialRange);
  const [customStart, setCustomStart] = useState(initialRange === 'custom' ? initialStart : '');
  const [customEnd, setCustomEnd] = useState(initialRange === 'custom' ? initialEnd : '');
  const [selected, setSelected] = useState<InventoryReconciliationItem | null>(null);
  const rangeArgs = { rangeType, customStart, customEnd };
  const branches = useBranches();
  const query = useInventoryReconciliation(selectedBranchId || undefined);
  const refresh = query.refetch;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const items = query.data ?? [];
  const totals = summarizeInventoryRecon(items);
  const branchRows = buildInventoryReconBranchRows(items, branches.data);
  const rankedItems = [...items].sort(
    (a, b) => Number(hasVisibleReconciliationIssue(b)) - Number(hasVisibleReconciliationIssue(a)),
  );
  const pagination = useClientPagination(rankedItems, selectedBranchId);
  const showHub = !selectedBranchId;
  const loading = query.isLoading || branches.isLoading;
  const selectedBranchName =
    (branches.data ?? []).find((branch) => branch.id === selectedBranchId)?.name ??
    items.find((item) => item.branch_id === selectedBranchId)?.branch_name;
  const title = 'Inventory Reconciliation';
  const subtitle = selectedBranchId ? selectedBranchName ?? 'Branch' : undefined;

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
      refreshing={query.isRefetching}
      onRefresh={() => void refresh()}
    >
      <ManagerScreenHeader title={title} subtitle={subtitle} showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.filterBleed}>
          <DateRangeFilter
            value={rangeType}
            onChange={setRangeType}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </View>

        <StatTile
          layout="wide"
          emphasis
          icon="cube-outline"
          label="Items in report"
          value={loading || query.error ? '—' : totals.itemCount}
        />
        <OwnerSummaryKpiPair
          left={{
            icon: 'checkmark-circle-outline',
            label: 'Balanced',
            value: loading || query.error ? '—' : totals.balancedCount,
          }}
          right={{
            icon: 'alert-circle-outline',
            label: 'With issues',
            value: loading || query.error ? '—' : totals.issueCount,
          }}
        />

        {loading ? <LoadingState label="Reconciling inventory ledgers…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}

        {showHub && !loading && !query.error && branchRows.length === 0 ? (
          <EmptyState title="No branches" message="No branches are available for inventory reconciliation." />
        ) : null}

        {showHub && !loading && !query.error && branchRows.length > 0 ? (
          <View style={styles.section}>
            <ReportSectionHeading title="BRANCHES" meta={rangeLabel(rangeType)} />
            {branchRows.map((row) => {
              const title = row.isActive ? row.branchName : `Inactive · ${row.branchName}`;
              const meta = inventoryReconBranchMeta(row);
              const badge = inventoryReconIssueBadge(row);
              return (
                <ListRowCard
                  key={row.branchId}
                  icon={row.isMain ? 'home-outline' : 'storefront-outline'}
                  iconColor={accentForName(row.branchName)}
                  title={title}
                  subtitle={meta}
                  trailing={<ManagerBadge label={badge.label} tone={badge.tone} />}
                  onPress={() =>
                    router.push(inventoryReconBranchHref({ branchId: row.branchId, ...rangeArgs }) as never)
                  }
                  accessibilityLabel={`${title} ${meta}, ${badge.label}`}
                  accessibilityHint="Opens inventory reconciliation for this branch"
                />
              );
            })}
          </View>
        ) : null}

        {!showHub && items.length === 0 && !loading && !query.error ? (
          <EmptyState
            title="No products to reconcile"
            message="No active inventory or movements found for the selected branch."
          />
        ) : null}

        {!showHub
          ? pagination.pageItems.map((item) => (
              <ReconciliationItemCard
                key={`${item.branch_id}-${item.product_id}`}
                item={item}
                onOpen={() => setSelected(item)}
              />
            ))
          : null}
        {!showHub && pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>
      <ManagerBottomSheet
        visible={selected != null}
        title={selected?.product_name ?? 'Product'}
        scroll
        onClose={() => setSelected(null)}
      >
        {selected ? <ReconDetailsBody item={selected} /> : null}
      </ManagerBottomSheet>
    </Screen>
  );
}

function LedgerLine({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'issue' | 'ok';
}) {
  return (
    <View style={styles.ledgerRow}>
      <Text style={[styles.ledgerLabel, strong && styles.ledgerStrong]}>{label}</Text>
      <Text
        style={[
          styles.ledgerValue,
          strong && styles.ledgerStrong,
          tone === 'issue' && styles.varianceIssue,
          tone === 'ok' && styles.varianceOk,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ReconciliationItemCard({
  item,
  onOpen,
}: {
  item: InventoryReconciliationItem;
  onOpen: () => void;
}) {
  const mismatch = reconHasStockMismatch(item);
  const openCountIssue = reconHasOpenReturnIssue(item) || reconHasOpenTransferIssue(item);
  const badge = reconciliationIssueBadge(item);
  const openLine = reconOpenStatusLine(item);
  const resolvedLine = resolvedDiscrepancySummary(item);
  const code = item.stock_unit_code;
  const a11yStatus = [openLine, resolvedLine].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.card, mismatch && styles.issueCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${item.product_name}, ${badge.label}${a11yStatus ? `, ${a11yStatus}` : ''}`}
      accessibilityHint="Shows movement details"
    >
      <View style={styles.headerRow}>
        <Text style={styles.productName}>{item.product_name}</Text>
        <View style={styles.headerTrail}>
          <ManagerBadge label={badge.label} tone={badge.tone} />
          <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
        </View>
      </View>
      <Text style={styles.meta}>{item.product_sku}</Text>
      {openLine ? <Text style={[styles.statusLine, styles.statusOpen]}>{openLine}</Text> : null}
      {resolvedLine ? (
        <Text style={[styles.statusLine, openCountIssue ? styles.resolutionLine : styles.statusResolved]}>
          {resolvedLine}
        </Text>
      ) : null}

      <View style={styles.ledger}>
        <LedgerLine label="Ledger" value={formatReconQty(Number(item.calculated_stock), code)} strong />
        <LedgerLine label="On hand" value={formatReconQty(Number(item.current_stock), code)} strong />
        <LedgerLine
          label="Variance"
          value={signedQty(Number(item.variance), code)}
          strong
          tone={mismatch ? 'issue' : 'ok'}
        />
      </View>
    </Pressable>
  );
}

export function ReconDetailsBody({ item }: { item: InventoryReconciliationItem }) {
  const mismatch = reconHasStockMismatch(item);
  const openCountIssue = reconHasOpenReturnIssue(item) || reconHasOpenTransferIssue(item);
  const badge = reconciliationIssueBadge(item);
  const openLine = reconOpenStatusLine(item);
  const resolvedLine = resolvedDiscrepancySummary(item);
  const movements = reconNonZeroMovementLines(item);
  const resolved = reconResolvedRows(item);
  const code = item.stock_unit_code;

  return (
    <View style={styles.sheetBody}>
      <View style={styles.sheetHead}>
        <View style={styles.headerRow}>
          <Text style={styles.meta}>{item.product_sku}</Text>
          <ManagerBadge label={badge.label} tone={badge.tone} />
        </View>
        {openLine ? <Text style={[styles.statusLine, styles.statusOpen]}>{openLine}</Text> : null}
        {resolvedLine ? (
          <Text style={[styles.statusLine, openCountIssue ? styles.resolutionLine : styles.statusResolved]}>
            {resolvedLine}
          </Text>
        ) : null}
      </View>
      <View style={styles.sheetCard}>
        {movements.length === 0 ? (
          <View style={styles.itemRow}>
            <Text style={styles.meta}>No stock movements</Text>
          </View>
        ) : (
          movements.map((line, index) => (
            <View
              key={line.label}
              style={[styles.itemRow, index < movements.length - 1 && styles.itemRowDivider]}
            >
              <Text style={styles.itemName}>{line.label}</Text>
              <Text style={styles.itemQty}>{signedQty(line.quantity, code)}</Text>
            </View>
          ))
        )}
        <View style={styles.sheetTotals}>
          <LedgerLine label="Ledger" value={formatReconQty(Number(item.calculated_stock), code)} strong />
          <LedgerLine label="On hand" value={formatReconQty(Number(item.current_stock), code)} strong />
          <LedgerLine
            label="Variance"
            value={signedQty(Number(item.variance), code)}
            strong
            tone={mismatch ? 'issue' : 'ok'}
          />
        </View>
      </View>
      {resolved.length > 0
        ? resolved.map((row) => {
            const detail = reconResolvedRowDetail(row);
            const when = row.resolved_at ? formatDate(row.resolved_at) : null;
            return (
              <View key={`${row.kind}-${row.id}`} style={styles.resolutionRow}>
                <Text style={styles.itemName}>{detail.title}</Text>
                {when ? <Text style={styles.meta}>{when}</Text> : null}
                {detail.meta ? <Text style={styles.meta}>{detail.meta}</Text> : null}
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, padding: 20, gap: 16 },
  filterBleed: { marginHorizontal: -20 },
  section: { gap: 10, marginTop: 4 },
  pager: { paddingVertical: 8 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  issueCard: { borderColor: '#F3C6C2', backgroundColor: '#FFFAF9' },
  pressed: { opacity: 0.85 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  headerTrail: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  productName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 21 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  statusLine: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  statusOpen: { color: '#92400E', fontFamily: 'Inter_600SemiBold' },
  statusResolved: { color: managerColors.green, fontFamily: 'Inter_600SemiBold' },
  resolutionLine: { color: managerColors.subtext, fontFamily: 'Inter_500Medium' },
  varianceIssue: { color: '#B91C1C' },
  varianceOk: { color: managerColors.green },
  ledger: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ledgerLabel: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  ledgerValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  ledgerStrong: { fontFamily: 'Inter_700Bold', color: managerColors.ink },
  resolutionRow: { gap: 2 },
  sheetBody: { gap: 14, paddingBottom: 8 },
  sheetHead: { gap: 6 },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  itemRowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  itemName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  itemQty: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  sheetTotals: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingVertical: 12,
    gap: 6,
  },
});
