import { Pressable, StyleSheet, View } from 'react-native';

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
      <View style={styles.stack}>
        <View style={styles.bar} />
        <View style={[styles.bar, styles.barShort]} />
        <View style={styles.bar} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  stack: { gap: 5, alignItems: 'flex-start' },
  bar: { width: 22, height: 2, borderRadius: 1, backgroundColor: managerColors.subtext },
  barShort: { width: 14 },
});
