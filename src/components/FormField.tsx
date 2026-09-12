import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
  appearance?: 'default' | 'dark';
  leftIcon?: IoniconsIconName;
  rightIcon?: IoniconsIconName;
  onRightIconPress?: () => void;
  rightIconAccessibilityLabel?: string;
  accentColor?: string;
  labelStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
  iconSize?: number;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  {
    label,
    error,
    appearance = 'default',
    leftIcon,
    rightIcon,
    onRightIconPress,
    rightIconAccessibilityLabel,
    accentColor = colors.primary,
    labelStyle,
    errorStyle,
    iconSize = 20,
    style,
    onFocus,
    onBlur,
    ...props
  },
  ref
) {
  const isDark = appearance === 'dark';
  const [isFocused, setIsFocused] = useState(false);
  const iconColor = isFocused ? accentColor : isDark ? '#78716C' : colors.muted;
  const leftIconOffset = (48 - iconSize) / 2;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, isDark && styles.labelDark, labelStyle]}>{label}</Text>
      <View style={styles.inputWrapper}>
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={iconSize}
            color={iconColor}
            style={[styles.leftIcon, { top: leftIconOffset }]}
          />
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={isDark ? '#A8A29E' : colors.muted}
          style={[
            styles.input,
            isDark && styles.inputDark,
            Boolean(leftIcon) && styles.inputWithLeftIcon,
            Boolean(rightIcon) && styles.inputWithRightIcon,
            isFocused && !error && { borderColor: accentColor },
            Boolean(error) && styles.inputError,
            Boolean(error) && isDark && styles.inputErrorDark,
            style,
          ]}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
        {rightIcon ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rightIconAccessibilityLabel ?? 'Toggle'}
            hitSlop={8}
            onPress={onRightIconPress}
            style={styles.rightIcon}
          >
            <Ionicons name={rightIcon} size={iconSize} color={isDark ? '#78716C' : colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[styles.error, isDark && styles.errorDark, errorStyle]}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  labelDark: { color: '#D6D3D1' },
  inputWrapper: { justifyContent: 'center' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  inputDark: {
    borderColor: '#3F3F46',
    backgroundColor: '#171717',
    color: '#FAFAF9',
  },
  inputWithLeftIcon: { paddingLeft: 44 },
  inputWithRightIcon: { paddingRight: 44 },
  leftIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  rightIcon: { position: 'absolute', right: 6, top: 6, padding: 8 },
  inputError: { borderColor: colors.danger },
  inputErrorDark: { borderColor: '#F87171' },
  error: { color: colors.danger, fontSize: 13 },
  errorDark: { color: '#FCA5A5' },
});
