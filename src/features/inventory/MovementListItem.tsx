import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate, formatMovementType } from '@/lib/format';
import type { InventoryMovementWithRelations } from '@/types/models';

export function MovementListItem({ movement }: { movement: InventoryMovementWithRelations }) {
  const positive = movement.quantity > 0;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.name}>{movement.product?.name ?? `Unavailable product (${movement.product_id})`}</Text>
          <Text style={styles.branch}>{movement.branch?.name ?? 'Branch'}</Text>
        </View>
        <Text style={[styles.quantity, positive ? styles.positive : styles.negative]}>{positive ? '+' : ''}{movement.quantity}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.type}>{formatMovementType(movement.movement_type)}</Text>
        <Text style={styles.meta}>{movement.transfer?.transfer_number ?? movement.reference_type.replace('_', ' ')}</Text>
      </View>
      <Text style={styles.meta}>{formatDate(movement.created_at)}</Text>
      <Text style={styles.meta}>Created by {movement.created_by_profile?.full_name ?? 'Employee'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  branch: { color: colors.muted, fontSize: 13, marginTop: 2 },
  quantity: { fontSize: 22, fontWeight: '900' },
  positive: { color: colors.success },
  negative: { color: colors.danger },
  type: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
});
