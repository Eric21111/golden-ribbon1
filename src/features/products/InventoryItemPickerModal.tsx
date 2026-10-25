import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';

import {
  THIS_PRODUCT_ID,
  filterPickerItems,
  getPickerOptions,
  matchesInventorySearch,
  type InventoryItemOption,
  type PickerListFilter,
} from './recipePreviewData';

const BORDER = '#D9DFEA';
const BLUE_TINT = '#EAF0FB';

/**
 * Sheet for choosing an inventory item for a variant. It lists the real products (plus "This Product") and only
 * reports the chosen id back to the wizard, which saves it with the product.
 */
export function InventoryItemPickerModal({
  visible,
  productName,
  ingredients,
  addedItemIds,
  title = 'Select Stock Item',
  includeThisProduct = true,
  mode = 'stock',
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** Sheet title. */
  title?: string;
  /** "This Product" is offered for stock lists; a drink is never the meal itself. */
  includeThisProduct?: boolean;
  /** Stock lists prioritize inventory supplies. Drink lists show saved drinks only. */
  mode?: 'stock' | 'drink';
  /** Name of the product being created/edited, shown for "This Product". */
  productName: string;
  /** Real products that can be used as stock items. */
  ingredients: InventoryItemOption[];
  /** Items already used by this variant; they are shown but can't be picked again. */
  addedItemIds: string[];
  onSelect: (itemId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<PickerListFilter>('supplies');

  // Start every opening on inventory supplies, with a clean search.
  useEffect(() => {
    if (!visible) {
      setSearch('');
      setListFilter('supplies');
    }
  }, [visible]);

  const activeFilter: PickerListFilter = mode === 'drink' ? 'drinks' : listFilter;
  const matches = filterPickerItems(
    getPickerOptions(productName, ingredients).filter((item) => includeThisProduct || item.id !== THIS_PRODUCT_ID),
    activeFilter,
  ).filter((item) => matchesInventorySearch(item, search));
  const currentProduct = matches.find((item) => item.id === THIS_PRODUCT_ID);
  const inventoryItems = matches.filter((item) => item.id !== THIS_PRODUCT_ID);

  function renderRow(item: InventoryItemOption, index: number) {
    const added = addedItemIds.includes(item.id);
    const isCurrent = item.id === THIS_PRODUCT_ID;
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={added ? `${item.name} already added` : `Add ${item.name}`}
        accessibilityState={{ disabled: added }}
        disabled={added}
        onPress={() => onSelect(item.id)}
        style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.pressed]}
      >
        <View style={styles.rowCopy}>
          <Text style={[styles.rowName, added && styles.rowNameAdded]}>{item.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {isCurrent ? item.hint : `${item.unit.plural}${item.hint ? ` · ${item.hint}` : ''}`}
          </Text>
        </View>
        {added ? (
          <View style={styles.addedWrap}>
            <Ionicons name="checkmark" size={14} color={managerColors.subtext} />
            <Text style={styles.addedText}>Added</Text>
          </View>
        ) : (
          <View style={styles.addPill}>
            <Ionicons name="add" size={14} color={managerColors.royalBlue} />
            <Text style={styles.addText}>Add</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <ManagerBottomSheet visible={visible} title={title} scroll onClose={onClose}>
      <View style={styles.body}>
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search stock items"
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
        />
        {mode === 'stock' ? (
          <FilterChipRow
            options={[
              { label: 'Inventory supplies', value: 'supplies' },
              { label: 'All', value: 'all' },
            ]}
            value={listFilter}
            onChange={setListFilter}
          />
        ) : null}
        <Text style={styles.hint}>
          {mode === 'drink' ? 'Drinks only.' : 'Supplies are listed first.'}
        </Text>

        {matches.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim()
              ? 'No matching items.'
              : mode === 'drink'
                ? 'No drinks yet. Set the product category to Drinks.'
                : listFilter === 'supplies'
                  ? 'No supplies yet. Try All, or turn Sell Separately off.'
                  : 'No matching items.'}
          </Text>
        ) : (
          <>
            {currentProduct ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>THIS PRODUCT</Text>
                {renderRow(currentProduct, 0)}
              </View>
            ) : null}
            {inventoryItems.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>ITEMS</Text>
                {inventoryItems.map(renderRow)}
              </View>
            ) : null}
          </>
        )}
      </View>
    </ManagerBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  empty: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 12 },
  section: { gap: 2 },
  sectionLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  rowCopy: { flex: 1, minWidth: 0, gap: 1 },
  rowName: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowNameAdded: { color: managerColors.subtext },
  rowSub: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: BLUE_TINT,
    borderRadius: 999,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 6,
  },
  addText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  addedWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addedText: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  pressed: { opacity: 0.7 },
});
