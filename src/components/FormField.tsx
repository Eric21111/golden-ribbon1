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
  /** Secondary line under the label (e.g. expected amount). */
  hint?: string;
  error?: string;
  appearance?: 'default' | 'dark';
  leftIcon?: IoniconsIconName;
  rightIcon?: IoniconsIconName;
  onRightIconPress?: () => void;
  rightIconAccessibilityLabel?: string;
  accentColor?: string;
  labelStyle?: StyleProp<TextStyle>;
  hintStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
  iconSize?: number;
  required?: boolean;
  /** Keep accessibility label on the input but hide the visible label row. */
  hideLabel?: boolean;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  {
    label,
    hint,
    error,
    appearance = 'default',
    leftIcon,
    rightIcon,
    onRightIconPress,
    rightIconAccessibilityLabel,
    accentColor = colors.primary,
    labelStyle,
    hintStyle,
    errorStyle,
    iconSize = 20,
    required = false,
    hideLabel = false,
    style,
    onFocus,
    onBlur,
    ...props
  },
  ref
) {
  const isDark = appearance === 'dark';
  const [isFocused, setIsFocused] = useState(false);
  const iconColor = isFocused ? accentColor : isDark ? '#E7ECFA' : colors.muted;
  const leftIconOffset = (48 - iconSize) / 2;

  return (
    <View style={styles.container}>
      {!hideLabel ? (
        <Text style={[styles.label, isDark && styles.labelDark, labelStyle]}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}
      {hint ? <Text style={[styles.hint, isDark && styles.hintDark, hintStyle]}>{hint}</Text> : null}
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
          placeholderTextColor={isDark ? '#93A0B8' : colors.muted}
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
            <Ionicons name={rightIcon} size={iconSize} color={isDark ? '#E7ECFA' : colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[styles.error, isDark && styles.errorDark, errorStyle]}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs, width: '100%', maxWidth: '100%', alignSelf: 'stretch' },
  label: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  labelDark: { color: '#F3F6FF', fontSize: 14, letterSpacing: 0.2 },
  required: { color: '#F87171', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  hint: { color: colors.muted, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  hintDark: { color: '#93A0B8' },
  inputWrapper: { justifyContent: 'center', width: '100%', maxWidth: '100%' },
  input: {
    width: '100%',
    maxWidth: '100%',
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  inputDark: {
    borderWidth: 1.5,
    borderColor: 'rgba(198, 210, 232, 0.78)',
    backgroundColor: 'rgba(10, 18, 36, 0.5)',
    color: '#FFFFFF',
  },
  inputWithLeftIcon: { paddingLeft: 44 },
  inputWithRightIcon: { paddingRight: 44 },
  leftIcon: { position: 'absolute', left: 14, top: 14, zIndex: 1 },
  rightIcon: { position: 'absolute', right: 6, top: 6, padding: 8 },
  inputError: { borderColor: colors.danger },
  inputErrorDark: { borderColor: '#F87171' },
  error: { color: colors.danger, fontSize: 13, fontFamily: 'Inter_500Medium' },
  errorDark: { color: '#FCA5A5' },
});
