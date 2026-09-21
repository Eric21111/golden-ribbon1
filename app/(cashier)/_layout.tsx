import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useCheckoutStore } from '@/stores/checkoutStore';
import { RoleNavigation } from '@/components/RoleNavigation';
import { Screen } from '@/components/Screen';

import { LoadingState } from '@/components/dashboard/ManagerFeedback';
import { RoleGuard } from '@/features/auth/RoleGuard';

function CashierNavigator() {
  const request = useCheckoutStore((state) => state.request);
  const pathname = usePathname();
  if (request && pathname !== '/cashier/payment') return <RoleGuard role="cashier"><Redirect href="/cashier/payment" /></RoleGuard>;
  return (
    <RoleGuard role="cashier">
      <RoleNavigation role="cashier">
        <Stack screenOptions={{ headerShown: false, animation: 'default', contentStyle: { backgroundColor: '#FFFFFF' } }}>
          <Stack.Screen name="cashier/dashboard" />
          <Stack.Screen name="cashier/pos" />
          <Stack.Screen name="cashier/payment" />
          <Stack.Screen name="cashier/sales" />
          <Stack.Screen name="cashier/sales/[id]" />
          <Stack.Screen name="cashier/profile" />
          <Stack.Screen name="cashier/change-password" />
        </Stack>
      </RoleNavigation>
    </RoleGuard>
  );
}

export default function CashierLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <LoadingState label="Loading…" />
      </Screen>
    );
  }

  return <CashierNavigator />;
}
