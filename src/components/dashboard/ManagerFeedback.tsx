import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';

import {
  EmptyState as BaseEmptyState,
  ErrorState as BaseErrorState,
  LoadingState as BaseLoadingState,
} from '@/components/Feedback';

export function LoadingState(props: ComponentProps<typeof BaseLoadingState>) {
  return <BaseLoadingState {...props} labelStyle={[styles.label, props.labelStyle]} />;
}

export function EmptyState(props: ComponentProps<typeof BaseEmptyState>) {
  return (
    <BaseEmptyState
      {...props}
      titleStyle={[styles.title, props.titleStyle]}
      messageStyle={[styles.message, props.messageStyle]}
    />
  );
}

export function ErrorState(props: ComponentProps<typeof BaseErrorState>) {
  return (
    <BaseErrorState
      {...props}
      titleStyle={[styles.title, props.titleStyle]}
      messageStyle={[styles.message, props.messageStyle]}
      retryLabelStyle={[styles.retryLabel, props.retryLabelStyle]}
    />
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: 'Inter_500Medium' },
  title: { fontFamily: 'Inter_700Bold' },
  message: { fontFamily: 'Inter_400Regular' },
  retryLabel: { fontFamily: 'Inter_700Bold' },
});
