import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet } from 'react-native';

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
        <Ionicons name="person" size={size * 0.52} color="#FFFFFF" />
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
  pressed: { opacity: 0.8 },
});
