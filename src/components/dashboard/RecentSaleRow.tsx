import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
          <Text style={styles.cashier} numberOfLines={1}>
            {cashierName}
          </Text>
          <CurrencyText value={amount} style={styles.amount} numberOfLines={1} />
        </View>
        <View style={styles.line}>
          <Text style={styles.date} numberOfLines={1}>
            {date}
          </Text>
          <Text style={styles.tag} numberOfLines={1}>
            {shortSaleTag(saleNumber)}
          </Text>
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
  content: { flex: 1, gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cashier: { flexShrink: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, color: managerColors.ink },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 16, color: managerColors.green },
  date: { flexShrink: 1, fontFamily: 'Inter_400Regular', fontSize: 12, color: managerColors.subtext },
  tag: { fontFamily: 'Inter_500Medium', fontSize: 11, color: managerColors.subtext },
});
