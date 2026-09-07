import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { colors, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBranches } from '@/hooks/useBranches';
import { useEmployees } from '@/hooks/useEmployees';
import { useInventory } from '@/hooks/useInventory';
import { useOwnerDashboardMetrics } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';

export default function OwnerDashboard() {
  const { profile } = useAuth();
  const branches = useBranches();
  const employees = useEmployees();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const mainInventory = useInventory(mainBranch, true);
  const metricsQuery = useOwnerDashboardMetrics();

  const metrics = metricsQuery.data;

  return (
    <Screen>
      <PageHeader title={`Hello, ${profile?.full_name ?? 'Owner'}`} subtitle="Company-wide administration" />
      <Text style={styles.role}>OWNER</Text>
      {branches.error || employees.error || mainInventory.error || metricsQuery.error ? (
        <ErrorState
          message={getErrorMessage(
            branches.error ?? employees.error ?? mainInventory.error ?? metricsQuery.error
          )}
          onRetry={() => {
            void branches.refetch();
            void employees.refetch();
            void mainInventory.refetch();
            void metricsQuery.refetch();
          }}
        />
      ) : (
        <View style={styles.grid}>
          {/* Sales & Financial Overview */}
          <DashboardCard
            title="Today's Sales"
            value={metrics ? formatMoney(metrics.today_sales) : '—'}
            description={`${metrics?.today_transactions ?? '—'} completed orders today (PH)`}
            onPress={() => router.push('/owner/sales' as any)}
          />
          <DashboardCard
            title="Sales by Branch"
            description="Inspect revenue and transaction volume across selling branches"
            onPress={() => router.push('/owner/reports/sales-by-branch' as any)}
          />
          <DashboardCard
            title="Product Sales Summary"
            description="View units sold and revenue per product"
            onPress={() => router.push('/owner/reports/product-sales' as any)}
          />
          <DashboardCard
            title="Branch Performance"
            description="Compare completed sales, items sold, and discrepancy metrics across selling branches"
            onPress={() => router.push('/owner/reports/branch-performance' as any)}
          />
          <DashboardCard
            title="Inventory Reconciliation"
            description="Verify branch physical inventory against cumulative signed movement ledgers"
            onPress={() => router.push('/owner/reports/inventory-reconciliation' as any)}
          />
          <DashboardCard
            title="Transfer Discrepancies"
            value={metrics?.transfer_discrepancies_count ?? '—'}
            description="Audit missing or excess items during branch transfer receiving"
            onPress={() => router.push('/owner/reports/transfer-discrepancies' as any)}
          />
          <DashboardCard
            title="Return Discrepancies"
            value={metrics?.return_discrepancies_count ?? '—'}
            description="Audit missing or excess items during Main Branch return receiving"
            onPress={() => router.push('/owner/reports/return-discrepancies' as any)}
          />
          <DashboardCard
            title="Sales History"
            description="Search and filter company-wide sales by branch, cashier, and date"
            onPress={() => router.push('/owner/sales' as any)}
          />
          <DashboardCard
            title="Shift History"
            description="Review all cashier shift sessions and sales totals"
            onPress={() => router.push('/owner/shifts' as any)}
          />

          {/* Logistics & Inventory Metrics */}
          <DashboardCard
            title="Branches"
            value={branches.data?.length ?? '—'}
            description="Manage branch master data"
            onPress={() => router.push('/owner/branches')}
          />
          <DashboardCard
            title="Active Products"
            value={metrics?.active_products_count ?? '—'}
            description="Manage product catalog and active items"
            onPress={() => router.push('/owner/products')}
          />
          <DashboardCard
            title="Main inventory products"
            value={mainInventory.data?.filter((item) => item.quantity_on_hand > 0).length ?? '—'}
            description="View and initialize Main Branch stock"
            onPress={() => router.push('/owner/inventory')}
          />
          <DashboardCard
            title="Pending transfers"
            value={metrics?.pending_transfers_count ?? '—'}
            description="Stock awaiting branch receipt"
            onPress={() => router.push('/owner/transfers')}
          />
          <DashboardCard
            title="Pending return receipts"
            value={metrics?.in_transit_returns_count ?? '—'}
            description="Unsold stock returning from branches awaiting receipt"
            onPress={() => router.push('/owner/returns')}
          />

          <DashboardCard
            title="Inventory by branch"
            description="Inspect read-only balances across branches"
            onPress={() => router.push('/owner/inventory-by-branch')}
          />
          <DashboardCard
            title="Stock returns"
            description="View all branch stock returns"
            onPress={() => router.push('/owner/returns')}
          />
          <DashboardCard
            title="Inventory history"
            description="Review all signed inventory movements"
            onPress={() => router.push('/owner/movements')}
          />
          <DashboardCard
            title="Employees"
            value={employees.data?.filter((employee) => employee.is_active).length ?? '—'}
            description="Manage Manager and Cashier accounts"
            onPress={() => router.push('/owner/employees')}
          />
          <DashboardCard
            title="Audit History"
            description="View the complete company-wide activity and change trail"
            onPress={() => router.push('/owner/audit' as any)}
          />
          <DashboardCard
            title="Profile"
            description="View your account information"
            onPress={() => router.push('/owner/profile')}
          />
        </View>
      )}
      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  role: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  grid: { gap: spacing.md },
});
