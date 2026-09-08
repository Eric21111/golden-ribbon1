import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FilterDropdown } from '@/components/FilterDropdown';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useInventoryMovements } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';

import { MovementListItem } from './MovementListItem';

export function InventoryHistoryScreen({
  branchId = '',
  branchName,
}: {
  branchId?: string;
  branchName?: string;
}) {
  const lockedToBranch = Boolean(branchId);
  const branches = useBranches();
  const query = useInventoryMovements(branchId);
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const movement of query.data ?? []) {
      const id = movement.created_by;
      const name = movement.created_by_profile?.full_name?.trim() || 'Employee';
      if (id && !map.has(id)) map.set(id, name);
    }
    return [
      { label: 'All Accounts', value: '' },
      ...[...map.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];
  }, [query.data]);

  const branchOptions = useMemo(
    () => [
      { label: 'All Branches', value: '' },
      ...(branches.data ?? []).map((branch) => ({
        label: branch.name,
        value: branch.id,
      })),
    ],
    [branches.data],
  );

  const filtered = useMemo(() => {
    return (query.data ?? []).filter((movement) => {
      if (!lockedToBranch && filterBranchId && movement.branch_id !== filterBranchId) {
        return false;
      }
      if (filterAccountId && movement.created_by !== filterAccountId) return false;
      return true;
    });
  }, [query.data, lockedToBranch, filterBranchId, filterAccountId]);

  const pagination = useClientPagination(
    filtered,
    `${filterBranchId}|${filterAccountId}|${filtered.length}`,
  );

  const showOwnerFilters = !lockedToBranch;

  return (
    <Screen>
      <ConstrainedWidth style={styles.column}>
        <PageHeader
          title="Inventory history"
          subtitle={
            branchName
              ? `Signed movements for ${branchName}.`
              : 'Signed movements across all branches.'
          }
        />

        {showOwnerFilters || accountOptions.length > 1 ? (
          <View style={styles.filterRow}>
            {showOwnerFilters ? (
              <View style={styles.filterItem}>
                <FilterDropdown
                  label="Branch"
                  options={branchOptions}
                  value={filterBranchId}
                  onChange={setFilterBranchId}
                />
              </View>
            ) : null}
            <View style={styles.filterItem}>
              <FilterDropdown
                label="Account"
                options={accountOptions}
                value={filterAccountId}
                onChange={setFilterAccountId}
              />
            </View>
          </View>
        ) : null}

        {query.isLoading ? <LoadingState label="Loading movements…" /> : null}
        {query.error ? (
          <ErrorState
            message={getErrorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {!query.isLoading && !query.error && filtered.length === 0 ? (
          <EmptyState
            title="No inventory history"
            message={
              filterBranchId || filterAccountId
                ? 'No movements match the selected filters.'
                : 'Opening stock and transfer movements will appear here.'
            }
          />
        ) : null}
        {pagination.pageItems.map((movement) => (
          <MovementListItem key={movement.id} movement={movement} />
        ))}
        {pagination.showPagination ? (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
          />
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.md },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
});
