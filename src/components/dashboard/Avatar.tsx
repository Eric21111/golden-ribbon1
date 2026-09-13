import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { getInitials } from '@/lib/format';

import { managerGradients } from './theme';

interface AvatarProps {
  name: string;
  size?: number;
  onPress?: () => void;
}

export function Avatar({ name, size = 44, onPress }: AvatarProps) {
  const dimensionStyle = { width: size, height: size, borderRadius: size / 2 };

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name}, view profile`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [pressed && onPress && styles.pressed]}
    >
      <LinearGradient
        colors={managerGradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.circle, dimensionStyle]}
      >
        <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{getInitials(name)}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  initials: { color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
  pressed: { opacity: 0.8 },
});
