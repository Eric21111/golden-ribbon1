import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlyphIcon, type GlyphName } from '../GlyphIcon';
import { managerColors, statChipColors, type StatChipColor } from './theme';

interface ListRowCardProps {
  icon?: GlyphName;
  iconColor?: StatChipColor;
  /** Spoken name of the icon when it carries meaning (e.g. a product category). Without it the icon is decorative. */
  iconLabel?: string;
  title: string;
  subtitle?: string;
  /** Renders subtitle as a small code-style chip instead of plain text (good for SKUs/IDs). */
  subtitleTag?: boolean;
  meta?: ReactNode;
  /** For icon + text pairs (e.g. a clock icon next to a time, a person icon next to a name) —
   * `meta` renders inside a single Text, which can't hold inline icons/Views. Renders as its
   * own wrapping row below subtitle/meta. */
  metaRow?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Spoken description of the whole card when it is tappable. Without it the card reads its text in order. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** How many lines the title may take before it is cut off with an ellipsis. Two unless a screen needs more room. */
  titleLines?: number;
  /** A small code-style tag (e.g. the SKU) right after the title. It drops to the next line when the name is long. */
  titleTag?: string;
}

export function ListRowCard({
  icon,
  iconColor = 'blue',
  iconLabel,
  title,
  subtitle,
  subtitleTag = false,
  meta,
  metaRow,
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  titleLines = 2,
  titleTag,
}: ListRowCardProps) {
  const chip = statChipColors[iconColor];

  const content = (
    <View style={styles.row}>
      {icon ? (
        <View
          accessible={iconLabel != null}
          accessibilityRole={iconLabel != null ? 'image' : undefined}
          accessibilityLabel={iconLabel}
          style={[styles.iconChip, { backgroundColor: chip.chip }]}
        >
          <GlyphIcon name={icon} size={18} color={chip.icon} />
        </View>
      ) : null}
      <View style={styles.body}>
        {titleTag ? (
          <View style={styles.titleLine}>
            <Text style={[styles.title, styles.titleInline]} numberOfLines={titleLines}>
              {title}
            </Text>
            <View style={styles.subtitleTag}>
              <Text style={styles.subtitleTagLabel} numberOfLines={1}>
                {titleTag}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.title} numberOfLines={titleLines}>
            {title}
          </Text>
        )}
        {subtitle ? (
          subtitleTag ? (
            <View style={styles.subtitleTag}>
              <Text style={styles.subtitleTagLabel} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
          ) : (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {metaRow ? <View style={styles.metaRow}>{metaRow}</View> : null}
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
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
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
  titleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  titleInline: { flexShrink: 1 },
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
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  trailing: { alignItems: 'flex-end', gap: 6 },
  chevron: { marginLeft: -2 },
});
