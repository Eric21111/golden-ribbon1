import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { FilterIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';
import { confirmAction } from '@/lib/confirmAction';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { DEFAULT_LIST_FILTERS, type ListFilters } from '@/features/products/listFilters';
import { ListFiltersSheet } from '@/features/products/ProductFilterControls';

/**
 * `maximum` is how many can be sent (Send stock). Opening stock has none. `category` is the saved product category.
 * `current` is what is already typed for this product on the screen ('' or absent = nothing yet).
 */
type Row = { id: string; name: string; maximum?: number; category?: string | null; current?: string };
type Mode = 'replace' | 'add';
type Status = 'all' | 'empty' | 'filled';

/** Nothing to send: it can't be picked, so Select all never adds it either. */
const isUnavailable = (row: Row) => row.maximum !== undefined && row.maximum <= 0;
/** Something is already typed for it (a typed 0 counts, like everywhere else on these screens). */
const hasQuantity = (row: Row) => String(row.current ?? '').trim() !== '';
const currentNumber = (row: Row) => {
  const value = Number(row.current);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
/** The same cap as the quantity boxes on the screens. */
const LIMIT = 999999;

const BORDER = '#D9DFEA';

/**
 * Sets the same quantity for several products at once. Pick products (search, category, Empty/Filled, Select all), type one
 * quantity, Apply. Products that already have a quantity are marked, and can be replaced or added to. The list scrolls on
 * its own so the quantity and Apply stay on screen, whatever the number of products.
 */
export function BulkQuantityPicker({ rows, onApply, filledCount, onClearAll }: {
  rows: Row[];
  /** The final quantity for each picked product (already worked out: replaced, or added to what was there). */
  onApply: (values: Map<string, string>) => void;
  /** How many products already have a quantity entered on the screen. "Clear all" shows only when this is above 0. */
  filledCount?: number;
  /** Empties every quantity on the screen (after the user confirms). */
  onClearAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState('');
  const [query, setQuery] = useState('');
  // the same category filter as the other stock lists (funnel button + Filters sheet)
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_LIST_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<Status>('all');
  const { height } = useWindowDimensions();

  const amount = Number(quantity);
  const chosen = rows.filter(row => selected.has(row.id));
  const chosenFilled = chosen.filter(hasQuantity);
  /** What the product will have after Apply. */
  const finalFor = (row: Row, mode: Mode) => (mode === 'add' && hasQuantity(row) ? currentNumber(row) + amount : amount);
  // typing the quantity is checked as a plain replacement; "Add to it" is checked again in the dialog
  const exceeds = chosen.find(row => row.maximum !== undefined && amount > row.maximum);
  const addExceeds = chosenFilled.find(row => row.maximum !== undefined && finalFor(row, 'add') > row.maximum);
  const addOverLimit = chosenFilled.find(row => finalFor(row, 'add') > LIMIT);

  const filledTotal = rows.filter(hasQuantity).length;
  const emptyTotal = rows.length - filledTotal;
  const term = query.trim().toLowerCase();
  const shown = rows.filter(row =>
    (!term || row.name.toLowerCase().includes(term))
    && (filters.category === 'all' || row.category === filters.category)
    && (status === 'all' || (status === 'filled') === hasQuantity(row)));
  // only what can really be picked: Select all never adds a product that has nothing to send
  const pickable = shown.filter(row => !isUnavailable(row));
  const allShownSelected = pickable.length > 0 && pickable.every(row => selected.has(row.id));
  // the category filter is only offered when the list has more than one category
  const canFilterByCategory = new Set(rows.map(row => row.category).filter(Boolean)).size > 1;
  const statusPills: Array<{ label: string; value: Status }> = [
    { label: 'All', value: 'all' },
    { label: `Empty (${emptyTotal})`, value: 'empty' },
    { label: `Filled (${filledTotal})`, value: 'filled' },
  ];
  const filtering = term !== '' || filters.category !== 'all' || status !== 'all';

  function close() {
    setOpen(false);
    setSelected(new Set());
    setQuantity('');
    setQuery('');
    setFilters(DEFAULT_LIST_FILTERS);
    setFiltersOpen(false);
    setStatus('all');
  }
  function applyWith(mode: Mode) {
    onApply(new Map(chosen.map(row => [row.id, String(finalFor(row, mode))])));
    close();
  }
  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllShown() {
    setSelected(previous => {
      const next = new Set(previous);
      if (allShownSelected) pickable.forEach(row => next.delete(row.id));
      else pickable.forEach(row => next.add(row.id));
      return next;
    });
  }

  if (!open) {
    const filled = filledCount ?? 0;
    return (
      <View style={styles.trigger}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Set quantity for multiple products"
          accessibilityHint="Pick products and give them all the same quantity"
          accessibilityState={{ disabled: !rows.length }}
          disabled={!rows.length}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.triggerCard, !rows.length && styles.triggerDisabled, pressed && styles.pressed]}
        >
          <View style={styles.triggerIcon}>
            <Ionicons name="layers-outline" size={20} color={managerColors.royalBlue} />
          </View>
          <View style={styles.triggerCopy}>
            <Text style={styles.triggerTitle} numberOfLines={1}>Set quantity in bulk</Text>
            <Text style={styles.triggerHint} numberOfLines={1}>One quantity for many products</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
        </Pressable>
        {onClearAll && filled > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear all quantities, ${filled} entered`}
            onPress={() =>
              confirmAction(
                'Clear all quantities?',
                `This removes the quantities you entered for ${filled} product${filled === 1 ? '' : 's'}. This cannot be undone.`,
                onClearAll,
                { confirm: 'Clear all', tone: 'danger' },
              )
            }
            style={({ pressed }) => [styles.clearAll, pressed && styles.pressed]}
          >
            <Ionicons name="trash-outline" size={16} color="#B91C1C" />
            <Text style={styles.clearAllText}>Clear all</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const count = chosen.length;
  /** The app's standard dialog: Replace it / Add to it, closed by its X or a tap outside. Only asked when a picked product already has a quantity. */
  function askReplaceOrAdd() {
    // no explanation: the title and the two buttons say it. Only when Add to it can't be offered is the reason shown.
    const message = addProblem ? `Add to it isn't possible. ${addProblem}` : '';
    confirmAction('Some already have a quantity', message, () => applyWith('replace'), {
      confirm: 'Replace it',
      tone: 'info',
      closeButton: true,
      // when adding would go over what is available, only Replace is offered (the left button is then a plain Cancel)
      ...(addProblem ? {} : { secondary: { label: 'Add to it', onPress: () => applyWith('add') } }),
    });
  }
  const error = exceeds ? `${exceeds.name} only has ${exceeds.maximum} available.` : '';
  // why "Add to it" is not offered (shown in the dialog), or empty when it is fine
  const addProblem = addExceeds
    ? `${addExceeds.name} has ${currentNumber(addExceeds)}. Adding ${amount} is over the ${addExceeds.maximum} available.`
    : addOverLimit
      ? `${addOverLimit.name} would go over ${LIMIT.toLocaleString('en-US')}.`
      : '';
  return (
    <ManagerBottomSheet visible={open} title="Set quantities" onClose={close}>
      <View style={styles.body}>
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="Search products"
            placeholder="Search products"
            placeholderTextColor={managerColors.subtext}
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            style={[styles.search, styles.searchGrow]}
          />
          {canFilterByCategory ? <FilterIconButton count={filters.category !== 'all' ? 1 : 0} onPress={() => setFiltersOpen(true)} /> : null}
        </View>
        {canFilterByCategory ? (
          <ListFiltersSheet visible={filtersOpen} filters={filters} keys={['category']} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
        ) : null}

        <FilterChipRow options={statusPills} value={status} onChange={setStatus} />

        <View style={styles.controls}>
          <Text style={styles.count}>{count === 0 ? 'None selected' : `${count} selected`}</Text>
          <View style={styles.controlLinks}>
            <Pressable accessibilityRole="button" disabled={pickable.length === 0} hitSlop={8} onPress={toggleAllShown}>
              <Text style={[styles.link, pickable.length === 0 && styles.linkDisabled]}>
                {allShownSelected ? 'Unselect all' : filtering ? 'Select all shown' : 'Select all'}
              </Text>
            </Pressable>
            {count > 0 && !allShownSelected ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setSelected(new Set())}>
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={[styles.list, { maxHeight: Math.round(height * 0.42) }]}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {shown.length === 0 ? <Text style={styles.empty}>No products match.</Text> : null}
          {shown.map(row => {
            const isSelected = selected.has(row.id);
            const unavailable = isUnavailable(row);
            const filled = hasQuantity(row);
            return (
              <Pressable
                key={row.id}
                accessibilityRole="checkbox"
                accessibilityLabel={[
                  row.name,
                  unavailable ? 'out of stock' : row.maximum !== undefined ? `${row.maximum} available` : null,
                  filled ? `quantity ${String(row.current).trim()} entered` : null,
                ].filter(part => part !== null).join(', ')}
                accessibilityState={{ checked: isSelected, disabled: unavailable }}
                disabled={unavailable}
                onPress={() => toggle(row.id)}
                style={({ pressed }) => [styles.row, isSelected && styles.rowSelected, unavailable && styles.rowDisabled, pressed && styles.pressed]}
              >
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={isSelected ? managerColors.royalBlue : managerColors.subtext}
                />
                <CategoryIcon category={row.category} size={28} decorative />
                <Text style={[styles.name, isSelected && styles.nameSelected]} numberOfLines={1}>{row.name}</Text>
                <View style={styles.rowEnd}>
                  {filled ? <Text style={styles.qtyBadge}>{String(row.current).trim()}</Text> : null}
                  {unavailable ? (
                    <Text style={styles.available}>Out of stock</Text>
                  ) : row.maximum !== undefined ? (
                    <Text style={styles.available}>{`${row.maximum} available`}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.field}>
          <Text style={styles.label}>Quantity for each selected product</Text>
          <TextInput
            accessibilityLabel="Quantity per selected product"
            placeholder="e.g. 10"
            placeholderTextColor={managerColors.subtext}
            keyboardType="number-pad"
            maxLength={6}
            value={quantity}
            onChangeText={value => {
              if (/^\d*$/.test(value)) setQuantity(value);
            }}
            style={[styles.quantity, !!error && styles.quantityError]}
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>

        <ManagerActionButton
          label={count === 0 ? 'Select products' : `Apply to ${count} product${count === 1 ? '' : 's'}`}
          disabled={!count || !amount || !!error}
          onPress={() => {
            // nothing typed yet for the picked products: just apply. Otherwise ask what to do with the old quantities.
            if (chosenFilled.length === 0) applyWith('replace');
            else askReplaceOrAdd();
          }}
        />

      </View>
    </ManagerBottomSheet>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  triggerCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#B9C8EA',
    borderRadius: 14,
    backgroundColor: '#F6F9FE',
  },
  triggerDisabled: { opacity: 0.5 },
  triggerIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3EBFA' },
  triggerCopy: { flex: 1, minWidth: 0, gap: 1 },
  triggerTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  triggerHint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  clearAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 56,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#F3C7C7',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  clearAllText: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  // the sheet clips what does not fit, so the list (the only flexible part) shrinks first
  body: { gap: 10, flexShrink: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchGrow: { flex: 1, minWidth: 0 },
  search: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#F6F8FC',
    color: managerColors.ink,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  count: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  controlLinks: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  link: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  linkDisabled: { opacity: 0.4 },
  list: { flexShrink: 1, flexGrow: 0 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, paddingVertical: 16, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  rowSelected: { borderColor: '#B9C8EA', backgroundColor: '#F6F9FE' },
  rowDisabled: { opacity: 0.5, backgroundColor: '#F6F8FC' },
  name: { flex: 1, minWidth: 0, color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 14 },
  nameSelected: { fontFamily: 'Inter_600SemiBold' },
  rowEnd: { alignItems: 'flex-end', gap: 2 },
  // what is already typed for this product
  qtyBadge: {
    minWidth: 32,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    textAlign: 'center',
    color: managerColors.royalBlue,
    backgroundColor: '#E3EBFA',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  available: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  field: { gap: 6 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  quantity: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  quantityError: { borderColor: '#B91C1C' },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  pressed: { opacity: 0.7 },
});
