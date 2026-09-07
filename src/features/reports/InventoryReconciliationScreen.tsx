import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import { useInventoryReconciliation } from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryReconciliationItem } from '@/types/models';

export function InventoryReconciliationScreen() {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');

  const query = useInventoryReconciliation(selectedBranchId || undefined);
  const items = query.data ?? [];

  const totalProducts = items.length;
  const issueCount = items.filter((i) => i.has_reconciliation_issue).length;
  const balancedCount = totalProducts - issueCount;

  return (
    <Screen>
      <PageHeader
        title="Inventory Reconciliation"
        subtitle="Verify branch physical inventory against cumulative signed movement ledgers."
      />

      {/* Branch Selector */}
      <View style={styles.chipCard}>
        <Text style={styles.filterTitle}>Select Selling Branch:</Text>
        <View style={styles.chipRow}>
          <Text
            onPress={() => setSelectedBranchId('')}
            style={[styles.chip, !selectedBranchId && styles.chipActive]}
          >
            All Selling Branches
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

      {/* Summary Reconciliation Banner */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Reconciliation Overview (Cumulative)</Text>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Audited Items:</Text>
          <Text style={styles.value}>{totalProducts}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Balanced Items:</Text>
          <Text style={styles.okText}>{balancedCount}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Reconciliation Issues:</Text>
          <Text style={[styles.boldValue, issueCount > 0 ? styles.missingText : styles.okText]}>
            {issueCount} {issueCount === 1 ? 'issue' : 'issues'} flagged
          </Text>
        </View>
      </View>

      {query.isLoading && <LoadingState label="Reconciling inventory ledgers…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {items.length === 0 && !query.isLoading && (
        <EmptyState
          title="No products to reconcile"
          message="No active inventory or movements found for the selected branch."
        />
      )}

      {items.map((item) => (
        <ReconciliationItemCard
          key={`${item.branch_id}-${item.product_id}`}
          item={item}
        />
      ))}
    </Screen>
  );
}

function ReconciliationItemCard({ item }: { item: InventoryReconciliationItem }) {
  const isIssue = item.has_reconciliation_issue;

  return (
    <View style={[styles.card, isIssue ? styles.issueBorder : styles.balancedBorder]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.productName}>{item.product_name}</Text>
          <Text style={styles.meta}>{item.branch_name} · {item.product_sku}</Text>
        </View>
        <Text style={isIssue ? styles.issueBadge : styles.balancedBadge}>
          {isIssue ? 'Reconciliation Issue' : 'Balanced'}
        </Text>
      </View>

      {/* Movement Breakdown Categories */}
      <View style={styles.breakdownSection}>
        <Text style={styles.sectionHeader}>Movement Ledger (Authoritative):</Text>
        <View style={styles.auditRow}>
          <Text style={styles.label}>+ Opening Stock:</Text>
          <Text style={styles.value}>{item.opening_stock}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>+ Transfers In (Received):</Text>
          <Text style={styles.value}>{item.transfer_in}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>− Sales (Deducted):</Text>
          <Text style={styles.value}>{item.sale}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>− Returns Out (Sent):</Text>
          <Text style={styles.value}>{item.return_out}</Text>
        </View>
        {item.adjustment !== 0 && (
          <View style={styles.auditRow}>
            <Text style={styles.label}>± Adjustments:</Text>
            <Text style={styles.value}>{item.adjustment > 0 ? `+${item.adjustment}` : item.adjustment}</Text>
          </View>
        )}
      </View>

      <View style={styles.divider} />

      {/* Stock Equation Verification */}
      <View style={styles.auditRow}>
        <Text style={styles.boldLabel}>Calculated Stock (Ledger):</Text>
        <Text style={styles.boldValue}>{item.calculated_stock}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.boldLabel}>Current Stock (On-Hand):</Text>
        <Text style={styles.boldValue}>{item.current_stock}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.boldLabel}>Variance (Current − Calculated):</Text>
        <Text style={[styles.boldValue, isIssue ? styles.missingText : styles.okText]}>
          {item.variance > 0 ? `+${item.variance} (Excess)` : item.variance < 0 ? `${item.variance} (Missing)` : '0'}
        </Text>
      </View>

      {/* Audit Discrepancies (Reference Only) */}
      {(item.transfer_missing_qty > 0 ||
        item.transfer_excess_qty > 0 ||
        item.return_missing_qty > 0 ||
        item.return_excess_qty > 0) && (
        <View style={styles.auditReferenceSection}>
          <Text style={styles.auditReferenceHeader}>Audit Discrepancies (Reference Only):</Text>
          {(item.transfer_missing_qty > 0 || item.transfer_excess_qty > 0) && (
            <View style={styles.auditRow}>
              <Text style={styles.label}>Transfer Discrepancy:</Text>
              <Text style={styles.meta}>
                {item.transfer_missing_qty} missing{item.transfer_excess_qty > 0 ? ` · ${item.transfer_excess_qty} excess` : ''}
              </Text>
            </View>
          )}
          {(item.return_missing_qty > 0 || item.return_excess_qty > 0) && (
            <View style={styles.auditRow}>
              <Text style={styles.label}>Return Discrepancy:</Text>
              <Text style={styles.meta}>
                {item.return_missing_qty} missing{item.return_excess_qty > 0 ? ` · ${item.return_excess_qty} excess` : ''}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  balancedBorder: {
    borderColor: '#E5E7EB',
  },
  issueBorder: {
    borderColor: colors.danger,
    backgroundColor: '#FFF8F8',
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
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
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  productName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
  },
  balancedBadge: {
    backgroundColor: '#DEF7EC',
    color: colors.success,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  issueBadge: {
    backgroundColor: '#FEE2E2',
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  breakdownSection: {
    backgroundColor: '#F9FAFB',
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: 2,
    marginTop: spacing.xs,
  },
  sectionHeader: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
  },
  value: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  boldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  boldValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  missingText: {
    color: colors.danger,
  },
  okText: {
    color: colors.success,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  auditReferenceSection: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 4,
    marginTop: 4,
    gap: 2,
  },
  auditReferenceHeader: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
});
