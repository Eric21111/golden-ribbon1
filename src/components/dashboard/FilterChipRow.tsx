import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { FilterChip } from './FilterChip';

interface FilterChipOption<T extends string> {
  label: string;
  value: T;
  leading?: ReactNode;
}

interface FilterChipRowProps<T extends string> {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * For a row inside a screen column that has horizontal padding: the row runs out to the screen edges by this many dp
   * (so the next chip is cut off by the edge of the screen, which says "scroll") and starts and ends with the same inset.
   * Leave it out and the row behaves as before.
   */
  bleed?: number;
  /** Scroll the selected chip fully into view when it changes, so a half-hidden chip never stays half hidden. */
  keepSelectedVisible?: boolean;
}

const EDGE_GAP = 12;

export function FilterChipRow<T extends string>({
  options,
  value,
  onChange,
  bleed = 0,
  keepSelectedVisible = false,
}: FilterChipRowProps<T>) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetX = useRef(0);
  const viewportWidth = useRef(0);
  const chipBox = useRef<Record<string, { x: number; width: number }>>({});

  useEffect(() => {
    if (!keepSelectedVisible) return;
    const box = chipBox.current[value];
    if (!box || viewportWidth.current === 0) return;
    const left = box.x - EDGE_GAP;
    const right = box.x + box.width + EDGE_GAP;
    if (left < offsetX.current) {
      scrollRef.current?.scrollTo({ x: Math.max(0, left), animated: true });
    } else if (right > offsetX.current + viewportWidth.current) {
      scrollRef.current?.scrollTo({ x: right - viewportWidth.current, animated: true });
    }
  }, [value, keepSelectedVisible]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(event: LayoutChangeEvent) => {
        viewportWidth.current = event.nativeEvent.layout.width;
      }}
      onScroll={(event) => {
        offsetX.current = event.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={16}
      style={[styles.scroll, bleed > 0 ? { marginHorizontal: -bleed } : null]}
      contentContainerStyle={[styles.content, bleed > 0 && { paddingLeft: bleed, paddingRight: bleed }]}
    >
      {options.map((option) => (
        <View
          key={option.value}
          onLayout={(event: LayoutChangeEvent) => {
            chipBox.current[option.value] = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width };
          }}
        >
          <FilterChip
            label={option.label}
            leading={option.leading}
            selected={option.value === value}
            onPress={() => onChange(option.value)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // a horizontal ScrollView grows to fill spare height by default; a chip row must stay one chip tall
  scroll: { flexGrow: 0 },
  content: { flexDirection: 'row', gap: 10, paddingRight: 16 },
});
