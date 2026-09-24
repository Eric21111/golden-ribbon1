import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { CalendarRangePicker } from '@/features/reports/CalendarRangePicker';
import {
  getThisMonthRangeManila,
  getThisWeekRangeManila,
  toNextDayStartManila,
  toStartOfDayManila,
} from '@/lib/format';

export type DateFilterType = 'all_time' | 'today' | 'this_week' | 'this_month' | 'custom';

export const DATE_RANGE_OPTIONS: Array<{ label: string; value: DateFilterType }> = [
  { label: 'All Time', value: 'all_time' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
];

/** Translates the UI-facing filter type into what the report RPCs actually understand
 * ('today' | 'custom' | 'all_time'). This Week/This Month have no server-side concept —
 * they're computed client-side and sent through as a 'custom' range under the hood. */
export function resolveReportRange(
  rangeType: DateFilterType,
  customStart: string,
  customEnd: string
): { rpcRangeType: 'today' | 'custom' | 'all_time'; startIso?: string; endIso?: string } {
  if (rangeType === 'today') return { rpcRangeType: 'today' };
  if (rangeType === 'all_time') return { rpcRangeType: 'all_time' };
  if (rangeType === 'this_week') {
    const { start, end } = getThisWeekRangeManila();
    return { rpcRangeType: 'custom', startIso: start, endIso: end };
  }
  if (rangeType === 'this_month') {
    const { start, end } = getThisMonthRangeManila();
    return { rpcRangeType: 'custom', startIso: start, endIso: end };
  }
  return { rpcRangeType: 'custom', startIso: toStartOfDayManila(customStart), endIso: toNextDayStartManila(customEnd) };
}

/** Today and a one-day custom range list orders. Week / month / all-time list daily totals. */
export function shouldShowBranchOrderLog(
  rangeType: DateFilterType,
  startIso?: string,
  endIso?: string,
): boolean {
  if (rangeType === 'today') return true;
  if (rangeType !== 'custom' || !startIso || !endIso) return false;
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;
  return endMs - startMs <= 24 * 60 * 60 * 1000;
}

interface DateRangeFilterProps {
  value: DateFilterType;
  onChange: (value: DateFilterType) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}

/** Shared "All Time / Today / This Week / This Month" pill row + a calendar icon that opens a
 * custom-range popup, reused across every owner report screen. */
export function DateRangeFilter({
  value,
  onChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: DateRangeFilterProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const isCustom = value === 'custom';

  const openPicker = () => {
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setPickerOpen(true);
  };

  const applyCustom = () => {
    onCustomStartChange(draftStart);
    onCustomEndChange(draftEnd);
    onChange('custom');
    setPickerOpen(false);
  };

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {DATE_RANGE_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]} numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick a custom date range"
          accessibilityState={{ selected: isCustom }}
          onPress={openPicker}
          style={({ pressed }) => [styles.iconButton, isCustom && styles.chipSelected, pressed && styles.pressed]}
        >
          <Ionicons name="calendar-outline" size={18} color={isCustom ? managerColors.royalBlue : managerColors.subtext} />
        </Pressable>
      </ScrollView>

      {isCustom ? (
        <Pressable accessibilityRole="button" onPress={openPicker} style={styles.customSummary}>
          <Text style={styles.customSummaryText} numberOfLines={1}>
            {customStart || '—'} to {customEnd || '—'}
          </Text>
          <Text style={styles.customSummaryEdit}>Edit</Text>
        </Pressable>
      ) : null}

      <ManagerBottomSheet visible={pickerOpen} title="Custom date range" scroll onClose={() => setPickerOpen(false)}>
        <View style={styles.sheetBody}>
          <Text style={styles.rangeSummary}>
            {draftStart || 'Start date'} — {draftEnd || 'End date'}
          </Text>
          <CalendarRangePicker
            start={draftStart}
            end={draftEnd}
            onChange={(nextStart, nextEnd) => {
              setDraftStart(nextStart);
              setDraftEnd(nextEnd);
            }}
          />
          <ManagerActionButton
            label="Apply"
            onPress={applyCustom}
            disabled={!draftStart.trim() || !draftEnd.trim()}
          />
        </View>
      </ManagerBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 16 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  chipSelected: { backgroundColor: '#EAF0FB', borderColor: '#EAF0FB' },
  pressed: { opacity: 0.7 },
  chipLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  chipLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
  },
  customSummary: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customSummaryText: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13 },
  customSummaryEdit: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  sheetBody: { gap: 16 },
  rangeSummary: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
});
