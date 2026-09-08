import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useLayout } from '@/lib/layout';

type ConstrainedWidthProps = PropsWithChildren<{
  /** Max width on tablet; ignored on phone. */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
  /** When false, children always fill width (default true applies max on tablet). */
  enabled?: boolean;
  /**
   * Stretch to fill parent height (POS-style flex layouts).
   * Leave false inside ScrollView screens.
   */
  fill?: boolean;
}>;

/** Centers content and caps width on tablet. Phone layout unchanged. */
export function ConstrainedWidth({
  children,
  maxWidth,
  style,
  enabled = true,
  fill = false,
}: ConstrainedWidthProps) {
  const { isTablet, contentMaxWidth } = useLayout();
  const cap = maxWidth ?? contentMaxWidth;

  return (
    <View
      style={[
        styles.wrap,
        fill && styles.fill,
        enabled && isTablet ? { maxWidth: cap, alignSelf: 'center' } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  fill: { flex: 1, minHeight: 0 },
});
