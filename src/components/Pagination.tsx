import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { visiblePageNumbers } from '@/lib/pagination';

/** Neutral pager — avoid brand primary (terracotta). */
const pager = {
  text: '#57534E',
  muted: '#A8A29E',
  border: '#D6D3D1',
  surface: '#FAFAF9',
  selectedBg: '#E7E5E4',
  selectedText: '#44403C',
} as const;

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** When false, renders nothing (caller already gates on item count). */
  visible?: boolean;
  labelStyle?: StyleProp<TextStyle>;
};

export function Pagination({
  page,
  totalPages,
  onPageChange,
  visible = true,
  labelStyle,
}: PaginationProps) {
  if (!visible || totalPages < 1) return null;

  const canPrev = page > 0;
  const canNext = page < totalPages - 1;
  const pages = visiblePageNumbers(page, totalPages);

  return (
    <View style={styles.wrap} accessibilityRole="adjustable" accessibilityLabel="Pagination">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous page"
        accessibilityState={{ disabled: !canPrev }}
        disabled={!canPrev}
        onPress={() => onPageChange(page - 1)}
        style={({ pressed }) => [
          styles.nav,
          !canPrev && styles.disabled,
          pressed && canPrev && styles.pressed,
        ]}
      >
        <Text style={[styles.navLabel, labelStyle, !canPrev && styles.disabledLabel]}>Prev</Text>
      </Pressable>

      <View style={styles.numbers}>
        {pages.map((entry, index) =>
          entry < 0 ? (
            <Text key={`ellipsis-${index}`} style={[styles.ellipsis, labelStyle]}>
              …
            </Text>
          ) : (
            <Pressable
              key={entry}
              accessibilityRole="button"
              accessibilityLabel={`Page ${entry + 1}`}
              accessibilityState={{ selected: entry === page }}
              onPress={() => onPageChange(entry)}
              style={({ pressed }) => [
                styles.page,
                entry === page && styles.pageSelected,
                pressed && entry !== page && styles.pressed,
              ]}
            >
              <Text style={[styles.pageLabel, labelStyle, entry === page && styles.pageLabelSelected]}>
                {entry + 1}
              </Text>
            </Pressable>
          ),
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next page"
        accessibilityState={{ disabled: !canNext }}
        disabled={!canNext}
        onPress={() => onPageChange(page + 1)}
        style={({ pressed }) => [
          styles.nav,
          !canNext && styles.disabled,
          pressed && canNext && styles.pressed,
        ]}
      >
        <Text style={[styles.navLabel, labelStyle, !canNext && styles.disabledLabel]}>Next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  nav: {
    minHeight: 40,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: pager.border,
    backgroundColor: pager.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: { color: pager.text, fontSize: 14, fontWeight: '600' },
  numbers: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  page: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: pager.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  pageSelected: {
    backgroundColor: pager.selectedBg,
    borderColor: '#A8A29E',
  },
  pageLabel: { color: pager.text, fontSize: 14, fontWeight: '600' },
  pageLabelSelected: { color: pager.selectedText, fontWeight: '800' },
  ellipsis: { color: pager.muted, fontSize: 14, paddingHorizontal: 4 },
  disabled: { opacity: 0.4 },
  disabledLabel: { color: pager.muted },
  pressed: { opacity: 0.7 },
});
