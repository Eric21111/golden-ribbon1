import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type TextStyle } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface AppButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  labelStyle?: StyleProp<TextStyle>;
}

export function AppButton({
  label,
  loading = false,
  variant = 'primary',
  disabled,
  style,
  labelStyle,
  ...props
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        styles[variant],
        state.pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.primary : colors.surface} />
      ) : (
        <Text style={[styles.label, variant === 'secondary' && styles.secondaryLabel, labelStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
  label: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  secondaryLabel: { color: colors.primary },
});
