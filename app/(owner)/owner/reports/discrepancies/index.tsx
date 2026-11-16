import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { managerColors } from '@/components/dashboard/theme';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useReturnDiscrepanciesReport, useTransferDiscrepanciesReport } from '@/hooks/useReconciliation';
import { useShiftRemittances } from '@/hooks/useShifts';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { stockUnit } from '@/lib/stockUnits';
import type { DiscrepancyResolutionReason } from '@/types/models';

type Section = 'transfer' | 'return' | 'remittance';
type StatusFilter = 'all' | 'open' | 'resolved';

const SECTION_OPTIONS: Array<{ label: string; value: Section }> = [
  { value: 'transfer', label: 'Transfers' },
  { value: 'return', label: 'Returns' },
  { value: 'remittance', label: 'Remittance' },
];

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];

const RESOLUTION_REASON_LABELS: Record<DiscrepancyResolutionReason, string> = {
  confirmed_shortage: 'Confirmed shortage',
  confirmed_excess: 'Confirmed excess',
  counting_error: 'Counting error',
  encoding_error: 'Encoding error',
  transfer_handling_issue: 'Transfer handling issue',
  return_handling_issue: 'Return handling issue',
  other: 'Other',
};

function resolutionLabel(reason: string | null | undefined, note: string | null | undefined): string {
  const reasonText = reason
    ? RESOLUTION_REASON_LABELS[reason as DiscrepancyResolutionReason] ?? reason.replace(/_/g, ' ')
    : null;
  const parts = [reasonText, note?.trim()].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No resolution recorded';
}

type AnalyticsRow = {
  id: string;
  product: string;
  branch: string;
  expected: string;
  actual: string;
  difference: string;
  missing: boolean;
  reason: string;
  resolution: string;
  status: StatusFilter | 'n/a';
  link: string;
  icon: 'swap-horizontal-outline' | 'return-up-back-outline' | 'cash-outline';
};

