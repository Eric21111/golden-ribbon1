import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BottomSheet } from '@/components/BottomSheet';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { useCreateBranch } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { getErrorMessage } from '@/lib/errors';
import { useLayout } from '@/lib/layout';
import type { Branch } from '@/types/models';

import { BranchForm } from './BranchForm';
import { BranchListItem } from './BranchListItem';
import {
  BRANCH_FILTER_CHOICES,
  branchFilterEmptyMessage,
  matchesBranchFilter,
  type BranchFilter,
} from './branchFilters';
import type { BranchFormValues } from './branchSchema';

type BranchHubProps = {
  branches: Branch[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onPressBranch: (branch: Branch) => void;
};

export function BranchHub({
  branches,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
  onPressBranch,
}: BranchHubProps) {
  const { isTablet, hubMaxWidth } = useLayout();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BranchFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const createMutation = useCreateBranch();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (branches ?? []).filter((branch) => {
      if (!matchesBranchFilter(branch, filter)) return false;
      if (!query) return true;
      return `${branch.name} ${branch.code}`.toLowerCase().includes(query);
    });
  }, [branches, filter, search]);

  const pagination = useClientPagination(filtered, `${search}|${filter}`);

  const empty =
    filter === 'all' && !search.trim()
      ? { title: 'No branches yet', message: 'Create the Main Branch to get started.' }
      : branchFilterEmptyMessage(filter, Boolean(search.trim()));

  const submitCreate = (values: BranchFormValues) => {
    createMutation.mutate(
      {
        ...values,
        address: values.address?.trim() ? values.address.trim() : null,
      },
      { onSuccess: () => setCreateOpen(false) }
    );
  };

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth maxWidth={hubMaxWidth} fill enabled={isTablet}>
        <View style={styles.layout}>
          <View style={styles.top}>
            <PageHeader title="Branches" subtitle="Main and selling locations" />

            <TextInput
              accessibilityLabel="Search branches"
              placeholder="Search name or code"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              style={styles.search}
            />

            <ChoiceChips choices={BRANCH_FILTER_CHOICES} value={filter} onChange={setFilter} />
          </View>

          {isLoading && !branches ? <LoadingState label="Loading branches…" /> : null}
          {error ? <ErrorState message={error} onRetry={onRetry} /> : null}

          {!error && (branches || !isLoading) ? (
            <FlatList
              data={pagination.pageItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              style={styles.list}
              refreshControl={
                <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
              }
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                isLoading ? (
                  <LoadingState label="Loading branches…" />
                ) : (
                  <EmptyState title={empty.title} message={empty.message} />
                )
              }
              ListFooterComponent={
                pagination.showPagination ? (
                  <View style={styles.pager}>
                    <Pagination
                      page={pagination.page}
                      totalPages={pagination.totalPages}
                      onPageChange={pagination.setPage}
                    />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <BranchListItem branch={item} onPress={() => onPressBranch(item)} />
              )}
            />
          ) : null}

          <View style={styles.footer}>
            <AppButton
              label="Create branch"
              onPress={() => {
                createMutation.reset();
                setCreateOpen(true);
              }}
            />
          </View>
        </View>
      </ConstrainedWidth>

      <BottomSheet visible={createOpen} title="Create branch" scroll onClose={() => setCreateOpen(false)}>
        <BranchForm
          submitLabel="Create branch"
          loading={createMutation.isPending}
          error={createMutation.error ? getErrorMessage(createMutation.error) : undefined}
          onSubmit={submitCreate}
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  top: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexGrow: 1 },
  separator: { height: spacing.sm },
  pager: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
