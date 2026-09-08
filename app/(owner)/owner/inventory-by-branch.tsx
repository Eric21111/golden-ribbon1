import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { InventoryListItem } from '@/features/inventory/InventoryListItem';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';

export default function AllBranchInventoryScreen() {
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branchId, branches.data]);
  const selected = branches.data?.find((branch) => branch.id === branchId);
  const inventory = useInventory(selected);
  const items = inventory.data ?? [];
  const pagination = useClientPagination(items, branchId);

  return (
    <Screen constrain>
      <PageHeader
        title="Inventory by branch"
        subtitle="Read-only physical balances. Quantities cannot be edited inline."
      />
      <BranchSelector branches={branches.data ?? []} value={branchId} onChange={setBranchId} />
      {branches.isLoading || inventory.isLoading ? (
        <LoadingState label="Loading branch inventory…" />
      ) : null}
      {branches.error || inventory.error ? (
        <ErrorState message={getErrorMessage(branches.error ?? inventory.error)} />
      ) : null}
      {inventory.data?.length === 0 ? (
        <EmptyState title="No inventory initialized" message="This branch has no product balances yet." />
      ) : null}
      {pagination.pageItems.map((item) => (
        <InventoryListItem key={item.product.id} item={item} />
      ))}
      {pagination.showPagination ? (
        <View style={styles.pager}>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pager: { paddingVertical: spacing.sm },
});
