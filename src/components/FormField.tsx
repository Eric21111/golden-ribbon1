import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
  appearance?: 'default' | 'dark';
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, error, appearance = 'default', style, ...props },
  ref
) {
  const isDark = appearance === 'dark';

  return (
    <View style={styles.container}>
      <Text style={[styles.label, isDark && styles.labelDark]}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={isDark ? '#A8A29E' : colors.muted}
        style={[
          styles.input,
          isDark && styles.inputDark,
          Boolean(error) && styles.inputError,
          Boolean(error) && isDark && styles.inputErrorDark,
          style,
        ]}
        {...props}
      />
      {error ? <Text style={[styles.error, isDark && styles.errorDark]}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  labelDark: { color: '#D6D3D1' },
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
  inputError: { borderColor: colors.danger },
  inputErrorDark: { borderColor: '#F87171' },
  error: { color: colors.danger, fontSize: 13 },
  errorDark: { color: '#FCA5A5' },
});
