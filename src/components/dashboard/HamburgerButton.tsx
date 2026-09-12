import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { useManagerDrawer } from '@/features/navigation/ManagerDrawerContext';

import { managerColors } from './theme';

export function HamburgerButton() {
  const { openDrawer } = useManagerDrawer();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      hitSlop={14}
      onPress={openDrawer}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="menu-outline" size={24} color={managerColors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
