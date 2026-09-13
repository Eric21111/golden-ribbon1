import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';

import { ManagerSidebar } from '@/components/dashboard/ManagerSidebar';
import { LoadingState } from '@/components/dashboard/ManagerFeedback';
import { RoleNavigation } from '@/components/RoleNavigation';
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
      drawerStyle={{
        width: 300,
        backgroundColor: '#FFFFFF',
        borderTopRightRadius: 24,
        borderBottomRightRadius: 24,
        overflow: 'hidden',
      }}
      renderDrawerContent={() => <ManagerSidebar onClose={closeDrawer} onNavigate={closeDrawer} />}
    >
      <RoleNavigation role="manager">
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="manager/dashboard" />
          <Stack.Screen name="manager/inventory/index" />
          <Stack.Screen name="manager/inventory/setup" />
          <Stack.Screen name="manager/returns/index" />
          <Stack.Screen name="manager/returns/create" />
          <Stack.Screen name="manager/returns/[id]" />
          <Stack.Screen name="manager/incoming/index" />
          <Stack.Screen name="manager/incoming/[id]" />
          <Stack.Screen name="manager/transfers/index" />
          <Stack.Screen name="manager/transfers/create" />
          <Stack.Screen name="manager/transfers/[id]" />
          <Stack.Screen name="manager/products" />
          <Stack.Screen name="manager/sales/index" />
          <Stack.Screen name="manager/sales/[id]" />
          <Stack.Screen name="manager/shifts/index" />
          <Stack.Screen name="manager/shifts/[id]" />
          <Stack.Screen name="manager/reports/product-sales" />
          <Stack.Screen name="manager/profile" />
          <Stack.Screen name="manager/change-password" />
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
