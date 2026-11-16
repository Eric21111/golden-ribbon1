import Ionicons from '@react-native-vector-icons/ionicons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const PAGE_SIZE = 50;

export default function VoidLogsScreen() {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['void-logs', profile?.id, profile?.branch_id, profile?.role, page],
    enabled: !!profile,
    queryFn: async () => {
      const result = await supabase.rpc('list_sale_void_logs', { p_offset: page * PAGE_SIZE });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  useFocusEffect(
    useCallback(() => {
      if (profile) void refetch();
    }, [profile, refetch]),
  );

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  const centered = !isPending && !error && pageRows.length === 0;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader title="Void logs" showBack />
      <ConstrainedWidth fill={centered} style={[styles.column, centered && styles.centered]}>
        {error ? <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} /> : null}
        {isPending ? <LoadingState label="Loading void logs…" /> : null}
        {!isPending && !error && pageRows.length === 0 ? (
          <EmptyState title="No voids" message="There are no voided items on this page." />
        ) : null}

        {pageRows.map((row) => {
          const reason = [row.reason, row.note].filter(Boolean).join(' · ') || 'No reason recorded';
          return (
            <View key={row.event_id} style={styles.card}>
              <View style={styles.top}>
                <View style={styles.iconChip}>
                  <Ionicons name="close-circle-outline" size={18} color={managerColors.royalBlue} />
                </View>
                <View style={styles.titleCol}>
                  <Text style={styles.product} numberOfLines={2}>
                    {row.product_name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {row.sale_number}
                  </Text>
                </View>
                <ManagerBadge label={`${row.quantity} voided`} tone="danger" />
              </View>

              <Text style={styles.amount}>{formatMoney(row.amount)} deducted</Text>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="storefront-outline" size={13} color={managerColors.subtext} />
                  <Text style={styles.metaItemText} numberOfLines={1}>
                    {row.branch_name}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="person-circle-outline" size={13} color={managerColors.subtext} />
                  <Text style={styles.metaItemText} numberOfLines={1}>
                    {row.cashier_name}
                  </Text>
                </View>
              </View>

              <View style={styles.bottom}>
                <View style={styles.reasonPill}>
                  <Text style={styles.reasonText} numberOfLines={2}>
                    {reason}
                  </Text>
                </View>
                <Text style={styles.time}>{formatDate(row.recorded_at)}</Text>
              </View>
            </View>
          );
        })}

        <Pagination
          page={page}
          totalPages={page + (hasMore ? 2 : 1)}
          visible={page > 0 || hasMore}
          onPageChange={setPage}
        />
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  centered: { flexGrow: 1, justifyContent: 'center', paddingBottom: 64 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3EBFA',
  },
  titleCol: { flex: 1, minWidth: 0, gap: 1 },
  product: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 20 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  amount: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  metaItemText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, flexShrink: 1 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reasonPill: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EAF0FB',
  },
  reasonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  time: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12, flexShrink: 0 },
});
