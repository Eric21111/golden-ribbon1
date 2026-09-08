import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage, getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import { createReturn, listReturnStock } from '@/services/returnService';
import { useReturnStore } from '@/stores/returnStore';

import { returnStyles } from './returnStyles';

export default function CreateReturnScreen() {
  const { profile } = useAuth();
  const user = profile?.id ?? '';
  const saved = useReturnStore((state) => state.byUser[user]);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['return-inventory', user, profile?.branch_id],
    queryFn: listReturnStock,
  });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selected =
    saved?.request.p_items ??
    Object.entries(quantities)
      .filter(([, value]) => value !== '' && value !== '0')
      .map(([product_id, value]) => ({ product_id, quantity_returned: Number(value) }));

  function reviewReturn() {
    if (!selected.length) {
      setError('Select at least one product.');
      return;
    }
    for (const item of selected) {
      const stock = query.data?.find((row) => row.product_id === item.product_id);
      if (
        !stock ||
        !/^[1-9][0-9]{0,5}$/.test(quantities[item.product_id]) ||
        item.quantity_returned > stock.quantity_on_hand
      ) {
        setError(
          `Enter a positive whole quantity within available stock for ${stock?.product_name ?? 'each product'} (maximum 999999).`,
        );
        return;
      }
    }
    setError('');
    setReview(true);
  }

  async function confirm() {
    if (lock.current || !user) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const request = saved?.request ?? {
      p_items: selected,
      p_notes: notes.trim() || null,
      p_idempotency_key: makeIdempotencyKey('return'),
    };
    try {
      useReturnStore.getState().save(user, { request });
      const id = await createReturn(request);
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
        setReview(false);
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
      <Screen>
        <ConstrainedWidth style={styles.column}>
          <PageHeader title="Return confirmed" subtitle="Stock is now In Transit to Main Branch." />
          <Text>Branch stock was deducted once. Main Branch stock was not increased.</Text>
          <AppButton
            label="View return"
            onPress={() => {
              const id = saved.id!;
              useReturnStore.getState().clear(user);
              router.replace({ pathname: '/manager/returns/[id]', params: { id } });
            }}
          />
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen>
      <ConstrainedWidth style={styles.column}>
        <PageHeader
          title={review || saved ? 'Review return' : 'Create return'}
          subtitle={`${profile?.branch?.name ?? 'Assigned branch'} → Main Branch`}
        />
        <Text>Stock leaves your branch only when confirmed. Main Branch will count it later.</Text>
        {error ? <ErrorState message={error} /> : null}
        {review || saved ? (
          <>
            {selected.map((item) => (
              <View key={item.product_id} style={returnStyles.card}>
                <Text style={returnStyles.title}>
                  {query.data?.find((row) => row.product_id === item.product_id)?.product_name ??
                    item.product_id}
                </Text>
                <Text>Return quantity: {item.quantity_returned}</Text>
              </View>
            ))}
            <Text>Notes: {(saved?.request.p_notes ?? notes) || 'None'}</Text>
            {saved ? (
              <Text>
                This confirmation is saved. Retry it unchanged to safely check the result without
                deducting stock twice.
              </Text>
            ) : null}
            <AppButton
              label={saved ? 'Retry confirmation' : 'Confirm return'}
              loading={busy}
              onPress={() => void confirm()}
            />
            {!saved ? (
              <AppButton
                label="Edit quantities"
                variant="secondary"
                disabled={busy}
                onPress={() => setReview(false)}
              />
            ) : null}
          </>
        ) : (
          <>
            {query.isLoading ? <LoadingState /> : null}
            {query.error ? (
              <ErrorState
                message={getErrorMessage(query.error)}
                onRetry={() => void query.refetch()}
              />
            ) : null}
            {query.data?.length === 0 ? (
              <EmptyState
                title="No stock to return"
                message="Only products with remaining stock appear here."
              />
            ) : null}
            {query.data?.map((row) => (
              <View key={row.product_id} style={returnStyles.card}>
                <Text style={returnStyles.title}>
                  {row.product_name}
                  {!row.is_active ? ' (Inactive)' : ''}
                </Text>
                <Text>
                  {row.product_sku} · Available: {row.quantity_on_hand}
                </Text>
                <FormField
                  label={`Return quantity — ${row.product_name}`}
                  keyboardType="number-pad"
                  value={quantities[row.product_id] ?? ''}
                  placeholder="0"
                  maxLength={6}
                  onChangeText={(value) =>
                    setQuantities((current) => ({ ...current, [row.product_id]: value }))
                  }
                />
              </View>
            ))}
            <FormField
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
            />
            <AppButton
              label="Review return"
              disabled={!query.data?.length || Boolean(query.error)}
              onPress={reviewReturn}
            />
          </>
        )}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.md },
});
