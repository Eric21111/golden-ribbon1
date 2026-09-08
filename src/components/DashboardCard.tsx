import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface DashboardCardProps {
  title: string;
  value?: string | number;
  description?: string;
  comingSoon?: boolean;
  onPress?: () => void;
  variant?: 'default' | 'alert' | 'compact';
  style?: StyleProp<ViewStyle>;
}

export function DashboardCard({
  title,
  value,
  description,
  comingSoon,
  onPress,
  variant = 'default',
  style,
}: DashboardCardProps) {
  const isAlert = variant === 'alert';
  const isCompact = variant === 'compact';

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isAlert && styles.alertCard,
        isCompact && styles.compactCard,
        pressed && styles.pressed,
        comingSoon && styles.comingSoon,
        style,
      ]}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, isCompact && styles.compactTitle]} numberOfLines={isCompact ? 2 : undefined}>
          {title}
        </Text>
        {comingSoon ? <Text style={styles.badge}>Coming Soon</Text> : null}
      </View>
      {value !== undefined ? (
        <Text style={[styles.value, isAlert && styles.alertValue, isCompact && styles.compactValue]}>{value}</Text>
      ) : null}
      {description ? (
        <Text style={[styles.description, isCompact && styles.compactDescription]} numberOfLines={isCompact ? 2 : undefined}>
          {description}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  alertCard: {
    backgroundColor: colors.warningSurface,
    borderColor: '#F59E0B',
  },
  compactCard: {
    padding: spacing.sm + 2,
    gap: spacing.xs,
    minHeight: 72,
    justifyContent: 'center',
  },
  comingSoon: { opacity: 0.75 },
  pressed: { opacity: 0.8 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  compactTitle: { fontSize: 14, fontWeight: '700' },
  value: { color: colors.primary, fontSize: 30, fontWeight: '800' },
  alertValue: { fontSize: 26 },
  compactValue: { fontSize: 20 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  compactDescription: { fontSize: 12, lineHeight: 16 },
  badge: {
    backgroundColor: colors.warningSurface,
    color: '#92400E',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
});
