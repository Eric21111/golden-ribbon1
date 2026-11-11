import { StockUnitHint } from '@/components/StockUnitHint';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { FilterIconButton, SortIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { ListFilterSummary, ListFiltersSheet } from '@/features/products/ProductFilterControls';
import { DEFAULT_LIST_FILTERS, countListFilters, type ListFilterKey, type ListFilters } from '@/features/products/listFilters';
import {
  formatCashResultLabel,
  incompleteProductCount,
  isValidClosePieceQuantity,
} from '@/features/shifts/closeDisplay';
import {
  closeProgressText,
  fillWithSystem,
  fillableProducts,
  initialCounts,
  isCounted,
  splitByStock,
  systemPieces,
  visibleCountProducts,
  type CountFilter,
  type CountSort,
  type ProductCounts,
} from '@/features/shifts/closeCountList';
import { confirmAction } from '@/lib/confirmAction';
import { buildFinalizePayload, requiresRemittanceCount } from './remittanceProducts';
import { TABLET_MIN_EDGE } from '@/lib/layout';
import { formatMoney, previewCashResult } from '@/lib/format';
import { listCashierProductCategories } from '@/services/inventoryService';
import type {
  ShiftCloseFinalizeProduct,
  ShiftClosePreview,
  ShiftCloseProductPreview,
} from '@/types/models';

const COUNT_FILTER_OPTIONS: Array<{ label: string; value: CountFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Needs count', value: 'needs_count' },
  { label: 'Counted', value: 'counted' },
];

const SORT_OPTIONS: Array<{ label: string; value: CountSort }> = [
  { label: 'System stock (high to low)', value: 'stock-desc' },
  { label: 'Needs count first', value: 'needs_count' },
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
];
const DEFAULT_SORT: CountSort = 'stock-desc';


// The pills are the count status; the funnel holds the Category.
const COUNT_LIST_FILTERS: ListFilterKey[] = ['category'];

/** A small − 12 + control: tap to step or type. Digits only, up to 6. */
function MiniStepper({
  label,
  value,
  placeholder,
  accessibilityLabel,
  accessibilityHint,
  inputRef,
  onChange,
  onSubmit,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder: string;
  accessibilityLabel: string;
  accessibilityHint: string;
  inputRef?: (element: TextInput | null) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const current = Number.parseInt(value || '0', 10) || 0;
  return (
    <View style={styles.stepperField}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={[styles.stepperPill, focused && styles.stepperPillFocused]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          hitSlop={6}
          disabled={current <= 0}
          onPress={() => onChange(String(Math.max(0, current - 1)))}
          style={({ pressed }) => [styles.stepperButton, pressed && current > 0 && styles.stepperButtonPressed]}
        >
          <Text style={[styles.stepperSymbol, current <= 0 && styles.stepperSymbolDisabled]}>−</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          keyboardType="number-pad"
          returnKeyType="next"
          value={value}
          placeholder={placeholder}
          placeholderTextColor={managerColors.subtext}
          maxLength={6}
          selectTextOnFocus
          underlineColorAndroid="transparent"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onSubmitEditing={onSubmit}
          onChangeText={(text) => onChange(text.replace(/[^\d]/g, '').slice(0, 6))}
          style={styles.stepperInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          hitSlop={6}
          onPress={() => onChange(String(Math.min(999999, current + 1)))}
          style={({ pressed }) => [styles.stepperButton, pressed && styles.stepperButtonPressed]}
        >
          <Text style={styles.stepperSymbol}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProductCountCard({
  product,
  category,
  actualRemaining,
  wasteQuantity,
  wide,
  onChangeActual,
  onChangeWaste,
  onFillSystem,
  onSettle,
  registerRemaining,
  onNext,
}: {
  product: ShiftCloseProductPreview;
  category: string | null | undefined;
  actualRemaining: string;
  wasteQuantity: string;
  wide: boolean;
  onChangeActual: (value: string) => void;
  onChangeWaste: (value: string) => void;
  onFillSystem: () => void;
  /** An input lost focus: now is when the list may re-sort (never on a + / − / Use tap, so the cards stay under the finger). */
  onSettle: () => void;
  registerRemaining: (element: TextInput | null) => void;
  onNext: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasActual = actualRemaining.trim().length > 0;
  const counted = hasActual && isValidClosePieceQuantity(actualRemaining);
  const system = systemPieces(product);

  return (
    <View
      style={[styles.productCard, wide && styles.productCardWide, counted && styles.productCardCounted]}
      accessibilityLabel={`Count ${product.product_name_snapshot}`}
    >
      <View style={styles.productCardTop}>
        <View>
          <CategoryIcon category={category} size={36} decorative />
          {counted ? (
            <View style={styles.countedBadge}>
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
        <View style={styles.productCardInfo}>
          <Text style={styles.productName} numberOfLines={2}>
            {product.product_name_snapshot}
          </Text>
          <StockUnitHint code={product.stock_unit_code} />
          <Pressable
            onPress={() => setDetailsOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={detailsOpen ? 'Hide stock details' : 'View stock details'}
            hitSlop={6}
            style={styles.systemRow}
          >
            <Text style={styles.sku} numberOfLines={1}>
              {product.sku_snapshot ? `${product.sku_snapshot} · ` : ''}System {Number(product.system_balance_before_waste)}
            </Text>
            <Ionicons name={detailsOpen ? 'chevron-up' : 'information-circle-outline'} size={15} color={managerColors.royalBlue} />
          </Pressable>
        </View>
        {system != null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Set remaining to the system stock of ${system} for ${product.product_name_snapshot}`}
            onPress={onFillSystem}
            style={({ pressed }) => [styles.fillChip, pressed && styles.pressed]}
          >
            <Text style={styles.fillChipText}>Use {system}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.fieldsRow}>
        <MiniStepper
          label="Remaining"
          value={actualRemaining}
          placeholder="—"
          accessibilityLabel={`Actual remaining for ${product.product_name_snapshot}`}
          accessibilityHint="Count usable items left at the booth, not including waste."
          inputRef={registerRemaining}
          onChange={onChangeActual}
          onSubmit={onNext}
          onBlur={onSettle}
        />
        <MiniStepper
          label="Waste"
          value={wasteQuantity}
          placeholder="0"
          accessibilityLabel={`Waste for ${product.product_name_snapshot}`}
          accessibilityHint="Damaged, spoiled, or otherwise unusable pieces."
          onChange={onChangeWaste}
          onSubmit={onNext}
          onBlur={onSettle}
        />
      </View>

      {detailsOpen ? (
        <View style={styles.detailsBox}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Opening</Text>
            <Text style={styles.detailValue}>{Number(product.opening_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Received</Text>
            <Text style={styles.detailValue}>{Number(product.received_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Returned/outgoing</Text>
            <Text style={styles.detailValue}>{Number(product.outgoing_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Sold</Text>
            <Text style={styles.detailValue}>{Number(product.sold_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Adjustment</Text>
            <Text style={styles.detailValue}>{Number(product.adjustment_quantity)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>System stock</Text>
            <Text style={styles.detailValue}>{Number(product.system_balance_before_waste)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The count-and-remit screen body for End Shift / Pending Remittance. It is a full-height layout: the products and the cash scroll,
 * and a pinned bar at the bottom always shows how many are counted and holds the submit button. The parent supplies the header.
 */
export function CashierShiftCloseForm({
  preview,
  branchName,
  title = 'End Shift',
  submitLabel = 'Complete End Shift',
  loading,
  footerExtra,
  onSubmit,
}: {
  preview: ShiftClosePreview;
  branchName?: string | null;
  title?: string;
  submitLabel?: string;
  loading?: boolean;
  /** Something that belongs right above the submit button (a retry button, an error). */
  footerExtra?: ReactNode;
  onSubmit: (actualCash: string, products: ShiftCloseFinalizeProduct[], actualGcash?: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const wide = Math.min(width, height) >= TABLET_MIN_EDGE;
  const isLegacy = preview.mode === 'legacy_cash_only' || !preview.inventory_reconciliation_required;
  const allProducts = isLegacy ? [] : preview.products ?? [];
  const products = allProducts.filter(requiresRemittanceCount);
  const expectedCash = Number(preview.expected_cash);

  const [actualGcash, setActualGcash] = useState('');
  const splitPayments = preview.expected_gcash != null;
  const gcashResult = previewCashResult(Number(preview.expected_gcash ?? 0), actualGcash);
  const [actualCash, setActualCash] = useState('');
  const [counts, setCounts] = useState<ProductCounts>(() => initialCounts(products));
  const [search, setSearch] = useState('');
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [listFilters, setListFilters] = useState<ListFilters>(DEFAULT_LIST_FILTERS);
  const [sort, setSort] = useState<CountSort>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // What the list is ordered and filtered by only catches up when an input loses focus: a card must never jump away (or vanish
  // from a "Needs count" list) while its number is being typed.
  const countsRef = useRef(counts);
  countsRef.current = counts;
  const [settled, setSettled] = useState<ProductCounts>(counts);
  const settle = () => setSettled(countsRef.current);

  const categories = useQuery({
    queryKey: ['cashier-product-categories'],
    queryFn: listCashierProductCategories,
    staleTime: 5 * 60 * 1000,
    enabled: products.length > 0,
  });
  const categoryOfProduct = (product: ShiftCloseProductPreview) => categories.data?.get(product.product_id) ?? null;

  const cashResult = previewCashResult(expectedCash, actualCash);
  const incomplete = incompleteProductCount(products, counts);
  const countedTotal = products.length - incomplete;

  const shown = useMemo(
    () =>
      visibleCountProducts({
        products,
        settled,
        search,
        countFilter,
        category: listFilters.category,
        sort,
        categories: categories.data,
      }),
    [products, settled, search, countFilter, listFilters.category, sort, categories.data],
  );
  // two sections: what still has stock (the real counting) and what has none (usually just 0)
  const { withStock, noStock } = splitByStock(shown);

  // keyboard "Next": the Remaining box of the next product on screen
  const remainingInputs = useRef(new Map<string, TextInput | null>());
  const focusNextAfter = (productId: string) => {
    const ids = shown.map((product) => product.product_id);
    const next = ids[ids.indexOf(productId) + 1];
    if (next && remainingInputs.current.get(next)) remainingInputs.current.get(next)?.focus();
    else Keyboard.dismiss();
  };

  const setActual = (productId: string, actualRemaining: string) =>
    setCounts((current) => ({
      ...current,
      [productId]: { actualRemaining, wasteQuantity: current[productId]?.wasteQuantity ?? '0' },
    }));
  const setWaste = (productId: string, wasteQuantity: string) =>
    setCounts((current) => ({
      ...current,
      [productId]: { actualRemaining: current[productId]?.actualRemaining ?? '', wasteQuantity },
    }));

  // Fill one section: Remaining := system stock for its uncounted products (Waste kept). Asks first.
  const askFill = (group: typeof shown, kind: 'stock' | 'none') => {
    const targets = fillableProducts(group, counts);
    if (targets.length === 0) return;
    const noun = targets.length === 1 ? 'product' : 'products';
    confirmAction(
      kind === 'none' ? `Set ${targets.length} ${noun} to 0?` : `Fill ${targets.length} ${noun}?`,
      kind === 'none'
        ? 'These have no system stock. Remaining is set to 0 for each one, and you can still change any of them.'
        : 'Remaining is set to the system stock for products not counted yet. Waste stays as it is, and you can still change any of them.',
      () => {
        const next = fillWithSystem(countsRef.current, targets);
        countsRef.current = next;
        setCounts(next);
        setSettled(next);
      },
      { confirm: kind === 'none' ? 'Set to 0' : 'Fill', tone: 'warning' },
    );
  };

  const productsValid = useMemo(() => {
    if (products.length === 0) return true;
    return products.every((product) => {
      const row = counts[product.product_id];
      const waste = (row?.wasteQuantity ?? '0').trim() || '0';
      return (
        isValidClosePieceQuantity(row?.actualRemaining ?? '')
        && isValidClosePieceQuantity(waste)
      );
    });
  }, [counts, products]);

  const canSubmit = cashResult != null && (!splitPayments || gcashResult != null) && productsValid && incomplete === 0;

  const cutoffLabel = preview.sales_cutoff_at
    ? new Date(preview.sales_cutoff_at).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const submit = () => {
    if (!canSubmit || loading) return;
    const products = buildFinalizePayload(allProducts, counts);
    if (splitPayments) onSubmit(actualCash.trim(), products, actualGcash.trim());
    else onSubmit(actualCash.trim(), products);
  };

  const progressText = closeProgressText({ total: products.length, counted: countedTotal, cashEntered: cashResult != null && (!splitPayments || gcashResult != null) });
  const progress = products.length > 0 ? countedTotal / products.length : cashResult == null ? 0 : 1;

  const activeFilters = countListFilters(listFilters, COUNT_LIST_FILTERS);

  return (
    <View style={styles.screen} accessibilityLabel={title}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.statusStrip}>
          <Ionicons name="lock-closed-outline" size={16} color={managerColors.royalBlue} />
          <View style={styles.statusCopy}>
            <Text style={styles.status}>Sales closed for today</Text>
            {(branchName || cutoffLabel) ? (
              <Text style={styles.identityText}>
                {[branchName, cutoffLabel ? `Cutoff ${cutoffLabel}` : null].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
        </View>

        {!isLegacy && products.length > 0 ? (
          <>
            <View style={styles.toolbar}>
              <View style={styles.searchRow}>
                <View style={styles.searchField}>
                  <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
                </View>
                <FilterIconButton count={activeFilters} onPress={() => setFiltersOpen(true)} />
                <SortIconButton
                  currentLabel={SORT_OPTIONS.find((option) => option.value === sort)?.label}
                  active={sort !== DEFAULT_SORT}
                  onPress={() => setSortOpen(true)}
                />
              </View>
              <FilterChipRow options={COUNT_FILTER_OPTIONS} value={countFilter} onChange={setCountFilter} />
              <ListFilterSummary
                countText={`${shown.length} of ${products.length} products`}
                filters={listFilters}
                keys={COUNT_LIST_FILTERS}
                onChange={setListFilters}
              />
            </View>

            {shown.length === 0 ? (
              <Text style={styles.note}>No products match this search or filter.</Text>
            ) : (
              <>
                {[
                  { key: 'stock', title: 'WITH STOCK', items: withStock, kind: 'stock' as const, action: 'Use system stock for all' },
                  { key: 'none', title: 'NO SYSTEM STOCK', items: noStock, kind: 'none' as const, action: 'Set all to 0' },
                ].map((group) =>
                  group.items.length === 0 ? null : (
                    <View key={group.key} style={styles.group}>
                      <View style={styles.groupHeader}>
                        <Text style={styles.groupTitle}>
                          {group.title} <Text style={styles.groupCount}>{group.items.length}</Text>
                        </Text>
                        {fillableProducts(group.items, counts).length > 0 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${group.action} (${fillableProducts(group.items, counts).length} not counted yet)`}
                            hitSlop={8}
                            onPress={() => askFill(group.items, group.kind)}
                          >
                            <Text style={styles.groupAction}>{group.action}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      <View style={wide ? styles.gridWide : styles.list}>
                        {group.items.map((product) => {
                          const counted = counts[product.product_id] ?? { actualRemaining: '', wasteQuantity: '0' };
                          return (
                            <ProductCountCard
                              key={product.product_id}
                              product={product}
                              category={categoryOfProduct(product)}
                              actualRemaining={counted.actualRemaining}
                              wasteQuantity={counted.wasteQuantity}
                              wide={wide}
                              onChangeActual={(value) => setActual(product.product_id, value)}
                              onChangeWaste={(value) => setWaste(product.product_id, value)}
                              onFillSystem={() => {
                                const system = systemPieces(product);
                                if (system != null) setActual(product.product_id, String(system));
                              }}
                              onSettle={settle}
                              registerRemaining={(element) => {
                                remainingInputs.current.set(product.product_id, element);
                              }}
                              onNext={() => focusNextAfter(product.product_id)}
                            />
                          );
                        })}
                      </View>
                    </View>
                  ),
                )}
              </>
            )}
          </>
        ) : (
          <View style={styles.sectionCard}>
            <Text style={styles.note}>
              {isLegacy && !splitPayments
                ? 'This historical shift only needs cash reconciliation.'
                : 'No inventory counts required for this shift.'}
            </Text>
          </View>
        )}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{splitPayments ? 'Cash remittance' : preview.unrecorded_count ? 'Combined collections' : 'Cash Remittance'}</Text>
          {preview.unrecorded_count ? <Text>This shift includes receipts without a recorded payment method. Enter all collections together.</Text> : null}
          <Text style={styles.expectedCash}>{preview.unrecorded_count ? 'Expected collections' : 'Expected cash'} {formatMoney(expectedCash)}</Text>
          <FormField
            label={preview.unrecorded_count ? "Actual collections" : "Actual cash"}
            value={actualCash}
            onChangeText={setActualCash}
            keyboardType="decimal-pad"
            placeholder="—"
            accentColor={managerColors.royalBlue}
            accessibilityHint="Enter the cash counted in the drawer. Leave blank until counted."
          />
          <Text style={styles.cashDiff}>
            Difference: {formatCashResultLabel(expectedCash, actualCash, cashResult)}
          </Text>
          {splitPayments && <>
            <Text style={styles.sectionTitle}>GCash remittance</Text>
            <Text>Expected GCash {formatMoney(Number(preview.expected_gcash))}</Text>
            <FormField label="Actual GCash received this shift" value={actualGcash} onChangeText={setActualGcash} keyboardType="decimal-pad" placeholder="—" />
            <Text>Difference: {formatCashResultLabel(Number(preview.expected_gcash), actualGcash, gcashResult)}</Text>
          </>}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {footerExtra}
        <View style={styles.progressRow} accessibilityLiveRegion="polite">
          <Text style={[styles.progressText, canSubmit && styles.progressTextDone]}>{progressText}</Text>
          {products.length > 0 ? <Text style={styles.progressCount}>{Math.round(progress * 100)}%</Text> : null}
        </View>
        {products.length > 0 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }, canSubmit && styles.progressFillDone]} />
          </View>
        ) : null}
        <ManagerActionButton
          label={submitLabel}
          loading={loading}
          disabled={!canSubmit || loading}
          onPress={submit}
        />
      </View>

      <ListFiltersSheet
        visible={filtersOpen}
        filters={listFilters}
        keys={COUNT_LIST_FILTERS}
        onChange={setListFilters}
        onClose={() => setFiltersOpen(false)}
      />
      <ManagerBottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
        <View style={styles.sortList}>
          {SORT_OPTIONS.map((option) => {
            const selected = option.value === sort;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setSort(option.value);
                  setSortOpen(false);
                }}
                style={({ pressed }) => [styles.sortRow, selected && styles.sortRowSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.sortRowLabel, selected && styles.sortRowLabelSelected]}>{option.label}</Text>
                {selected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ManagerBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { padding: 20, gap: 14, paddingBottom: 24 },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EAF0FB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusCopy: { flex: 1, minWidth: 0, gap: 1 },
  status: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  identityText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  toolbar: { gap: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  group: { gap: 10 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 24 },
  groupTitle: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.6 },
  groupCount: { fontFamily: 'Inter_500Medium' },
  groupAction: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pressed: { opacity: 0.75 },
  list: { gap: 10 },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  productCardWide: { width: '49%' },
  productCardCounted: { borderColor: managerColors.green, backgroundColor: '#F8FFFA' },
  productCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  productCardInfo: { flex: 1, minWidth: 0, gap: 2 },
  countedBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.green,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  productName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  systemRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  fillChip: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
  },
  fillChipText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 12 },
  fieldsRow: { flexDirection: 'row', gap: 12 },
  stepperField: { flex: 1, gap: 4 },
  stepperLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 11,
    backgroundColor: managerColors.cardSurface,
    overflow: 'hidden',
  },
  stepperPillFocused: { borderColor: managerColors.royalBlue, backgroundColor: '#FFFFFF' },
  stepperButton: { width: 32, height: 42, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 20 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  stepperInput: {
    flex: 1,
    minWidth: 0,
    height: 42,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    textAlign: 'center',
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  detailsBox: {
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  detailValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  expectedCash: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  cashDiff: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressText: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  progressTextDone: { color: managerColors.green },
  progressCount: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E4E9F2', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: managerColors.royalBlue },
  progressFillDone: { backgroundColor: managerColors.green },
  sortList: { gap: 8, paddingBottom: 8 },
  sortRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sortRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  sortRowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  sortRowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
});
