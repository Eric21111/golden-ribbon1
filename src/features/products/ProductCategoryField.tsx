import { StyleSheet, Text, View } from 'react-native';

import { FilterDropdown } from '@/components/FilterDropdown';
import { managerColors } from '@/components/dashboard/theme';

import { PRODUCT_CATEGORIES, type CategoryChoice } from './productCategoryPreview';

const CATEGORY_OPTIONS: Array<{ label: string; value: CategoryChoice }> = PRODUCT_CATEGORIES.map((category) => ({
  label: category.label,
  value: category.id,
}));
const UNSET_OPTION: { label: string; value: CategoryChoice } = { label: 'Category not set', value: 'unset' };

/**
 * Product category dropdown for Step 1. PREVIEW ONLY: the choice is kept in the wizard's local state, is not
 * saved, and only changes how Step 2 is laid out. The wizard shows the preview badge once for the
 * whole Setup group. In Edit (`allowUnset`) it starts as "Category not set", because existing products have no
 * saved category and none should be presented as confirmed.
 */
export function ProductCategoryField({
  value,
  onChange,
  allowUnset = false,
}: {
  value: CategoryChoice;
  onChange: (category: CategoryChoice) => void;
  allowUnset?: boolean;
}) {
  const options = allowUnset ? [UNSET_OPTION, ...CATEGORY_OPTIONS] : CATEGORY_OPTIONS;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Category</Text>
      <FilterDropdown label="Product category" options={options} value={value} onChange={onChange} />
      {value === 'unset' ? <Text style={styles.hint}>Choose what kind of product this is.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink, fontSize: 14 },
  hint: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
});
