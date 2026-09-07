import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface DashboardCardProps {
  title: string;
  value?: string | number;
  description?: string;
  comingSoon?: boolean;
  onPress?: () => void;
}

export function DashboardCard({ title, value, description, comingSoon, onPress }: DashboardCardProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, comingSoon && styles.comingSoon]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {comingSoon ? <Text style={styles.badge}>Coming Soon</Text> : null}
      </View>
      {value !== undefined ? <Text style={styles.value}>{value}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  comingSoon: { opacity: 0.75 },
  pressed: { opacity: 0.8 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  value: { color: colors.primary, fontSize: 30, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  badge: { backgroundColor: colors.warningSurface, color: '#92400E', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
});
