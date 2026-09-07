import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import { useAuditLogs } from '@/hooks/useAudit';
import { getErrorMessage } from '@/lib/errors';
import type { AuditAction, AuditLogEntry, AuditLogFilters } from '@/types/models';
import { formatDate } from '@/lib/format';

const RANGE_OPTIONS: { label: string; value: 'today' | 'all_time' | 'custom' }[] = [
  { label: 'Today', value: 'today' },
  { label: 'All Time', value: 'all_time' },
  { label: 'Custom', value: 'custom' },
];

const ACTION_OPTIONS: { label: string; value: AuditAction | '' }[] = [
  { label: 'All Actions', value: '' },
  { label: 'Employee Created', value: 'employee_created' },
  { label: 'Employee Updated', value: 'employee_updated' },
  { label: 'Employee Deactivated', value: 'employee_deactivated' },
  { label: 'Product Created', value: 'product_created' },
  { label: 'Product Updated', value: 'product_updated' },
  { label: 'Price Changed', value: 'product_price_changed' },
  { label: 'Inventory Adjusted', value: 'inventory_adjusted' },
  { label: 'Transfer Created', value: 'transfer_created' },
  { label: 'Transfer Received', value: 'transfer_received' },
  { label: 'Transfer Discrepancy', value: 'transfer_discrepancy_detected' },
  { label: 'Shift Started', value: 'shift_started' },
  { label: 'Shift Ended', value: 'shift_ended' },
  { label: 'Sale Completed', value: 'sale_completed' },
  { label: 'Return Created', value: 'return_created' },
  { label: 'Return Received', value: 'return_received' },
  { label: 'Return Discrepancy', value: 'return_discrepancy_detected' },
];

function actionLabel(action: AuditAction): string {
  return ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action;
}

function roleBadgeStyle(role: string): object {
  if (role === 'owner') return styles.roleBadgeOwner;
  if (role === 'manager') return styles.roleBadgeManager;
  return styles.roleBadgeCashier;
}

export function AuditHistoryScreen() {
  const branches = useBranches();
  const [filters, setFilters] = useState<AuditLogFilters>({ rangeType: 'all_time' });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const query = useAuditLogs(filters, page, PAGE_SIZE);
  const result = query.data;
  const items = result?.items ?? [];

  function updateFilter(patch: Partial<AuditLogFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
  }

  return (
    <Screen>
      <PageHeader title="Audit History" subtitle="Company-wide activity trail (Owner only)" />

      {/* Date Range Filter */}
      <View style={styles.filterCard}>
        <Text style={styles.filterLabel}>Date Range</Text>
        <View style={styles.chipRow}>
          {RANGE_OPTIONS.map((o) => (
            <Text
              key={o.value}
              onPress={() => updateFilter({ rangeType: o.value })}
              style={[styles.chip, filters.rangeType === o.value && styles.chipActive]}
            >
              {o.label}
            </Text>
          ))}
        </View>
      </View>

      {/* Branch Filter */}
      <View style={styles.filterCard}>
        <Text style={styles.filterLabel}>Branch</Text>
        <View style={styles.chipRow}>
          <Text
            onPress={() => updateFilter({ branchId: undefined })}
            style={[styles.chip, !filters.branchId && styles.chipActive]}
          >
            All Branches
          </Text>
          {branches.data?.map((b) => (
            <Text
              key={b.id}
              onPress={() => updateFilter({ branchId: b.id })}
              style={[styles.chip, filters.branchId === b.id && styles.chipActive]}
            >
              {b.name}
            </Text>
          ))}
        </View>
      </View>

      {/* Action Filter */}
      <View style={styles.filterCard}>
        <Text style={styles.filterLabel}>Action</Text>
        <View style={styles.chipRow}>
          {ACTION_OPTIONS.map((o) => (
            <Text
              key={o.value || 'all'}
              onPress={() => updateFilter({ action: o.value || undefined })}
              style={[
                styles.chip,
                (filters.action === o.value || (!filters.action && o.value === '')) &&
                  styles.chipActive,
              ]}
            >
              {o.label}
            </Text>
          ))}
        </View>
      </View>

      {/* Summary */}
      {result && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {result.total} event{result.total !== 1 ? 's' : ''} found
          </Text>
          <Text style={styles.summaryText}>
            Page {result.page + 1}
          </Text>
        </View>
      )}

      {query.isLoading && <LoadingState label="Loading audit history…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {items.length === 0 && !query.isLoading && !query.error && (
        <EmptyState title="No audit events" message="No matching audit records found." />
      )}

      {items.map((entry) => (
        <AuditLogCard
          key={entry.id}
          entry={entry}
          onPress={() => router.push(`/owner/audit/${entry.id}` as any)}
        />
      ))}

      {/* Pagination */}
      {(result?.has_more || page > 0) && !query.isLoading && (
        <View style={styles.paginationRow}>
          {page > 0 && (
            <Pressable style={styles.pageBtn} onPress={() => setPage((p) => p - 1)}>
              <Text style={styles.pageBtnText}>← Previous</Text>
            </Pressable>
          )}
          {result?.has_more && (
            <Pressable style={styles.pageBtn} onPress={() => setPage((p) => p + 1)}>
              <Text style={styles.pageBtnText}>Next →</Text>
            </Pressable>
          )}
        </View>
      )}
    </Screen>
  );
}

function AuditLogCard({
  entry,
  onPress,
}: {
  entry: AuditLogEntry;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionText}>{actionLabel(entry.action)}</Text>
          <Text style={styles.actorText}>{entry.actor_name_snapshot}</Text>
        </View>
        <View style={styles.metaRight}>
          <Text style={[styles.roleBadge, roleBadgeStyle(entry.actor_role_snapshot)]}>
            {entry.actor_role_snapshot.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.cardMeta}>
        {entry.branch_name && (
          <Text style={styles.metaText}>📍 {entry.branch_name}</Text>
        )}
        <Text style={styles.metaText}>📋 {entry.entity_type}</Text>
        <Text style={styles.metaText}>🕐 {formatDate(entry.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  filterLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryText: {
    color: colors.muted,
    fontSize: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  actionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  actorText: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  metaRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  roleBadge: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  roleBadgeOwner: {
    backgroundColor: '#EDE9FE',
    color: '#6D28D9',
  },
  roleBadgeManager: {
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
  },
  roleBadgeCashier: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
  },
  metaText: {
    color: colors.muted,
    fontSize: 11,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  pageBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  pageBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
