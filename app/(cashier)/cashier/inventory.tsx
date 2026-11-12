import { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { stockUnit } from '@/lib/stockUnits';
import { listCashierDayStock } from '@/services/inventoryService';

export default function BranchStock() {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const { data, error, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['cashier-day-stock', profile?.id, profile?.branch_id],
    queryFn: listCashierDayStock,
    enabled: !!profile?.branch_id,
  });
  useFocusEffect(useCallback(() => { if (profile?.branch_id) void refetch(); }, [refetch, profile?.branch_id]));
  const rows = data?.filter(row => row.product_name.toLowerCase().includes(search.trim().toLowerCase()));
  return <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
    <ManagerScreenHeader title="Branch inventory" showBack />
    <ManagerActionButton label="Record local purchase" onPress={() => router.push('/cashier/local-purchase')} />
    <TextInput placeholder="Search stock" accessibilityLabel="Search stock" value={search} onChangeText={setSearch} style={{padding: 12}} />
    {error ? <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} /> :
      isLoading ? <LoadingState label="Loading stock…" /> : rows?.length ? rows.map(row =>
        <View key={row.product_id} style={{paddingVertical: 10}}>
          <Text style={{fontWeight: '600'}}>{row.product_name}</Text>
          <Text>Available {row.available} {stockUnit(row.stock_unit_code)?.plural ?? 'pcs'}</Text>
          <Text>On hand {row.on_hand} · Held for return {row.awaiting_return}</Text>
        </View>) : <EmptyState title={search ? 'No matching stock' : 'No stock recorded'} message={search ? 'Try another name.' : 'This branch has no stock recorded yet.'} />}
  </Screen>;
}
