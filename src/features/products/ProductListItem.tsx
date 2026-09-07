import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/StatusBadge';
import { colors, radius, spacing } from '@/constants/theme';
import type { Product } from '@/types/models';

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export function ProductListItem({ product, onPress }: { product: Product; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.sku}>{product.sku}</Text>
        </View>
        <StatusBadge active={product.is_active} />
      </View>
      <Text style={styles.price}>{money.format(product.selling_price)}</Text>
      {product.description ? <Text style={styles.description}>{product.description}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  pressed: { opacity: 0.8 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sku: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  price: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
