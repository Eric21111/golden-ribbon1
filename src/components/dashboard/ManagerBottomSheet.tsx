import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';

import { BottomSheet as BaseBottomSheet } from '@/components/BottomSheet';

export function ManagerBottomSheet(props: ComponentProps<typeof BaseBottomSheet>) {
  return (
    <BaseBottomSheet
      {...props}
      titleStyle={[styles.title, props.titleStyle]}
      closeLabelStyle={[styles.close, props.closeLabelStyle]}
    />
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: 'Inter_700Bold' },
  close: { fontFamily: 'Inter_600SemiBold' },
});
