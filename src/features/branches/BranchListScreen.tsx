import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
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
import { BranchForm, type BranchFormHandle } from '@/features/branches/BranchForm';
import {
  BRANCH_FILTER_CHOICES,
  branchFilterEmptyMessage,
  matchesBranchFilter,
  type BranchFilter,
} from '@/features/branches/branchFilters';
import type { BranchFormValues } from '@/features/branches/branchSchema';
import { useBranches, useCreateBranch, useDeleteBranch, useUpdateBranch } from '@/hooks/useBranches';
import { confirmAction } from '@/lib/confirmAction';
import { getErrorMessage, getRetentionActionMessage } from '@/lib/errors';
import { accentForName } from '@/lib/nameAccent';
import type { Branch } from '@/types/models';

type BranchListScreenProps = {
  canCreate: boolean;
  canEdit: boolean;
  /** Manager Branches: footer opens all catalogs; selling-branch rows open that branch’s catalog. */
  openCatalog?: boolean;
};

export function BranchListScreen({ canCreate, canEdit, openCatalog = false }: BranchListScreenProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BranchFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const query = useBranches();
  const createMutation = useCreateBranch();
  const updateMutation = useUpdateBranch(editBranch?.id ?? '');
  const deleteMutation = useDeleteBranch();
  const editForm = useRef<BranchFormHandle>(null);
  // after a failed save the next close discards the changes (so the sheet can always be left)
  const discardOnNextClose = useRef(false);
  // Delete closes the sheet itself. The next close must not run the edit form's auto-save.
  const closingAfterDelete = useRef(false);

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
      ? canCreate
        ? { title: 'No branches yet', message: 'Create a selling branch to get started.' }
        : {
            title: 'No branches yet',
            message: 'Ask the Owner to create or manage selling branches.',
          }
      : branchFilterEmptyMessage(filter, Boolean(search.trim()));

  const submitCreate = (values: BranchFormValues) => {
    createMutation.mutate(
      { ...values, is_main_branch: false, address: values.address?.trim() ? values.address.trim() : null },
      { onSuccess: () => setCreateOpen(false) },
    );
  };

  // saved when the sheet closes: the form only sends what changed and valid, and the sheet stays open if it could not be saved
  const submitEdit = (values: BranchFormValues) => {
    if (!editBranch) return Promise.resolve();
    return updateMutation.mutateAsync({
      ...values,
      is_main_branch: editBranch.is_main_branch,
      is_active: editBranch.is_main_branch ? true : values.is_active,
      address: values.address?.trim() || null,
    });
  };

  const openEdit = (branch: Branch) => {
    updateMutation.reset();
    deleteMutation.reset();
    discardOnNextClose.current = false;
    closingAfterDelete.current = false;
    setEditBranch(branch);
  };

  const requestDelete = () => {
    if (!editBranch || editBranch.is_main_branch || deleteMutation.isPending || updateMutation.isPending) return;
    const branch = editBranch;
    confirmAction(
      'Delete branch?',
      `This permanently deletes ${branch.name}. It cannot be undone. Branches with employees, stock, sales, shifts, or other history are kept. Turn Active off to deactivate a branch that must keep its records.`,
      () => {
        deleteMutation.mutate(branch.id, {
          onSuccess: () => {
            closingAfterDelete.current = true;
            updateMutation.reset();
            setEditBranch(null);
          },
        });
      },
      { confirm: 'Delete branch', cancel: 'Cancel', tone: 'danger' },
    );
  };

  const closeEdit = async () => {
    if (updateMutation.isPending) return;
    if (deleteMutation.isPending) return;
    if (closingAfterDelete.current) {
      closingAfterDelete.current = false;
      updateMutation.reset();
      deleteMutation.reset();
      setEditBranch(null);
      return;
    }
    if (discardOnNextClose.current) {
      discardOnNextClose.current = false;
      updateMutation.reset();
      setEditBranch(null);
      return;
    }
    const result = await editForm.current?.flush();
    if (!result || result === 'unchanged' || result === 'saved') {
      updateMutation.reset();
      setEditBranch(null);
    } else {
      discardOnNextClose.current = true;
    }
  };

  return (
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
            renderItem={({ item }) => {
              const openBranchCatalog =
                openCatalog && !item.is_main_branch
                  ? () => router.push(`/manager/catalog?branchId=${encodeURIComponent(item.id)}` as never)
                  : undefined;
              return (
                <ListRowCard
                  icon={item.is_main_branch ? 'home-outline' : 'storefront-outline'}
                  iconColor={accentForName(item.name)}
                  title={item.name}
                  meta={`${item.code} · ${item.is_main_branch ? 'Main Branch' : 'Selling Branch'}`}
                  trailing={
                    <ManagerBadge
                      label={item.is_active ? 'Active' : 'Inactive'}
                      tone={item.is_active ? 'success' : 'neutral'}
                    />
                  }
                  onPress={canEdit ? () => openEdit(item) : openBranchCatalog}
                />
              );
            }}
          />
        )}

        {canCreate || openCatalog ? (
          <View style={styles.footer}>
            {openCatalog ? (
              <ManagerActionButton
                label="Branch Catalogs"
                icon="git-branch-outline"
                variant={canCreate ? 'secondary' : undefined}
                onPress={() => router.push('/manager/catalog' as never)}
              />
            ) : null}
            {canCreate ? (
              <ManagerActionButton
                label="Create branch"
                icon="add-circle-outline"
                onPress={() => {
                  createMutation.reset();
                  setCreateOpen(true);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </ConstrainedWidth>

      {canCreate ? (
        <BottomSheet visible={createOpen} title="Create branch" scroll onClose={() => setCreateOpen(false)}>
          <BranchForm
            submitLabel="Create"
            onCancel={() => setCreateOpen(false)}
            hideMainToggle
            loading={createMutation.isPending}
            error={createMutation.error ? getErrorMessage(createMutation.error) : undefined}
            onSubmit={submitCreate}
          />
        </BottomSheet>
      ) : null}

      {canEdit ? (
        <BottomSheet
          visible={editBranch != null}
          title="Edit branch"
          scroll
          onClose={() => void closeEdit()}
        >
          {editBranch ? (
            <BranchForm
              key={editBranch.id}
              ref={editForm}
              autoSave
              defaultValues={{
                name: editBranch.name,
                code: editBranch.code,
                address: editBranch.address ?? '',
                is_main_branch: editBranch.is_main_branch,
                is_active: editBranch.is_active,
                receiving_mode: editBranch.receiving_mode,
              }}
              hideMainToggle
              protectMainBranch={editBranch.is_main_branch}
              loading={updateMutation.isPending}
              deleteLoading={deleteMutation.isPending}
              error={
                deleteMutation.error
                  ? getRetentionActionMessage(deleteMutation.error)
                  : updateMutation.error
                    ? getErrorMessage(updateMutation.error)
                    : undefined
              }
              onDelete={editBranch.is_main_branch ? undefined : requestDelete}
              onSubmit={submitEdit}
            />
          ) : null}
        </BottomSheet>
      ) : null}
    </Screen>
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
