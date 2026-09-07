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
        <Stack.Screen name="manager/inventory" options={{ title: 'Inventory' }} />
        <Stack.Screen name="manager/returns/index" options={{ title: 'Stock Returns' }} />
        <Stack.Screen name="manager/returns/create" options={{ title: 'Create Return' }} />
        <Stack.Screen name="manager/returns/[id]" options={{ title: 'Return Details' }} />
        <Stack.Screen name="manager/incoming/index" options={{ title: 'Incoming Transfers' }} />
        <Stack.Screen name="manager/incoming/[id]" options={{ title: 'Receive Stock' }} />
        <Stack.Screen name="manager/movements" options={{ title: 'Inventory History' }} />
        <Stack.Screen name="manager/products" options={{ title: 'Products' }} />
        <Stack.Screen name="manager/profile" options={{ title: 'Account' }} />
        <Stack.Screen name="manager/change-password" options={{ title: 'Change Password' }} />
      </Stack>
      </RoleNavigation>
    </RoleGuard>
  );
}
