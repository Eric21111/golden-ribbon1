import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';

import { Screen } from '@/components/Screen';
import { RoleNavigation } from '@/components/RoleNavigation';
import { ManagerSidebar } from '@/components/dashboard/ManagerSidebar';
import { LoadingState } from '@/components/dashboard/ManagerFeedback';
import { RoleGuard } from '@/features/auth/RoleGuard';
import { ManagerDrawerProvider, useManagerDrawer } from '@/features/navigation/ManagerDrawerContext';

function OwnerStack() {
  return (
    <RoleNavigation role="owner">
      <Stack screenOptions={{ headerShown: false, animation: 'default', contentStyle: { backgroundColor: '#FFFFFF' } }}>
        <Stack.Screen name="owner/dashboard" />
        <Stack.Screen name="owner/reports/index" />
        <Stack.Screen name="owner/reports/sales-by-branch" />
        <Stack.Screen name="owner/reports/product-sales" />
        <Stack.Screen name="owner/reports/branch-performance/index" />
        <Stack.Screen name="owner/reports/branch-performance/[id]" />
        <Stack.Screen name="owner/reports/discrepancies" />
        <Stack.Screen name="owner/reports/transfer-discrepancies" />
        <Stack.Screen name="owner/reports/return-discrepancies" />
        <Stack.Screen name="owner/reports/inventory-reconciliation" />
        <Stack.Screen name="owner/inventory-by-branch" />
        <Stack.Screen name="owner/employees/index" />
        <Stack.Screen name="owner/data-archive" />
        <Stack.Screen name="owner/profile" />
        <Stack.Screen name="owner/change-password" />
      </Stack>
    </RoleNavigation>
  );
}

function OwnerNavigator() {
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
      renderDrawerContent={() => <ManagerSidebar role="owner" onClose={closeDrawer} onNavigate={closeDrawer} />}
    >
      <OwnerStack />
    </Drawer>
  );
}

export default function OwnerLayout() {
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

  return (
    <RoleGuard role="owner">
      <ManagerDrawerProvider>
        <OwnerNavigator />
      </ManagerDrawerProvider>
    </RoleGuard>
  );
}
