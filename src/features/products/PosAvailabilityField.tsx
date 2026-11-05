import { SettingRow, SettingsCard } from './StepOneLayout';

/**
 * Step 1: "Show in Cashier POS". Saved as sell_in_pos, separate from Enable Product (is_active).
 * On lists it on the cashier POS menu. Off keeps it for stock and configured meal choices, including a meal-only drink.
 */
export function PosAvailabilityField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <SettingsCard>
      <SettingRow
        label="Show in Cashier POS"
        description="Show this product on the cashier menu."
        info={{
          title: 'Show in Cashier POS',
          body:
            'On: Available for separate sale when enabled and priced at the branch.\n\nOff: Hidden from the cashier menu, but can still be used for stock, transfers, and meal options when eligible.',
        }}
        value={value}
        onValueChange={onChange}
      />
    </SettingsCard>
  );
}
