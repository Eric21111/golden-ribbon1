import { StyleSheet, Text, View } from 'react-native';

export type ManagerBadgeTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

interface ManagerBadgeProps {
  label: string;
  tone: ManagerBadgeTone;
  size?: 'sm' | 'md';
}

const toneStyles: Record<ManagerBadgeTone, { bg: string; text: string }> = {
  success: { bg: '#DCFCE7', text: '#166534' },
  warning: { bg: '#FEF3C7', text: '#92400E' },
  info: { bg: '#DBEAFE', text: '#1E40AF' },
  danger: { bg: '#FEE2E2', text: '#B91C1C' },
  neutral: { bg: '#F1F2F6', text: '#667085' },
};

export function ManagerBadge({ label, tone, size = 'sm' }: ManagerBadgeProps) {
  const palette = toneStyles[tone];
  const isMd = size === 'md';
  return (
    <View style={[styles.badge, isMd && styles.badgeMd, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, isMd && styles.labelMd, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeMd: { paddingHorizontal: 12, paddingVertical: 6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5, letterSpacing: 0.2 },
  labelMd: { fontSize: 13 },
});
