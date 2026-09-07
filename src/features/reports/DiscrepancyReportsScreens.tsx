import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import {
  useReturnDiscrepanciesReport,
  useTransferDiscrepanciesReport,
} from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, toNextDayStartManila, toStartOfDayManila } from '@/lib/format';
import type {
  ReturnDiscrepancyReportItem,
  TransferDiscrepancyReportItem,
} from '@/types/models';

type DateFilterType = 'today' | 'all_time' | 'custom';
type DiscrepancyFilterType = 'all' | 'missing' | 'excess';

export function TransferDiscrepanciesReportScreen() {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyFilterType>('all');
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  const query = useTransferDiscrepanciesReport(
    selectedBranchId || undefined,
    discrepancyType,
    rangeType,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined
  );

  const discrepancies = query.data ?? [];
  const totalMissing = discrepancies
    .filter((d) => d.discrepancy_type === 'missing')
    .reduce((acc, d) => acc + Number(d.difference), 0);
  const totalExcess = discrepancies
    .filter((d) => d.discrepancy_type === 'excess')
    .reduce((acc, d) => acc + Math.abs(Number(d.difference)), 0);

  return (
    <Screen>
      <PageHeader
        title="Transfer Discrepancies"
        subtitle="Audited differences between stock sent from Main Branch and quantities received at selling branches."
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
          <Text style={styles.filterTitle}>Custom Date Range (YYYY-MM-DD)</Text>
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

      {/* Branch Filter */}
      <View style={styles.chipCard}>
        <Text style={styles.filterTitle}>Filter by Destination Branch:</Text>
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

      {/* Discrepancy Type Filter */}
      <View style={styles.filterRow}>
        <Text style={styles.filterTitle}>Type:</Text>
        <View style={styles.typeSelector}>
          {(['all', 'missing', 'excess'] as const).map((t) => (
            <Text
              key={t}
              onPress={() => setDiscrepancyType(t)}
              style={[styles.typeTab, discrepancyType === t && styles.typeTabActive]}
            >
              {t.toUpperCase()}
            </Text>
          ))}
        </View>
      </View>

      {/* Summary Totals */}
      <View style={styles.summaryCard}>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Discrepancy Records:</Text>
          <Text style={styles.value}>{discrepancies.length}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Missing Items:</Text>
          <Text style={[styles.boldValue, totalMissing > 0 ? styles.missingText : styles.okText]}>
            {totalMissing}
          </Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Excess Items:</Text>
          <Text style={[styles.boldValue, totalExcess > 0 ? styles.excessText : styles.okText]}>
            {totalExcess}
          </Text>
        </View>
      </View>

      {query.isLoading && <LoadingState label="Loading transfer discrepancies…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {discrepancies.length === 0 && !query.isLoading && (
        <EmptyState
          title="No transfer discrepancies"
          message="All transfer receipts matched the quantities sent."
        />
      )}

      {discrepancies.map((item) => (
        <TransferDiscrepancyCard key={item.id} item={item} />
      ))}
    </Screen>
  );
}

function TransferDiscrepancyCard({ item }: { item: TransferDiscrepancyReportItem }) {
  const isMissing = item.discrepancy_type === 'missing';
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.transferNum}>{item.transfer_number}</Text>
        <Text style={isMissing ? styles.missingBadge : styles.excessBadge}>
          {isMissing ? `${item.difference} Missing` : `${Math.abs(item.difference)} Excess`}
        </Text>
      </View>

      <Text style={styles.branchName}>Destination: {item.branch_name}</Text>
      <Text style={styles.productTitle}>{item.product_name} ({item.product_sku})</Text>

      <View style={styles.divider} />

      <View style={styles.auditRow}>
        <Text style={styles.label}>Quantity Sent:</Text>
        <Text style={styles.value}>{item.quantity_sent}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Quantity Received:</Text>
        <Text style={styles.value}>{item.quantity_received}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Receipt Date:</Text>
        <Text style={styles.value}>{formatDate(item.created_at)}</Text>
      </View>

      {Boolean(item.notes) && <Text style={styles.notesText}>Note: {item.notes}</Text>}
    </View>
  );
}

