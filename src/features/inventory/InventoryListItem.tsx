import { StyleSheet, Text } from 'react-native';

import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge, type ManagerBadgeTone } from '@/components/dashboard/ManagerBadge';
import { managerColors } from '@/components/dashboard/theme';
import { formatMoney } from '@/lib/format';
import type { InventoryItem } from '@/types/models';

import { getStockStatus, stockStatusLabel, type StockStatus } from './inventoryStatus';

type InventoryListItemProps = {
  item: InventoryItem;
  showBranch?: boolean;
  onPress?: () => void;
  selected?: boolean;
};

function badgeTone(status: StockStatus): ManagerBadgeTone {
  if (status === 'low') return 'warning';
  if (status === 'out') return 'danger';
  if (status === 'not_set') return 'neutral';
  return 'success';
}

export function InventoryListItem({ item, showBranch = false, onPress }: InventoryListItemProps) {
  const status = getStockStatus(item);

  const meta = [item.product.sku, showBranch ? item.branch.name : null, formatMoney(item.product.selling_price)]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRowCard
      title={item.product.name}
      meta={meta}
      onPress={onPress}
      trailing={
        <>
          <Text style={[styles.stock, status === 'out' && styles.stockMuted]}>{item.quantity_on_hand}</Text>
          <ManagerBadge label={stockStatusLabel(status)} tone={badgeTone(status)} />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  stock: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    minWidth: 26,
    textAlign: 'right',
  },
  stockMuted: { color: managerColors.subtext },
});
