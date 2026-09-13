import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors, statChipColors } from '@/components/dashboard/theme';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useInventoryReconciliation } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { accentForName } from '@/lib/nameAccent';
import type { InventoryReconciliationItem } from '@/types/models';

export function InventoryReconciliationScreen() {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');

  const query = useInventoryReconciliation(selectedBranchId || undefined);
  const items = query.data ?? [];
  const pagination = useClientPagination(items, selectedBranchId);

  const totalProducts = items.length;
  const issueCount = items.filter((i) => i.has_reconciliation_issue).length;
  const balancedCount = totalProducts - issueCount;

  const branchOptions = [
    { label: 'All selling branches', value: '' },
    ...(branches.data?.filter((b) => !b.is_main_branch).map((b) => ({ label: b.name, value: b.id })) ?? []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Inventory Reconciliation" showBack />
      <ConstrainedWidth style={styles.column}>
        <FilterChipRow options={branchOptions} value={selectedBranchId} onChange={setSelectedBranchId} />

        <Text style={styles.sectionTitle}>RECONCILIATION OVERVIEW</Text>
        <StatTile layout="wide" emphasis icon="alert-circle-outline" label="Reconciliation issues" value={issueCount} />
        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} compact icon="cube-outline" label="Audited items" value={totalProducts} />
          <StatTile style={styles.statHalf} compact icon="checkmark-circle-outline" label="Balanced items" value={balancedCount} />
        </View>

        {query.isLoading ? <LoadingState label="Reconciling inventory ledgers…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {items.length === 0 && !query.isLoading ? (
          <EmptyState title="No products to reconcile" message="No active inventory or movements found for the selected branch." />
        ) : null}

        {pagination.pageItems.map((item) => (
          <ReconciliationItemCard key={`${item.branch_id}-${item.product_id}`} item={item} />
        ))}
        {pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

function ReconciliationItemCard({ item }: { item: InventoryReconciliationItem }) {
  const [expanded, setExpanded] = useState(false);
  const isIssue = item.has_reconciliation_issue;
  const hasAuditRef =
    item.transfer_missing_qty > 0 || item.transfer_excess_qty > 0 || item.return_missing_qty > 0 || item.return_excess_qty > 0;
  const varianceTone = isIssue ? styles.varianceIssue : styles.varianceOk;
  const varianceLabel = item.variance > 0 ? `+${item.variance}` : String(item.variance);
  const branchChip = statChipColors[accentForName(item.branch_name)];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide movement ledger' : 'Show movement ledger'}
      onPress={() => setExpanded((current) => !current)}
      style={({ pressed }) => [styles.card, isIssue && styles.issueCard, pressed && styles.pressed]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.productName} numberOfLines={2}>
          {item.product_name}
        </Text>
        <ManagerBadge label={isIssue ? 'Issue' : 'Balanced'} tone={isIssue ? 'danger' : 'success'} />
      </View>

      <View style={styles.subRow}>
        <View style={styles.subRowLeft}>
          <View style={[styles.branchTag, { backgroundColor: branchChip.chip }]}>
            <Ionicons name="storefront-outline" size={11} color={branchChip.icon} />
            <Text style={[styles.branchTagLabel, { color: branchChip.icon }]} numberOfLines={1}>
              {item.branch_name}
            </Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {item.product_sku}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={managerColors.subtext} />
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Calculated</Text>
          <Text style={styles.summaryValue}>{item.calculated_stock}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Current</Text>
          <Text style={styles.summaryValue}>{item.current_stock}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Variance</Text>
          <Text style={[styles.summaryValue, varianceTone]}>{varianceLabel}</Text>
        </View>
      </View>

      {expanded ? (
        <View style={styles.ledger}>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>+ Opening stock</Text>
            <Text style={styles.ledgerValue}>{item.opening_stock}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>+ Transfers in (received)</Text>
            <Text style={styles.ledgerValue}>{item.transfer_in}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>− Sales (deducted)</Text>
            <Text style={styles.ledgerValue}>{item.sale}</Text>
          </View>
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>− Returns out (sent)</Text>
            <Text style={styles.ledgerValue}>{item.return_out}</Text>
          </View>
          {item.adjustment !== 0 ? (
            <View style={styles.ledgerRow}>
              <Text style={styles.ledgerLabel}>± Adjustments</Text>
              <Text style={styles.ledgerValue}>{item.adjustment > 0 ? `+${item.adjustment}` : item.adjustment}</Text>
            </View>
          ) : null}

          {hasAuditRef ? (
            <View style={styles.auditRefSection}>
              <View style={styles.auditRefHeader}>
                <Ionicons name="information-circle-outline" size={13} color={managerColors.subtext} />
                <Text style={styles.auditRefTitle}>Audit discrepancies (reference only)</Text>
              </View>
              {item.transfer_missing_qty > 0 || item.transfer_excess_qty > 0 ? (
                <View style={styles.ledgerRow}>
                  <Text style={styles.ledgerLabel}>Transfer discrepancy</Text>
                  <Text style={styles.meta}>
                    {item.transfer_missing_qty} missing{item.transfer_excess_qty > 0 ? ` · ${item.transfer_excess_qty} excess` : ''}
                  </Text>
                </View>
              ) : null}
              {item.return_missing_qty > 0 || item.return_excess_qty > 0 ? (
                <View style={styles.ledgerRow}>
                  <Text style={styles.ledgerLabel}>Return discrepancy</Text>
                  <Text style={styles.meta}>
                    {item.return_missing_qty} missing{item.return_excess_qty > 0 ? ` · ${item.return_excess_qty} excess` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 16 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
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
  productName: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 21 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  subRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  branchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  branchTagLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  summaryItem: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  summaryLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  summaryValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
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
  auditRefSection: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 8,
    marginTop: 4,
    gap: 4,
  },
  auditRefHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  auditRefTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
});
