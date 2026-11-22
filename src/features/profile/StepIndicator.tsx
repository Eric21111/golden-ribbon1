import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

/** The "1 ── 2" dots and the name of the current step, shared by the two-step account sheets (Change PIN, Change email). */
export function StepIndicator({ step, labels }: { step: 1 | 2; labels: { 1: string; 2: string } }) {
  const steps = [1, 2] as const;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {steps.map((id, index) => (
          <View key={id} style={styles.segment}>
            <View style={[styles.dot, id <= step && styles.dotActive]}>
              <Text style={[styles.dotLabel, id <= step && styles.dotLabelActive]}>{index + 1}</Text>
            </View>
            {index < steps.length - 1 ? <View style={[styles.line, id < step && styles.lineActive]} /> : null}
          </View>
        ))}
      </View>
      <Text style={styles.label}>{labels[step]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  dotActive: { backgroundColor: managerColors.royalBlue, borderColor: managerColors.royalBlue },
  dotLabel: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 12 },
  dotLabelActive: { color: '#FFFFFF' },
  line: { width: 48, height: 2, backgroundColor: managerColors.cardBorder, marginHorizontal: 4 },
  lineActive: { backgroundColor: managerColors.royalBlue },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
