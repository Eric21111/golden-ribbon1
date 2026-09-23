import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage, getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import { createReturn, listReturnStock } from '@/services/returnService';
import { useReturnStore } from '@/stores/returnStore';

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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  function setQuantity(productId: string, value: string) {
    setQuantities((current) => ({ ...current, [productId]: value }));
  }

  function stepQuantity(productId: string, delta: number, max: number) {
    setQuantities((current) => {
      const parsed = Number.parseInt(current[productId] ?? '0', 10);
      const base = Number.isFinite(parsed) ? parsed : 0;
      const next = Math.min(max, Math.max(0, base + delta));
      return { ...current, [productId]: String(next) };
    });
  }
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selected =
    (saved?.request && 'p_items' in saved.request ? saved.request.p_items : undefined) ??
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
    const request =
      saved?.request && 'p_items' in saved.request
        ? saved.request
        : {
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
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Return confirmed" subtitle="Stock is now In Transit to Main Branch." showBack />
        <ConstrainedWidth style={styles.column}>
          <Text style={styles.body}>Branch stock was deducted once. Main Branch stock was not increased.</Text>
          <ManagerActionButton
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
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title={review || saved ? 'Review return' : 'Create return'}
        subtitle={`${profile?.branch?.name ?? 'Assigned branch'} → Main Branch`}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <Text style={styles.body}>Stock leaves your branch only when confirmed. Main Branch will count it later.</Text>
        {error ? <ErrorState message={error} /> : null}
        {review || saved ? (
          <>
            {selected.map((item) => (
              <ListRowCard
                key={item.product_id}
                title={
                  query.data?.find((row) => row.product_id === item.product_id)?.product_name ?? item.product_id
                }
                meta={`Return quantity: ${item.quantity_returned}`}
              />
            ))}
            <Text style={styles.body}>Notes: {(saved?.request.p_notes ?? notes) || 'None'}</Text>
            {saved ? (
              <Text style={styles.body}>
                This confirmation is saved. Retry it unchanged to safely check the result without deducting stock
                twice.
              </Text>
            ) : null}
            <View style={styles.actions}>
              <ManagerActionButton
                label={saved ? 'Retry confirmation' : 'Confirm return'}
                loading={busy}
                onPress={() => void confirm()}
              />
              {!saved ? (
                <ManagerActionButton
                  label="Edit quantities"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setReview(false)}
                />
              ) : null}
            </View>
          </>
        ) : (
          <>
            {query.isLoading ? <LoadingState /> : null}
            {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
            {query.data?.length === 0 ? (
              <EmptyState title="No stock to return" message="Only products with remaining stock appear here." />
            ) : null}
            {query.data?.map((row) => {
              const currentQty = Number.parseInt(quantities[row.product_id] ?? '0', 10) || 0;
              const isFocused = focusedId === row.product_id;
              const atMin = currentQty <= 0;
              const atMax = currentQty >= row.quantity_on_hand;
              return (
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
                        <Text style={styles.availableLabel}> available</Text>
                      </Text>
                    </View>
                  </View>
                  <View style={styles.qtyRow}>
                    <Text style={styles.qtyCaption}>Qty</Text>
                    <View style={styles.qtyControls}>
                      <View style={[styles.stepperPill, isFocused && styles.stepperPillFocused]}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease quantity for ${row.product_name}`}
                          hitSlop={6}
                          disabled={atMin}
                          onPress={() => stepQuantity(row.product_id, -1, row.quantity_on_hand)}
                          style={({ pressed }) => [styles.stepperButton, pressed && !atMin && styles.stepperButtonPressed]}
                        >
                          <Text style={[styles.stepperSymbol, atMin && styles.stepperSymbolDisabled]}>−</Text>
                        </Pressable>
                        <TextInput
                          accessibilityLabel={`Return quantity for ${row.product_name}`}
                          keyboardType="number-pad"
                          value={quantities[row.product_id] ?? ''}
                          placeholder="0"
                          placeholderTextColor={managerColors.subtext}
                          maxLength={6}
                          selectTextOnFocus
                          underlineColorAndroid="transparent"
                          onFocus={() => setFocusedId(row.product_id)}
                          onBlur={() => setFocusedId((current) => (current === row.product_id ? null : current))}
                          onChangeText={(value) => setQuantity(row.product_id, value)}
                          style={styles.stepperInput}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Increase quantity for ${row.product_name}`}
                          hitSlop={6}
                          disabled={atMax}
                          onPress={() => stepQuantity(row.product_id, 1, row.quantity_on_hand)}
                          style={({ pressed }) => [styles.stepperButton, pressed && !atMax && styles.stepperButtonPressed]}
                        >
                          <Text style={[styles.stepperSymbol, atMax && styles.stepperSymbolDisabled]}>+</Text>
                        </Pressable>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Return all ${row.quantity_on_hand} available`}
                        disabled={atMax}
                        onPress={() => setQuantity(row.product_id, String(row.quantity_on_hand))}
                        style={({ pressed }) => [
                          styles.maxButton,
                          atMax && styles.maxButtonDisabled,
                          pressed && !atMax && styles.maxButtonPressed,
                        ]}
                      >
                        <Text style={[styles.maxButtonText, atMax && styles.maxButtonTextDisabled]}>Max</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
            <FormField
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
              accentColor={managerColors.royalBlue}
              labelStyle={styles.fieldLabel}
              style={styles.fieldInput}
            />
            <ManagerActionButton
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
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 12,
    gap: 12,
  },
  qtyCaption: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 10,
    backgroundColor: managerColors.cardSurface,
    overflow: 'hidden',
  },
  stepperPillFocused: {
    borderColor: managerColors.royalBlue,
    backgroundColor: '#FFFFFF',
  },
  stepperButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 20 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  stepperInput: {
    width: 40,
    height: 40,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: 'transparent',
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 0,
  },
  maxButton: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#EAF0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  maxButtonPressed: { opacity: 0.7 },
  maxButtonDisabled: { backgroundColor: managerColors.cardSurface },
  maxButtonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  maxButtonTextDisabled: { color: managerColors.cardBorder },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  actions: { gap: 10 },
});
