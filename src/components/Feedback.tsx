import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { AppButton } from './AppButton';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{message}</Text>
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
