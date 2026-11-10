import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { useAuth } from '@/features/auth/AuthProvider';
import { listCorrections } from '@/services/stockCorrectionService';
import { getErrorMessage } from '@/lib/errors';
import { stockUnit } from '@/lib/stockUnits';

export default function StockCorrectionsScreen() {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['stock-corrections', profile?.id, page], queryFn: () => listCorrections(page * 50), enabled: !!profile, staleTime: 0 });
  return <Screen backgroundColor="#FFFFFF" constrain>
    <ManagerScreenHeader title="Stock corrections" showBack />
    <Text>Verified counts entered by cashiers. These adjustments are included in remittance.</Text>
    {query.isPending ? <Text>Loading corrections…</Text> : query.error ? <Text accessibilityRole="alert">{getErrorMessage(query.error)}</Text> : !query.data?.length ? <Text>No corrections on this page.</Text> : null}
    {(query.data ?? []).map(row => <View key={row.id} style={{ padding: 16, gap: 8, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10 }}>
      <Text style={{ fontWeight: '700' }}>{row.product_name} · {row.branch_name}</Text>
      <Text>{row.details.before} → {row.details.after} {stockUnit(row.stock_unit_code)?.plural ?? 'pcs'} (change: {row.details.after - row.details.before})</Text>
      <Text>{row.details.reason}</Text>
      <Text>{row.cashier_name} · {new Date(row.created_at).toLocaleString()}</Text>
    </View>)}
    <ManagerActionButton label="Refresh" variant="secondary" onPress={() => void query.refetch()} />
    <ManagerActionButton label="Previous page" variant="secondary" disabled={page === 0 || query.isFetching} onPress={() => setPage(page - 1)} />
    <ManagerActionButton label="Next page" variant="secondary" disabled={query.data?.length !== 50 || query.isFetching} onPress={() => setPage(page + 1)} />
  </Screen>;
}
