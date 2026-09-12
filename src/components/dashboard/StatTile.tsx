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
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function StatTile({ label, value, icon, emphasis = false, onPress, style }: StatTileProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, !emphasis && styles.tileDefault, style, pressed && styles.pressed]}
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
      <View style={styles.content}>
        {emphasis ? (
          <View style={[styles.iconChip, styles.iconChipEmphasis]}>
            <Ionicons name={icon} size={20} color="#FFFFFF" />
          </View>
        ) : (
          <LinearGradient
            colors={managerGradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconChip}
          >
            <Ionicons name={icon} size={20} color="#FFFFFF" />
          </LinearGradient>
        )}
        <CurrencyText
          value={value}
          style={emphasis ? styles.valueEmphasis : styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
        />
        <Text style={emphasis ? styles.labelEmphasis : styles.label} numberOfLines={2}>
          {label}
        </Text>
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
  tileDefault: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  content: { flex: 1, padding: 20, gap: 6, justifyContent: 'center' },
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
