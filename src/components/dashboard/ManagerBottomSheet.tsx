import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';

import { BottomSheet as BaseBottomSheet } from '@/components/BottomSheet';

import { managerColors } from './theme';

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
  title: { fontFamily: 'Inter_700Bold', color: managerColors.ink },
  close: { fontFamily: 'Inter_600SemiBold', color: managerColors.royalBlue },
});
