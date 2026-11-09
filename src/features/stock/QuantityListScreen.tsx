import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { CategoryGroupHeading } from '@/features/products/CategoryGroupHeading';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { buildListRows, groupByCategory, groupCounts } from '@/features/products/categoryGroups';
import { productSearchText } from '@/features/products/listFilters';
import { CATEGORY_CHIP_CHOICES, categoryOf, type CategoryFilter } from '@/features/products/productFilters';
import { useClientPagination } from '@/hooks/useClientPagination';
import { PIECE_QUANTITY_MAX_LENGTH, formatLiveStock } from '@/lib/format';

/**
 * The one layout for "enter a quantity for each product" screens that have no review step (Create return, Local purchase): the
 * same pieces as Send stock and Opening stock (search, category pills, category headings, a card per product with the stepper)
 * and a pinned summary + "Review" button at the bottom. Nothing is sent from here: the quantities go on to a review screen, where
 * the notes are written and the request is confirmed. Quantities live in the screen that uses it.
 */
export type QuantityRow = {
  id: string;
  name: string;
  sku: string;
  category: string | null | undefined;
  /** The balance this branch holds now. */
  onHand: number;
};

// Category pills carry the same icon as the rows. "All" is not a category, so it has none.
const CATEGORY_CHIPS = CATEGORY_CHIP_CHOICES.map((choice) => ({
  ...choice,
  leading: choice.value === 'all' ? undefined : <CategoryIcon category={choice.value} size={18} decorative />,
}));

const PAGE_SIZE = 10;

const asProduct = (row: QuantityRow) => ({ id: row.id, is_active: true, product_category: row.category });

/** Rows matching the search (name, SKU or category name) and the chosen category pill, in category groups, A-Z inside each. */
export function filterQuantityRows(rows: QuantityRow[], search: string, category: CategoryFilter): QuantityRow[] {
  const term = search.trim().toLowerCase();
  const matching = rows
    .filter((row) => category === 'all' || categoryOf(asProduct(row)) === category)
    .filter((row) => !term || productSearchText({ ...asProduct(row), name: row.name, sku: row.sku }).includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));
  return groupByCategory(matching, asProduct);
}

