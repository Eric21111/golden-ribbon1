import { StyleSheet, Text, View } from 'react-native';

import { GlyphIcon, type GlyphName } from '@/components/GlyphIcon';
import { managerColors, statChipColors, type StatChipColor } from '@/components/dashboard/theme';
import { describeActivityCompact } from '@/features/reports/todayLog';
import type { OwnerActivityAction, OwnerTodayActivity } from '@/types/models';

/** One icon tile per kind of activity, always the same colour for the same kind. */
const ACTIVITY_LOOK: Record<OwnerActivityAction, { icon: GlyphName; color: StatChipColor }> = {
  opening_stock_set: { icon: 'layers-outline', color: 'gold' },
  transfer_sent: { icon: 'car-outline', color: 'blue' },
  shift_started: { icon: 'play-circle-outline', color: 'green' },
  transfer_received: { icon: 'download-outline', color: 'teal' },
  shift_ended: { icon: 'stop-circle-outline', color: 'gray' },
  return_sent: { icon: 'return-up-back-outline', color: 'orange' },
  return_received: { icon: 'archive-outline', color: 'lilac' },
};

/**
 * Today Log as one grouped card of short rows (hairline dividers):
 *   icon · action ........ time
 *          branch · name                       (the name as saved: no role label, the names already carry it)
 *          from Main · 34 items · TR-000089 [Discrepancy]   (only when the activity has details)
 * Nothing is cut off with "…": a long name or detail wraps instead.
 */
export function TodayLogList({ activities }: { activities: readonly OwnerTodayActivity[] }) {
  return (
    <View style={styles.card}>
      {activities.map((activity, index) => {
        const row = describeActivityCompact(activity);
        const look = ACTIVITY_LOOK[activity.action] ?? { icon: 'time-outline', color: 'gray' };
        const chip = statChipColors[look.color];
        const who = `${row.branch} · ${row.actor}`;
        return (
          <View
            key={activity.id}
            accessible
            accessibilityLabel={[row.action, who, row.detail, row.discrepancy ? 'with discrepancy' : null, `at ${row.time}`]
              .filter(Boolean)
              .join(', ')}
            style={[styles.row, index > 0 && styles.rowDivider]}
          >
            <View style={[styles.chip, { backgroundColor: chip.chip }]}>
              <GlyphIcon name={look.icon} size={18} color={chip.icon} />
            </View>
            <View style={styles.body}>
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={2}>
                  {row.action}
                </Text>
                <Text style={styles.time}>{row.time}</Text>
              </View>
              <Text style={styles.who} numberOfLines={2}>
                {who}
              </Text>
              {row.detail || row.discrepancy ? (
                <View style={styles.extra}>
                  {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
                  {row.discrepancy ? (
                    <View style={styles.flag}>
                      <Text style={styles.flagLabel}>Discrepancy</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: managerColors.cardBorder },
  chip: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, minWidth: 0, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  time: { flexShrink: 0, color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 20 },
  who: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  extra: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  detail: { flexShrink: 1, color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  flag: { backgroundColor: '#FBDBD8', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  flagLabel: { color: '#B91C1C', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
