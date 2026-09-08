import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { MasterDetailLayout, masterDetailStyles } from '@/components/MasterDetailLayout';
import { OverflowSheet, type OverflowAction } from '@/components/OverflowSheet';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ChoiceChips } from '@/features/employees/ChoiceChips';
import { colors, radius, spacing } from '@/constants/theme';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useLayout } from '@/lib/layout';
import type { InventoryItem } from '@/types/models';

import { InventoryListItem } from './InventoryListItem';
import { InventoryProductDetails } from './InventoryProductDetails';
import { InventoryProductSheet } from './InventoryProductSheet';
import {
  filterEmptyMessage,
  matchesStockFilter,
  type StockFilter,
} from './inventoryStatus';

type InventoryHubProps = {
  title: string;
  subtitle: string;
  items: InventoryItem[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  loadingLabel?: string;
  defaultEmptyTitle: string;
  defaultEmptyMessage: string;
  primaryAction: { label: string; onPress: () => void };
  overflowActions: OverflowAction[];
  includeNotSetFilter?: boolean;
  sheetPrimaryAction?: { label: string; onPress: () => void };
  /**
   * Tablet master–detail (Manager). Owner supervisory hubs set false —
   * single centered column + bottom sheet.
   */
  enableMasterDetail?: boolean;
};

export function InventoryHub({
  title,
  subtitle,
  items,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
  loadingLabel = 'Loading inventory…',
  defaultEmptyTitle,
  defaultEmptyMessage,
  primaryAction,
  overflowActions,
  includeNotSetFilter = false,
  sheetPrimaryAction,
  enableMasterDetail = true,
}: InventoryHubProps) {
  const { isTablet, hubMaxWidth } = useLayout();
  const useSplit = isTablet && enableMasterDetail;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetItem, setSheetItem] = useState<InventoryItem | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const filterChoices = useMemo(
    () =>
      [
        { label: 'All', value: 'all' as const },
        { label: 'In stock', value: 'in_stock' as const },
        { label: 'Low', value: 'low' as const },
        { label: 'Out', value: 'out' as const },
        ...(includeNotSetFilter ? [{ label: 'Not set', value: 'not_set' as const }] : []),
      ] satisfies Array<{ label: string; value: StockFilter }>,
    [includeNotSetFilter],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (items ?? []).filter((item) => {
      if (!matchesStockFilter(item, filter)) return false;
      if (!query) return true;
      return `${item.product.name} ${item.product.sku}`.toLowerCase().includes(query);
    });
  }, [items, filter, search]);

  const pagination = useClientPagination(filtered, `${search}|${filter}`);

  useEffect(() => {
    if (!useSplit) return;
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((item) => item.product.id === selectedId)) return;
    setSelectedId(filtered[0]?.product.id ?? null);
  }, [filtered, useSplit, selectedId]);

  const selectedItem = useMemo(
    () => filtered.find((item) => item.product.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  const empty =
    filter === 'all' && !search.trim()
      ? { title: defaultEmptyTitle, message: defaultEmptyMessage }
      : filterEmptyMessage(filter, Boolean(search.trim()));

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
        accessibilityLabel="Search products"
        placeholder="Search name or SKU"
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        style={styles.search}
      />

      <ChoiceChips choices={filterChoices} value={filter} onChange={setFilter} />
    </View>
  );

  const list = !error && (!isLoading || items) ? (
    <FlatList
      data={pagination.pageItems}
      keyExtractor={(item) => item.product.id}
      contentContainerStyle={styles.listContent}
      style={styles.list}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        isLoading ? <LoadingState label={loadingLabel} /> : <EmptyState title={empty.title} message={empty.message} />
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
        <InventoryListItem
          item={item}
          selected={useSplit && item.product.id === selectedId}
          onPress={() => {
            if (useSplit) {
              setSelectedId(item.product.id);
              return;
            }
            setSheetItem(item);
          }}
        />
      )}
    />
  ) : null;

  const footer = (
    <View style={styles.footer}>
      <AppButton label={primaryAction.label} onPress={primaryAction.onPress} />
    </View>
  );

  const masterColumn = (
    <View style={styles.layout}>
      {top}
      {isLoading && !items ? <LoadingState label={loadingLabel} /> : null}
      {error ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {list}
      {footer}
    </View>
  );

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      {useSplit ? (
        <MasterDetailLayout
          master={masterColumn}
          detail={
            selectedItem ? (
              <ScrollView
                style={masterDetailStyles.detailScroll}
                contentContainerStyle={masterDetailStyles.detailContent}
                keyboardShouldPersistTaps="handled"
              >
                <InventoryProductDetails item={selectedItem} primaryAction={sheetPrimaryAction} />
              </ScrollView>
            ) : (
              <View style={masterDetailStyles.detailEmpty}>
                <EmptyState title="Select a product" message="Choose a product to view stock details." />
              </View>
            )
          }
        />
      ) : (
        <ConstrainedWidth maxWidth={hubMaxWidth} fill enabled={isTablet}>
          {masterColumn}
        </ConstrainedWidth>
      )}

      {!useSplit ? (
        <InventoryProductSheet
          item={sheetItem}
          primaryAction={sheetPrimaryAction}
          onClose={() => setSheetItem(null)}
        />
      ) : null}
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
