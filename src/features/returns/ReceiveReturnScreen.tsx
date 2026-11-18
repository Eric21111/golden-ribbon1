import Ionicons from '@react-native-vector-icons/ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { RouteBanner } from '@/components/dashboard/RouteBanner';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { returnStatusBadgeLabel, returnStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { useReceiveReturn, useReturn } from '@/hooks/useReturns';
import { alertNotice } from '@/lib/confirmAction';
import { getInventoryErrorMessage } from '@/lib/errors';
import {
  formatDate,
  formatSnapshottedQuantity,
  makeIdempotencyKey,
  PIECE_QUANTITY_MAX_LENGTH,
  quantityBoxWidth,
} from '@/lib/format';
import { listCashierProductCategories } from '@/services/inventoryService';

const RECEIVE_HELP =
  'Physically count every product. Counted leftover is waste and does not restock Main sellable inventory.';

const schema = z.object({
  items: z
    .array(
      z.object({
        stock_return_item_id: z.string(),
        quantity_received: z
          .string()
          .min(1, 'Enter the physical count.')
          .regex(/^\d{1,6}$/, 'Enter a whole PCS quantity (0–999999).'),
      }),
    )
    .min(1),
  notes: z.string().max(1000).optional(),
});
type Values = z.infer<typeof schema>;

