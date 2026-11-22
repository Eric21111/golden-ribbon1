import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

/** The small (i) next to a heading: the long explanation opens in a bottom sheet instead of sitting on the page. */
export function ArchiveInfoButton({ label, onPress, color = managerColors.royalBlue, size = 20 }: { label: string; onPress: () => void; color?: string; size?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress}>
      <Ionicons name="information-circle-outline" size={size} color={color} />
    </Pressable>
  );
}
