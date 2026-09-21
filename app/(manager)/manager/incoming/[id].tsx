import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { RouteBanner } from '@/components/dashboard/RouteBanner';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { transferStatusBadgeLabel, transferStatusTone } from '@/components/dashboard/statusTone';
import { managerColors } from '@/components/dashboard/theme';
import { useReceiveTransfer, useTransfer } from '@/hooks/useTransfers';
import { getInventoryErrorMessage } from '@/lib/errors';
import { formatDate, makeIdempotencyKey } from '@/lib/format';

const schema = z.object({
  items: z
    .array(
      z.object({
        stock_transfer_item_id: z.string(),
        quantity_received: z
          .string()
          .min(1, 'Enter the physical count.')
          .regex(/^\d+$/, 'Enter a whole number of zero or greater.'),
      }),
    )
    .min(1),
  notes: z.string().max(1000).optional(),
});
type Values = z.infer<typeof schema>;

export default function ReceiveTransferScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useTransfer(id);
  const mutation = useReceiveTransfer();
  const requestKey = useRef(makeIdempotencyKey('receive'));
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
          stock_transfer_item_id: item.id,
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
          const transferItem = query.data?.items.find(
            (item) => item.id === value.stock_transfer_item_id,
          );
          const received = Number(value.quantity_received);
          return transferItem
            ? { ...transferItem, received, difference: transferItem.quantity_sent - received }
            : null;
        })
        .filter((item) => item !== null) ?? [],
    [query.data?.items, review],
  );

  if (query.isLoading) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Receive stock" showBack />
        <LoadingState label="Loading transfer…" />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader title="Receive stock" showBack />
        <ErrorState message="Unable to load transfer." onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  const transfer = query.data;
  const notesByItemId = new Map(transfer.discrepancies.map((disc) => [disc.stock_transfer_item_id, disc.notes]));

  if (transfer.to_branch?.receiving_mode === 'cashier_confirm' && transfer.status === 'pending_receipt') {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader
          title={transfer.transfer_number}
          subtitle={`${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`}
          badge={<ManagerBadge label={transferStatusBadgeLabel(transfer.status)} tone={transferStatusTone(transfer.status)} />}
          showBack
        />
        <ConstrainedWidth style={styles.column}>
          <ErrorState message="This branch uses cashier confirmation. Ask the assigned cashier to open Incoming and confirm shipment arrival." />
        </ConstrainedWidth>
      </Screen>
    );
  }

  if (transfer.status !== 'pending_receipt') {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader
          title={transfer.transfer_number}
          subtitle={`${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`}
          badge={<ManagerBadge label={transferStatusBadgeLabel(transfer.status)} tone={transferStatusTone(transfer.status)} />}
          showBack
        />
        <ConstrainedWidth style={styles.column}>
          <RouteBanner
            from={{ label: transfer.from_branch?.name ?? 'Sending branch', isMain: true }}
            to={{ label: transfer.to_branch?.name ?? 'Receiving branch', isMain: false }}
            connectorIcon="paper-plane"
          />
          <SummaryCard
            rows={[
              { label: 'Created by', value: transfer.created_by_profile?.full_name ?? 'Staff details unavailable', icon: 'person-outline' },
              { label: 'Sent by', value: transfer.sent_by_profile?.full_name ?? 'Pending', icon: 'paper-plane-outline' },
              { label: 'Sent', value: formatDate(transfer.sent_at), icon: 'time-outline' },
              { label: 'Received by', value: transfer.received_by_profile?.full_name ?? 'Pending', icon: 'person-outline' },
              { label: 'Received', value: formatDate(transfer.received_at), icon: 'time-outline' },
              ...(transfer.notes ? [{ label: 'Notes', value: transfer.notes, icon: 'document-text-outline' as const }] : []),
            ]}
          />

          <Text style={styles.sectionTitle}>PRODUCTS</Text>
          {transfer.items.map((item) => {
            const difference = item.quantity_received === null ? null : item.quantity_sent - item.quantity_received;
            const note = notesByItemId.get(item.id);
            return (
              <ListRowCard
                key={item.id}
                title={item.product?.name ?? `Unavailable product (${item.product_id})`}
                subtitle={`Sent ${item.quantity_sent} · Received ${item.quantity_received === null ? 'Pending' : item.quantity_received}`}
                meta={note ? `Note: ${note}` : undefined}
                trailing={
                  difference === null ? undefined : (
                    <ManagerBadge
                      label={
                        difference === 0
                          ? 'Complete'
                          : difference > 0
                            ? `${difference} missing`
                            : `${Math.abs(difference)} excess`
                      }
                      tone={difference === 0 ? 'success' : 'warning'}
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
      <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
        <ManagerScreenHeader
          title="Review receipt"
          subtitle={transfer.transfer_number}
          showBack
        />
        <ConstrainedWidth style={styles.column}>
          {reviewItems.map((item) => (
            <ListRowCard
              key={item.id}
              title={item.product?.name ?? `Unavailable product (${item.product_id})`}
              subtitle={`Expected ${item.quantity_sent} · Received ${item.received}`}
              trailing={
                <ManagerBadge
                  label={
                    item.difference === 0
                      ? 'Complete'
                      : item.difference > 0
                        ? `${item.difference} missing`
                        : `${Math.abs(item.difference)} excess`
                  }
                  tone={item.difference === 0 ? 'success' : 'warning'}
                />
              }
            />
          ))}
          {review.notes ? <Text style={styles.meta}>Notes: {review.notes}</Text> : null}
          {mutation.error ? <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text> : null}
          <View style={styles.actions}>
            <ManagerActionButton
              label="Confirm receipt"
              loading={mutation.isPending}
              onPress={() =>
                mutation.mutate(
                  {
                    transferId: transfer.id,
                    items: reviewItems.map((item) => ({
                      stock_transfer_item_id: item.id,
                      quantity_received: item.received,
                    })),
                    notes: review.notes?.trim() || null,
                    idempotencyKey: requestKey.current,
                  },
                  {
                    onSuccess: () => {
                      setReview(null);
                      Alert.alert(
                        'Receipt confirmed',
                        'Branch inventory was updated using the actual quantities received.',
                      );
                      void query.refetch();
                    },
                  },
                )
              }
            />
            <ManagerActionButton
              label="Back to counts"
              variant="secondary"
              disabled={mutation.isPending}
              onPress={() => setReview(null)}
            />
          </View>
        </ConstrainedWidth>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title="Receive stock"
        subtitle={`${transfer.transfer_number} · ${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`}
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <Text style={styles.instructions}>
          Physically count every product. Do not assume the sent quantity was received.
        </Text>
        {fields.map((field, index) => {
          const item = transfer.items[index];
          if (!item) return null;
          return (
            <Controller
              key={field.id}
              control={control}
              name={`items.${index}.quantity_received`}
              render={({ field: quantity, fieldState }) => {
                const currentQty = Number.parseInt(quantity.value || '0', 10) || 0;
                const isFocused = focusedIndex === index;
                const atMin = currentQty <= 0;
                const matchesExpected = currentQty === item.quantity_sent;
                const step = (delta: number) => {
                  const next = Math.max(0, currentQty + delta);
                  quantity.onChange(String(next));
                };
                return (
                  <View style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.cardInfo}>
                        <Text style={styles.name} numberOfLines={2}>
                          {item.product?.name ?? `Unavailable product (${item.product_id})`}
                        </Text>
                        <Text style={styles.sku}>{item.product?.sku ?? 'Product details unavailable'}</Text>
                      </View>
                      <View style={styles.expectedPill}>
                        <Text style={styles.expectedText} numberOfLines={1}>
                          <Text style={styles.expectedValue}>{item.quantity_sent}</Text>
                          <Text style={styles.expectedLabel}> expected</Text>
                        </Text>
                      </View>
                    </View>
                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyCaption}>Actual received</Text>
                      <View style={styles.qtyControls}>
                        <View style={[styles.stepperPill, isFocused && styles.stepperPillFocused]}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Decrease received quantity for ${item.product?.name ?? 'product'}`}
                            hitSlop={6}
                            disabled={atMin}
                            onPress={() => step(-1)}
                            style={({ pressed }) => [
                              styles.stepperButton,
                              pressed && !atMin && styles.stepperButtonPressed,
                            ]}
                          >
                            <Text style={[styles.stepperSymbol, atMin && styles.stepperSymbolDisabled]}>−</Text>
                          </Pressable>
                          <TextInput
                            accessibilityLabel={`Actual received quantity for ${item.product?.name ?? 'product'}`}
                            keyboardType="number-pad"
                            value={quantity.value}
                            placeholder="0"
                            placeholderTextColor={managerColors.subtext}
                            maxLength={6}
                            selectTextOnFocus
                            underlineColorAndroid="transparent"
                            onFocus={() => setFocusedIndex(index)}
                            onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
                            onChangeText={quantity.onChange}
                            style={styles.stepperInput}
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Increase received quantity for ${item.product?.name ?? 'product'}`}
                            hitSlop={6}
                            onPress={() => step(1)}
                            style={({ pressed }) => [styles.stepperButton, pressed && styles.stepperButtonPressed]}
                          >
                            <Text style={styles.stepperSymbol}>+</Text>
                          </Pressable>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Match expected quantity of ${item.quantity_sent}`}
                          disabled={matchesExpected}
                          onPress={() => quantity.onChange(String(item.quantity_sent))}
                          style={({ pressed }) => [
                            styles.matchButton,
                            matchesExpected && styles.matchButtonDisabled,
                            pressed && !matchesExpected && styles.matchButtonPressed,
                          ]}
                        >
                          <Text style={[styles.matchButtonText, matchesExpected && styles.matchButtonTextDisabled]}>
                            Match
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                    {fieldState.error ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
                  </View>
                );
              }}
            />
          );
        })}
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
        <ManagerActionButton label="Review receipt" onPress={handleSubmit(setReview)} />
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
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
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  expectedPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: managerColors.cardSurface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  expectedText: { fontSize: 13 },
  expectedValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  expectedLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
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
  matchButton: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#EAF0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchButtonPressed: { opacity: 0.7 },
  matchButtonDisabled: { backgroundColor: managerColors.cardSurface },
  matchButtonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  matchButtonTextDisabled: { color: managerColors.cardBorder },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  instructions: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldError: { fontFamily: 'Inter_500Medium' },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  actions: { gap: 10 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: 8,
  },
});
