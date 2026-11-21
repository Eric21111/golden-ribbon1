import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

/** Shared report section label — same type as Owner Dashboard / Branch Operations. */
export function ReportSectionHeading({ title, meta }: { title: string; meta?: string }) {
  if (!meta) {
    return <Text style={styles.title}>{title}</Text>;
  }
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  meta: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
});
