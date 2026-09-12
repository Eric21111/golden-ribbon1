import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { masterDetailStyles } from '@/components/MasterDetailLayout';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { getReturn } from '@/services/returnService';

import { returnStyles } from './returnStyles';
import { ReturnStatusBadge } from './ReturnStatusBadge';

type ReturnDetailsBodyProps = {
  returnId: string;
};

export function ReturnDetailsBody({ returnId }: ReturnDetailsBodyProps) {
  const { profile } = useAuth();
  const canReceiveReturns = isMainBranchManager(profile);

  const query = useQuery({
    queryKey: ['stock-returns', profile?.id, returnId],
    queryFn: () => getReturn(returnId),
    enabled: Boolean(returnId),
  });

  if (query.isLoading) return <LoadingState label="Loading return details…" />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        message={getErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const row = query.data;
  const canReceive = row.status === 'in_transit' && canReceiveReturns;

  return (
    <View style={returnStyles.detailsBody}>
      <View style={returnStyles.headerRow}>
        <View style={returnStyles.detailsHeaderCopy}>
          <PageHeader
            title={row.return_number}
            subtitle={`${row.from_branch_name} → ${row.to_branch_name}`}
          />
        </View>
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

        {row.received_by_name ? (
          <View style={returnStyles.auditRow}>
            <Text style={returnStyles.auditLabel}>Received by:</Text>
            <Text style={returnStyles.auditValue}>{row.received_by_name}</Text>
          </View>
        ) : null}
        {row.received_at ? (
          <View style={returnStyles.auditRow}>
            <Text style={returnStyles.auditLabel}>Received at:</Text>
            <Text style={returnStyles.auditValue}>{formatDate(row.received_at)}</Text>
          </View>
        ) : null}

        {row.notes ? (
          <View style={returnStyles.auditRow}>
            <Text style={returnStyles.auditLabel}>Notes:</Text>
            <Text style={returnStyles.auditValue}>{row.notes}</Text>
          </View>
        ) : null}
      </View>

      {canReceive ? (
        <AppButton
          label="Count & receive return"
          onPress={() =>
            router.push({ pathname: '/manager/returns/receive/[id]', params: { id: row.id } })
          }
        />
      ) : null}

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

            {diff !== null ? (
              <Text style={diff === 0 ? returnStyles.complete : returnStyles.warning}>
                {diff === 0
                  ? 'Exact match'
                  : diff > 0
                    ? `${diff} missing`
                    : `${Math.abs(diff)} excess`}
              </Text>
            ) : null}
          </View>
        );
      })}

      {row.discrepancies && row.discrepancies.length > 0 ? (
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
      ) : null}
    </View>
  );
}

export function ReturnDetailPane({ returnId }: { returnId: string }) {
  return (
    <ScrollView
      style={masterDetailStyles.detailScroll}
      contentContainerStyle={masterDetailStyles.detailContent}
      keyboardShouldPersistTaps="handled"
    >
      <ReturnDetailsBody returnId={returnId} />
    </ScrollView>
  );
}

export function ReturnDetailEmpty() {
  return (
    <View style={masterDetailStyles.detailEmpty}>
      <EmptyState
        title="Select a return"
        message="Choose a return from the list to view details."
      />
    </View>
  );
}
