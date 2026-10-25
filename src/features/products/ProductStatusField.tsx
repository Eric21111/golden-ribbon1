import { SettingRow } from './StepOneLayout';

/**
 * Product Status is is_active. It is separate from stock quantity and from Sell Separately in POS.
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
      label="Product Status"
      description="Enabled keeps it available for stock, recipes, and transfers. Disabled stops new use and keeps past records. Stock on hand does not change this."
      choice={{ on: 'Enabled', off: 'Disabled' }}
      value={value}
      onValueChange={onChange}
    />
  );
}
