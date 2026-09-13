import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
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
          <SummaryCard
            rows={[
              { label: 'From', value: transfer.from_branch?.name ?? 'Sending branch' },
              { label: 'To', value: transfer.to_branch?.name ?? 'Receiving branch' },
              { label: 'Created by', value: transfer.created_by_profile?.full_name ?? 'Staff details unavailable' },
              { label: 'Sent by', value: transfer.sent_by_profile?.full_name ?? 'Pending' },
              { label: 'Sent', value: formatDate(transfer.sent_at) },
              { label: 'Received by', value: transfer.received_by_profile?.full_name ?? 'Pending' },
              { label: 'Received', value: formatDate(transfer.received_at) },
              ...(transfer.notes ? [{ label: 'Notes', value: transfer.notes }] : []),
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
          subtitle={`${transfer.transfer_number} · Confirm the physical counts below`}
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
            <View key={field.id} style={styles.card}>
              <Text style={styles.name}>{item.product?.name ?? `Unavailable product (${item.product_id})`}</Text>
              <Text style={styles.meta}>
                {item.product?.sku ?? 'Product details unavailable'} · Expected: {item.quantity_sent}
              </Text>
              <Controller
                control={control}
                name={`items.${index}.quantity_received`}
                render={({ field: quantity, fieldState }) => (
                  <FormField
                    label="Actual received"
                    value={quantity.value}
                    onChangeText={quantity.onChange}
                    keyboardType="number-pad"
                    error={fieldState.error?.message}
                    accentColor={managerColors.royalBlue}
                    labelStyle={styles.fieldLabel}
                    errorStyle={styles.fieldError}
                    style={styles.fieldInput}
                  />
                )}
              />
            </View>
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
    gap: 8,
  },
  name: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
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
