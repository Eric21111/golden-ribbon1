import { SettingRow } from './StepOneLayout';

/**
 * Explicit product flag — BBQ, Tocino, Cheesesticks, drinks, etc. A real, saved setting (unlike the
 * preview-only ones). The wording stays "Non-returnable" (OFF by default) so the switch value is exactly what
 * is saved. Meant to sit inside a SettingsCard.
 */
export function NonReturnableField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <SettingRow
      label="Non-returnable"
      description="Unsold stock stays at the branch."
      value={value}
      onValueChange={onChange}
      info={{
        title: 'What happens to leftover stock?',
        body: "Leftover stays at the branch for the next day. It can't go back to Main.",
      }}
    />
  );
}
