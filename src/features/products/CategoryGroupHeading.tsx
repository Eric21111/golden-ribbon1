import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

/** The heading in front of a category group in a product list: the category in small gray capitals, and how many are in it. */
export function CategoryGroupHeading({ title, count }: { title: string; count: number }) {
  return (
    <View accessibilityRole="header" style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8 },
  title: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  count: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
});
