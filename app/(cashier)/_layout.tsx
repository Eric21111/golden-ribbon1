import { Redirect, Stack, usePathname } from 'expo-router';
import { useCheckoutStore } from '@/stores/checkoutStore';
import { RoleNavigation } from '@/components/RoleNavigation';

import { colors } from '@/constants/theme';
import { RoleGuard } from '@/features/auth/RoleGuard';

export default function CashierLayout() {
  const request = useCheckoutStore((state) => state.request);
  const pathname = usePathname();
  if (request && pathname !== '/cashier/payment') return <RoleGuard role="cashier"><Redirect href="/cashier/payment" /></RoleGuard>;
  return (
    <RoleGuard role="cashier">
      <RoleNavigation role="cashier">
        <Stack screenOptions={{ headerTintColor: colors.primary, headerBackTitle: 'Back' }}>
          <Stack.Screen name="cashier/dashboard" options={{ title: 'Cashier Dashboard' }} />
          <Stack.Screen name="cashier/pos" options={{ title: 'Point of Sale' }} />
          <Stack.Screen name="cashier/payment" options={{ title: 'Checkout' }} />
          <Stack.Screen name="cashier/sales" options={{ title: 'Current Shift Sales' }} />
          <Stack.Screen name="cashier/profile" options={{ title: 'Account' }} />
          <Stack.Screen name="cashier/change-password" options={{ title: 'Change Password' }} />
        </Stack>
      </RoleNavigation>
    </RoleGuard>
  );
}
