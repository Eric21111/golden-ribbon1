import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate } from '@/lib/format';
import type { StockTransferSummary } from '@/types/models';
import { TransferStatusBadge } from './TransferStatusBadge';

export function TransferListItem({ transfer, onPress }: { transfer: StockTransferSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.row}>
        <Text style={styles.number}>{transfer.transfer_number}</Text>
        <TransferStatusBadge status={transfer.status} />
      </View>
      <Text style={styles.branch}>{transfer.from_branch?.name ?? 'Sending branch'} → {transfer.to_branch?.name ?? 'Receiving branch'}</Text>
      <View style={styles.row}>
        <Text style={styles.meta}>{transfer.items.length} {transfer.items.length === 1 ? 'product' : 'products'}</Text>
        <Text style={styles.meta}>{formatDate(transfer.sent_at ?? transfer.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  number: { color: colors.text, fontSize: 17, fontWeight: '800' },
  branch: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 12 },
});
