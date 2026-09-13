import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors, statChipColors, type StatChipColor } from './theme';

interface ListRowCardProps {
  icon?: IoniconsIconName;
  iconColor?: StatChipColor;
  title: string;
  subtitle?: string;
  /** Renders subtitle as a small code-style chip instead of plain text (good for SKUs/IDs). */
  subtitleTag?: boolean;
  meta?: string;
  trailing?: ReactNode;
  onPress?: () => void;
}

export function ListRowCard({
  icon,
  iconColor = 'blue',
  title,
  subtitle,
  subtitleTag = false,
  meta,
  trailing,
  onPress,
}: ListRowCardProps) {
  const chip = statChipColors[iconColor];

  const content = (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.iconChip, { backgroundColor: chip.chip }]}>
          <Ionicons name={icon} size={18} color={chip.icon} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          subtitleTag ? (
            <View style={styles.subtitleTag}>
              <Text style={styles.subtitleTagLabel} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          ) : (
            <Text style={styles.subtitle}>{subtitle}</Text>
          )
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} style={styles.chevron} /> : null}
    </View>
  );

  if (!onPress) {
    return <View style={styles.card}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 6 },
  title: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20 },
  subtitle: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  subtitleTag: {
    alignSelf: 'flex-start',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  subtitleTagLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  trailing: { alignItems: 'flex-end', gap: 6 },
  chevron: { marginLeft: -2 },
});
