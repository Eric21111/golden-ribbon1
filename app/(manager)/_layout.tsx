import { Stack } from 'expo-router';
import { RoleNavigation } from '@/components/RoleNavigation';

import { colors } from '@/constants/theme';
import { RoleGuard } from '@/features/auth/RoleGuard';

export default function ManagerLayout() {
  return (
    <RoleGuard role="manager">
      <RoleNavigation role="manager">
        <Stack screenOptions={{ headerTintColor: colors.primary, headerBackTitle: 'Back' }}>
          <Stack.Screen name="manager/dashboard" options={{ title: 'Manager Dashboard' }} />
          <Stack.Screen name="manager/inventory/index" options={{ title: 'Inventory' }} />
          <Stack.Screen name="manager/inventory/setup" options={{ title: 'Opening Stock' }} />
          <Stack.Screen name="manager/products/index" options={{ title: 'Products' }} />
          <Stack.Screen name="manager/products/[id]" options={{ title: 'Edit Product' }} />
          <Stack.Screen name="manager/employees/index" options={{ title: 'Unauthorized' }} />
          <Stack.Screen name="manager/employees/[id]/index" options={{ title: 'Unauthorized' }} />
          <Stack.Screen name="manager/employees/[id]/reset-password" options={{ title: 'Unauthorized' }} />
          <Stack.Screen name="manager/branches/index" options={{ title: 'Branches' }} />
          <Stack.Screen name="manager/branches/[id]" options={{ title: 'Edit Branch' }} />
          <Stack.Screen name="manager/transfers/index" options={{ title: 'Transfers' }} />
          <Stack.Screen name="manager/transfers/create" options={{ title: 'Send Stock' }} />
          <Stack.Screen name="manager/transfers/[id]" options={{ title: 'Transfer Details' }} />
          <Stack.Screen name="manager/incoming/index" options={{ title: 'Incoming Transfers' }} />
          <Stack.Screen name="manager/incoming/[id]" options={{ title: 'Receive Stock' }} />
          <Stack.Screen name="manager/returns/index" options={{ title: 'Stock Returns' }} />
          <Stack.Screen name="manager/returns/create" options={{ title: 'Create Return' }} />
          <Stack.Screen name="manager/returns/[id]" options={{ title: 'Return Details' }} />
          <Stack.Screen name="manager/returns/receive/[id]" options={{ title: 'Receive Return' }} />
          <Stack.Screen name="manager/reports/product-sales" options={{ title: 'Product Sales' }} />
          <Stack.Screen name="manager/profile" options={{ title: 'Account' }} />
          <Stack.Screen name="manager/change-password" options={{ title: 'Change Password' }} />
          <Stack.Screen name="manager/change-email" options={{ title: 'Change Email' }} />
        </Stack>
      </RoleNavigation>
    </RoleGuard>
  );
}
