import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { alertNotice, confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import {
  listCashierLocalPurchaseCatalog,
  recordBranchLocalPurchase,
} from '@/services/inventoryService';

type QtyMap = Record<string, string>;

export default function LocalPurchaseScreen() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [qty, setQty] = useState<QtyMap>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const keyRef = useRef(makeIdempotencyKey('local-purchase'));

  const catalog = useQuery({
    queryKey: ['local-purchase-catalog', profile?.branch_id],
    queryFn: listCashierLocalPurchaseCatalog,
  });

  const lines = useMemo(() => {
    const rows = catalog.data ?? [];
    return rows
      .map((row) => {
        const raw = (qty[row.product_id] ?? '').trim();
        if (!raw || raw === '0') return null;
        return { product_id: row.product_id, name: row.product_name, quantity: raw };
      })
      .filter((row): row is { product_id: string; name: string; quantity: string } => row != null);
  }, [catalog.data, qty]);

  const mutation = useMutation({
    mutationFn: () =>
      recordBranchLocalPurchase(
        lines.map(({ product_id, quantity }) => ({ product_id, quantity })),
        notes.trim() || null,
        keyRef.current,
      ),
    onSuccess: async () => {
      setError('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['local-purchase-catalog'] }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
        client.invalidateQueries({ queryKey: ['cashier-pos-inventory'] }),
      ]);
      alertNotice('Local purchase recorded', 'Branch stock increased. Main Branch inventory was not changed.');
      router.replace('/cashier/dashboard');
    },
    onError: (failure) => setError(getInventoryErrorMessage(failure)),
  });

  const submit = () => {
    if (lines.length === 0 || mutation.isPending) return;
    setError('');
    confirmAction(
      'Record local purchase?',
      `${lines.length} product${lines.length === 1 ? '' : 's'} will be added to ${profile?.branch?.name ?? 'this branch'} only.`,
      () => mutation.mutate(),
    );
  };

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      <ManagerScreenHeader
        title="Local purchase"
        subtitle={`${profile?.branch?.name ?? 'Branch'} · does not change Main stock`}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <Text style={styles.body}>
          Record drinks or other non-returnable items bought locally. Only products marked non-returnable in product
          settings appear here. KG meals are Main-tracked and cannot be purchased here.
        </Text>
        {error ? <ErrorState message={error} /> : null}
        {catalog.isLoading ? <LoadingState label="Loading catalog…" /> : null}
        {catalog.error ? (
          <ErrorState message={getInventoryErrorMessage(catalog.error)} onRetry={() => void catalog.refetch()} />
        ) : null}
        {!catalog.isLoading && !catalog.error && (catalog.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No non-returnable products"
            message="Ask a Main Branch Manager to mark drinks or snacks as non-returnable in product settings."
          />
        ) : null}
        {(catalog.data ?? []).map((row) => (
          <View key={row.product_id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.cardInfo}>
                <Text style={styles.name} numberOfLines={2}>
                  {row.product_name}
                </Text>
                <Text style={styles.sku}>
                  {row.product_sku} · on hand {row.quantity_on_hand}
                </Text>
              </View>
            </View>
            <FormField
              label="Qty purchased"
              value={qty[row.product_id] ?? ''}
              onChangeText={(text) =>
                setQty((current) => ({ ...current, [row.product_id]: text.replace(/[^\d]/g, '').slice(0, 6) }))
              }
              keyboardType="number-pad"
              placeholder="0"
              accentColor={managerColors.royalBlue}
              labelStyle={styles.fieldLabel}
              style={styles.fieldInput}
            />
          </View>
        ))}
        {(catalog.data?.length ?? 0) > 0 ? (
          <>
            <FormField
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={1000}
              accentColor={managerColors.royalBlue}
              labelStyle={styles.fieldLabel}
              style={styles.fieldInput}
            />
            <ManagerActionButton
              label="Record purchase"
              loading={mutation.isPending}
              disabled={lines.length === 0}
              onPress={submit}
            />
            <Pressable accessibilityRole="button" onPress={() => router.back()}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </>
        ) : null}
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  body: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', gap: 10 },
  cardInfo: { flex: 1, gap: 4 },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  fieldLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  fieldInput: { borderColor: managerColors.cardBorder },
  cancel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
