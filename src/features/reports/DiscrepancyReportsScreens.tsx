import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FilterDropdown } from '@/components/FilterDropdown';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { DateRangeFilter, resolveReportRange, type DateFilterType } from '@/features/reports/DateRangeFilter';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import {
  useReturnDiscrepanciesReport,
  useTransferDiscrepanciesReport,
} from '@/hooks/useReconciliation';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

type DiscrepancyFilterType = 'all' | 'missing' | 'excess';
type StatusFilter = 'all' | 'open' | 'resolved';

const TYPE_OPTIONS: Array<{ label: string; value: DiscrepancyFilterType }> = [
  { label: 'All', value: 'all' },
  { label: 'Missing', value: 'missing' },
  { label: 'Excess', value: 'excess' },
];

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
];

export function TransferDiscrepanciesReportScreen({
  detailHref,
}: {
  detailHref: (id: string) => string;
}) {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyFilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useTransferDiscrepanciesReport(
    selectedBranchId || undefined,
    discrepancyType,
    rpcRangeType,
    startIso,
    endIso,
  );

  const discrepancies = useMemo(
    () =>
      (query.data ?? []).filter((item) => statusFilter === 'all' || (item.status ?? 'open') === statusFilter),
    [query.data, statusFilter],
  );
  const pagination = useClientPagination(
    discrepancies,
    `${selectedBranchId}|${discrepancyType}|${statusFilter}|${rangeType}|${customStart}|${customEnd}`,
  );
  const totalMissing = discrepancies
    .filter((d) => d.discrepancy_type === 'missing')
    .reduce((acc, d) => acc + Number(d.difference), 0);
  const totalExcess = discrepancies
    .filter((d) => d.discrepancy_type === 'excess')
    .reduce((acc, d) => acc + Math.abs(Number(d.difference)), 0);

  const branchOptions = [
    { label: 'All branches', value: '' },
    ...(branches.data?.filter((b) => !b.is_main_branch).map((b) => ({ label: b.name, value: b.id })) ?? []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Transfer Discrepancies" showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        <View style={styles.filterRow}>
          <View style={styles.filterItem}>
            <FilterDropdown label="Destination branch" options={branchOptions} value={selectedBranchId} onChange={setSelectedBranchId} />
          </View>
          <View style={styles.filterItem}>
            <FilterDropdown label="Type" options={TYPE_OPTIONS} value={discrepancyType} onChange={setDiscrepancyType} />
          </View>
          <View style={styles.filterItem}>
            <FilterDropdown label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          </View>
        </View>

        <StatTile
          layout="wide"
          emphasis
          icon="document-text-outline"
          label="Discrepancy records"
          value={discrepancies.length}
        />
        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} compact icon="arrow-down-circle-outline" label="Total missing items" value={totalMissing} />
          <StatTile style={styles.statHalf} compact icon="arrow-up-circle-outline" label="Total excess items" value={totalExcess} />
        </View>

        {query.isLoading ? <LoadingState label="Loading transfer discrepancies…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {discrepancies.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState
            title="No transfer discrepancies"
            message="Notes appear when a cashier reports a short or over shipment instead of confirming the full sent quantity."
          />
        ) : null}

        {pagination.pageItems.map((item) => {
          const isMissing = item.discrepancy_type === 'missing';
          const status = item.status ?? 'open';
          return (
            <ListRowCard
              key={item.id}
              title={item.transfer_number}
              subtitle={`${item.product_name} (${item.product_sku})`}
              meta={`Destination: ${item.branch_name} · Sent: ${item.quantity_sent} · Received: ${item.quantity_received} · ${formatDate(item.created_at)}${item.notes ? ` · Note: ${item.notes}` : ''}`}
              trailing={
                <View style={styles.trailing}>
                  <ManagerBadge label={status === 'resolved' ? 'Resolved' : 'Open'} tone={status === 'resolved' ? 'success' : 'warning'} />
                  <ManagerBadge
                    label={isMissing ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
                    tone={isMissing ? 'danger' : 'warning'}
                  />
                </View>
              }
              onPress={() => router.push(detailHref(item.id) as never)}
            />
          );
        })}
        {pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

export function ReturnDiscrepanciesReportScreen({
  detailHref,
}: {
  detailHref: (id: string) => string;
}) {
  const branches = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyFilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rangeType, setRangeType] = useState<DateFilterType>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { rpcRangeType, startIso, endIso } = resolveReportRange(rangeType, customStart, customEnd);
  const query = useReturnDiscrepanciesReport(
    selectedBranchId || undefined,
    discrepancyType,
    rpcRangeType,
    startIso,
    endIso,
  );

  const discrepancies = useMemo(
    () =>
      (query.data ?? []).filter((item) => statusFilter === 'all' || (item.status ?? 'open') === statusFilter),
    [query.data, statusFilter],
  );
  const pagination = useClientPagination(
    discrepancies,
    `${selectedBranchId}|${discrepancyType}|${statusFilter}|${rangeType}|${customStart}|${customEnd}`,
  );
  const totalMissing = discrepancies
    .filter((d) => d.discrepancy_type === 'missing')
    .reduce((acc, d) => acc + Number(d.difference), 0);
  const totalExcess = discrepancies
    .filter((d) => d.discrepancy_type === 'excess')
    .reduce((acc, d) => acc + Math.abs(Number(d.difference)), 0);

  const branchOptions = [
    { label: 'All branches', value: '' },
    ...(branches.data?.filter((b) => !b.is_main_branch).map((b) => ({ label: b.name, value: b.id })) ?? []),
  ];

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Return Discrepancies" showBack />
      <ConstrainedWidth style={styles.column}>
        <DateRangeFilter
          value={rangeType}
          onChange={setRangeType}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />

        <View style={styles.filterRow}>
          <View style={styles.filterItem}>
            <FilterDropdown label="Returning branch" options={branchOptions} value={selectedBranchId} onChange={setSelectedBranchId} />
          </View>
          <View style={styles.filterItem}>
            <FilterDropdown label="Type" options={TYPE_OPTIONS} value={discrepancyType} onChange={setDiscrepancyType} />
          </View>
          <View style={styles.filterItem}>
            <FilterDropdown label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          </View>
        </View>

        <StatTile
          layout="wide"
          emphasis
          icon="document-text-outline"
          label="Discrepancy records"
          value={discrepancies.length}
        />
        <View style={styles.statsRow}>
          <StatTile style={styles.statHalf} compact icon="arrow-down-circle-outline" label="Total missing items" value={totalMissing} />
          <StatTile style={styles.statHalf} compact icon="arrow-up-circle-outline" label="Total excess items" value={totalExcess} />
        </View>

        {query.isLoading ? <LoadingState label="Loading return discrepancies…" /> : null}
        {query.error ? (
          <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}
        {rangeType === 'custom' && !query.isFetched && !query.isLoading ? (
          <EmptyState title="Select a date range" message="Enter both a start date and an end date to run this report." />
        ) : null}
        {discrepancies.length === 0 && !query.isLoading && query.isFetched ? (
          <EmptyState title="No return discrepancies" message="All return receipts matched the quantities returned." />
        ) : null}

        {pagination.pageItems.map((item) => {
          const isMissing = item.discrepancy_type === 'missing';
          const status = item.status ?? 'open';
          return (
            <ListRowCard
              key={item.id}
              title={item.return_number}
              subtitle={`${item.product_name} (${item.product_sku})`}
              meta={`Origin: ${item.branch_name} · Returned: ${item.quantity_returned} · Main received: ${item.quantity_received} · ${formatDate(item.created_at)}${item.notes ? ` · Note: ${item.notes}` : ''}`}
              trailing={
                <View style={styles.trailing}>
                  <ManagerBadge label={status === 'resolved' ? 'Resolved' : 'Open'} tone={status === 'resolved' ? 'success' : 'warning'} />
                  <ManagerBadge
                    label={isMissing ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
                    tone={isMissing ? 'danger' : 'warning'}
                  />
                </View>
              }
              onPress={() => router.push(detailHref(item.id) as never)}
            />
          );
        })}
        {pagination.showPagination ? (
          <View style={styles.pager}>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 18 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
  trailing: { alignItems: 'flex-end', gap: 6 },
  pager: { paddingVertical: 8 },
});
