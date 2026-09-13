import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { NavTile } from '@/components/dashboard/NavTile';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { spacing } from '@/constants/theme';

export default function OwnerReportsHub() {
  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Reports" subtitle="Company-wide read-only performance" />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.list}>
          <NavTile
            icon="stats-chart-outline"
            accent="blue"
            title="Sales by Branch"
            description="Revenue and completed transactions by selling branch"
            onPress={() => router.push('/owner/reports/sales-by-branch')}
          />
          <NavTile
            icon="pricetag-outline"
            accent="gold"
            title="Product Sales Performance"
            description="Units sold and historical revenue by product"
            onPress={() => router.push('/owner/reports/product-sales')}
          />
          <NavTile
            icon="git-branch-outline"
            accent="teal"
            title="Branch Performance"
            description="Sales, volume, and discrepancy comparison"
            onPress={() => router.push('/owner/reports/branch-performance' as never)}
          />
          <NavTile
            icon="cube-outline"
            accent="lilac"
            title="Inventory Summary"
            description="Read-only on-hand balances across branches"
            onPress={() => router.push('/owner/inventory-by-branch')}
          />
          <NavTile
            icon="checkmark-done-outline"
            accent="green"
            title="Inventory Reconciliation"
            description="Physical stock versus the movement ledger"
            onPress={() => router.push('/owner/reports/inventory-reconciliation')}
          />
          <NavTile
            icon="alert-circle-outline"
            accent="red"
            title="Discrepancy Analytics"
            description="Transfer and return missing or excess quantities"
            onPress={() => router.push('/owner/reports/discrepancies' as never)}
          />
        </View>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20 },
  list: { gap: spacing.sm },
});
