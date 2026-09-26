import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FilterDropdown } from '@/components/FilterDropdown';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { getInventoryErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import {
  getReturnDiscrepancy,
  getTransferDiscrepancy,
  resolveReturnDiscrepancy,
  resolveTransferDiscrepancy,
  type DiscrepancyKind,
} from '@/services/discrepancyService';
import type { DiscrepancyResolutionReason } from '@/types/models';

const REASON_OPTIONS: Array<{ label: string; value: DiscrepancyResolutionReason | '' }> = [
  { label: 'Select a reason', value: '' },
  { label: 'Confirmed shortage', value: 'confirmed_shortage' },
  { label: 'Confirmed excess', value: 'confirmed_excess' },
  { label: 'Counting error', value: 'counting_error' },
  { label: 'Encoding error', value: 'encoding_error' },
  { label: 'Transfer handling issue', value: 'transfer_handling_issue' },
  { label: 'Return handling issue', value: 'return_handling_issue' },
  { label: 'Other', value: 'other' },
];

function reasonLabel(reason: string | null): string {
  return REASON_OPTIONS.find((option) => option.value === reason)?.label ?? reason ?? '—';
}

export function DiscrepancyDetailScreen({ kind, id }: { kind: DiscrepancyKind; id: string }) {
  const { profile } = useAuth();
  const canResolve = isMainBranchManager(profile);
  const client = useQueryClient();
  const [reason, setReason] = useState<DiscrepancyResolutionReason | ''>('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  const returnQuery = useQuery({
    queryKey: ['discrepancy-detail', 'return', id],
    queryFn: () => getReturnDiscrepancy(id),
    enabled: Boolean(id) && kind === 'return',
  });
  const transferQuery = useQuery({
    queryKey: ['discrepancy-detail', 'transfer', id],
    queryFn: () => getTransferDiscrepancy(id),
    enabled: Boolean(id) && kind === 'transfer',
  });
  const query = kind === 'return' ? returnQuery : transferQuery;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!reason) throw new Error('Select a resolution reason.');
      if (reason === 'other' && !note.trim()) throw new Error('Enter a note for this resolution.');
      const trimmed = note.trim() || null;
      return kind === 'return'
        ? resolveReturnDiscrepancy(id, reason, trimmed)
        : resolveTransferDiscrepancy(id, reason, trimmed);
    },
    onSuccess: async () => {
      setFormError('');
      await Promise.all([
        query.refetch(),
        client.invalidateQueries({ queryKey: ['reports'] }),
        client.invalidateQueries({ queryKey: ['stock-returns'] }),
        client.invalidateQueries({ queryKey: ['stock-transfers'] }),
      ]);
    },
    onError: (failure) => setFormError(getInventoryErrorMessage(failure)),
  });

  if (kind !== 'return' && kind !== 'transfer') {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Discrepancy" showBack />
        <ErrorState message="This discrepancy is no longer available." />
      </Screen>
    );
  }

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Discrepancy details" showBack />
        <LoadingState label="Loading discrepancy…" />
      </Screen>
    );
  }

  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Discrepancy details" showBack />
        <ErrorState
          message="This discrepancy is no longer available."
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  }

  const row = query.data;
  const isMissing = row.discrepancy_type === 'missing';
  const status = row.status ?? 'open';
  const isReturn = kind === 'return';
  const returnRow = isReturn && 'stock_return' in row ? row : null;
  const transferRow = !isReturn && 'stock_transfer' in row ? row : null;
  const expected = row.quantity_expected;
  const received = row.quantity_received;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title={isReturn ? 'Return discrepancy' : 'Transfer discrepancy'}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.badges}>
          <ManagerBadge label={status === 'resolved' ? 'Resolved' : 'Open'} tone={status === 'resolved' ? 'success' : 'warning'} />
          <ManagerBadge
            label={isMissing ? `${row.difference} missing` : `${Math.abs(Number(row.difference))} excess`}
            tone={isMissing ? 'danger' : 'warning'}
          />
        </View>

        <SummaryCard
          rows={[
            {
              label: isReturn ? 'Expected / returned' : 'Expected / sent',
              value: String(expected),
              icon: 'cube-outline',
            },
            { label: 'Received', value: String(received), icon: 'checkmark-outline' },
            {
              label: 'Difference',
              value: isMissing ? `${row.difference} missing` : `${Math.abs(Number(row.difference))} excess`,
              icon: 'alert-circle-outline',
            },
            ...(isReturn
              ? [
                  {
                    label: 'Selling branch',
                    value: returnRow?.stock_return?.from_branch_name ?? '—',
                    icon: 'storefront-outline' as const,
                  },
                  {
                    label: 'Return',
                    value: returnRow?.stock_return?.return_number ?? '—',
                    icon: 'return-up-back-outline' as const,
                  },
                ]
              : [
                  {
                    label: 'Source',
                    value: transferRow?.stock_transfer?.from_branch?.name ?? '—',
                    icon: 'paper-plane-outline' as const,
                  },
                  {
                    label: 'Destination',
                    value: transferRow?.stock_transfer?.to_branch?.name ?? '—',
                    icon: 'storefront-outline' as const,
                  },
                  {
                    label: 'Transfer',
                    value: transferRow?.stock_transfer?.transfer_number ?? '—',
                    icon: 'swap-horizontal-outline' as const,
                  },
                ]),
            { label: 'Recorded', value: formatDate(row.created_at), icon: 'time-outline' },
            ...(row.notes ? [{ label: 'Receive note', value: row.notes, icon: 'document-text-outline' as const }] : []),
          ]}
        />

        {status === 'resolved' ? (
          <ListRowCard
            title="Resolution"
            subtitle={reasonLabel(row.resolution_reason)}
            meta={`Resolved ${formatDate(row.resolved_at)}${row.resolution_note ? ` · ${row.resolution_note}` : ''}`}
          />
        ) : null}

        {canResolve && status === 'open' ? (
          <View style={styles.resolve}>
            <Text style={styles.sectionTitle}>RESOLVE</Text>
            <Text style={styles.help}>
              Resolving records the investigation only. Inventory and original quantities stay unchanged.
            </Text>
            <FilterDropdown
              label="Resolution reason"
              options={REASON_OPTIONS}
              value={reason}
              onChange={setReason}
            />
            <FormField
              label={reason === 'other' ? 'Resolution note (required)' : 'Resolution note (optional)'}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={1000}
              accentColor={managerColors.royalBlue}
            />
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <ManagerActionButton
              label="Resolve discrepancy"
              loading={mutation.isPending}
              onPress={() => mutation.mutate()}
            />
          </View>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 14 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resolve: { gap: 12 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  help: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
});
