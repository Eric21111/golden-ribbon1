import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { spacing } from '@/constants/theme';
import type { InventoryItem } from '@/types/models';

import { InventoryProductDetails } from './InventoryProductDetails';

type InventoryProductSheetProps = {
  item: InventoryItem | null;
  primaryAction?: { label: string; onPress: () => void };
  onClose: () => void;
};

export function InventoryProductSheet({ item, primaryAction, onClose }: InventoryProductSheetProps) {
  return (
    <BottomSheet visible={item != null} title="Stock details" onClose={onClose}>
      {item ? (
        <View style={styles.body}>
          <InventoryProductDetails
            item={item}
            primaryAction={
              primaryAction
                ? {
                    label: primaryAction.label,
                    onPress: () => {
                      onClose();
                      primaryAction.onPress();
                    },
                  }
                : undefined
            }
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: spacing.sm },
});