export function ReturnDiscrepanciesReportScreen() {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyFilterType>('all');
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const startDateIso = toStartOfDayManila(customStart);
  const endDateIso = toNextDayStartManila(customEnd);

  const query = useReturnDiscrepanciesReport(
    selectedBranchId || undefined,
    discrepancyType,
    rangeType,
    rangeType === 'custom' ? startDateIso : undefined,
    rangeType === 'custom' ? endDateIso : undefined
  );

  const discrepancies = query.data ?? [];
  const totalMissing = discrepancies
    .filter((d) => d.discrepancy_type === 'missing')
    .reduce((acc, d) => acc + Number(d.difference), 0);
  const totalExcess = discrepancies
    .filter((d) => d.discrepancy_type === 'excess')
    .reduce((acc, d) => acc + Math.abs(Number(d.difference)), 0);

  return (
    <Screen>
      <PageHeader
        title="Return Discrepancies"
        subtitle="Audited differences between branch returned stock and Main Branch verification receipts."
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
          <Text style={styles.filterTitle}>Custom Date Range (YYYY-MM-DD)</Text>
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

      {/* Branch Filter */}
      <View style={styles.chipCard}>
        <Text style={styles.filterTitle}>Filter by Returning Branch:</Text>
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

      {/* Discrepancy Type Filter */}
      <View style={styles.filterRow}>
        <Text style={styles.filterTitle}>Type:</Text>
        <View style={styles.typeSelector}>
          {(['all', 'missing', 'excess'] as const).map((t) => (
            <Text
              key={t}
              onPress={() => setDiscrepancyType(t)}
              style={[styles.typeTab, discrepancyType === t && styles.typeTabActive]}
            >
              {t.toUpperCase()}
            </Text>
          ))}
        </View>
      </View>

      {/* Summary Totals */}
      <View style={styles.summaryCard}>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Discrepancy Records:</Text>
          <Text style={styles.value}>{discrepancies.length}</Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Missing Items:</Text>
          <Text style={[styles.boldValue, totalMissing > 0 ? styles.missingText : styles.okText]}>
            {totalMissing}
          </Text>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.label}>Total Excess Items:</Text>
          <Text style={[styles.boldValue, totalExcess > 0 ? styles.excessText : styles.okText]}>
            {totalExcess}
          </Text>
        </View>
      </View>

      {query.isLoading && <LoadingState label="Loading return discrepancies…" />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {discrepancies.length === 0 && !query.isLoading && (
        <EmptyState
          title="No return discrepancies"
          message="All return receipts matched the quantities returned."
        />
      )}

      {discrepancies.map((item) => (
        <ReturnDiscrepancyCard key={item.id} item={item} />
      ))}
    </Screen>
  );
}

function ReturnDiscrepancyCard({ item }: { item: ReturnDiscrepancyReportItem }) {
  const isMissing = item.discrepancy_type === 'missing';
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.transferNum}>{item.return_number}</Text>
        <Text style={isMissing ? styles.missingBadge : styles.excessBadge}>
          {isMissing ? `${item.difference} Missing` : `${Math.abs(item.difference)} Excess`}
        </Text>
      </View>

      <Text style={styles.branchName}>Origin: {item.branch_name}</Text>
      <Text style={styles.productTitle}>{item.product_name} ({item.product_sku})</Text>

      <View style={styles.divider} />

      <View style={styles.auditRow}>
        <Text style={styles.label}>Quantity Returned:</Text>
        <Text style={styles.value}>{item.quantity_returned}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Main Branch Received:</Text>
        <Text style={styles.value}>{item.quantity_received}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text style={styles.label}>Verification Date:</Text>
        <Text style={styles.value}>{formatDate(item.created_at)}</Text>
      </View>

      {Boolean(item.notes) && <Text style={styles.notesText}>Note: {item.notes}</Text>}
    </View>
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
    gap: spacing.xs,
  },
  transferNum: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  branchName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  productTitle: {
    color: colors.muted,
    fontSize: 13,
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
    fontSize: 13,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  typeSelector: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: radius.sm,
    padding: 2,
    gap: 4,
  },
  typeTab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  typeTabActive: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontWeight: '800',
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
  boldValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  missingBadge: {
    backgroundColor: '#FEE2E2',
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  excessBadge: {
    backgroundColor: '#FEF3C7',
    color: '#D97706',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  missingText: {
    color: colors.danger,
  },
  excessText: {
    color: '#D97706',
  },
  okText: {
    color: colors.success,
  },
  notesText: {
    color: colors.text,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
});
