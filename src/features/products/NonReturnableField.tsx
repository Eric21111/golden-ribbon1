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
        body: "Good stock left at the end of the day stays at the branch and is ready to sell the next day. It can't be returned to Main. You don't need to set anything up.",
      }}
    />
  );
}
