import { SettingRow } from './StepOneLayout';

/**
 * "Enable Product" is is_active. It is separate from stock quantity and from Show in Cashier POS.
 * Enabled with zero stock is allowed; a sale still fails until stock exists.
 */
export function ProductStatusField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <SettingRow
      label="Enable Product"
      description="Allow sales, transfers, and local purchases."
      info={{
        title: 'Enable Product',
        body:
          'Off: Stops new sales, transfers, and local purchases. A disabled drink is not offered as a meal drink. Existing stock and sales history remain unchanged.',
      }}
      value={value}
      onValueChange={onChange}
    />
  );
}
