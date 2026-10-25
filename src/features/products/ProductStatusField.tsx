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
      description="On for stock, recipes, and transfers."
      choice={{ on: 'Enabled', off: 'Disabled' }}
      info={{
        title: 'Product Status',
        body: 'Disabled stops new use. Past sales stay. Stock quantity does not change this.',
      }}
      value={value}
      onValueChange={onChange}
    />
  );
}
