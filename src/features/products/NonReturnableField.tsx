import { SettingRow } from './StepOneLayout';

/**
 * Explicit product flag — BBQ, Tocino, Cheesesticks, drinks, etc. A real, saved setting (unlike the
 * preview-only ones). The label reads "Keep Unsold Stock at Branch"; ON is exactly is_non_returnable = true
 * (OFF by default). Meant to sit inside a SettingsCard.
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
      label="Keep Unsold Stock at Branch"
      description="Keep leftover stock instead of returning it to Main."
      value={value}
      onValueChange={onChange}
      info={{
        title: 'Keep Unsold Stock at Branch',
        body:
          'On: Leftover stock stays at the branch for the next day. It cannot be returned to Main and is eligible for local purchases.\n\nTurning Off allows returns and changes the shift-close behavior when switching from On. Existing products may have different closing settings.',
      }}
    />
  );
}
