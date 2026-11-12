import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FilterChip } from '@/components/dashboard/FilterChip';
import { managerColors } from '@/components/dashboard/theme';
import { unitsPerWhole, type StockUnitCode } from '@/lib/stockUnits';

import { SettingRow, SettingsCard } from './StepOneLayout';

export type PartOf = 'egg' | 'serving';
export type PartSize = 'half' | 'quarter';

/** Which counting unit a plain-words choice means. A quarter egg is not offered. */
export function unitFromParts(of: PartOf, size: PartSize): StockUnitCode {
  if (of === 'egg') return 'half_egg';
  return size === 'quarter' ? 'quarter_serving' : 'half_serving';
}

/** The plain-words choice behind a unit code, or null for whole pieces. */
export function partsFromUnit(code: StockUnitCode): { of: PartOf; size: PartSize } | null {
  if (code === 'half_egg') return { of: 'egg', size: 'half' };
  if (code === 'half_serving') return { of: 'serving', size: 'half' };
  if (code === 'quarter_serving') return { of: 'serving', size: 'quarter' };
  return null;
}

/** "Each count = half an egg." */
export const STOCK_UNIT_MEANING: Record<Exclude<StockUnitCode, 'piece'>, string> = {
  half_egg: 'Each count = half an egg.',
  half_serving: 'Each count = half a serving.',
  quarter_serving: 'Each count = a quarter of a serving.',
};

/**
 * What to type for a whole amount: 10 servings split in halves -> 20. Null when the amount is not an exact number of
 * parts (10.3 servings in halves), is not a number, or is negative. Nothing is rounded.
 */
export function countFor(amount: string, code: StockUnitCode): number | null {
  const per = unitsPerWhole(code);
  const value = Number(amount);
  if (!per || amount.trim() === '' || !Number.isFinite(value) || value < 0) return null;
  const count = value * per;
  return Number.isInteger(count) ? count : null;
}

/** "half" / "halves" / "quarter" / "quarters" for a count. */
export function partName(size: PartSize, count: number): string {
  if (size === 'half') return count === 1 ? 'half' : 'halves';
  return count === 1 ? 'quarter' : 'quarters';
}

const INFO = {
  title: 'About splitting stock',
  body: "Use this for items you split up, like half an egg per meal. Stock counts, transfers and returns for this item are then entered in parts.\n\nThis can't be changed after you save.",
};

/**
 * Create Product, stock-only items. Most items are counted as whole pieces, so this is a switch that is off by default and
 * only asks about splitting when it is turned on. Same look as the other setting rows ("Show in Cashier POS"). The result
 * is one of the same four fixed counting units; it is locked once the product is saved.
 */
export function StockUnitField({ value, onChange }: { value: StockUnitCode; onChange: (code: StockUnitCode) => void }) {
  const parts = partsFromUnit(value);
  const [amount, setAmount] = useState('10');
  const noun = parts?.of === 'egg' ? 'eggs' : 'servings';
  const singular = parts?.of === 'egg' ? 'egg' : 'serving';
  const count = parts ? countFor(amount, value) : null;
  return (
    <SettingsCard>
      <SettingRow
        label="Split into halves or quarters"
        description={
          parts ? 'Stock is counted in parts, not whole items.' : 'Turn on if a meal uses less than 1 whole item, like half an egg.'
        }
        value={parts !== null}
        onValueChange={(on) => onChange(on ? 'half_egg' : 'piece')}
        info={INFO}
      />
      {parts ? (
        <View style={styles.choices}>
          <View style={styles.group}>
            <Text style={styles.label}>What is being split?</Text>
            <View style={styles.chips}>
              <FilterChip label="Egg" selected={parts.of === 'egg'} onPress={() => onChange(unitFromParts('egg', 'half'))} />
              <FilterChip
                label="Serving"
                selected={parts.of === 'serving'}
                onPress={() => onChange(unitFromParts('serving', parts.size))}
              />
            </View>
          </View>
          {parts.of === 'serving' ? (
            <View style={styles.group}>
              <Text style={styles.label}>Split into</Text>
              <View style={styles.chips}>
                <FilterChip label="Halves" selected={parts.size === 'half'} onPress={() => onChange(unitFromParts('serving', 'half'))} />
                <FilterChip
                  label="Quarters"
                  selected={parts.size === 'quarter'}
                  onPress={() => onChange(unitFromParts('serving', 'quarter'))}
                />
              </View>
            </View>
          ) : (
            <Text style={styles.note}>Eggs are split into halves.</Text>
          )}
          <View style={styles.tryBox}>
            <Text style={styles.meaning}>{STOCK_UNIT_MEANING[value as Exclude<StockUnitCode, 'piece'>]}</Text>
            <View style={styles.tryRow}>
              <Text style={styles.tryLabel}>Try it</Text>
              <TextInput
                accessibilityLabel={`How many ${noun} do you have`}
                keyboardType="decimal-pad"
                selectTextOnFocus
                value={amount}
                onChangeText={(text) => {
                  if (/^\d{0,4}(\.\d{0,2})?$/.test(text)) setAmount(text);
                }}
                style={styles.tryInput}
              />
              <Text style={styles.tryLabel}>{noun}</Text>
            </View>
            {count === null ? (
              <Text accessibilityLiveRegion="polite" style={styles.tryError}>
                {`That is not an exact number of ${parts.size === 'half' ? 'halves' : 'quarters'}.`}
              </Text>
            ) : (
              <View accessibilityLiveRegion="polite" style={styles.resultBlock}>
                <Text style={styles.tryResult}>
                  {`${amount} ${Number(amount) === 1 ? singular : noun} = ${count} ${partName(parts.size, count)}`}
                </Text>
                <Text style={styles.tryHelp}>{`Type ${count} when you add or count stock.`}</Text>
              </View>
            )}
          </View>
        </View>
      ) : null}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  choices: { gap: 12, paddingTop: 4, paddingBottom: 14 },
  group: { gap: 6 },
  label: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  tryBox: { backgroundColor: '#F2F6FF', borderWidth: 1, borderColor: '#D3E0FA', borderRadius: 12, padding: 12, gap: 8 },
  meaning: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  tryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tryLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  tryInput: {
    width: 72,
    minHeight: 40,
    textAlign: 'center',
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    padding: 0,
    borderWidth: 1,
    borderColor: '#D9DFEA',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  resultBlock: { gap: 1 },
  tryResult: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  tryHelp: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  tryError: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
});