export default function OwnerDiscrepancyAnalytics() {
  const [section, setSection] = useState<Section>('transfer');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const transfers = useTransferDiscrepanciesReport(undefined, 'all', 'all_time');
  const returns = useReturnDiscrepanciesReport(undefined, 'all', 'all_time');
  const remittance = useShiftRemittances('all_time');
  const query = section === 'transfer' ? transfers : section === 'return' ? returns : remittance;

  const rows = useMemo((): AnalyticsRow[] => {
    if (section === 'remittance') {
      return (remittance.data?.days ?? []).flatMap((day) =>
        day.shifts.flatMap((shift) =>
          (
            [
              [shift.expected_gcash == null ? 'Collections' : 'Cash', shift.expected_cash, shift.actual_cash],
              ['GCash', shift.expected_gcash, shift.actual_gcash],
            ] as const
          ).flatMap(([label, expected, actual]) => {
            if (expected == null || actual == null || Number(actual) === Number(expected)) return [];
            return [
              {
                id: `${shift.shift_id}-${label}`,
                product: label,
                branch: shift.branch_name,
                expected: formatMoney(expected),
                actual: formatMoney(actual),
                difference: formatMoney(Math.abs(actual - expected)),
                missing: expected > actual,
                reason: 'No reason recorded',
                resolution: 'No resolution recorded',
                status: 'n/a' as const,
                link: `/owner/reports/shift-remittances/${shift.shift_id}`,
                icon: 'cash-outline' as const,
              },
            ];
          }),
        ),
      );
    }

    return (section === 'transfer' ? transfers.data ?? [] : returns.data ?? []).map((item) => {
      const unit = ` ${stockUnit(item.stock_unit_code)?.plural ?? 'pcs'}`;
      const expected = 'quantity_sent' in item ? item.quantity_sent : item.quantity_returned;
      const status = (item.status ?? 'open') as StatusFilter;
      return {
        id: item.id,
        product: item.product_name,
        branch: item.branch_name,
        expected: `${expected}${unit}`,
        actual: `${item.quantity_received}${unit}`,
        difference: `${Math.abs(Number(item.difference))}${unit}`,
        missing: item.discrepancy_type === 'missing',
        reason: item.notes?.trim() || 'No reason recorded',
        resolution: resolutionLabel(item.resolution_reason, item.resolution_note),
        status,
        link: `/owner/reports/discrepancies/${section}/${item.id}`,
        icon: section === 'transfer' ? ('swap-horizontal-outline' as const) : ('return-up-back-outline' as const),
      };
    });
  }, [section, transfers.data, returns.data, remittance.data]);

  const filteredRows = useMemo(() => {
    if (section === 'remittance' || statusFilter === 'all') return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, section, statusFilter]);

  const page = useClientPagination(filteredRows, `${section}|${statusFilter}`, 20);
  const openCount = rows.filter((row) => row.status === 'open').length;
  const resolvedCount = rows.filter((row) => row.status === 'resolved').length;
  const actualLabel = section === 'remittance' ? 'Remitted' : 'Received';

  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader title="Discrepancy Analytics" showBack />
      <ConstrainedWidth style={styles.column}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View stock count changes and reasons"
          onPress={() => router.push('/owner/reports/stock-count-changes' as never)}
          style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
        >
          <View style={styles.linkIcon}>
            <Ionicons name="create-outline" size={18} color={managerColors.royalBlue} />
          </View>
          <View style={styles.linkBody}>
            <Text style={styles.linkTitle}>Stock count changes</Text>
            <Text style={styles.linkMeta}>View count corrections and reasons</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
        </Pressable>

        <FilterChipRow value={section} onChange={setSection} options={SECTION_OPTIONS} />
        {section !== 'remittance' ? (
          <FilterChipRow value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
        ) : null}

        <StatTile
          layout="wide"
          emphasis
          icon="alert-circle-outline"
          label={`${SECTION_OPTIONS.find((option) => option.value === section)?.label ?? 'Discrepancy'} records`}
          value={filteredRows.length}
        />
        {section !== 'remittance' ? (
          <View style={styles.statsRow}>
            <StatTile style={styles.statHalf} compact icon="time-outline" label="Open" value={openCount} />
            <StatTile style={styles.statHalf} compact icon="checkmark-circle-outline" label="Resolved" value={resolvedCount} />
          </View>
        ) : null}

        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <LoadingState label="Loading differences…" />
        ) : !filteredRows.length ? (
          <EmptyState title="No differences" message="No differences recorded for this category." />
        ) : (
          <>
            {page.pageItems.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.product}, ${row.branch}`}
                onPress={() => router.push(row.link as never)}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.iconChip}>
                    <Ionicons name={row.icon} size={18} color={managerColors.royalBlue} />
                  </View>
                  <View style={styles.titleCol}>
                    <Text style={styles.product} numberOfLines={2}>
                      {row.product}
                    </Text>
                    <Text style={styles.branch} numberOfLines={1}>
                      {row.branch}
                    </Text>
                  </View>
                  <View style={styles.badges}>
                    {row.status === 'open' || row.status === 'resolved' ? (
                      <ManagerBadge
                        label={row.status === 'resolved' ? 'Resolved' : 'Open'}
                        tone={row.status === 'resolved' ? 'success' : 'warning'}
                      />
                    ) : null}
                    <ManagerBadge
                      label={row.missing ? `${row.difference} missing` : `${row.difference} excess`}
                      tone={row.missing ? 'danger' : 'warning'}
                    />
                  </View>
                </View>

                <View style={styles.qtyRow}>
                  <View style={styles.qtyItem}>
                    <Text style={styles.qtyLabel}>Expected</Text>
                    <Text style={styles.qtyValue}>{row.expected}</Text>
                  </View>
                  <View style={styles.qtyItem}>
                    <Text style={styles.qtyLabel}>{actualLabel}</Text>
                    <Text style={styles.qtyValue}>{row.actual}</Text>
                  </View>
                </View>

                <Text style={styles.detailLine} numberOfLines={2}>
                  Discrepancy reason: {row.reason}
                </Text>
                <Text style={styles.detailLine} numberOfLines={2}>
                  Resolution: {row.resolution}
                </Text>
              </Pressable>
            ))}
            {page.totalPages > 1 ? (
              <View style={styles.pager}>
                <Pagination page={page.page} totalPages={page.totalPages} onPageChange={page.setPage} />
              </View>
            ) : null}
          </>
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
  },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3EBFA',
  },
  linkBody: { flex: 1, gap: 2, minWidth: 0 },
  linkTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  linkMeta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.85 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3EBFA',
  },
  titleCol: { flex: 1, minWidth: 0, gap: 2 },
  product: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 20 },
  branch: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  badges: { alignItems: 'flex-end', gap: 6, maxWidth: '42%' },
  qtyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  qtyItem: { gap: 2, minWidth: 110, flexGrow: 1 },
  qtyLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  qtyValue: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  detailLine: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 17 },
  pager: { paddingVertical: 8 },
});
