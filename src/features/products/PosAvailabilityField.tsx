import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

import { SettingRow, SettingsCard } from './StepOneLayout';
import { INVENTORY_ONLY_MESSAGE, INVENTORY_ONLY_UNSUPPORTED_MESSAGE } from './wizardGuards';

const BORDER = '#D9DFEA';

/**
 * Step 1: "Sell in POS". PREVIEW ONLY — kept in the wizard's local state, never saved (the wizard
 * shows the preview badge once for the whole Setup group). It is not decided by the category: any product can be
 * sellable or inventory-only.
 *
 * HIDDEN FOR NOW: the wizards don't render this while POS_AVAILABILITY_ENABLED (wizardGuards) is false. It is
 * kept, unchanged, for when the backend can store the setting.
 *
 * Turning it off shows the inventory-only layout. Saving it is not supported yet (see InventoryOnlyNotice, which
 * the wizard shows right above the disabled save button).
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
          label="Sell in POS"
          description="Turn off for items you only keep in stock."
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

/**
 * Shown directly above the disabled Create / Save button while POS availability is off, so the reason saving is
 * unavailable is visible exactly where the user would tap.
 */
export function InventoryOnlyNotice() {
  return (
    <View style={styles.unsupported} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color="#92400E" />
      <Text style={styles.unsupportedText}>{INVENTORY_ONLY_UNSUPPORTED_MESSAGE}</Text>
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
  unsupported: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  unsupportedText: { flex: 1, color: '#92400E', fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
});
