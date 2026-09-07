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
          <Stack.Screen name="owner/returns/index" options={{ title: 'Stock Returns' }} />
          <Stack.Screen name="owner/returns/[id]" options={{ title: 'Return Details' }} />
          <Stack.Screen name="owner/inventory/index" options={{ title: 'Main Inventory' }} />
          <Stack.Screen name="owner/inventory/setup" options={{ title: 'Opening Stock' }} />
          <Stack.Screen name="owner/inventory-by-branch" options={{ title: 'Inventory by Branch' }} />
          <Stack.Screen name="owner/movements" options={{ title: 'Inventory History' }} />
          <Stack.Screen name="owner/transfers/index" options={{ title: 'Stock Transfers' }} />
          <Stack.Screen name="owner/transfers/create" options={{ title: 'Send Stock' }} />
          <Stack.Screen name="owner/transfers/[id]" options={{ title: 'Transfer Details' }} />
          <Stack.Screen name="owner/branches/index" options={{ title: 'Branches' }} />
          <Stack.Screen name="owner/branches/create" options={{ title: 'New Branch' }} />
          <Stack.Screen name="owner/branches/[id]" options={{ title: 'Edit Branch' }} />
          <Stack.Screen name="owner/products/index" options={{ title: 'Products' }} />
          <Stack.Screen name="owner/products/create" options={{ title: 'New Product' }} />
          <Stack.Screen name="owner/products/[id]" options={{ title: 'Edit Product' }} />
          <Stack.Screen name="owner/employees/index" options={{ title: 'Employees' }} />
          <Stack.Screen name="owner/employees/create" options={{ title: 'Create Employee' }} />
          <Stack.Screen name="owner/employees/[id]/index" options={{ title: 'Edit Employee' }} />
          <Stack.Screen name="owner/reports/sales-by-branch" options={{ title: 'Sales by Branch' }} />
          <Stack.Screen name="owner/reports/product-sales" options={{ title: 'Product Sales' }} />
          <Stack.Screen name="owner/reports/branch-performance/index" options={{ title: 'Branch Performance' }} />
          <Stack.Screen name="owner/reports/branch-performance/[id]" options={{ title: 'Branch Details' }} />
          <Stack.Screen name="owner/reports/transfer-discrepancies" options={{ title: 'Transfer Discrepancies' }} />
          <Stack.Screen name="owner/reports/return-discrepancies" options={{ title: 'Return Discrepancies' }} />
          <Stack.Screen name="owner/reports/inventory-reconciliation" options={{ title: 'Inventory Reconciliation' }} />
          <Stack.Screen name="owner/audit/index" options={{ title: 'Audit History' }} />
          <Stack.Screen name="owner/audit/[id]" options={{ title: 'Audit Event Detail' }} />
          <Stack.Screen name="owner/profile" options={{ title: 'Account' }} />
          <Stack.Screen name="owner/change-password" options={{ title: 'Change Password' }} />
        </Stack>

      </RoleNavigation>
    </RoleGuard>
  );
}
