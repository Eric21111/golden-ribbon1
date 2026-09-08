import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/types/models';

export function ProductListItem({ product, onPress }: { product: Product; onPress?: () => void }) {
  const content = (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {product.sku} · {formatMoney(product.selling_price)}
        </Text>
      </View>
      <View style={styles.trailing}>
        <StatusBadge active={product.is_active} />
        {onPress ? <Ionicons color={colors.muted} name="chevron-forward" size={18} /> : null}
      </View>
    </View>
  );

  if (!onPress) {
    return <View style={styles.card}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatMoney(product.selling_price)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: 0.82 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
