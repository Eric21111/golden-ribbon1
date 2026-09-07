import { router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { DashboardCard } from '@/components/DashboardCard';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SignOutButton } from '@/components/SignOutButton';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useActiveShift, useEndShift, useStartShift } from '@/hooks/useShifts';
import { getShiftErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { useCartStore } from '@/stores/cartStore';
import { confirmAction } from '@/lib/confirmAction';

export default function CashierDashboard() {
  const { profile } = useAuth();
  const cashierId = profile?.id ?? '';
  const shiftQuery = useActiveShift(cashierId);
  const startMutation = useStartShift(cashierId);
  const endMutation = useEndShift(cashierId);
  const cartItems = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);

  const startShift = () => startMutation.mutate(undefined, {
    onSuccess: () => router.replace('/cashier/pos'),
  });

  const requestEndShift = () => {
    const shiftId = shiftQuery.data?.id;
    if (!shiftId) return;
    if (cartItems.length > 0) {
      Alert.alert('Unfinished cart', 'Remove every item from the cart before ending the shift.');
      return;
    }
    confirmAction('End shift?', 'The end time will be recorded and this shift cannot be reopened.',
      () => endMutation.mutate(shiftId, {
          onSuccess: (summary) => {
            clearCart();
            Alert.alert(
              'Shift Ended',
              `Completed Orders: ${summary.completed_transaction_count}\nTotal Sales: ${formatMoney(summary.total_sales)}`,
              [
                { text: 'OK' },
                {
                  text: 'View Details',
                  onPress: () => router.push(`/cashier/shifts/${summary.id}` as any),
                },
              ]
            );
          },
        }));
  };

  if (shiftQuery.isLoading) return <LoadingState label="Checking active shift…" />;

  return (
    <Screen>
      <PageHeader title={`Hello, ${profile?.full_name ?? 'Cashier'}`} subtitle={profile?.branch?.name ?? 'Assigned branch unavailable'} />
      <Text style={styles.role}>CASHIER</Text>
      {shiftQuery.error ? <ErrorState message={getShiftErrorMessage(shiftQuery.error)} onRetry={() => void shiftQuery.refetch()} /> : null}

      {!shiftQuery.error && !shiftQuery.data ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>No Active Shift</Text>
          <Text style={styles.noticeText}>Start a shift before opening the POS.</Text>
          {startMutation.error ? <Text style={styles.error}>{getShiftErrorMessage(startMutation.error)}</Text> : null}
          <AppButton label="START SHIFT" loading={startMutation.isPending} onPress={startShift} />
        </View>
      ) : null}

      {shiftQuery.data ? (
        <View style={styles.shiftCard}>
          <View style={styles.statusRow}>
            <Text style={styles.shiftTitle}>Active Shift</Text>
            <Text style={styles.openBadge}>OPEN</Text>
          </View>
          <Text style={styles.detail}>Cashier: {profile?.full_name}</Text>
          <Text style={styles.detail}>Branch: {profile?.branch?.name}</Text>
          <Text style={styles.detail}>Started: {formatDate(shiftQuery.data.started_at)}</Text>
          {cartItems.length > 0 ? <Text style={styles.warning}>The cart has {cartItems.length} unfinished product{cartItems.length === 1 ? '' : 's'}.</Text> : null}
          {endMutation.error ? <Text style={styles.error}>{getShiftErrorMessage(endMutation.error)}</Text> : null}
          <AppButton label="OPEN POS" onPress={() => router.push('/cashier/pos')} />
          <AppButton label="CURRENT SHIFT SALES" variant="secondary" onPress={() => router.push('/cashier/sales')} />
          <AppButton label="END SHIFT" variant="danger" loading={endMutation.isPending} onPress={requestEndShift} />
        </View>
      ) : null}

      <DashboardCard title="Shift History" description="Review your past shift sessions and sales" onPress={() => router.push('/cashier/shifts' as any)} />
      <DashboardCard title="Profile" description="View your account and assigned branch" onPress={() => router.push('/cashier/profile')} />
      <SignOutButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  role: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  notice: { backgroundColor: colors.warningSurface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  noticeTitle: { color: '#92400E', fontSize: 21, fontWeight: '900' },
  noticeText: { color: '#78350F', fontSize: 15, lineHeight: 22 },
  shiftCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  shiftTitle: { color: colors.text, fontSize: 21, fontWeight: '900' },
  openBadge: { color: colors.success, backgroundColor: '#DCFCE7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '900' },
  detail: { color: colors.text, fontSize: 14, lineHeight: 21 },
  warning: { color: '#92400E', backgroundColor: colors.warningSurface, padding: spacing.sm, borderRadius: radius.sm, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
