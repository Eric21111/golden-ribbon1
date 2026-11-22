import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { managerGradients } from './theme';

interface ManagerActionButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'destructive';
  icon?: IoniconsIconName;
  /** Extra style for the button itself, e.g. horizontal padding on a button that is not full width. */
  style?: StyleProp<ViewStyle>;
}

export function ManagerActionButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  icon,
  style,
}: ManagerActionButtonProps) {
  const isDisabled = disabled || loading;

  if (variant === 'secondary') {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.secondary,
          style,
          pressed && styles.pressed,
          isDisabled && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={managerGradients.hero[1]} />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={18} color={managerGradients.hero[1]} /> : null}
            <Text style={styles.secondaryLabel}>{label}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  // solid red: the confirm button of something that cannot be undone
  if (variant === 'destructive') {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.destructive,
          style,
          pressed && styles.pressed,
          isDisabled && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={18} color="#FFFFFF" /> : null}
            <Text style={styles.destructiveLabel}>{label}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  if (variant === 'danger') {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.danger,
          style,
          pressed && styles.pressed,
          isDisabled && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#B91C1C" />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={18} color="#B91C1C" /> : null}
            <Text style={styles.dangerLabel}>{label}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, isDisabled && styles.disabled]}
    >
      <LinearGradient
        colors={managerGradients.hero}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.primary, style]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={18} color="#FFFFFF" /> : null}
            <Text style={styles.primaryLabel}>{label}</Text>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The buttons are at least 54 tall, never exactly 54: a label that wraps (a long label, a larger system font) makes the
  // button taller instead of being clipped.
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 1 },
  primary: {
    minHeight: 54,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { flexShrink: 1, textAlign: 'center', color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  secondary: {
    minHeight: 54,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
  },
  secondaryLabel: { flexShrink: 1, textAlign: 'center', color: managerGradients.hero[1], fontFamily: 'Inter_700Bold', fontSize: 15 },
  danger: {
    minHeight: 54,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  dangerLabel: { flexShrink: 1, textAlign: 'center', color: '#B91C1C', fontFamily: 'Inter_700Bold', fontSize: 15 },
  destructive: {
    minHeight: 54,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
  },
  destructiveLabel: { flexShrink: 1, textAlign: 'center', color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
