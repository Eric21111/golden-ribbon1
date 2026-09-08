import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FilterDropdown } from '@/components/FilterDropdown';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { OverflowSheet, type OverflowAction } from '@/components/OverflowSheet';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { useLayout } from '@/lib/layout';
import type { Branch, StockTransferSummary } from '@/types/models';

import { TransferDetailEmpty, TransferDetailPane } from './TransferDetailPane';
import { TransferListItem } from './TransferListItem';
import {
  transferFilterEmptyMessage,
  type TransferStatusFilter,
} from './transferFilters';

type TransferHubProps = {
  title: string;
  subtitle: string;
  transfers: StockTransferSummary[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  loadingLabel?: string;
  defaultEmptyTitle: string;
  defaultEmptyMessage: string;
  statusFilter: TransferStatusFilter;
  onStatusFilterChange: (status: TransferStatusFilter) => void;
  statusChoices: Array<{ label: string; value: TransferStatusFilter }>;
  destinationBranches?: Branch[];
  destinationBranchId?: string;
  onDestinationChange?: (branchId: string) => void;
  primaryAction?: { label: string; onPress: () => void };
  overflowActions?: OverflowAction[];
  onPressTransfer: (transfer: StockTransferSummary) => void;
  /** When true, pending transfers show a receive CTA in the tablet detail pane. */
  showReceiveAction?: boolean;
  receiveActionLabel?: string;
  /**
   * Tablet master–detail (Manager Incoming). Owner Transfers set false.
   */
  enableMasterDetail?: boolean;
  /** Owner uses compact dropdowns; Manager Incoming keeps chips. */
  filterPresentation?: 'chips' | 'dropdown';
};

export function TransferHub({
  title,
  subtitle,
  transfers,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
  loadingLabel = 'Loading transfers…',
  defaultEmptyTitle,
  defaultEmptyMessage,
  statusFilter,
  onStatusFilterChange,
  statusChoices,
  destinationBranches,
  destinationBranchId = '',
  onDestinationChange,
  primaryAction,
  overflowActions = [],
  onPressTransfer,
  showReceiveAction = false,
  receiveActionLabel = 'Receive stock',
  enableMasterDetail = true,
  filterPresentation = 'chips',
}: TransferHubProps) {
  const { isTablet, hubMaxWidth } = useLayout();
  const useSplit = isTablet && enableMasterDetail;
  const useDropdowns = filterPresentation === 'dropdown';
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return transfers ?? [];
    return (transfers ?? []).filter((transfer) => {
      const haystack = [
        transfer.transfer_number,
        transfer.from_branch?.name ?? '',
        transfer.to_branch?.name ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [transfers, search]);

  useEffect(() => {
    if (!useSplit) return;
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((transfer) => transfer.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, useSplit, selectedId]);

  const selectedTransfer = useMemo(
    () => filtered.find((transfer) => transfer.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  const hasDestinationFilter = Boolean(destinationBranchId);
  const empty =
    statusFilter === '' && !search.trim() && !hasDestinationFilter
      ? { title: defaultEmptyTitle, message: defaultEmptyMessage }
      : transferFilterEmptyMessage(statusFilter, Boolean(search.trim()), hasDestinationFilter);

  const top = (
    <View style={styles.top}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <PageHeader title={title} subtitle={subtitle} />
        </View>
        {overflowActions.length > 0 ? (
          <Pressable
            accessibilityLabel="More actions"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setOverflowOpen(true)}
            style={({ pressed }) => [styles.overflowButton, pressed && styles.pressed]}
          >
            <Ionicons color={colors.text} name="ellipsis-horizontal" size={22} />
          </Pressable>
        ) : null}
      </View>

      <TextInput
        accessibilityLabel="Search transfers"
        placeholder="Search transfer # or branch"
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        style={styles.search}
      />

      {useDropdowns ? (
        <View style={styles.filterRow}>
          <View style={styles.filterItem}>
            <FilterDropdown
              label="Status"
              options={statusChoices}
              value={statusFilter}
              onChange={onStatusFilterChange}
            />
          </View>
          {destinationBranches && onDestinationChange ? (
            <View style={styles.filterItem}>
              <FilterDropdown
                label="Destination"
                options={[
                  { label: 'All Branches', value: '' },
                  ...destinationBranches.map((branch) => ({
                    label: branch.name,
                    value: branch.id,
                  })),
                ]}
                value={destinationBranchId}
                onChange={onDestinationChange}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <ChoiceChips choices={statusChoices} value={statusFilter} onChange={onStatusFilterChange} />
          {destinationBranches && onDestinationChange ? (
            <BranchSelector
              branches={destinationBranches}
              value={destinationBranchId}
              onChange={onDestinationChange}
              allowAll
            />
          ) : null}
        </>
      )}
    </View>
  );

  const list = !error && (transfers || !isLoading) ? (
    <FlatList
      data={filtered}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      style={styles.list}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        isLoading ? <LoadingState label={loadingLabel} /> : <EmptyState title={empty.title} message={empty.message} />
      }
      renderItem={({ item }) => (
        <TransferListItem
          transfer={item}
          selected={useSplit && item.id === selectedId}
          onPress={() => {
            if (useSplit) {
              setSelectedId(item.id);
              return;
            }
            onPressTransfer(item);
          }}
        />
      )}
    />
  ) : null;

  const masterColumn = (
    <View style={styles.layout}>
      {top}
      {isLoading && !transfers ? <LoadingState label={loadingLabel} /> : null}
      {error ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {list}
      {primaryAction ? (
        <View style={styles.footer}>
          <AppButton label={primaryAction.label} onPress={primaryAction.onPress} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      {useSplit ? (
        <MasterDetailLayout
          master={masterColumn}
          detail={
            selectedId ? (
              <TransferDetailPane
                transferId={selectedId}
                receiveAction={
                  showReceiveAction && selectedTransfer
                    ? {
                        label: receiveActionLabel,
                        onPress: () => onPressTransfer(selectedTransfer),
                      }
                    : undefined
                }
              />
            ) : (
              <TransferDetailEmpty />
            )
          }
        />
      ) : (
        <ConstrainedWidth maxWidth={hubMaxWidth} fill enabled={isTablet}>
          {masterColumn}
        </ConstrainedWidth>
      )}

      <OverflowSheet visible={overflowOpen} actions={overflowActions} onClose={() => setOverflowOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  top: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterItem: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  overflowButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  pressed: { opacity: 0.7 },
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
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
