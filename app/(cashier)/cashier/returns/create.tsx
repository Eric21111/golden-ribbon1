import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage, getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import { listReturnStock, returnLeftoverStock } from '@/services/returnService';
import { useReturnStore } from '@/stores/returnStore';
import type { LeftoverReturnRequest, ReturnRequest } from '@/types/returns';

function leftoverRequestOf(request: ReturnRequest | LeftoverReturnRequest): LeftoverReturnRequest {
  return {
    p_notes: request.p_notes,
    p_idempotency_key: request.p_idempotency_key,
  };
}

export default function CreateReturnScreen() {
  const { profile } = useAuth();
  const user = profile?.id ?? '';
  const saved = useReturnStore((state) => state.byUser[user]);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['return-inventory', user, profile?.branch_id],
    queryFn: listReturnStock,
  });
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const leftover = query.data ?? [];

  async function confirm() {
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const request = saved?.request
      ? leftoverRequestOf(saved.request)
      : {
          p_notes: notes.trim() || null,
          p_idempotency_key: makeIdempotencyKey('leftover'),
        };
    try {
      useReturnStore.getState().save(user, { request });
      const id = await returnLeftoverStock(request);
      useReturnStore.getState().save(user, { request, id });
      await Promise.all(
        ['inventory', 'inventory-movements', 'stock-returns', 'return-inventory'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (failure) {
      const code =
        typeof failure === 'object' && failure && 'code' in failure ? String(failure.code) : '';
      if (['22023', '42501', '23514', 'P0001', '40P01', '40001'].includes(code)) {
        useReturnStore.getState().clear(user);
        void query.refetch();
      }
      setError(getInventoryErrorMessage(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (saved?.id) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Return confirmed" subtitle="Stock is now In Transit to Main Branch." showBack />
        <ConstrainedWidth style={styles.column}>
          <Text style={styles.body}>
            Leftover on-hand stock left your branch once. Main Branch will count it later. Difference is recorded only
            when Main receives the return.
          </Text>
          <ManagerActionButton
            label="Back to home"
            onPress={() => {
              useReturnStore.getState().clear(user);
              router.replace('/cashier/dashboard');
            }}
          />
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title="Create return"
        subtitle={`${profile?.branch?.name ?? 'Assigned branch'} → Main Branch`}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <Text style={styles.body}>
          Every leftover unit on hand is returned automatically. Confirm only. Main Branch will count the arrival and
          record any difference.
        </Text>
        {error ? <ErrorState message={error} /> : null}
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
        {!query.isLoading && !query.error && leftover.length === 0 ? (
          <EmptyState title="No leftover stock" message="Only products still on hand at this branch appear here." />
        ) : null}
        {leftover.map((row) => (
          <View key={row.product_id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.cardInfo}>
                <Text style={styles.name} numberOfLines={2}>
                  {row.product_name}
                </Text>
                <Text style={styles.sku}>
                  {row.product_sku}
                  {!row.is_active ? ' · Inactive' : ''}
                </Text>
              </View>
              <View style={styles.availablePill}>
                <Text style={styles.availableText} numberOfLines={1}>
                  <Text style={styles.availableValue}>{row.quantity_on_hand}</Text>
                  <Text style={styles.availableLabel}> leftover</Text>
                </Text>
              </View>
            </View>
          </View>
        ))}
        {leftover.length > 0 || saved ? (
          <>
            <FormField
              label="Notes (optional)"
              value={saved?.request.p_notes ?? notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
              editable={!saved}
              accentColor={managerColors.royalBlue}
              labelStyle={styles.fieldLabel}
              style={styles.fieldInput}
            />
            {saved ? (
              <Text style={styles.body}>
                This confirmation is saved. Retry it unchanged to safely check the result without deducting stock twice.
              </Text>
            ) : null}
            <ManagerActionButton
              label={saved ? 'Retry confirmation' : 'Confirm leftover return'}
              loading={busy}
              disabled={!saved && (leftover.length === 0 || Boolean(query.error))}
              onPress={() => void confirm()}
            />
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  body: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardInfo: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  availablePill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  availableText: { fontSize: 13 },
  availableValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  availableLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
});
