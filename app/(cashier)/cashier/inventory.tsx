import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { stockUnit } from '@/lib/stockUnits';
import { BranchStockActions, type StockRow } from '@/features/pos/BranchStockActions';
import { useActiveShift } from '@/hooks/useShifts';
import { listCashierDayStock, listCashierProductCategories } from '@/services/inventoryService';

export default function BranchStock() {
  const { profile } = useAuth();
  const shift = useActiveShift(profile?.id ?? '');
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [category, setCategory] = useState('all');
  const categories = useQuery({ queryKey: ['cashier-product-categories', profile?.id], queryFn: listCashierProductCategories, enabled: !!profile });
  const [search, setSearch] = useState('');
  const { data, error, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['cashier-day-stock', profile?.id, profile?.branch_id],
    queryFn: listCashierDayStock,
    enabled: !!profile?.branch_id,
  });
  useFocusEffect(useCallback(() => { if (profile?.branch_id) void refetch(); }, [refetch, profile?.branch_id]));
  const rows = data?.filter(row => (category === 'all' || categories.data?.get(row.product_id) === category) && row.product_name.toLowerCase().includes(search.trim().toLowerCase()));
  return <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
    <ManagerScreenHeader title="Branch inventory" showBack />
    <ManagerActionButton variant="secondary" label="Void logs" onPress={() => router.push('/cashier/stock-corrections')} />
    <ManagerActionButton label="Record local purchase" onPress={() => router.push('/cashier/local-purchase')} />
    <TextInput placeholder="Search stock" accessibilityLabel="Search stock" value={search} onChangeText={setSearch} style={{padding: 12}} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {['all', ...new Set((data ?? []).map(item => categories.data?.get(item.product_id)).filter((name): name is NonNullable<typeof name> => !!name))].map(name =>
        <Pressable key={name} accessibilityRole="button" accessibilityState={{selected: category === name}} onPress={() => setCategory(name)} style={{padding: 9, backgroundColor: category === name ? '#EADCF7' : '#F5F5F5', borderRadius: 10}}>
          <Text>{name[0].toUpperCase() + name.slice(1)}</Text>
        </Pressable>)}
    </View>
    {profile && <BranchStockActions key={profile.id} row={selected} userId={profile.id} shiftId={shift.data?.status === 'open' ? shift.data.id : undefined} onClose={() => setSelected(null)} />}
    {error ? <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} /> :
      isLoading ? <LoadingState label="Loading stock…" /> : rows?.length ? rows.map(row =>
        <Pressable accessibilityRole="button" accessibilityLabel={row.product_name + ", view stock actions"} onPress={() => setSelected(row)} key={row.product_id} style={{paddingVertical: 10}}>
          <Text style={{fontWeight: '600'}}>{row.product_name}  {'\u203a'}</Text>
          <Text>Available {row.available} {stockUnit(row.stock_unit_code)?.plural ?? 'pcs'}</Text>
          <Text>On hand {row.on_hand} · Held for return {row.awaiting_return}</Text>
        </Pressable>) : <EmptyState title={search ? 'No matching stock' : 'No stock recorded'} message={search ? 'Try another name.' : 'This branch has no stock recorded yet.'} />}
  </Screen>;
}
