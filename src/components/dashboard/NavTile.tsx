import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { managerColors, statChipColors, tileGradients } from './theme';

type NavAccent = keyof typeof statChipColors;

interface NavTileProps {
  title: string;
  description?: string;
  icon: IoniconsIconName;
  value?: string | number;
  variant?: 'default' | 'alert';
  accent?: NavAccent;
  /** 'row' (default): full-width list row. 'tile': compact colored icon+title tile, sized to share a row evenly. */
  layout?: 'row' | 'tile';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function NavTile({
  title,
  description,
  icon,
  value,
  variant = 'default',
  accent = 'blue',
  layout = 'row',
  onPress,
  style,
}: NavTileProps) {
  const isAlert = variant === 'alert';
  const chip = statChipColors[accent];

  if (layout === 'tile') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.colorTile, style, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={tileGradients[accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.colorFill}
        >
          <View style={styles.colorIconChip}>
            <Ionicons name={icon} size={20} color={chip.icon} />
          </View>
          <Text style={styles.colorTitle} numberOfLines={3}>
            {title}
          </Text>
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, isAlert && styles.alertTile, style, pressed && styles.pressed]}
    >
      <View style={[styles.iconChip, isAlert ? styles.alertIconChip : { backgroundColor: chip.chip }]}>
        <Ionicons name={icon} size={18} color={isAlert ? managerColors.goldMuted : chip.icon} />
      </View>
      <View style={styles.textColumn}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {value !== undefined ? (
            <Text
              style={[styles.value, { color: chip.icon }, isAlert && styles.alertValue]}
              numberOfLines={1}
            >
              {value}
            </Text>
          ) : null}
        </View>
        {description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={managerColors.subtext} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  alertTile: {
    backgroundColor: '#FFFBEF',
    borderColor: '#F1DFA8',
    borderLeftWidth: 3,
    borderLeftColor: managerColors.gold,
  },
  pressed: { opacity: 0.85 },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertIconChip: { backgroundColor: '#F6E9C4' },
  textColumn: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flexShrink: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15, color: managerColors.ink },
  value: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  alertValue: { color: managerColors.goldMuted },
  description: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: managerColors.subtext },
  chevron: { marginTop: 2 },
  colorTile: {
    flex: 1,
    minHeight: 118,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  colorFill: { flex: 1, padding: 14, gap: 10, justifyContent: 'flex-start' },
  colorIconChip: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18, color: managerColors.ink },
});
