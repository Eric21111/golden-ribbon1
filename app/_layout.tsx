import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { queryClient } from '@/lib/queryClient';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerTintColor: colors.primary }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(owner)" options={{ headerShown: false }} />
              <Stack.Screen name="(manager)" options={{ headerShown: false }} />
              <Stack.Screen name="(cashier)" options={{ headerShown: false }} />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
