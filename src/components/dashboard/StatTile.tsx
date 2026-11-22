import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { FIGURE_MAX_FONT_SCALE, figureFits } from '@/features/reports/reportDisplay';

import { CurrencyText } from './CurrencyText';
import { managerColors, managerGradients } from './theme';

/** A wide tile's room beside the figure: its padding (16 + 16), the icon (36) and the gap after it (14). */
const WIDE_TEXT_INSET = 16 + 16 + 36 + 14;

export interface StatTileProps {
  label: string;
  value: string | number;
  icon: IoniconsIconName;
  /** Reserve for the single most important metric — full navy gradient fill instead of a white card. */
  emphasis?: boolean;
  /** 'square' (default): tall grid tile. 'wide': short full-width banner — icon left, value+label
   * stacked to its right. Use for a single headline metric that should span the row. */
  layout?: 'square' | 'wide';
  /** Shrinks a square tile's height/padding for denser layouts. Ignored when layout is 'wide'
   * (wide is already short). */
  compact?: boolean;
  /** Allow a long status string (e.g. "No remittance recorded") to wrap instead of clipping. */
  valueNumberOfLines?: number;
  /** Extra line under the label (kept short — used for issue-qty scope). */
  caption?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function StatTile({
  label,
  value,
  icon,
  emphasis = false,
  layout = 'square',
  compact = false,
  valueNumberOfLines = 1,
  caption,
  onPress,
  style,
}: StatTileProps) {
  const isWide = layout === 'wide';
  const statusWrap = valueNumberOfLines > 1 && /[A-Za-z]/.test(String(value));
  const valueLines = statusWrap ? valueNumberOfLines : 1;
  const growForCopy = statusWrap || Boolean(caption);
  const { fontScale } = useWindowDimensions();
  const [tileWidth, setTileWidth] = useState(0);
  // A wide tile whose figure would not fit beside the icon (a seven-figure amount, a larger system font) puts the icon above
  // the figure, so the figure gets the whole tile width instead of being shrunk hard.
  const iconOnTop =
    isWide && !statusWrap && tileWidth > 0 && !figureFits(String(value), tileWidth - WIDE_TEXT_INSET, fontScale);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next !== tileWidth) setTileWidth(next);
      }}
      style={({ pressed }) => [
        styles.tile,
        growForCopy
          ? isWide
            ? styles.tileWideWrap
            : styles.tileWrap
          : isWide
            ? styles.tileWide
            : compact
              ? styles.tileCompact
              : styles.tileSquare,
        !emphasis && styles.tileDefault,
        style,
        pressed && styles.pressed,
      ]}
    >
      {emphasis ? (
        <LinearGradient
          colors={managerGradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View
        style={[
          styles.content,
          isWide ? (iconOnTop ? styles.contentWideStacked : styles.contentWide) : compact && styles.contentCompact,
          growForCopy && !isWide && styles.contentWrap,
        ]}
      >
        {emphasis ? (
          <View style={[styles.iconChip, styles.iconChipEmphasis, isWide && styles.iconChipWide]}>
            <Ionicons name={icon} size={20} color="#FFFFFF" />
          </View>
        ) : (
          <LinearGradient
            colors={managerGradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.iconChip, isWide && styles.iconChipWide]}
          >
            <Ionicons name={icon} size={20} color="#FFFFFF" />
          </LinearGradient>
        )}
        {isWide ? (
          <View style={[styles.wideTextBlock, iconOnTop && styles.wideTextBlockStacked]}>
            <CurrencyText
              value={value}
              style={[
                emphasis ? styles.valueEmphasis : styles.value,
                statusWrap && (isWide ? styles.valueWideWrap : styles.valueWrap),
                statusWrap && emphasis && styles.valueWrapEmphasis,
              ]}
              numberOfLines={valueLines}
              adjustsFontSizeToFit={!statusWrap}
              minimumFontScale={0.6}
              maxFontSizeMultiplier={FIGURE_MAX_FONT_SCALE}
            />
            <Text style={emphasis ? styles.labelEmphasis : styles.label}>
              {label}
            </Text>
            {caption ? (
              <Text style={emphasis ? styles.captionEmphasis : styles.caption}>
                {caption}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <CurrencyText
              value={value}
              style={[
                emphasis ? styles.valueEmphasis : styles.value,
                statusWrap && (isWide ? styles.valueWideWrap : styles.valueWrap),
                statusWrap && emphasis && styles.valueWrapEmphasis,
                styles.valueFill,
              ]}
              numberOfLines={valueLines}
              adjustsFontSizeToFit={!statusWrap}
              minimumFontScale={0.6}
              maxFontSizeMultiplier={FIGURE_MAX_FONT_SCALE}
            />
            <Text style={emphasis ? styles.labelEmphasis : styles.label}>
              {label}
            </Text>
            {caption ? (
              <Text style={emphasis ? styles.captionEmphasis : styles.caption}>
                {caption}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  // minimum heights, never fixed ones: a long label, a larger system font or a wrapped value makes the tile taller
  // instead of clipping what is inside it
  tileSquare: { minHeight: 152 },
  tileWide: { minHeight: 92 },
  tileCompact: { minHeight: 140 },
  tileWrap: { minHeight: 140 },
  tileWideWrap: { minHeight: 118 },
  tileDefault: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  content: { flex: 1, padding: 20, gap: 6, justifyContent: 'center' },
  contentWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', padding: 16, gap: 14 },
  // icon above the figure: used when the figure does not fit beside the icon
  contentWideStacked: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', padding: 16, gap: 10 },
  contentCompact: { padding: 14, gap: 4 },
  contentWrap: { flex: 0 },
  pressed: { opacity: 0.9 },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  iconChipEmphasis: { backgroundColor: 'rgba(255, 255, 255, 0.22)' },
  iconChipWide: { marginBottom: 0 },
  wideTextBlock: { flex: 1, minWidth: 0, gap: 2 },
  wideTextBlockStacked: { flex: 0, alignSelf: 'stretch' },
  valueFill: { alignSelf: 'stretch', width: '100%' },
  value: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 32, minHeight: 32, color: managerColors.ink },
  valueWrap: { fontSize: 17, lineHeight: 22, minHeight: 22 },
  valueWideWrap: { fontSize: 20, lineHeight: 26, minHeight: 26 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 16, color: managerColors.subtext },
  valueEmphasis: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 32, minHeight: 32, color: '#FFFFFF' },
  valueWrapEmphasis: { color: '#FFFFFF' },
  labelEmphasis: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  caption: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 14,
    color: managerColors.subtext,
  },
  captionEmphasis: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 14,
    color: 'rgba(255, 255, 255, 0.75)',
  },
});
