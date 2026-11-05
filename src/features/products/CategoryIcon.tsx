import { StyleSheet, View } from 'react-native';

import { GlyphIcon } from '@/components/GlyphIcon';
import { statChipColors } from '@/components/dashboard/theme';

import { getCategoryIndicator } from './productCategoryIndicator';

/**
 * Small tinted square with the category icon. It is a picture, not a status: it has no text and never uses the filled
 * pill shape of the stock / Enabled / Show in Cashier POS badges. `decorative` hides it from screen readers where the category
 * name is already written next to it.
 */
export function CategoryIcon({
  category,
  size = 20,
  decorative = false,
}: {
  category: string | null | undefined;
  /** Outer square, in px. The glyph is drawn at 60% of it. */
  size?: number;
  decorative?: boolean;
}) {
  const indicator = getCategoryIndicator(category);
  const tint = statChipColors[indicator.color];
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : indicator.label}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[styles.box, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: tint.chip }]}
    >
      <GlyphIcon name={indicator.icon} size={Math.round(size * 0.6)} color={tint.icon} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
