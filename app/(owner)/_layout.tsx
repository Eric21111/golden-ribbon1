import { Stack } from 'expo-router';
import { RoleNavigation } from '@/components/RoleNavigation';

import { colors } from '@/constants/theme';
import { RoleGuard } from '@/features/auth/RoleGuard';

export default function OwnerLayout() {
  return (
    <RoleGuard role="owner">
      <RoleNavigation role="owner">
        <Stack screenOptions={{ headerTintColor: colors.primary, headerBackTitle: 'Back' }}>
          <Stack.Screen name="owner/dashboard" options={{ title: 'Owner Dashboard' }} />
          <Stack.Screen name="owner/reports/index" options={{ title: 'Analytics' }} />
          <Stack.Screen name="owner/reports/sales-by-branch" options={{ title: 'Sales by Branch' }} />
          <Stack.Screen name="owner/reports/product-sales" options={{ title: 'Product Sales' }} />
          <Stack.Screen name="owner/reports/branch-performance/index" options={{ title: 'Branch Performance' }} />
          <Stack.Screen name="owner/reports/branch-performance/[id]" options={{ title: 'Branch Details' }} />
          <Stack.Screen name="owner/reports/discrepancies" options={{ title: 'Discrepancy Analytics' }} />
          <Stack.Screen name="owner/reports/transfer-discrepancies" options={{ title: 'Transfer Discrepancies' }} />
          <Stack.Screen name="owner/reports/return-discrepancies" options={{ title: 'Return Discrepancies' }} />
          <Stack.Screen name="owner/reports/inventory-reconciliation" options={{ title: 'Inventory Reconciliation' }} />
          <Stack.Screen name="owner/inventory-by-branch" options={{ title: 'Inventory Summary' }} />
          <Stack.Screen name="owner/employees/index" options={{ title: 'Employees' }} />
          <Stack.Screen name="owner/data-archive" options={{ title: 'Data Archive' }} />
          <Stack.Screen name="owner/profile" options={{ title: 'Account' }} />
          <Stack.Screen name="owner/change-password" options={{ title: 'Change Password' }} />
          <Stack.Screen name="owner/change-email" options={{ title: 'Change Email' }} />
        </Stack>
      </RoleNavigation>
    </RoleGuard>
  );
}
