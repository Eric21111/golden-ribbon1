import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

const BLUE_TINT = '#EAF0FB';
const WARN = '#92400E';

/**
 * The small tinted box that says what one order deducts from stock. Shared by every category that shows one (Extras &
 * Sides and Meals & Viands); each category decides WHAT to say, this only draws it. `warning` is the amber variant.
 */
export function DeductionPreview({ sentences, warning = false }: { sentences: string[]; warning?: boolean }) {
  if (sentences.length === 0) return null;
  return (
    <View style={[styles.box, warning && styles.boxWarning]}>
      <Ionicons
        name={warning ? 'alert-circle-outline' : 'remove-circle-outline'}
        size={16}
        color={warning ? WARN : managerColors.royalBlue}
        style={styles.icon}
      />
      <View style={styles.copy}>
        {sentences.map((sentence) => (
          <Text key={sentence} style={[styles.text, warning && styles.textWarning]}>
            {sentence}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: BLUE_TINT, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  boxWarning: { backgroundColor: '#FFFBEB' },
  // the icon sits on the first line of text, whatever the number of lines
  icon: { marginTop: 1 },
  copy: { flex: 1, gap: 2 },
  text: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  textWarning: { color: WARN },
});
