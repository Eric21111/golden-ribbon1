import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { SaleListItem } from '@/features/pos/SaleListItem';
import { SaleDetailsBody } from '@/features/sales/SalesScreens';
import { useActiveShift } from '@/hooks/useShifts';
import { getShiftErrorMessage } from '@/lib/errors';
import { useLayout } from '@/lib/layout';
import { listShiftSales } from '@/services/saleService';

export default function CurrentShiftSales() {
  const { profile } = useAuth();
  const { isTablet, salesMasterWidth } = useLayout();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shift = useActiveShift(profile?.id ?? '');
  const sales = useQuery({
    queryKey: ['shift-sales', shift.data?.id],
    queryFn: () => listShiftSales(shift.data!.id),
    enabled: Boolean(shift.data),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sales.data ?? [];
    return (sales.data ?? []).filter((sale) =>
      sale.sale_number.toLowerCase().includes(term),
    );
  }, [sales.data, search]);

  useEffect(() => {
    if (!isTablet) return;
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((sale) => sale.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, isTablet, selectedId]);

  if (shift.isLoading) return <LoadingState label="Checking active shift…" />;
  if (shift.error) {
    return (
      <Screen>
        <ErrorState
          message={getShiftErrorMessage(shift.error)}
          onRetry={() => void shift.refetch()}
        />
      </Screen>
    );
  }
  if (!shift.data) return <Redirect href="/cashier/dashboard" />;

  const refreshing = sales.isRefetching || shift.isRefetching;
  const onRefresh = () => {
    void Promise.all([sales.refetch(), shift.refetch()]);
  };

  const listHeader = (
    <View style={styles.top}>
      <PageHeader
        title="Current Shift Sales"
        subtitle="Completed orders for your active shift."
      />
      <TextInput
        accessibilityLabel="Search sales by sale number"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={setSearch}
        placeholder="Search sale #"
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={search}
      />
    </View>
  );

  const saleList = (
    <FlatList
      data={filtered}
      keyExtractor={(item) => item.id}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        <EmptyState
          title={search.trim() ? 'No matching sales' : 'No sales yet'}
          message={
            search.trim()
              ? 'Try another sale number.'
              : 'Confirmed orders will appear here.'
          }
        />
      }
      renderItem={({ item }) => (
        <SaleListItem
          sale={item}
          selected={isTablet && item.id === selectedId}
          onPress={() => {
            if (isTablet) {
              setSelectedId(item.id);
              return;
            }
            router.push(`/cashier/sales/${item.id}` as never);
          }}
        />
      )}
    />
  );

  return (
    <Screen scroll={false} contentContainerStyle={styles.screen}>
      {isTablet ? (
        <View style={styles.split}>
          <View style={[styles.master, { width: salesMasterWidth }]}>
            {listHeader}
            {sales.isLoading && !sales.data ? (
              <LoadingState label="Loading shift sales…" />
            ) : null}
            {sales.error ? (
              <ErrorState
                message="Unable to load sales."
                onRetry={() => void sales.refetch()}
              />
            ) : null}
            {!sales.error && (sales.data || !sales.isLoading) ? saleList : null}
          </View>
          <View style={styles.detail}>
            {selectedId ? (
              <ScrollView
                style={styles.detailScroll}
                contentContainerStyle={styles.detailContent}
                keyboardShouldPersistTaps="handled"
              >
                <SaleDetailsBody saleId={selectedId} />
              </ScrollView>
            ) : (
              <View style={styles.detailEmpty}>
                <EmptyState
                  title="Select a sale"
                  message="Choose a sale from the list to view details."
                />
              </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.layout}>
          {listHeader}
          {sales.isLoading && !sales.data ? (
            <LoadingState label="Loading shift sales…" />
          ) : null}
          {sales.error ? (
            <ErrorState
              message="Unable to load sales."
              onRetry={() => void sales.refetch()}
            />
          ) : null}
          {!sales.error && (sales.data || !sales.isLoading) ? saleList : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  split: { flex: 1, minHeight: 0, flexDirection: 'row' },
  master: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 280,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors.background,
  },
  detailScroll: { flex: 1 },
  detailContent: { padding: spacing.md, flexGrow: 1 },
  detailEmpty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  top: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  list: { flex: 1, minHeight: 0 },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexGrow: 1,
  },
  separator: { height: spacing.sm },
});
