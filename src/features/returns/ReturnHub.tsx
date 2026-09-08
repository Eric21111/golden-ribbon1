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
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { OverflowSheet, type OverflowAction } from '@/components/OverflowSheet';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { useLayout } from '@/lib/layout';

import { ReturnDetailEmpty, ReturnDetailPane } from './ReturnDetailPane';
import { ReturnListItem, type StockReturnSummary } from './ReturnListItem';
import {
  returnFilterEmptyMessage,
  type ReturnStatusFilter,
} from './returnFilters';

type ReturnHubProps = {
  title: string;
  subtitle: string;
  returns: StockReturnSummary[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  loadingLabel?: string;
  defaultEmptyTitle: string;
  defaultEmptyMessage: string;
  statusFilter: ReturnStatusFilter;
  onStatusFilterChange: (status: ReturnStatusFilter) => void;
  statusChoices: Array<{ label: string; value: ReturnStatusFilter }>;
  primaryAction?: { label: string; onPress: () => void };
  overflowActions?: OverflowAction[];
  onPressReturn: (stockReturn: StockReturnSummary) => void;
  /**
   * Tablet master–detail (Manager). Owner set false — centered list only.
   */
  enableMasterDetail?: boolean;
};

export function ReturnHub({
  title,
  subtitle,
  returns,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
  loadingLabel = 'Loading stock returns…',
  defaultEmptyTitle,
  defaultEmptyMessage,
  statusFilter,
  onStatusFilterChange,
  statusChoices,
  primaryAction,
  overflowActions = [],
  onPressReturn,
  enableMasterDetail = true,
}: ReturnHubProps) {
  const { isTablet, hubMaxWidth } = useLayout();
  const useSplit = isTablet && enableMasterDetail;
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return returns ?? [];
    return (returns ?? []).filter((stockReturn) => {
      const haystack = [
        stockReturn.return_number,
        stockReturn.from_branch_name,
        stockReturn.to_branch_name,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [returns, search]);

  useEffect(() => {
    if (!useSplit) return;
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((stockReturn) => stockReturn.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, useSplit, selectedId]);

  const empty =
    statusFilter === '' && !search.trim()
      ? { title: defaultEmptyTitle, message: defaultEmptyMessage }
      : returnFilterEmptyMessage(statusFilter, Boolean(search.trim()));

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
        accessibilityLabel="Search returns"
        placeholder="Search return # or branch"
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        style={styles.search}
      />

      <ChoiceChips choices={statusChoices} value={statusFilter} onChange={onStatusFilterChange} />
    </View>
  );

  const list = !error && (returns || !isLoading) ? (
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
        <ReturnListItem
          stockReturn={item}
          selected={useSplit && item.id === selectedId}
          onPress={() => {
            if (useSplit) {
              setSelectedId(item.id);
              return;
            }
            onPressReturn(item);
          }}
        />
      )}
    />
  ) : null;

  const masterColumn = (
    <View style={styles.layout}>
      {top}
      {isLoading && !returns ? <LoadingState label={loadingLabel} /> : null}
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
          detail={selectedId ? <ReturnDetailPane returnId={selectedId} /> : <ReturnDetailEmpty />}
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
