import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from './theme';

/**
 * The square icon buttons next to a search box: Filter (funnel) and Sort (up/down arrows). Every manager list uses these so
 * they look and behave the same: 46 x 46, tinted blue while something is filtered or the sort is not the default.
 */
function ToolbarIconButton({
  icon,
  label,
  hint,
  active,
  badge = 0,
  onPress,
}: {
  icon: 'funnel-outline' | 'swap-vertical-outline';
  label: string;
  hint: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.button, active && styles.buttonOn, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={active ? managerColors.royalBlue : managerColors.ink} />
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Opens a filters sheet. `count` is how many filters are on (shown as a badge); the button is tinted while it is above 0. */
export function FilterIconButton({ count, onPress, label = 'Filters' }: { count: number; onPress: () => void; label?: string }) {
  return (
    <ToolbarIconButton
      icon="funnel-outline"
      label={count > 0 ? `${label}, ${count} on` : label}
      hint="Opens the filters"
      active={count > 0}
      badge={count}
      onPress={onPress}
    />
  );
}

/** Opens the sort sheet. `currentLabel` is the sort in use (read out loud); `active` is true when it is not the default. */
export function SortIconButton({ currentLabel, active, onPress }: { currentLabel?: string; active: boolean; onPress: () => void }) {
  return (
    <ToolbarIconButton
      icon="swap-vertical-outline"
      label={currentLabel ? `Sort: ${currentLabel}` : 'Sort'}
      hint="Opens the sort options"
      active={active}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOn: { borderColor: '#C9D7F2', backgroundColor: '#EAF0FB' },
  pressed: { opacity: 0.75 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: managerColors.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 11, lineHeight: 14 },
});
