import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DashboardCard } from '@/components/DashboardCard';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';

export default function OwnerReportsHub() {
  return (
    <Screen constrain>
      <PageHeader title="Analytics / Reports" subtitle="Company-wide read-only performance" />
      <View style={styles.list}>
        <DashboardCard
          title="Sales by Branch"
          description="Revenue and completed transactions by selling branch"
          onPress={() => router.push('/owner/reports/sales-by-branch')}
        />
        <DashboardCard
          title="Product Sales Performance"
          description="Units sold and historical revenue by product"
          onPress={() => router.push('/owner/reports/product-sales')}
        />
        <DashboardCard
          title="Branch Performance"
          description="Sales, volume, and discrepancy comparison"
          onPress={() => router.push('/owner/reports/branch-performance' as never)}
        />
        <DashboardCard
          title="Inventory Summary"
          description="Read-only on-hand balances across branches"
          onPress={() => router.push('/owner/inventory-by-branch')}
        />
        <DashboardCard
          title="Inventory Reconciliation"
          description="Physical stock versus the movement ledger"
          onPress={() => router.push('/owner/reports/inventory-reconciliation')}
        />
        <DashboardCard
          title="Discrepancy Analytics"
          description="Transfer and return missing or excess quantities"
          onPress={() => router.push('/owner/reports/discrepancies' as never)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
});
