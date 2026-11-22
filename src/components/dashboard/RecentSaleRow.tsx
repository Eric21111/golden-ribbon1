import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FIGURE_MAX_FONT_SCALE } from '@/features/reports/reportDisplay';

import { CurrencyText } from './CurrencyText';
import { managerColors, statChipColors } from './theme';

interface RecentSaleRowProps {
  saleNumber: string;
  amount: string;
  cashierName: string;
  date: string;
  onPress?: () => void;
}

function shortSaleTag(saleNumber: string): string {
  const digits = saleNumber.replace(/\D/g, '');
  return digits.length > 0 ? `#${digits.slice(-4)}` : saleNumber;
}

export function RecentSaleRow({ saleNumber, amount, cashierName, date, onPress }: RecentSaleRowProps) {
  const chip = statChipColors.blue;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}
    >
      <View style={[styles.iconChip, { backgroundColor: chip.chip }]}>
        <Ionicons name="receipt-outline" size={16} color={chip.icon} />
      </View>
      <View style={styles.content}>
        <View style={styles.line}>
          <Text style={styles.cashier}>{cashierName}</Text>
          <CurrencyText value={amount} style={styles.amount} maxFontSizeMultiplier={FIGURE_MAX_FONT_SCALE} />
        </View>
        <View style={styles.line}>
          <Text style={styles.date}>{date}</Text>
          <Text style={styles.tag}>{shortSaleTag(saleNumber)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { opacity: 0.7 },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, minWidth: 0, gap: 4 },
  // The name and the date wrap; the amount and the sale tag keep their own width (never cut, never broken). When they do not
  // fit beside the name (a larger system font, a seven-figure amount) they drop to the next line, right-aligned.
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 12, rowGap: 2 },
  cashier: { flexGrow: 1, flexShrink: 1, flexBasis: 110, minWidth: 0, fontFamily: 'Inter_600SemiBold', fontSize: 14, color: managerColors.ink },
  amount: { flexShrink: 0, marginLeft: 'auto', fontFamily: 'Inter_700Bold', fontSize: 16, color: managerColors.green },
  date: { flexGrow: 1, flexShrink: 1, flexBasis: 110, minWidth: 0, fontFamily: 'Inter_400Regular', fontSize: 12, color: managerColors.subtext },
  tag: { flexShrink: 0, marginLeft: 'auto', fontFamily: 'Inter_500Medium', fontSize: 11, color: managerColors.subtext },
});