export function QuantityListScreen({
  title,
  subtitle,
  rows,
  loading,
  loadError,
  onRetry,
  quantities,
  onQuantityChange,
  showMax = false,
  capAtOnHand = false,
  emptyTitle,
  emptyMessage,
  formError,
  actionLabel,
  actionDisabled,
  actionLoading,
  onAction,
}: {
  title: string;
  subtitle: string;
  rows: QuantityRow[];
  loading: boolean;
  /** Why the list could not be loaded (the list is not shown, Retry is). */
  loadError?: string | null;
  onRetry?: () => void;
  quantities: Record<string, string>;
  onQuantityChange: (id: string, value: string) => void;
  /** A "Max" button that fills in everything on hand. */
  showMax?: boolean;
  /** The quantity can never go above what is on hand (typing, + and Max all stop there). For a return: the database refuses more. */
  capAtOnHand?: boolean;
  emptyTitle: string;
  emptyMessage: string;
  formError?: string | null;
  actionLabel: string;
  actionDisabled: boolean;
  actionLoading: boolean;
  onAction: () => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const shown = useMemo(() => filterQuantityRows(rows, search, category), [rows, search, category]);
  const totals = useMemo(() => groupCounts(shown, asProduct), [shown]);
  const pagination = useClientPagination(shown, `${search}|${category}`, PAGE_SIZE);
  // a heading in front of each category on the page; none while one category is picked (it would say the same everywhere)
  const listRows = useMemo(
    () => buildListRows(pagination.pageItems, totals, category === 'all', asProduct),
    [pagination.pageItems, totals, category],
  );

  const entered = rows.filter((row) => Number(quantities[row.id]) > 0);
  const totalPieces = entered.reduce((sum, row) => sum + Number(quantities[row.id]), 0);
  const hasRows = rows.length > 0;
  const searching = search.trim() !== '' || category !== 'all';

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title={title} subtitle={subtitle} showBack />

        {hasRows ? (
          <View style={styles.filters}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
            <FilterChipRow options={CATEGORY_CHIPS} value={category} onChange={setCategory} />
          </View>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {loading ? <LoadingState /> : null}
          {loadError ? <ErrorState message={loadError} onRetry={onRetry} /> : null}
          {!loading && !loadError && !hasRows ? <EmptyState title={emptyTitle} message={emptyMessage} /> : null}
          {hasRows && shown.length === 0 ? (
            <EmptyState title="No matches" message="Try another name, SKU or category." />
          ) : null}

          {listRows.map((listRow) => {
            if (listRow.type === 'header') return <CategoryGroupHeading key={listRow.key} title={listRow.title} count={listRow.count} />;
            const row = listRow.item;
            const raw = quantities[row.id] ?? '';
            const current = Number.parseInt(raw || '0', 10) || 0;
            const atMin = current <= 0;
            const atOnHand = current >= row.onHand;
            // + is off at the ceiling only when there is one (a purchase can be any amount)
            const atCeiling = capAtOnHand && atOnHand;
            return (
              <View key={row.id} style={[styles.card, current > 0 && styles.cardSelected]}>
                <View style={styles.cardTop}>
                  <CategoryIcon category={row.category} size={36} decorative />
                  <View style={styles.cardInfo}>
                    <Text style={styles.name} numberOfLines={2}>
                      {row.name}
                    </Text>
                    <Text style={styles.sku}>{row.sku}</Text>
                  </View>
                  <View style={styles.onHandPill}>
                    <Text style={styles.onHandText} numberOfLines={1}>
                      <Text style={styles.onHandValue}>{formatLiveStock(row.onHand)}</Text>
                      <Text style={styles.onHandLabel}> on hand</Text>
                    </Text>
                  </View>
                </View>
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyCaption}>Qty</Text>
                  <View style={styles.qtyControls}>
                    <View style={[styles.stepperPill, focusedId === row.id && styles.stepperPillFocused]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease quantity for ${row.name}`}
                        hitSlop={6}
                        disabled={atMin}
                        onPress={() => onQuantityChange(row.id, String(Math.max(0, current - 1)))}
                        style={({ pressed }) => [styles.stepperButton, pressed && !atMin && styles.stepperButtonPressed]}
                      >
                        <Text style={[styles.stepperSymbol, atMin && styles.stepperSymbolDisabled]}>−</Text>
                      </Pressable>
                      <TextInput
                        accessibilityLabel={`Quantity for ${row.name}`}
                        keyboardType="number-pad"
                        value={raw}
                        placeholder="0"
                        placeholderTextColor={managerColors.subtext}
                        maxLength={PIECE_QUANTITY_MAX_LENGTH}
                        selectTextOnFocus
                        underlineColorAndroid="transparent"
                        onFocus={() => setFocusedId(row.id)}
                        onBlur={() => setFocusedId((id) => (id === row.id ? null : id))}
                        onChangeText={(value) => {
                          if (value === '' || /^\d{1,6}$/.test(value)) {
                            // typing 999 past what is on hand settles at what is on hand
                            onQuantityChange(row.id, capAtOnHand && Number(value) > row.onHand ? String(row.onHand) : value);
                          }
                        }}
                        style={styles.stepperInput}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Increase quantity for ${row.name}`}
                        hitSlop={6}
                        disabled={atCeiling}
                        onPress={() => onQuantityChange(row.id, String(Math.min(capAtOnHand ? row.onHand : 999999, current + 1)))}
                        style={({ pressed }) => [styles.stepperButton, pressed && !atCeiling && styles.stepperButtonPressed]}
                      >
                        <Text style={[styles.stepperSymbol, atCeiling && styles.stepperSymbolDisabled]}>+</Text>
                      </Pressable>
                    </View>
                    {showMax ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`All ${row.onHand} on hand for ${row.name}`}
                        disabled={atOnHand}
                        onPress={() => onQuantityChange(row.id, String(row.onHand))}
                        style={({ pressed }) => [
                          styles.maxButton,
                          atOnHand && styles.maxButtonDisabled,
                          pressed && !atOnHand && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.maxButtonText, atOnHand && styles.maxButtonTextDisabled]}>Max</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}

          {pagination.showPagination ? (
            <View style={styles.pager}>
              <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
            </View>
          ) : null}

        </ScrollView>

        {hasRows ? (
          <View style={styles.footer}>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            {entered.length > 0 ? (
              <View style={styles.summary}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{entered.length}</Text>
                  <Text style={styles.summaryLabel}>{entered.length === 1 ? 'product' : 'products'}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{formatLiveStock(totalPieces)}</Text>
                  <Text style={styles.summaryLabel}>total pcs</Text>
                </View>
              </View>
            ) : null}
            <ManagerActionButton label={actionLabel} loading={actionLoading} disabled={actionDisabled} onPress={onAction} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  filters: { gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { padding: 20, gap: 12, paddingBottom: 20 },
  card: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F8FAFE' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardInfo: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15.5 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  onHandPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  onHandText: { fontSize: 13 },
  onHandValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  onHandLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 12,
    gap: 12,
  },
  qtyCaption: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 10,
    backgroundColor: managerColors.cardSurface,
    overflow: 'hidden',
  },
  stepperPillFocused: { borderColor: managerColors.royalBlue, backgroundColor: '#FFFFFF' },
  stepperButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 20 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  stepperInput: {
    width: 48,
    height: 40,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
    paddingVertical: 0,
  },
  maxButton: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#EAF0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  maxButtonDisabled: { backgroundColor: managerColors.cardSurface },
  maxButtonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  maxButtonTextDisabled: { color: managerColors.cardBorder },
  pressed: { opacity: 0.7 },
  pager: { alignItems: 'center', paddingTop: 4 },
  footer: {
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EAF0FB', borderRadius: 12, paddingVertical: 10 },
  summaryItem: { flex: 1, alignItems: 'center', gap: 1 },
  summaryValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 17 },
  summaryLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  summaryDivider: { width: 1, height: 28, backgroundColor: '#C7D6F2' },
});
