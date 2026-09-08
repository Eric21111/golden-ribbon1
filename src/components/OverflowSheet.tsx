import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { colors, radius, spacing } from '@/constants/theme';

export type OverflowAction = {
  label: string;
  onPress: () => void;
};

type OverflowSheetProps = {
  visible: boolean;
  actions: OverflowAction[];
  onClose: () => void;
  title?: string;
};

export function OverflowSheet({ visible, actions, onClose, title = 'More actions' }: OverflowSheetProps) {
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View style={styles.list}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.label}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs, paddingBottom: spacing.sm },
  row: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: 0.75 },
  label: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
