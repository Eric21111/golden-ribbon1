import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ErrorState, LoadingState, EmptyState } from '@/components/dashboard/ManagerFeedback';
import { Pagination } from '@/components/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';

export default function VoidLogsScreen() {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const {data, error, isPending, refetch} = useQuery({
    queryKey: ['void-logs', profile?.id, profile?.branch_id, profile?.role, page],
    enabled: !!profile,
    queryFn: async () => {
      const result = await supabase.rpc('list_sale_void_logs', {p_offset: page * 50});
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  useFocusEffect(useCallback(() => { if (profile) void refetch(); }, [profile, refetch]));
  return <Screen><ManagerScreenHeader title="Void logs" showBack />
    {error ? <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} /> :
      isPending ? <LoadingState label="Loading void logs…" /> :
      !data?.length ? <EmptyState title="No voids" message="There are no voided items on this page." /> :
      data.slice(0,50).map(row => <View key={row.event_id} style={{paddingVertical: 12, gap: 4}}>
        <Text style={{fontWeight: '700'}}>{row.product_name} × {row.quantity}</Text>
        <Text>{row.sale_number} · {formatMoney(row.amount)} deducted</Text>
        <Text>{row.branch_name} · {row.cashier_name}</Text>
        <Text>{new Date(row.recorded_at).toLocaleString('en-PH', {timeZone:'Asia/Manila'})}</Text>
        <Text>{[row.reason,row.note].filter(Boolean).join(' · ')}</Text>
      </View>)}
    <Pagination page={page} totalPages={page + ((data?.length ?? 0)>50 ? 2 : 1)} onPageChange={setPage} visible={page>0 || (data?.length ?? 0)>50}/>
  </Screen>;
}
