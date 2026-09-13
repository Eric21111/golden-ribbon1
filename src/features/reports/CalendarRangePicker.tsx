import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** Offset of the 1st of the month from Monday (0 = month starts on Monday). */
function mondayOffset(y: number, m: number): number {
  return (new Date(y, m, 1).getDay() + 6) % 7;
}

function todayKey(): string {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

interface CalendarRangePickerProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}

/** Lightweight month-grid range picker — no native/date-library dependency, so it renders
 * identically across iOS, Android, and web and needs no native rebuild to verify. */
export function CalendarRangePicker({ start, end, onChange }: CalendarRangePickerProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const today = todayKey();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (isCurrentMonth) return;
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handlePick = (key: string) => {
    if (!start || (start && end)) {
      onChange(key, '');
      return;
    }
    if (key < start) onChange(key, '');
    else onChange(start, key);
  };

  const totalDays = daysInMonth(viewYear, viewMonth);
  const offset = mondayOffset(viewYear, viewMonth);
  const cells: Array<{ key: string; day: number } | null> = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) cells.push({ key: toDateKey(viewYear, viewMonth, day), day });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={goPrevMonth}
          style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={18} color={managerColors.ink} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTH_LABELS[viewMonth]} {viewYear}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={isCurrentMonth}
          onPress={goNextMonth}
          style={({ pressed }) => [
            styles.navButton,
            isCurrentMonth && styles.navButtonDisabled,
            pressed && !isCurrentMonth && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? managerColors.cardBorder : managerColors.ink} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell, index) => {
          if (!cell) return <View key={`empty-${index}`} style={styles.cell} />;
          const { key, day } = cell;
          const isFuture = key > today;
          const isToday = key === today;
          const isBoundary = key === start || key === end;
          const inRange = Boolean(start && end && key > start && key < end);

          return (
            <View key={key} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={key}
                accessibilityState={{ selected: isBoundary, disabled: isFuture }}
                disabled={isFuture}
                onPress={() => handlePick(key)}
                style={[styles.dayButton, inRange && styles.dayInRange, isBoundary && styles.daySelected]}
              >
                <Text
                  style={[
                    styles.dayLabel,
                    isToday && !isBoundary && styles.dayLabelToday,
                    isBoundary && styles.dayLabelSelected,
                    isFuture && styles.dayLabelDisabled,
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const CELL_SIZE = 38;

const styles = StyleSheet.create({
  container: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
  },
  navButtonDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  monthLabel: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  weekdayRow: { flexDirection: 'row' },
  weekdayLabel: {
    width: CELL_SIZE,
    textAlign: 'center',
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11.5,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, alignItems: 'center', justifyContent: 'center' },
  dayButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayInRange: { backgroundColor: '#EAF0FB', borderRadius: 8 },
  daySelected: { backgroundColor: managerColors.royalBlue },
  dayLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13.5 },
  dayLabelToday: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  dayLabelSelected: { color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
  dayLabelDisabled: { color: managerColors.cardBorder },
});
