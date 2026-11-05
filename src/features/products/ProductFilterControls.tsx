import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { FilterIconButton } from '@/components/dashboard/ToolbarIconButtons';
import { managerColors } from '@/components/dashboard/theme';

import { CategoryIcon } from './CategoryIcon';

import {
  DEFAULT_LIST_FILTERS,
  LIST_FILTER_ROWS,
  countListFilters,
  listFilterTags,
  type ListFilterKey,
  type ListFilters,
} from './listFilters';
import {
  DEFAULT_PRODUCT_FILTERS,
  POS_FILTER_CHOICES,
  PRODUCT_FILTER_CHOICES,
  RETURN_FILTER_CHOICES,
  activeFilterTags,
  countActiveFilters,
  countSheetFilters,
  resultCountText,
  type ProductListFilters,
} from './productFilters';

/** Funnel button next to the search box. The badge is how many sheet filters are on (Category has its own chips). */
export function ProductFilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  return <FilterIconButton count={count} onPress={onPress} />;
}

/**
 * Only while something is filtered or searched: "3 products", a removable tag for each sheet filter that is on, and
 * Clear all. With nothing filtered the line is not there at all.
 */
export function ProductFilterSummary({
  resultCount,
  totalCount,
  filters,
  hasSearch,
  onChange,
  onClearAll,
}: {
  resultCount: number;
  /** All products before the chips, filters and sort sheet (a search still narrows it): "3 of 12 products". */
  totalCount?: number;
  filters: ProductListFilters;
  hasSearch: boolean;
  onChange: (next: ProductListFilters) => void;
  onClearAll: () => void;
}) {
  if (countActiveFilters(filters) === 0 && !hasSearch) return null;
  const tags = activeFilterTags(filters);
  return (
    <View style={styles.summary}>
      <View style={styles.summaryTop}>
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {resultCountText(resultCount, totalCount)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters and search" hitSlop={8} onPress={onClearAll}>
          <Text style={styles.clear}>Clear all</Text>
        </Pressable>
      </View>
      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Pressable
              key={tag.key}
              accessibilityRole="button"
              accessibilityLabel={`Remove filter ${tag.label}`}
              onPress={() => onChange({ ...filters, [tag.key]: DEFAULT_PRODUCT_FILTERS[tag.key] })}
              style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
            >
              <Text style={styles.tagText}>{tag.label}</Text>
              <Ionicons name="close" size={14} color={managerColors.royalBlue} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type SheetKey = 'status' | 'pos' | 'returns';

const ROWS: Array<{ key: SheetKey; title: string; options: Array<{ label: string; value: string }> }> = [
  { key: 'status', title: 'Enable Product', options: PRODUCT_FILTER_CHOICES },
  { key: 'pos', title: 'Show in Cashier POS', options: POS_FILTER_CHOICES },
  { key: 'returns', title: 'Keep Unsold Stock at Branch', options: RETURN_FILTER_CHOICES },
];

/** A row showing the current choice. Tap it to open its short list in place; picking one closes it. */
function FilterRow({
  title,
  options,
  value,
  open,
  isLast,
  onToggle,
  onPick,
}: {
  title: string;
  options: Array<{ label: string; value: string; leading?: ReactNode }>;
  value: string;
  open: boolean;
  isLast: boolean;
  onToggle: () => void;
  onPick: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value)?.label ?? 'All';
  const changed = value !== 'all';
  return (
    <View style={[!isLast && styles.rowDivider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${current}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Text style={styles.rowTitle}>{title}</Text>
        <View style={styles.rowValueWrap}>
          <Text style={[styles.rowValue, changed && styles.rowValueChanged]} numberOfLines={1}>
            {current}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={managerColors.subtext} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.options}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`${title}: ${option.label}`}
                accessibilityState={{ selected }}
                onPress={() => onPick(option.value)}
                style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
              >
                <View style={styles.optionMain}>
                  {option.leading ?? null}
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{option.label}</Text>
                </View>
                {selected ? <Ionicons name="checkmark" size={18} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Enable Product, Show in Cashier POS and Keep Unsold Stock at Branch as three rows. Changes apply straight away; Done just closes. */
export function ProductFiltersSheet({
  visible,
  filters,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: ProductListFilters;
  onChange: (next: ProductListFilters) => void;
  onClose: () => void;
}) {
  const [openKey, setOpenKey] = useState<SheetKey | null>(null);
  // every opening starts with all rows closed
  useEffect(() => {
    if (!visible) setOpenKey(null);
  }, [visible]);
  const on = countSheetFilters(filters);

  return (
    <ManagerBottomSheet visible={visible} title="Filters" onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.card}>
          {ROWS.map((row, index) => (
            <FilterRow
              key={row.key}
              title={row.title}
              options={row.options}
              value={filters[row.key]}
              open={openKey === row.key}
              isLast={index === ROWS.length - 1}
              onToggle={() => setOpenKey((current) => (current === row.key ? null : row.key))}
              onPick={(value) => {
                onChange({ ...filters, [row.key]: value } as ProductListFilters);
                setOpenKey(null);
              }}
            />
          ))}
        </View>
        <View style={styles.actions}>
          {on > 0 ? (
            <View style={styles.actionHalf}>
              <ManagerActionButton
                label="Reset"
                variant="secondary"
                onPress={() => {
                  onChange({ ...filters, status: 'all', pos: 'all', returns: 'all' });
                  setOpenKey(null);
                }}
              />
            </View>
          ) : null}
          <View style={styles.actionWide}>
            <ManagerActionButton label="Done" onPress={onClose} />
          </View>
        </View>
      </View>
    </ManagerBottomSheet>
  );
}

/**
 * The Category choices with the same picture as the product rows. "All" is not a category, so it gets a neutral one.
 * Built when the sheet renders, not when the file loads: it reads `styles`, which is defined at the bottom of this file.
 */
export function categoryOptionsWithIcons() {
  return LIST_FILTER_ROWS.category.options.map((option) => ({
    ...option,
    leading:
      option.value === 'all' ? (
        <View style={styles.allIcon}>
          <Ionicons name="apps-outline" size={14} color={managerColors.subtext} />
        </View>
      ) : (
        <CategoryIcon category={option.value === 'unset' ? null : option.value} size={24} decorative />
      ),
  }));
}

/**
 * The same filters for the stock lists (Main Inventory, Opening stock, Send stock, the cashier POS). `keys` are the rows the
 * screen offers. Changes apply straight away; Done just closes.
 */
export function ListFiltersSheet({
  visible,
  filters,
  keys,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: ListFilters;
  keys: ListFilterKey[];
  onChange: (next: ListFilters) => void;
  onClose: () => void;
}) {
  const [openKey, setOpenKey] = useState<ListFilterKey | null>(null);
  useEffect(() => {
    if (!visible) setOpenKey(null);
  }, [visible]);
  const on = countListFilters(filters, keys);
  const categoryOptions = categoryOptionsWithIcons();

  return (
    <ManagerBottomSheet visible={visible} title="Filters" onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.card}>
          {keys.map((key, index) => (
            <FilterRow
              key={key}
              title={LIST_FILTER_ROWS[key].title}
              options={key === 'category' ? categoryOptions : LIST_FILTER_ROWS[key].options}
              value={filters[key]}
              open={openKey === key}
              isLast={index === keys.length - 1}
              onToggle={() => setOpenKey((current) => (current === key ? null : key))}
              onPick={(value) => {
                onChange({ ...filters, [key]: value } as ListFilters);
                setOpenKey(null);
              }}
            />
          ))}
        </View>
        <View style={styles.actions}>
          {on > 0 ? (
            <View style={styles.actionHalf}>
              <ManagerActionButton
                label="Reset"
                variant="secondary"
                onPress={() => {
                  onChange({ ...filters, ...Object.fromEntries(keys.map((key) => [key, DEFAULT_LIST_FILTERS[key]])) } as ListFilters);
                  setOpenKey(null);
                }}
              />
            </View>
          ) : null}
          <View style={styles.actionWide}>
            <ManagerActionButton label="Done" onPress={onClose} />
          </View>
        </View>
      </View>
    </ManagerBottomSheet>
  );
}

/** Only while a filter is on: "3 of 12 products", a removable tag for each filter, and Clear all. Nothing otherwise. */
export function ListFilterSummary({
  countText,
  filters,
  keys,
  onChange,
}: {
  /** Already worded for the screen, e.g. "3 of 12 products". */
  countText: string;
  filters: ListFilters;
  keys: ListFilterKey[];
  onChange: (next: ListFilters) => void;
}) {
  const tags = listFilterTags(filters, keys);
  if (tags.length === 0) return null;
  const clearAll = () => onChange({ ...filters, ...Object.fromEntries(keys.map((key) => [key, DEFAULT_LIST_FILTERS[key]])) } as ListFilters);
  return (
    <View style={styles.summary}>
      <View style={styles.summaryTop}>
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {countText}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters" hitSlop={8} onPress={clearAll}>
          <Text style={styles.clear}>Clear all</Text>
        </Pressable>
      </View>
      <View style={styles.tags}>
        {tags.map((tag) => (
          <Pressable
            key={tag.key}
            accessibilityRole="button"
            accessibilityLabel={`Remove filter ${tag.label}`}
            onPress={() => onChange({ ...filters, [tag.key]: DEFAULT_LIST_FILTERS[tag.key] })}
            style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
          >
            <Text style={styles.tagText}>{tag.label}</Text>
            <Ionicons name="close" size={14} color={managerColors.royalBlue} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  summary: { gap: 8 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  clear: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EAF0FB',
  },
  tagText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  sheet: { gap: 16, paddingBottom: 8 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowTitle: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  rowValue: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 15 },
  rowValueChanged: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  options: { paddingHorizontal: 8, paddingBottom: 8, gap: 2 },
  option: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionSelected: { backgroundColor: '#EAF0FB' },
  optionMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  allIcon: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF1F6' },
  optionLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15 },
  optionLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  actions: { flexDirection: 'row', gap: 10 },
  actionHalf: { flex: 1 },
  actionWide: { flex: 2 },
});
