import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { useLayout } from '@/lib/layout';

type MasterDetailLayoutProps = {
  master: ReactNode;
  detail: ReactNode;
  /** Fixed master column width on tablet. */
  masterWidth?: number;
};

/** Side-by-side master | detail on tablet; stacks as a single column when not used. */
export function MasterDetailLayout({
  master,
  detail,
  masterWidth,
}: MasterDetailLayoutProps) {
  const { hubMasterWidth } = useLayout();
  const width = masterWidth ?? hubMasterWidth;

  return (
    <View style={styles.split}>
      <View style={[styles.master, { width }]}>{master}</View>
      <View style={styles.detail}>{detail}</View>
    </View>
  );
}

export const masterDetailStyles = StyleSheet.create({
  detailScroll: { flex: 1 },
  detailContent: { padding: spacing.md, flexGrow: 1, gap: spacing.md },
  detailEmpty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
});

const styles = StyleSheet.create({
  split: { flex: 1, minHeight: 0, flexDirection: 'row' },
  master: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 280,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors.background,
  },
});
