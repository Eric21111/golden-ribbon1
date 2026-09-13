import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet as BottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { MainBranchGuard } from '@/features/auth/MainBranchGuard';
import { BranchForm } from '@/features/branches/BranchForm';
import {
  BRANCH_FILTER_CHOICES,
  branchFilterEmptyMessage,
  matchesBranchFilter,
  type BranchFilter,
} from '@/features/branches/branchFilters';
import type { BranchFormValues } from '@/features/branches/branchSchema';
import { useBranches, useCreateBranch, useUpdateBranch } from '@/hooks/useBranches';
import { getErrorMessage } from '@/lib/errors';
import type { Branch } from '@/types/models';

export default function BranchListScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BranchFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const query = useBranches();
  const createMutation = useCreateBranch();
  const updateMutation = useUpdateBranch(editBranch?.id ?? '');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((branch) => {
      if (!matchesBranchFilter(branch, filter)) return false;
      if (!term) return true;
      return `${branch.name} ${branch.code}`.toLowerCase().includes(term);
    });
  }, [query.data, filter, search]);

  const empty =
    filter === 'all' && !search.trim()
      ? { title: 'No branches yet', message: 'Create the Main Branch to get started.' }
      : branchFilterEmptyMessage(filter, Boolean(search.trim()));

  const submitCreate = (values: BranchFormValues) => {
    createMutation.mutate(
      { ...values, is_main_branch: false, address: values.address?.trim() ? values.address.trim() : null },
      { onSuccess: () => setCreateOpen(false) },
    );
  };

  const submitEdit = (values: BranchFormValues) => {
    if (!editBranch) return;
    updateMutation.mutate(
      {
        ...values,
        is_main_branch: editBranch.is_main_branch,
        is_active: editBranch.is_main_branch ? true : values.is_active,
        address: values.address?.trim() || null,
      },
      { onSuccess: () => setEditBranch(null) },
    );
  };

  return (
    <MainBranchGuard>
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Branches" />

        <ConstrainedWidth style={styles.column}>
          <View style={styles.filters}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or code" />
            <FilterChipRow options={BRANCH_FILTER_CHOICES} value={filter} onChange={setFilter} />
          </View>

          {query.error ? (
            <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : query.isLoading && !query.data ? (
            <LoadingState label="Loading branches…" />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={<EmptyState title={empty.title} message={empty.message} />}
              renderItem={({ item }) => (
                <ListRowCard
                  title={item.name}
                  meta={`${item.code} · ${item.is_main_branch ? 'Main Branch' : 'Selling Branch'}`}
                  trailing={
                    <ManagerBadge
                      label={item.is_active ? 'Active' : 'Inactive'}
                      tone={item.is_active ? 'success' : 'neutral'}
                    />
                  }
                  onPress={() => setEditBranch(item)}
                />
              )}
            />
          )}

          <View style={styles.footer}>
            <ManagerActionButton
              label="Create branch"
              icon="add-circle-outline"
              onPress={() => {
                createMutation.reset();
                setCreateOpen(true);
              }}
            />
          </View>
        </ConstrainedWidth>

        <BottomSheet visible={createOpen} title="Create branch" scroll onClose={() => setCreateOpen(false)}>
          <BranchForm
            submitLabel="Create selling branch"
            hideMainToggle
            loading={createMutation.isPending}
            error={createMutation.error ? getErrorMessage(createMutation.error) : undefined}
            onSubmit={submitCreate}
          />
        </BottomSheet>

        <BottomSheet
          visible={editBranch != null}
          title="Edit branch"
          scroll
          onClose={() => setEditBranch(null)}
        >
          {editBranch ? (
            <BranchForm
              key={editBranch.id}
              defaultValues={{
                name: editBranch.name,
                code: editBranch.code,
                address: editBranch.address ?? '',
                is_main_branch: editBranch.is_main_branch,
                is_active: editBranch.is_active,
              }}
              hideMainToggle
              protectMainBranch={editBranch.is_main_branch}
              submitLabel="Save changes"
              loading={updateMutation.isPending}
              error={updateMutation.error ? getErrorMessage(updateMutation.error) : undefined}
              onSubmit={submitEdit}
            />
          ) : null}
        </BottomSheet>
      </Screen>
    </MainBranchGuard>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { gap: 12, marginBottom: 14 },
  listContent: { paddingBottom: 12, flexGrow: 1 },
  separator: { height: 12 },
  footer: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
});
