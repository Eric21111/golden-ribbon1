import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { getReturn, listReturns } from '@/services/returnService';
import { ReturnStatusBadge } from './ReturnStatusBadge';

export const returnStyles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  discrepancyCard: {
    borderColor: '#FCA5A5',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  text: {
    color: colors.text,
    fontSize: 15,
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  auditLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  auditValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  warning: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '800',
  },
  complete: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});

export function ReturnHistory({ role }: { role: 'owner' | 'manager' }) {
  const { profile } = useAuth();
  const isMainBranch = Boolean(profile?.branch?.is_main_branch);

  const query = useInfiniteQuery({
    queryKey: ['stock-returns', 'history', profile?.id, profile?.branch_id],
    queryFn: ({ pageParam }) => listReturns({}, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === 50 ? pages.length : undefined),
  });

  const rows = query.data?.pages.flat();

  return (
    <Screen>
      <PageHeader
        title="Stock returns"
        subtitle={
          role === 'owner'
            ? 'Returns from selling branches to Main Branch.'
            : isMainBranch
            ? 'Returns arriving at Main Branch for verification and receipt.'
            : 'Unsold stock returned to Main Branch.'
        }
      />

      {role === 'manager' && !isMainBranch && (
        <AppButton label="Create return" onPress={() => router.push('/manager/returns/create')} />
      )}

      {role === 'owner' && (
        <AppButton
          label="View return discrepancies"
          variant="secondary"
          onPress={() => router.push('/owner/returns/discrepancies')}
        />
      )}

      {query.isLoading && <LoadingState label="Loading stock returns…" />}
      {query.error && (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      )}
      {rows?.length === 0 && (
        <EmptyState title="No returns yet" message="Confirmed stock returns will appear here." />
      )}

      {rows?.map((row) => {
        const canReceive =
          row.status === 'in_transit' &&
          (role === 'owner' || (isMainBranch && profile?.branch_id === row.to_branch_id));

        return (
          <View key={row.id} style={returnStyles.card}>
            <View style={returnStyles.headerRow}>
              <Text style={returnStyles.title}>{row.return_number}</Text>
              <ReturnStatusBadge status={row.status} />
            </View>
            <Text style={returnStyles.meta}>
              {row.from_branch_name} → {row.to_branch_name}
            </Text>
            <Text style={returnStyles.meta}>
              {formatDate(row.returned_at)} · {row.items[0]?.count ?? 0} products
            </Text>

            <View style={returnStyles.buttonRow}>
              <View style={{ flex: 1 }}>
                <AppButton
                  variant="secondary"
                  label="View details"
                  onPress={() =>
                    router.push(
                      role === 'owner'
                        ? { pathname: '/owner/returns/[id]', params: { id: row.id } }
                        : { pathname: '/manager/returns/[id]', params: { id: row.id } }
                    )
                  }
                />
              </View>
              {canReceive && (
                <View style={{ flex: 1 }}>
                  <AppButton
                    label="Receive"
                    onPress={() =>
                      router.push(
                        role === 'owner'
                          ? { pathname: '/owner/returns/receive/[id]', params: { id: row.id } }
                          : { pathname: '/manager/returns/receive/[id]', params: { id: row.id } }
                      )
                    }
                  />
                </View>
              )}
            </View>
          </View>
        );
      })}

      {query.hasNextPage && (
        <AppButton
          label="Load older returns"
          loading={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      )}
    </Screen>
  );
}

export function ReturnDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const isMainBranch = Boolean(profile?.branch?.is_main_branch);
  const isOwner = profile?.role === 'owner';

  const query = useQuery({
    queryKey: ['stock-returns', profile?.id, id],
    queryFn: () => getReturn(id),
    enabled: Boolean(id),
  });

  const row = query.data;

  const canReceive =
    row?.status === 'in_transit' &&
    (isOwner || (isMainBranch && profile?.branch_id === row.to_branch_id));

  return (
    <Screen>
      {query.isLoading && <LoadingState label="Loading return details…" />}
      {query.error && (
        <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      )}
      {row && (
        <>
          <View style={returnStyles.headerRow}>
            <PageHeader title={row.return_number} subtitle={`${row.from_branch_name} → ${row.to_branch_name}`} />
            <ReturnStatusBadge status={row.status} />
          </View>

          <View style={returnStyles.card}>
            <View style={returnStyles.auditRow}>
              <Text style={returnStyles.auditLabel}>From Branch:</Text>
              <Text style={returnStyles.auditValue}>{row.from_branch_name}</Text>
            </View>
            <View style={returnStyles.auditRow}>
              <Text style={returnStyles.auditLabel}>To Branch:</Text>
              <Text style={returnStyles.auditValue}>{row.to_branch_name}</Text>
            </View>
            <View style={returnStyles.auditRow}>
              <Text style={returnStyles.auditLabel}>Returned by:</Text>
              <Text style={returnStyles.auditValue}>{row.returned_by_name}</Text>
            </View>
            <View style={returnStyles.auditRow}>
              <Text style={returnStyles.auditLabel}>Returned at:</Text>
              <Text style={returnStyles.auditValue}>{formatDate(row.returned_at)}</Text>
            </View>

            {row.received_by_name && (
              <View style={returnStyles.auditRow}>
                <Text style={returnStyles.auditLabel}>Received by:</Text>
                <Text style={returnStyles.auditValue}>{row.received_by_name}</Text>
              </View>
            )}
            {row.received_at && (
              <View style={returnStyles.auditRow}>
                <Text style={returnStyles.auditLabel}>Received at:</Text>
                <Text style={returnStyles.auditValue}>{formatDate(row.received_at)}</Text>
              </View>
            )}

            {row.notes ? (
              <View style={returnStyles.auditRow}>
                <Text style={returnStyles.auditLabel}>Notes:</Text>
                <Text style={returnStyles.auditValue}>{row.notes}</Text>
              </View>
            ) : null}
          </View>

          {canReceive && (
            <AppButton
              label="Count & receive return"
              onPress={() =>
                router.push(
                  isOwner
                    ? { pathname: '/owner/returns/receive/[id]', params: { id: row.id } }
                    : { pathname: '/manager/returns/receive/[id]', params: { id: row.id } }
                )
              }
            />
          )}

          <Text style={returnStyles.sectionTitle}>Returned Products</Text>
          {row.items.map((item) => {
            const isReceived = item.quantity_received !== null;
            const diff = isReceived ? item.quantity_returned - item.quantity_received! : null;

            return (
              <View key={item.id} style={returnStyles.card}>
                <Text style={returnStyles.title}>{item.product_name}</Text>
                <Text style={returnStyles.meta}>SKU: {item.product_sku}</Text>
                <View style={returnStyles.auditRow}>
                  <Text style={returnStyles.auditLabel}>Returned (expected):</Text>
                  <Text style={returnStyles.auditValue}>{item.quantity_returned}</Text>
                </View>
                <View style={returnStyles.auditRow}>
                  <Text style={returnStyles.auditLabel}>Actual received:</Text>
                  <Text style={returnStyles.auditValue}>
                    {isReceived ? item.quantity_received : 'Pending physical count'}
                  </Text>
                </View>

                {diff !== null && (
                  <Text style={diff === 0 ? returnStyles.complete : returnStyles.warning}>
                    {diff === 0
                      ? 'Exact match'
                      : diff > 0
                      ? `${diff} missing`
                      : `${Math.abs(diff)} excess`}
                  </Text>
                )}
              </View>
            );
          })}

          {row.discrepancies && row.discrepancies.length > 0 && (
            <>
              <Text style={returnStyles.sectionTitle}>Discrepancies</Text>
              {row.discrepancies.map((disc) => (
                <View key={disc.id} style={[returnStyles.card, returnStyles.discrepancyCard]}>
                  <Text style={returnStyles.title}>
                    {disc.product?.name ?? `Product (${disc.product_id})`}
                  </Text>
                  <Text style={returnStyles.warning}>
                    {disc.discrepancy_type === 'missing'
                      ? `${disc.difference} missing`
                      : `${Math.abs(disc.difference)} excess`}
                  </Text>
                  <Text style={returnStyles.meta}>
                    Returned: {disc.quantity_expected} · Received: {disc.quantity_received}
                  </Text>
                  {disc.notes ? <Text style={returnStyles.meta}>Notes: {disc.notes}</Text> : null}
                </View>
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
