import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CurrencyText } from './CurrencyText';
import { managerColors, managerGradients } from './theme';

interface StatTileProps {
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
  onPress,
  style,
}: StatTileProps) {
  const isWide = layout === 'wide';
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        isWide ? styles.tileWide : compact && styles.tileCompact,
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

      {/* Same wrapper, same padding/gap, for both variants — the card's box size can never
          depend on which branch renders inside it. */}
      <View style={[styles.content, isWide ? styles.contentWide : compact && styles.contentCompact]}>
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
          <View style={styles.wideTextBlock}>
            <CurrencyText
              value={value}
              style={emphasis ? styles.valueEmphasis : styles.value}
              numberOfLines={1}
              adjustsFontSizeToFit
            />
            <Text style={emphasis ? styles.labelEmphasis : styles.label} numberOfLines={1}>
              {label}
            </Text>
          </View>
        ) : (
          <>
            <CurrencyText
              value={value}
              style={emphasis ? styles.valueEmphasis : styles.value}
              numberOfLines={1}
              adjustsFontSizeToFit
            />
            <Text style={emphasis ? styles.labelEmphasis : styles.label} numberOfLines={2}>
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: 152,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  tileWide: { height: 92 },
  tileCompact: { height: 124 },
  tileDefault: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  content: { flex: 1, padding: 20, gap: 6, justifyContent: 'center' },
  contentWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', padding: 16, gap: 14 },
  contentCompact: { padding: 14, gap: 4 },
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
  wideTextBlock: { flex: 1, gap: 2 },
  value: { fontFamily: 'Inter_700Bold', fontSize: 26, color: managerColors.ink },
  label: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 16, color: managerColors.subtext },
  valueEmphasis: { fontFamily: 'Inter_700Bold', fontSize: 26, color: '#FFFFFF' },
  labelEmphasis: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.85)',
  },
});
