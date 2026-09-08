import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate } from '@/lib/format';
import type { StockTransferSummary } from '@/types/models';

import { TransferStatusBadge } from './TransferStatusBadge';

export function TransferListItem({
  transfer,
  onPress,
  selected = false,
}: {
  transfer: StockTransferSummary;
  onPress: () => void;
  selected?: boolean;
}) {
  const productCount = transfer.items.length;
  const route = `${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${transfer.transfer_number}, ${route}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.number} numberOfLines={1}>
          {transfer.transfer_number}
        </Text>
        <View style={styles.trailing}>
          <TransferStatusBadge status={transfer.status} compact />
          <Ionicons color={colors.muted} name="chevron-forward" size={18} />
        </View>
      </View>
      <Text style={styles.route} numberOfLines={1}>
        {route}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {productCount} {productCount === 1 ? 'item' : 'items'} · {formatDate(transfer.sent_at ?? transfer.created_at)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  selected: {
    borderColor: colors.primary,
    backgroundColor: '#FFF1E8',
  },
  pressed: { opacity: 0.82 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  number: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  route: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 12 },
});
