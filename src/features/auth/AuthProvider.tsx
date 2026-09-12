import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getMyProfile } from '@/services/profileService';
import { useCartStore } from '@/stores/cartStore';
import { useCheckoutStore } from '@/stores/checkoutStore';
import type { ProfileWithBranch } from '@/types/models';

interface AuthContextValue {
  session: Session | null;
  profile: ProfileWithBranch | null;
  isLoading: boolean;
  profileError: Error | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryProfile: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? '';

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setSessionLoading(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const profileQuery = useQuery({
    queryKey: queryKeys.profile(userId),
    queryFn: () => getMyProfile(userId),
    enabled: Boolean(userId) && isSupabaseConfigured,
    retry: 1,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const branchId = profileQuery.data?.branch_id ?? null;
  const role = profileQuery.data?.role;
  const isActive = profileQuery.data?.is_active;
  useEffect(() => {
    if (!userId) return;
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
    void queryClient.invalidateQueries({ queryKey: ['transfers'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-returns'] });
    void queryClient.invalidateQueries({ queryKey: ['return-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
  }, [userId, branchId, role, isActive, queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured. Add the values from .env.example.');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (useCheckoutStore.getState().request) throw new Error('Finish the sale confirmation before logging out.');
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    setSession(null);
    queryClient.clear();
    useCartStore.getState().clearCart();
    useCheckoutStore.getState().reset();
    if (error) throw error;
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile: profileQuery.data ?? null,
      isLoading: sessionLoading || (Boolean(session) && profileQuery.isLoading),
      profileError: profileQuery.error,
      signIn,
      signOut,
      retryProfile: profileQuery.refetch,
    }),
    [profileQuery.data, profileQuery.error, profileQuery.isLoading, profileQuery.refetch, session, sessionLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
