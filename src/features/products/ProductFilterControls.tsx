import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';

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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Filters, ${count} on` : 'Filters'}
      accessibilityHint="Opens the filters"
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, count > 0 && styles.iconButtonOn, pressed && styles.pressed]}
    >
      <Ionicons name="funnel-outline" size={20} color={count > 0 ? managerColors.royalBlue : managerColors.ink} />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
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
  options: Array<{ label: string; value: string }>;
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
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{option.label}</Text>
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

const styles = StyleSheet.create({
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonOn: { borderColor: '#C9D7F2', backgroundColor: '#EAF0FB' },
  pressed: { opacity: 0.75 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: managerColors.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 11, lineHeight: 14 },
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
  optionLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15 },
  optionLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  actions: { flexDirection: 'row', gap: 10 },
  actionHalf: { flex: 1 },
  actionWide: { flex: 2 },
});
