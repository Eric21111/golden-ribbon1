import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { AppButton } from './AppButton';

interface LoadingStateProps {
  label?: string;
  labelStyle?: StyleProp<TextStyle>;
}

export function LoadingState({ label = 'Loading…', labelStyle }: LoadingStateProps) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.muted, labelStyle]}>{label}</Text>
    </View>
  );
}

interface EmptyStateProps {
  title: string;
  message: string;
  titleStyle?: StyleProp<TextStyle>;
  messageStyle?: StyleProp<TextStyle>;
}

export function EmptyState({ title, message, titleStyle, messageStyle }: EmptyStateProps) {
  return (
    <View style={styles.center}>
      <Text style={[styles.title, titleStyle]}>{title}</Text>
      <Text style={[styles.muted, messageStyle]}>{message}</Text>
    </View>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  titleStyle?: StyleProp<TextStyle>;
  messageStyle?: StyleProp<TextStyle>;
  retryLabelStyle?: StyleProp<TextStyle>;
}

export function ErrorState({ message, onRetry, titleStyle, messageStyle, retryLabelStyle }: ErrorStateProps) {
  return (
    <View style={styles.center}>
      <Text style={[styles.errorTitle, titleStyle]}>Unable to load</Text>
      <Text style={[styles.muted, messageStyle]}>{message}</Text>
      {onRetry ? (
        <AppButton label="Try again" onPress={onRetry} variant="secondary" labelStyle={retryLabelStyle} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errorTitle: { color: colors.danger, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
