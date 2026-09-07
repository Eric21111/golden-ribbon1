import { Redirect, Stack } from 'expo-router';

import { LoadingState } from '@/components/Feedback';
import { useAuth } from '@/features/auth/AuthProvider';
import { roleHome } from '@/features/auth/roleRoutes';

export default function AuthLayout() {
  const { session, profile, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Checking session…" />;
  if (session && profile) return <Redirect href={roleHome[profile.role]} />;
  if (session) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
