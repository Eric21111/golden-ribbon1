import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { InventoryListItem } from '@/features/inventory/InventoryListItem';
import { useBranches } from '@/hooks/useBranches';
import { useInventory } from '@/hooks/useInventory';
import { getErrorMessage } from '@/lib/errors';

export default function MainInventoryScreen() {
  const [search, setSearch] = useState('');
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const inventory = useInventory(mainBranch);
  const filtered = useMemo(() => inventory.data?.filter((item) => `${item.product.name} ${item.product.sku}`.toLowerCase().includes(search.toLowerCase())) ?? [], [inventory.data, search]);

  return (
    <Screen>
      <PageHeader title="Main Branch inventory" subtitle="Current physical stock backed by immutable movements." />
      <AppButton label="Set up opening stock" onPress={() => router.push('/owner/inventory/setup')} />
      <AppButton label="Send stock" variant="secondary" onPress={() => router.push('/owner/transfers/create')} />
      <FormField label="Search" value={search} onChangeText={setSearch} placeholder="Product name or SKU" />
      {(branches.isLoading || inventory.isLoading) ? <LoadingState label="Loading inventory…" /> : null}
      {(branches.error || inventory.error) ? <ErrorState message={getErrorMessage(branches.error ?? inventory.error)} onRetry={() => { void branches.refetch(); void inventory.refetch(); }} /> : null}
      {!branches.isLoading && !mainBranch ? <EmptyState title="No Main Branch" message="Mark one active branch as the Main Branch first." /> : null}
      {mainBranch && filtered.length === 0 && !inventory.isLoading ? <EmptyState title="No inventory found" message={search ? 'Try another name or SKU.' : 'Create active products, then initialize opening stock.'} /> : null}
      {filtered.map((item) => <InventoryListItem key={item.product.id} item={item} />)}
    </Screen>
  );
}
