import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Redirect, Stack } from 'expo-router';

import { LoadingState } from '@/components/Feedback';
import { useAuth } from '@/features/auth/AuthProvider';
import { roleHome } from '@/features/auth/roleRoutes';

export default function AuthLayout() {
  const { session, profile, isLoading } = useAuth();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (isLoading || !fontsLoaded) return <LoadingState label="Checking session…" />;
  if (session && profile) return <Redirect href={roleHome[profile.role]} />;
  if (session) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
