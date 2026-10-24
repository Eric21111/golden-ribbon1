import Ionicons from '@react-native-vector-icons/ionicons';
import { Children, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { managerColors } from '@/components/dashboard/theme';

import { MIN_TOUCH_TARGET } from './touchTargets';

const BORDER = '#D9DFEA';

/** Small amber badge. One is shown per group of preview-only settings, not one per field. */
export function PreviewPill() {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>Not saved yet</Text>
    </View>
  );
}

/** Small uppercase group label for Step 1, with the preview badge on the right when the group is preview-only. */
export function SectionHeader({ title, preview = false }: { title: string; preview?: boolean }) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.headerText}>
        {title}
      </Text>
      {preview ? <PreviewPill /> : null}
    </View>
  );
}

/** One bordered card holding a stack of setting rows, with a hairline between them. */
export function SettingsCard({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.card}>
      {rows.map((row, index) => (
        <View key={index} style={index > 0 && styles.rowDivider}>
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * An on/off setting: a bold label, one short line under it, and the switch on the right. `info` adds an (i)
 * button that reveals a longer explanation under the row, so the row itself stays short.
 */
export function SettingRow({
  label,
  description,
  value,
  onValueChange,
  info,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  info?: { title: string; body: string };
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.rowCopy}>
          <View style={styles.labelLine}>
            <Text style={styles.rowLabel}>{label}</Text>
            {info ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={info.title}
                accessibilityState={{ expanded: infoOpen }}
                hitSlop={8}
                onPress={() => setInfoOpen((open) => !open)}
                style={({ pressed }) => [styles.infoTouch, pressed && styles.pressed]}
              >
                <Ionicons
                  name={infoOpen ? 'information-circle' : 'information-circle-outline'}
                  size={20}
                  color={managerColors.royalBlue}
                />
              </Pressable>
            ) : null}
          </View>
          {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
        </View>
        <Switch
          accessibilityLabel={label}
          onValueChange={onValueChange}
          thumbColor={colors.surface}
          trackColor={{ false: colors.disabled, true: managerColors.royalBlue }}
          value={value}
        />
      </View>
      {info && infoOpen ? (
        <View style={styles.tip}>
          <Text style={styles.tipTitle}>{info.title}</Text>
          <Text style={styles.tipBody}>{info.body}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerText: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  pill: { backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: '#92400E', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  row: { paddingVertical: 8 },
  rowMain: { minHeight: MIN_TOUCH_TARGET + 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowCopy: { flex: 1, minWidth: 0, gap: 1 },
  labelLine: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rowLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowDescription: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  infoTouch: { width: MIN_TOUCH_TARGET - 8, height: MIN_TOUCH_TARGET - 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  tip: { backgroundColor: '#F2F6FF', borderWidth: 1, borderColor: '#D3E0FA', borderRadius: 12, padding: 12, gap: 4, marginBottom: 4 },
  tipTitle: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  tipBody: { color: '#475467', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
});
