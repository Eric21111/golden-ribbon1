import type { PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ColorValue,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { useLayout } from '@/lib/layout';

import { ConstrainedWidth } from './ConstrainedWidth';
import { useBottomNavigationVisible } from './RoleNavigation';

interface ScreenProps extends PropsWithChildren {
  scroll?: boolean;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  refreshing?: boolean;
  onRefresh?: () => void;
  backgroundColor?: ColorValue;
  /** Override safe-area edges. Default: none when bottom nav visible, else bottom only. */
  edges?: readonly Edge[];
  /**
   * Cap and center content on tablet.
   * `true` uses contentMaxWidth (640). Pass a number for a custom cap.
   */
  constrain?: boolean | number;
}

export function Screen({
  children,
  scroll = true,
  contentContainerStyle,
  refreshing = false,
  onRefresh,
  backgroundColor = colors.background,
  edges,
  constrain,
}: ScreenProps) {
  const hasBottomNavigation = useBottomNavigationVisible();
  const { contentMaxWidth } = useLayout();
  const safeEdges = edges ?? (hasBottomNavigation ? [] : (['bottom'] as const));
  const maxWidth = constrain === true ? contentMaxWidth : typeof constrain === 'number' ? constrain : undefined;

  const body =
    maxWidth != null ? (
      <ConstrainedWidth maxWidth={maxWidth} fill={!scroll} style={scroll ? styles.constrainScroll : styles.constrainFill}>
        {children}
      </ConstrainedWidth>
    ) : (
      children
    );

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      {body}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, contentContainerStyle]}>{body}</View>
  );

  return (
    <SafeAreaView edges={safeEdges} style={[styles.safeArea, { backgroundColor }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  constrainScroll: { gap: spacing.md },
  constrainFill: { flex: 1, minHeight: 0 },
});
