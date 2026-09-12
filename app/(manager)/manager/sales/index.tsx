import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { saleStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { useSales } from '@/hooks/useSales';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { PAGE_SIZE, PAGINATION_MIN_ITEMS, totalPagesFor } from '@/lib/pagination';

export default function ManagerSalesHistoryScreen() {
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const [dateFilter, setDateFilter] = useState('');

  const salesQuery = useSales({ date: dateFilter || undefined }, page, PAGE_SIZE);
  const sales = salesQuery.data?.items ?? [];
  const total = salesQuery.data?.total ?? 0;
  const totalPages = totalPagesFor(total, PAGE_SIZE);
  const showPagination = total >= PAGINATION_MIN_ITEMS;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Sales History" subtitle={`${profile?.branch?.name ?? 'Branch'} sales history`} />

      <ConstrainedWidth style={styles.column}>
        <View style={styles.filters}>
          <SearchInput
            value={dateFilter}
            onChangeText={(value) => {
              setDateFilter(value.trim());
              setPage(0);
            }}
            placeholder="Filter by date (YYYY-MM-DD)"
          />
        </View>

        {salesQuery.error ? (
          <ErrorState message={getErrorMessage(salesQuery.error)} onRetry={() => void salesQuery.refetch()} />
        ) : salesQuery.isLoading && !salesQuery.data ? (
          <LoadingState label="Loading sales history…" />
        ) : (
          <FlatList
            data={sales}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={salesQuery.isRefetching}
                onRefresh={() => void salesQuery.refetch()}
                tintColor={managerColors.royalBlue}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <EmptyState title="No sales found" message="No matching sales records for this selection." />
            }
            ListFooterComponent={
              showPagination ? (
                <View style={styles.pager}>
                  <Pagination
                    page={Math.min(page, totalPages - 1)}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    visible={!salesQuery.isLoading}
                    labelStyle={styles.pagerLabel}
                  />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <ListRowCard
                icon="receipt-outline"
                iconColor="gold"
                title={item.sale_number}
                subtitle={`${item.cashier?.full_name ?? 'Cashier'} · ${formatDate(item.sold_at)}`}
                meta={formatMoney(item.total_amount)}
                trailing={
                  <ManagerBadge
                    label={item.status === 'completed' ? 'Completed' : 'Voided'}
                    tone={saleStatusTone(item.status)}
                  />
                }
                onPress={() => router.push({ pathname: '/manager/sales/[id]', params: { id: item.id } })}
              />
            )}
          />
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  filters: { marginBottom: 14 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  separator: { height: 10 },
  pager: { paddingTop: 12 },
  pagerLabel: { fontFamily: 'Inter_600SemiBold' },
});
