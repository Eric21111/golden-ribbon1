import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';

import { HamburgerButton } from '@/components/dashboard/HamburgerButton';
import { ManagerSidebar } from '@/components/dashboard/ManagerSidebar';
import { LoadingState } from '@/components/Feedback';
import { RoleNavigation } from '@/components/RoleNavigation';
import { colors } from '@/constants/theme';
import { RoleGuard } from '@/features/auth/RoleGuard';
import { ManagerDrawerProvider, useManagerDrawer } from '@/features/navigation/ManagerDrawerContext';

function ManagerNavigator() {
  const { open, openDrawer, closeDrawer } = useManagerDrawer();

  return (
    <Drawer
      open={open}
      onOpen={openDrawer}
      onClose={closeDrawer}
      drawerPosition="left"
      drawerType="front"
      drawerStyle={{ width: 300, backgroundColor: '#FFFFFF' }}
      renderDrawerContent={() => <ManagerSidebar onClose={closeDrawer} onNavigate={closeDrawer} />}
    >
      <RoleNavigation role="manager">
        <Stack screenOptions={{ headerTintColor: colors.primary, headerBackTitle: 'Back' }}>
          <Stack.Screen name="manager/dashboard" options={{ headerShown: false }} />
          <Stack.Screen
            name="manager/inventory"
            options={{ title: 'Inventory', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen
            name="manager/returns/index"
            options={{ title: 'Stock Returns', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen name="manager/returns/create" options={{ title: 'Create Return' }} />
          <Stack.Screen name="manager/returns/[id]" options={{ title: 'Return Details' }} />
          <Stack.Screen
            name="manager/incoming/index"
            options={{ title: 'Incoming Transfers', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen name="manager/incoming/[id]" options={{ title: 'Receive Stock' }} />
          <Stack.Screen
            name="manager/movements"
            options={{ title: 'Inventory History', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen
            name="manager/products"
            options={{ title: 'Products', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen
            name="manager/sales/index"
            options={{ title: 'Sales History', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen name="manager/sales/[id]" options={{ title: 'Sale Details' }} />
          <Stack.Screen
            name="manager/shifts/index"
            options={{ title: 'Shift History', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen name="manager/shifts/[id]" options={{ title: 'Shift Details' }} />
          <Stack.Screen
            name="manager/reports/product-sales"
            options={{ title: 'Product Sales', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen
            name="manager/profile"
            options={{ title: 'Account', headerLeft: () => <HamburgerButton /> }}
          />
          <Stack.Screen
            name="manager/change-password"
            options={{ title: 'Change Password', headerLeft: () => <HamburgerButton /> }}
          />
        </Stack>
      </RoleNavigation>
    </Drawer>
  );
}

export default function ManagerLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) return <LoadingState label="Loading…" />;

  return (
    <RoleGuard role="manager">
      <ManagerDrawerProvider>
        <ManagerNavigator />
      </ManagerDrawerProvider>
    </RoleGuard>
  );
}
