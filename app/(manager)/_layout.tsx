import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';

import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { ManagerSidebar } from '@/components/dashboard/ManagerSidebar';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { RoleNavigation } from '@/components/RoleNavigation';
import { useAuth } from '@/features/auth/AuthProvider';
import { RoleGuard } from '@/features/auth/RoleGuard';
import { isMainBranchManager, isSellingBranchManager } from '@/features/auth/roles';
import { ManagerDrawerProvider, useManagerDrawer } from '@/features/navigation/ManagerDrawerContext';

function SellingManagerLocked() {
  return (
    <Screen backgroundColor="#FFFFFF" scroll={false} contentContainerStyle={{ flexGrow: 1, padding: 0, gap: 0 }}>
      <ManagerScreenHeader title="Manager access updated" />
      <ErrorState message="Selling-branch manager accounts are no longer used. Ask the Owner to reassign this account as a Cashier or to the Main Branch Manager." />
      <SignOutButton />
    </Screen>
  );
}

function ManagerStack() {
  return (
    <RoleNavigation role="manager">
      <Stack screenOptions={{ headerShown: false, animation: 'default', contentStyle: { backgroundColor: '#FFFFFF' } }}>
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
        <Stack.Screen name="manager/products/index" />
        <Stack.Screen name="manager/products/[id]" />
        <Stack.Screen name="manager/catalog" />
        <Stack.Screen name="manager/branches/index" />
        <Stack.Screen name="manager/branches/[id]" />
        <Stack.Screen name="manager/reports/product-sales" />
        <Stack.Screen name="manager/profile" />
        <Stack.Screen name="manager/change-password" />
      </Stack>
    </RoleNavigation>
  );
}

function ManagerNavigator() {
  const { profile } = useAuth();
  const { open, openDrawer, closeDrawer } = useManagerDrawer();

  if (isSellingBranchManager(profile)) {
    return <SellingManagerLocked />;
  }

  if (!isMainBranchManager(profile)) {
    return <ManagerStack />;
  }

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
      <ManagerStack />
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

  if (!fontsLoaded) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <LoadingState label="Loading…" />
      </Screen>
    );
  }

  return (
    <RoleGuard role="manager">
      <ManagerDrawerProvider>
        <ManagerNavigator />
      </ManagerDrawerProvider>
    </RoleGuard>
  );
}