export function ReceiveReturnScreen() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useReturn(id);
  const mutation = useReceiveReturn();
  const categories = useQuery({
    queryKey: ['cashier-product-categories'],
    staleTime: 5 * 60 * 1000,
    queryFn: listCashierProductCategories,
  });
  const requestKey = useRef(makeIdempotencyKey('return-receive'));
  const formInitialized = useRef(false);
  const [review, setReview] = useState<Values | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const { control, handleSubmit, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { items: [], notes: '' },
  });
  const { fields } = useFieldArray({ control, name: 'items' });

  useEffect(() => {
    if (query.data && !formInitialized.current) {
      reset({
        items: query.data.items.map((item) => ({
          stock_return_item_id: item.id,
          quantity_received: '',
        })),
        notes: '',
      });
      formInitialized.current = true;
    }
  }, [query.data, reset]);

  const reviewItems = useMemo(
    () =>
      review?.items
        .map((value) => {
          const returnItem = query.data?.items.find((item) => item.id === value.stock_return_item_id);
          const received = Number(value.quantity_received);
          return returnItem
            ? {
                ...returnItem,
                received,
                difference: returnItem.quantity_returned - received,
              }
            : null;
        })
        .filter((item) => item !== null) ?? [],
    [query.data?.items, review],
  );

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Receive return" showBack />
        <LoadingState label="Loading stock return…" />
      </Screen>
    );
  }

  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Receive return" showBack />
        <ErrorState message="Unable to load stock return." onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const stockReturn = query.data;
  const notesByItemId = new Map(
    stockReturn.discrepancies?.map((disc) => [disc.stock_return_item_id, disc.notes]) ?? [],
  );

  if (!isMainBranchManager(profile)) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader
          title="Unauthorized"
          subtitle="Main Branch Manager only."
          showBack
        />
        <ConstrainedWidth style={styles.column}>
          <ManagerActionButton label="Go back" variant="secondary" onPress={() => router.back()} />
        </ConstrainedWidth>
      </Screen>
    );
  }

  if (stockReturn.status !== 'in_transit') {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader
          title={stockReturn.return_number}
          subtitle={`${stockReturn.from_branch_name} → ${stockReturn.to_branch_name}`}
          badge={
            <ManagerBadge
              label={returnStatusBadgeLabel(stockReturn.status)}
              tone={returnStatusTone(stockReturn.status)}
            />
          }
          showBack
        />
        <ConstrainedWidth style={styles.column}>
          <RouteBanner
            from={{ label: stockReturn.from_branch_name, isMain: false }}
            to={{ label: stockReturn.to_branch_name, isMain: true }}
            connectorIcon="return-up-back"
          />
          <SummaryCard
            rows={[
              { label: 'Returned by', value: stockReturn.returned_by_name, icon: 'person-outline' },
              { label: 'Returned at', value: formatDate(stockReturn.returned_at), icon: 'time-outline' },
              {
                label: 'Received by',
                value: stockReturn.received_by_name ?? 'Pending',
                icon: 'person-outline',
              },
              {
                label: 'Received',
                value: formatDate(stockReturn.received_at),
                icon: 'time-outline',
              },
              ...(stockReturn.notes
                ? [{ label: 'Notes', value: stockReturn.notes, icon: 'document-text-outline' as const }]
                : []),
            ]}
          />

          <Text style={styles.sectionTitle}>RETURNED PRODUCTS</Text>
          {stockReturn.items.map((item) => {
            const isReceived = item.quantity_received !== null;
            const difference = isReceived ? item.quantity_returned - item.quantity_received! : null;
            const note = notesByItemId.get(item.id);
            return (
              <ListRowCard
                key={item.id}
                title={item.product_name}
                subtitle={`Expected ${item.quantity_returned} · Received ${isReceived ? item.quantity_received : 'Pending'}`}
                meta={note ? `Note: ${note}` : undefined}
                trailing={
                  difference === null ? undefined : (
                    <ManagerBadge
                      label={
                        difference === 0
                          ? 'Exact'
                          : difference > 0
                            ? `${difference} missing`
                            : `${Math.abs(difference)} excess`
                      }
                      tone={
                        difference === 0 ? 'success' : difference > 0 ? 'danger' : 'warning'
                      }
                    />
                  )
                }
              />
            );
          })}
        </ConstrainedWidth>
      </Screen>
    );
  }

  if (review) {
    return (
      <Screen
        backgroundColor="#FFFFFF"
        edges={['top']}
        scroll={false}
        contentContainerStyle={styles.screenFill}
      >
        <ManagerScreenHeader title="Review receipt" subtitle={stockReturn.return_number} showBack />
        <ConstrainedWidth fill style={styles.body}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.column}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sectionHeading}>
              <Text style={styles.sheetLead}>Confirm counts</Text>
              <Text style={styles.sectionCount}>{reviewItems.length}</Text>
            </View>
            <View style={styles.list}>
              {reviewItems.map((item) => {
                const category = categories.data?.get(item.product_id) ?? null;
                const expectedLabel = formatSnapshottedQuantity(
                  item.quantity_returned,
                  item.inventory_mode,
                  item.stock_unit_code,
                );
                const receivedLabel = formatSnapshottedQuantity(
                  item.received,
                  item.inventory_mode,
                  item.stock_unit_code,
                );
                return (
                  <View key={item.id} style={styles.reviewRow}>
                    <CategoryIcon category={category} size={40} />
                    <View style={styles.productCardBody}>
                      <Text style={styles.name} numberOfLines={2}>
                        {item.product_name}
                      </Text>
                      <Text style={styles.productMeta}>
                        Expected {expectedLabel} · Received {receivedLabel}
                      </Text>
                    </View>
                    <ManagerBadge
                      label={
                        item.difference === 0
                          ? 'Exact'
                          : item.difference > 0
                            ? `${item.difference} missing`
                            : `${Math.abs(item.difference)} excess`
                      }
                      tone={
                        item.difference === 0
                          ? 'success'
                          : item.difference > 0
                            ? 'danger'
                            : 'warning'
                      }
                      size="md"
                    />
                  </View>
                );
              })}
            </View>
            {review.notes ? <Text style={styles.meta}>Notes: {review.notes}</Text> : null}
            {mutation.error ? (
              <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <View style={styles.footerButton}>
                <ManagerActionButton
                  label="Back to counts"
                  variant="secondary"
                  disabled={mutation.isPending}
                  onPress={() => setReview(null)}
                />
              </View>
              <View style={styles.footerButton}>
                <ManagerActionButton
                  label="Confirm receipt"
                  loading={mutation.isPending}
                  onPress={() =>
                    mutation.mutate(
                      {
                        returnId: stockReturn.id,
                        items: reviewItems.map((item) => ({
                          stock_return_item_id: item.id,
                          quantity_received: item.received,
                        })),
                        notes: review.notes?.trim() || null,
                        idempotencyKey: requestKey.current,
                      },
                      {
                        onSuccess: (finalStatus) => {
                          setReview(null);
                          router.replace('/manager/returns' as never);
                          Alert.alert(
                            'Return received',
                            `Leftover is waste and does not restock Main. Status: ${finalStatus.replaceAll('_', ' ')}.`,
                          );
                        },
                      },
                    )
                  }
                />
              </View>
            </View>
          </View>
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      scroll={false}
      contentContainerStyle={styles.screenFill}
    >
      <ManagerScreenHeader
        title="Receive return"
        subtitle={`${stockReturn.return_number} · ${stockReturn.from_branch_name} → ${stockReturn.to_branch_name}`}
        showBack
      />
      <ConstrainedWidth fill style={styles.body}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.column}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeading}>
            <Text style={styles.sheetLead}>Physical count</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Receive return help"
              hitSlop={10}
              onPress={() => alertNotice('Receive return', RECEIVE_HELP)}
              style={({ pressed }) => [styles.infoHit, pressed && styles.pressed]}
            >
              <Ionicons name="information-circle-outline" size={20} color={managerColors.royalBlue} />
            </Pressable>
          </View>

          <View style={styles.list}>
            {fields.map((field, index) => {
              const item = stockReturn.items[index];
              if (!item) return null;
              const category = categories.data?.get(item.product_id) ?? null;
              const expectedLabel = formatSnapshottedQuantity(
                item.quantity_returned,
                item.inventory_mode,
                item.stock_unit_code,
              );
              return (
                <Controller
                  key={field.id}
                  control={control}
                  name={`items.${index}.quantity_received`}
                  render={({ field: quantity, fieldState }) => {
                    const hasInput = quantity.value.trim() !== '';
                    const currentQty = Number.parseInt(quantity.value || '0', 10) || 0;
                    const atMin = !hasInput || currentQty <= 0;
                    const matchesExpected = hasInput && currentQty === item.quantity_returned;
                    const atMax = currentQty >= 999999;
                    const diff = hasInput ? item.quantity_returned - currentQty : null;
                    const step = (delta: number) => {
                      const next = Math.min(999999, Math.max(0, currentQty + delta));
                      quantity.onChange(String(next));
                    };

                    return (
                      <View style={[styles.countBlock, hasInput && styles.countBlockEntered]}>
                        <View style={styles.productCard}>
                          <CategoryIcon category={category} size={40} />
                          <View style={styles.productCardBody}>
                            <Text style={styles.name} numberOfLines={2}>
                              {item.product_name}
                            </Text>
                            <Text style={styles.productMeta}>Expected {expectedLabel}</Text>
                          </View>
                          {diff !== null ? (
                            <ManagerBadge
                              label={
                                diff === 0
                                  ? 'Exact'
                                  : diff > 0
                                    ? `${diff} missing`
                                    : `${Math.abs(diff)} excess`
                              }
                              tone={diff === 0 ? 'success' : diff > 0 ? 'danger' : 'warning'}
                              size="md"
                            />
                          ) : null}
                        </View>

                        <View style={styles.fieldBlock}>
                          <Text style={styles.qtyCaption}>Actual received</Text>
                          <View style={styles.stepper}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Decrease received quantity for ${item.product_name}`}
                              hitSlop={8}
                              disabled={atMin}
                              onPress={() => step(-1)}
                              style={({ pressed }) => [
                                styles.stepBtn,
                                pressed && !atMin && styles.pressed,
                                atMin && styles.stepDisabled,
                              ]}
                            >
                              <Text style={styles.stepText}>−</Text>
                            </Pressable>
                            <TextInput
                              accessibilityLabel={`Actual received quantity for ${item.product_name}`}
                              keyboardType="number-pad"
                              value={quantity.value}
                              placeholder="0"
                              placeholderTextColor={managerColors.subtext}
                              maxLength={PIECE_QUANTITY_MAX_LENGTH}
                              selectTextOnFocus
                              underlineColorAndroid="transparent"
                              onFocus={() => setFocusedIndex(index)}
                              onBlur={() =>
                                setFocusedIndex((current) => (current === index ? null : current))
                              }
                              onChangeText={(value) => {
                                if (value === '' || /^\d{0,6}$/.test(value)) quantity.onChange(value);
                              }}
                              style={[
                                styles.qtyInput,
                                focusedIndex === index && styles.qtyInputFocused,
                                {
                                  minWidth: quantityBoxWidth(quantity.value, { min: 40, fontSize: 15 }),
                                },
                              ]}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Increase received quantity for ${item.product_name}`}
                              hitSlop={8}
                              disabled={atMax}
                              onPress={() => step(1)}
                              style={({ pressed }) => [
                                styles.stepBtn,
                                pressed && !atMax && styles.pressed,
                                atMax && styles.stepDisabled,
                              ]}
                            >
                              <Text style={styles.stepText}>+</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Match expected quantity of ${item.quantity_returned}`}
                              disabled={matchesExpected}
                              hitSlop={8}
                              onPress={() => quantity.onChange(String(item.quantity_returned))}
                              style={({ pressed }) => [
                                styles.matchBtn,
                                pressed && !matchesExpected && styles.pressed,
                                matchesExpected && styles.stepDisabled,
                              ]}
                            >
                              <Text style={styles.matchBtnText}>Match</Text>
                            </Pressable>
                          </View>
                          {fieldState.error ? (
                            <Text style={styles.error}>{fieldState.error.message}</Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  }}
                />
              );
            })}
          </View>

          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <FormField
                label="Receipt notes (optional)"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                multiline
                accentColor={managerColors.royalBlue}
                labelStyle={styles.fieldLabel}
                style={styles.fieldInput}
              />
            )}
          />
        </ScrollView>

        <View style={styles.footer}>
          <ManagerActionButton label="Review receipt" onPress={handleSubmit(setReview)} />
        </View>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  screenFill: { flex: 1, flexGrow: 1, padding: 0, gap: 0 },
  body: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  column: { padding: 20, gap: 12, paddingBottom: 24 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheetLead: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  infoHit: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  list: { gap: 14 },
  sectionCount: {
    marginLeft: 'auto',
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  countBlock: {
    gap: 10,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#FFFFFF',
  },
  countBlockEntered: {
    borderColor: managerColors.royalBlue,
    backgroundColor: '#F5F8FF',
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: managerColors.cardSurface,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    padding: 12,
  },
  reviewRow: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  productCardBody: { flex: 1, minWidth: 0, gap: 2 },
  name: {
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  productMeta: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.5,
  },
  fieldBlock: { gap: 8 },
  qtyCaption: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  stepBtn: {
    width: 42,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
    flexShrink: 0,
  },
  stepDisabled: { opacity: 0.45 },
  stepText: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 26 },
  qtyInput: {
    flex: 1,
    minWidth: 56,
    minHeight: 48,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    textAlign: 'center',
  },
  qtyInputFocused: { borderColor: managerColors.royalBlue },
  matchBtn: {
    minWidth: 64,
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
    flexShrink: 0,
  },
  matchBtnText: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  footerRow: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 8,
  },
});
