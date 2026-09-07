import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState, EmptyState } from '@/components/Feedback';
import { useAuth } from '@/features/auth/AuthProvider';
import { useActiveShift } from '@/hooks/useShifts';
import { listShiftSales } from '@/services/saleService';
import { formatDate, formatMoney } from '@/lib/format';
import { AppButton } from '@/components/AppButton';
import { router } from 'expo-router';

export default function CurrentShiftSales() {
  const { profile } = useAuth();
  const shift = useActiveShift(profile?.id ?? '');
  const sales = useQuery({ queryKey: ['shift-sales', shift.data?.id], queryFn: () => listShiftSales(shift.data!.id), enabled: !!shift.data });
  if (shift.isLoading) return <LoadingState />;
  if (shift.error) return <ErrorState message="Unable to load shift." onRetry={() => void shift.refetch()} />;
  if (!shift.data) return <Redirect href="/cashier/dashboard" />;
  return <Screen><PageHeader title="Current Shift Sales" subtitle="Completed orders for your active shift." />
    {sales.isLoading ? <LoadingState /> : null}
    {sales.error ? <ErrorState message="Unable to load sales." onRetry={() => void sales.refetch()} /> : null}
    {sales.data?.length === 0 ? <EmptyState title="No sales yet" message="Confirmed orders will appear here." /> : null}
    {sales.data?.map((sale) => <View key={sale.id} style={{ padding: 16, backgroundColor: 'white', borderRadius: 12, gap: 6 }}>
      <Text style={{ fontWeight: '800' }}>{sale.sale_number}</Text><Text>{formatDate(sale.sold_at)}</Text><Text>{formatMoney(sale.total_amount)}</Text>
      <AppButton variant="secondary" label="View details" onPress={() => router.push(`/cashier/sales/${sale.id}` as any)} />
    </View>)}
  </Screen>;
}
