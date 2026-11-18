import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/dashboard/ManagerFeedback';
import { CategoryGroupHeading } from '@/features/products/CategoryGroupHeading';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { buildListRows, groupByCategory, groupCounts } from '@/features/products/categoryGroups';
import { productSearchText } from '@/features/products/listFilters';
import { CATEGORY_CHIP_CHOICES, categoryOf, type CategoryFilter } from '@/features/products/productFilters';

import { FilterChipRow } from './FilterChipRow';
import { SearchInput } from './SearchInput';
import { managerColors } from './theme';

export type DetailLineStatus = 'match' | 'missing' | 'excess' | 'pending';
type StatusFilter = 'all' | 'match' | 'missing' | 'excess';

export type DetailProductListItem = {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  lineStatus: DetailLineStatus;
};

type DetailProductListSectionProps<T extends DetailProductListItem> = {
  title: string;
  items: T[];
  /** Row badge wording for a perfect count: Exact on returns, Complete on transfers/incoming. */
  matchLabel: 'Exact' | 'Complete';
  /** Status chips (incoming/returns) or category chips (transfer detail). */
  filterMode?: 'status' | 'category';
  /** Search, chips, and product count. Default true. */
  showFilters?: boolean;
  /** Category group headings (e.g. MEALS, NOT SET). Default true. */
  showGroupHeadings?: boolean;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  renderItem: (item: T) => ReactNode;
};

const CATEGORY_CHIPS = CATEGORY_CHIP_CHOICES.map((choice) => ({
  ...choice,
  leading: choice.value === 'all' ? undefined : <CategoryIcon category={choice.value} size={18} decorative />,
}));

function asProduct(item: DetailProductListItem) {
  return { id: item.id, is_active: true, product_category: item.category, name: item.name, sku: item.sku ?? '' };
}

function countByStatus(items: DetailProductListItem[]) {
  let match = 0;
  let missing = 0;
  let excess = 0;
  for (const item of items) {
    if (item.lineStatus === 'match') match += 1;
    else if (item.lineStatus === 'missing') missing += 1;
    else if (item.lineStatus === 'excess') excess += 1;
  }
  return { match, missing, excess };
}

/** Detail product lines: search, status or category chips, gray count, category group headings. */
export function DetailProductListSection<T extends DetailProductListItem>({
  title,
  items,
  matchLabel,
  filterMode = 'status',
  showFilters = true,
  showGroupHeadings = true,
  searchPlaceholder = 'Search name or SKU',
  emptyTitle = 'No matches',
  emptyMessage,
  renderItem,
}: DetailProductListSectionProps<T>) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const statusTotals = useMemo(() => countByStatus(items), [items]);

  const statusChips = useMemo(
    () => [
      { label: `All ${items.length}`, value: 'all' as const },
      { label: `${matchLabel} ${statusTotals.match}`, value: 'match' as const },
      { label: `Missing ${statusTotals.missing}`, value: 'missing' as const },
      { label: `Excess ${statusTotals.excess}`, value: 'excess' as const },
    ],
    [items.length, matchLabel, statusTotals],
  );

  const filtered = useMemo(() => {
    if (!showFilters) return groupByCategory(items, asProduct);
    const term = search.trim().toLowerCase();
    const matching = items
      .filter((item) => {
        if (filterMode === 'status') return status === 'all' || item.lineStatus === status;
        return category === 'all' || categoryOf(asProduct(item)) === category;
      })
      .filter((item) => !term || productSearchText(asProduct(item)).includes(term));
    return groupByCategory(matching, asProduct);
  }, [items, search, status, category, filterMode, showFilters]);

  const counts = useMemo(() => groupCounts(filtered, asProduct), [filtered]);
  const showHeadings =
    showGroupHeadings && (!showFilters || filterMode === 'status' || category === 'all');
  const listRows = useMemo(
    () => buildListRows(filtered, counts, showHeadings, asProduct),
    [filtered, counts, showHeadings],
  );
  const filtersVisible = showFilters && items.length > 0;
  const searching =
    search.trim() !== '' || (filterMode === 'status' ? status !== 'all' : category !== 'all');
  const emptyHint =
    emptyMessage ??
    (filterMode === 'category'
      ? 'Try another name, SKU or category.'
      : 'Try another name, SKU or status.');

  return (
    <View style={styles.root}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {filtersVisible ? (
        <View style={styles.filters}>
          <SearchInput value={search} onChangeText={setSearch} placeholder={searchPlaceholder} />
          {filterMode === 'status' ? (
            <FilterChipRow options={statusChips} value={status} onChange={setStatus} bleed={20} keepSelectedVisible />
          ) : (
            <FilterChipRow
              options={CATEGORY_CHIPS}
              value={category}
              onChange={setCategory}
              bleed={20}
              keepSelectedVisible
            />
          )}
        </View>
      ) : null}
      {filtersVisible ? (
        <Text style={styles.resultsCount}>
          {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
        </Text>
      ) : null}
      {filtersVisible && filtered.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          message={searching ? emptyHint : 'No products on this list.'}
        />
      ) : null}
      {listRows.map((row) => {
        if (row.type === 'header') {
          return <CategoryGroupHeading key={row.key} title={row.title} count={row.count} />;
        }
        return <View key={row.key}>{renderItem(row.item)}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 8,
  },
  filters: { gap: 10 },
  resultsCount: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});
