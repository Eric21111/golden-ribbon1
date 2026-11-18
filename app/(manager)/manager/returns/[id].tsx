import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import {
  DetailProductListSection,
  type DetailLineStatus,
} from '@/components/dashboard/DetailProductListSection';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { Screen } from '@/components/Screen';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { RouteBanner } from '@/components/dashboard/RouteBanner';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { returnStatusBadgeLabel, returnStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { useMarkNotificationsReviewed } from '@/hooks/useNotifications';
import { getErrorMessage } from '@/lib/errors';
import { formatDate, formatSnapshottedQuantity } from '@/lib/format';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import { listCashierProductCategories } from '@/services/inventoryService';
import { getReturn } from '@/services/returnService';

export default function ManagerReturnDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const returnId = typeof id === 'string' ? id : '';
  const { profile } = useAuth();

  const query = useQuery({
    queryKey: ['stock-returns', profile?.id, returnId],
    queryFn: () => getReturn(returnId),
    enabled: Boolean(returnId),
  });
  const categoriesQuery = useQuery({
    queryKey: ['cashier-product-categories'],
    queryFn: listCashierProductCategories,
    staleTime: 5 * 60 * 1000,
  });
  useMarkNotificationsReviewed('return_submitted', returnId, returnId && query.data ? query.dataUpdatedAt : 0);

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Return Details" showBack />
        <LoadingState label="Loading return details…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Return Details" showBack />
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const row = query.data;
  const canReceive = row.status === 'in_transit' && isMainBranchManager(profile);
  const notesByItemId = new Map(row.discrepancies?.map((disc) => [disc.stock_return_item_id, disc.notes]) ?? []);
  const discrepancyIdByItemId = new Map(
    row.discrepancies?.map((disc) => [disc.stock_return_item_id, disc.id]) ?? [],
  );
  const categories = categoriesQuery.data;
  const summaryRows = [
    { label: 'Returned by', value: row.returned_by_name, icon: 'person-outline' as const },
    { label: 'Returned at', value: formatDate(row.returned_at), icon: 'time-outline' as const },
    ...(row.received_by_name
      ? [{ label: 'Received by', value: row.received_by_name, icon: 'person-outline' as const }]
      : []),
    ...(row.received_at
      ? [{ label: 'Received', value: formatDate(row.received_at), icon: 'time-outline' as const }]
      : []),
    ...(row.notes ? [{ label: 'Notes', value: row.notes, icon: 'document-text-outline' as const }] : []),
  ];

  const lineItems = row.items.map((item) => {
    const isReceived = item.quantity_received !== null;
    const diff = isReceived ? item.quantity_returned - item.quantity_received! : null;
    const expectedLabel = formatSnapshottedQuantity(
      item.quantity_returned,
      item.inventory_mode,
      item.stock_unit_code,
    );
    const receivedLabel = isReceived
      ? formatSnapshottedQuantity(item.quantity_received, item.inventory_mode, item.stock_unit_code)
      : null;
    const lineStatus: DetailLineStatus =
      diff === null ? 'pending' : diff === 0 ? 'match' : diff > 0 ? 'missing' : 'excess';
    return {
      id: item.id,
      name: item.product_name,
      sku: item.product_sku,
      category: categories?.get(item.product_id) ?? null,
      lineStatus,
      diff,
      note: notesByItemId.get(item.id),
      discrepancyId: discrepancyIdByItemId.get(item.id),
      expectedLine: `Expected ${expectedLabel}`,
      receivedLine: receivedLabel ? `Received ${receivedLabel}` : 'Received Pending',
    };
  });

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      scroll={false}
      contentContainerStyle={styles.screenContent}
    >
      <ManagerScreenHeader
        title={row.return_number}
        subtitle={`${row.from_branch_name} → ${row.to_branch_name}`}
        badge={<ManagerBadge label={returnStatusBadgeLabel(row.status)} tone={returnStatusTone(row.status)} />}
        showBack
      />
      <ConstrainedWidth fill style={styles.body}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.column}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <RouteBanner
            from={{ label: row.from_branch_name, isMain: false }}
            to={{ label: row.to_branch_name, isMain: true }}
            connectorIcon="return-up-back"
          />
          <SummaryCard rows={summaryRows} />

          <DetailProductListSection
            title="RETURNED PRODUCTS"
            matchLabel="Exact"
            items={lineItems}
            renderItem={(item) => (
              <ListRowCard
                {...categoryRowProps(item.category)}
                title={item.name}
                subtitle={item.expectedLine}
                meta={[item.receivedLine, item.note ? `Note: ${item.note}` : null]
                  .filter(Boolean)
                  .join('\n')}
                trailing={
                  item.diff === null ? (
                    <ManagerBadge label="Pending" tone="neutral" size="md" />
                  ) : (
                    <ManagerBadge
                      label={
                        item.diff === 0
                          ? 'Exact'
                          : item.diff > 0
                            ? `${item.diff} missing`
                            : `${Math.abs(item.diff)} excess`
                      }
                      tone={item.diff === 0 ? 'success' : item.diff > 0 ? 'danger' : 'warning'}
                      size="md"
                    />
                  )
                }
                onPress={
                  item.discrepancyId
                    ? () => router.push(`/manager/discrepancies/return/${item.discrepancyId}` as never)
                    : undefined
                }
              />
            )}
          />
        </ScrollView>

        {canReceive ? (
          <View style={styles.footer}>
            <ManagerActionButton
              label="Count & receive return"
              icon="clipboard-outline"
              onPress={() =>
                router.push({ pathname: '/manager/returns/receive/[id]', params: { id: row.id } })
              }
            />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1, flexGrow: 1, padding: 0, gap: 0 },
  body: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  column: { padding: 20, gap: 12, paddingBottom: 24 },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
});
