import { StyleSheet, Switch, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { colors, spacing } from '@/constants/theme';

interface SwitchFieldProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  labelStyle?: StyleProp<TextStyle>;
  descriptionStyle?: StyleProp<TextStyle>;
  /** Track color when on — defaults to the app's rust primary. */
  activeTrackColor?: string;
}

export function SwitchField({
  label,
  description,
  value,
  onValueChange,
  labelStyle,
  descriptionStyle,
  activeTrackColor = colors.primary,
}: SwitchFieldProps) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.label, labelStyle]}>{label}</Text>
        {description ? <Text style={[styles.description, descriptionStyle]}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        onValueChange={onValueChange}
        thumbColor={colors.surface}
        trackColor={{ false: colors.disabled, true: activeTrackColor }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, gap: 2 },
  label: { color: colors.text, fontSize: 16, fontWeight: '600' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
