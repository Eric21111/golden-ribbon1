import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CurrencyText } from '@/components/dashboard/CurrencyText';
import { managerColors } from '@/components/dashboard/theme';
import { accentForRank } from '@/features/reports/reportAccents';

type RankProgressRowProps = {
  title: string;
  meta?: string;
  metaNode?: ReactNode;
  amount: string;
  share: number;
  rank: number;
  icon?: IoniconsIconName;
  iconBackground?: string;
  iconColor?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/** Compact ranked row: identity, amount, and a share bar. Used for branch and product lists. */
export function RankProgressRow({
  title,
  meta,
  metaNode,
  amount,
  share,
  rank,
  icon,
  iconBackground,
  iconColor,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: RankProgressRowProps) {
  const accent = accentForRank(rank);
  const sharePct = Math.max(0, Math.min(100, share));
  const barColors = [accent.icon, accent.gradient[0]] as const;

  const body = (
    <>
      <View style={styles.top}>
        {icon ? (
          <View style={[styles.iconChip, { backgroundColor: iconBackground ?? accent.gradient[0] }]}>
            <Ionicons name={icon} size={18} color={iconColor ?? accent.icon} />
          </View>
        ) : (
          <View style={[styles.rankBadge, { backgroundColor: accent.gradient[0] }]}>
            <Text style={[styles.rankBadgeLabel, { color: accent.icon }]}>#{rank}</Text>
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {metaNode}
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
        <CurrencyText
          value={amount}
          style={styles.amount}
          numberOfLines={1}
          adjustsFontSizeToFit
        />
        {onPress ? <Ionicons name="chevron-forward" size={16} color={managerColors.subtext} /> : null}
      </View>
      <View style={styles.barRow}>
        <View style={styles.barTrack}>
          <LinearGradient
            colors={barColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.barFill, { width: `${sharePct}%` }]}
          />
        </View>
        <Text style={[styles.barPercent, { color: accent.icon }]}>{`${sharePct.toFixed(0)}%`}</Text>
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.card}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadge: {
    minWidth: 36,
    height: 36,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 19 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  amount: {
    flexShrink: 1,
    minWidth: 72,
    maxWidth: 132,
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'right',
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#EDEFF5',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 999, minWidth: 4 },
  barPercent: { fontFamily: 'Inter_700Bold', fontSize: 12, minWidth: 36, textAlign: 'right' },
});
