import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

import { SettingRow, SettingsCard } from './StepOneLayout';
import { INVENTORY_ONLY_MESSAGE } from './wizardGuards';

const BORDER = '#D9DFEA';

/**
 * Step 1: "Sell Separately in POS". Saved as sell_in_pos, separate from Product Status.
 * Yes sells it on its own. No keeps it for stock and configured meal choices, including a meal-only drink.
 */
export function PosAvailabilityField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.wrap}>
      <SettingsCard>
        <SettingRow
          label="Sell Separately in POS"
          description="Yes sells it on its own at its price. No hides it from the standalone menu. Meal drink choices can still use it."
          choice={{ on: 'Yes', off: 'No' }}
          value={value}
          onValueChange={onChange}
        />
      </SettingsCard>

      {!value ? (
        <View style={styles.info}>
          <Ionicons name="cube-outline" size={18} color={managerColors.royalBlue} />
          <Text style={styles.infoTitle}>{INVENTORY_ONLY_MESSAGE}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#F7F9FD',
    padding: 12,
  },
  infoTitle: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
});
