import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { useKeyboardBottomInset } from '@/hooks/useKeyboardBottomInset';

type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
  scroll?: boolean;
  titleStyle?: StyleProp<TextStyle>;
  closeLabelStyle?: StyleProp<TextStyle>;
}>;

/**
 * Modal bottom sheet for password / employee forms.
 *
 * Android RN Modal is a separate Dialog (full screen). Pair with
 * `softwareKeyboardLayoutMode: "pan"` when possible. Lift once:
 * - marginBottom = keyboard height
 * - maxHeight = space above the keyboard (uses screen height on Android so
 *   Activity "resize" cannot crush the sheet)
 *
 * No KeyboardAvoidingView — that double-offsets with the manual lift.
 */
export function BottomSheet({
  visible,
  title,
  onClose,
  children,
  scroll = false,
  titleStyle,
  closeLabelStyle,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardBottomInset();
  const { height: windowHeight } = useWindowDimensions();
  const screenHeight = Dimensions.get('screen').height;
  // Modal Dialog is screen-sized on Android; window can shrink under "resize".
  const layoutHeight = Platform.OS === 'android' ? screenHeight : windowHeight;
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);

  const topGap = Math.max(insets.top, 16);
  const keyboardLift = keyboardInset > 0 ? keyboardInset : 0;
  const sheetMaxHeight = Math.max(240, layoutHeight - topGap - keyboardLift - 8);

  useEffect(() => {
    if (!visible) scrollOffsetRef.current = 0;
  }, [visible]);

  useEffect(() => {
    if (!visible || !scroll || keyboardLift <= 0) return;

    const timer = setTimeout(() => {
      const input = TextInput.State.currentlyFocusedInput?.();
      if (!input || !scrollRef.current) return;

      input.measureInWindow((_x, y, _width, height) => {
        const keyboardTop = layoutHeight - keyboardLift - insets.bottom - 12;
        const overflow = y + height - keyboardTop;
        if (overflow <= 0) return;

        scrollRef.current?.scrollTo({
          y: Math.max(0, scrollOffsetRef.current + overflow),
          animated: true,
        });
      });
    }, Platform.OS === 'ios' ? 40 : 120);

    return () => clearTimeout(timer);
  }, [insets.bottom, keyboardLift, layoutHeight, scroll, visible]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  };

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={styles.scrollContent}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              marginBottom: keyboardLift,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, titleStyle]}>{title}</Text>
            <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={12} onPress={onClose}>
              <Text style={[styles.close, closeLabelStyle]}>Close</Text>
            </Pressable>
          </View>
          {body}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
    overflow: 'hidden',
    zIndex: 1,
    elevation: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  close: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.lg },
});
