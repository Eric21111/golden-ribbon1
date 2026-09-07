import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { TransferDetailsView } from '@/features/transfers/TransferDetailsView';
import { useReceiveTransfer, useTransfer } from '@/hooks/useTransfers';
import { getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';

const schema = z.object({
  items: z.array(z.object({
    stock_transfer_item_id: z.string(),
    quantity_received: z.string().min(1, 'Enter the physical count.').regex(/^\d+$/, 'Enter a whole number of zero or greater.'),
  })).min(1),
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
  const { control, handleSubmit, reset } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { items: [], notes: '' } });
  const { fields } = useFieldArray({ control, name: 'items' });

  useEffect(() => {
    if (query.data && !formInitialized.current) {
      reset({ items: query.data.items.map((item) => ({ stock_transfer_item_id: item.id, quantity_received: '' })), notes: '' });
      formInitialized.current = true;
    }
  }, [query.data, reset]);

  const reviewItems = useMemo(() => review?.items.map((value) => {
    const transferItem = query.data?.items.find((item) => item.id === value.stock_transfer_item_id);
    const received = Number(value.quantity_received);
    return transferItem ? { ...transferItem, received, difference: transferItem.quantity_sent - received } : null;
  }).filter((item) => item !== null) ?? [], [query.data?.items, review]);

  if (query.isLoading) return <LoadingState label="Loading transfer…" />;
  if (query.error || !query.data) return <Screen><ErrorState message="Unable to load transfer." onRetry={() => void query.refetch()} /></Screen>;
  const transfer = query.data;

  if (transfer.status !== 'pending_receipt') {
    return <Screen><PageHeader title="Transfer receipt" subtitle="This transfer is no longer pending." /><TransferDetailsView transfer={transfer} /></Screen>;
  }

  if (review) {
    return (
      <Screen>
        <PageHeader title="Review receipt" subtitle={`${transfer.transfer_number} · Confirm the physical counts below.`} />
        {reviewItems.map((item) => (
          <View key={item.id} style={[styles.card, item.difference !== 0 && styles.warningCard]}>
            <Text style={styles.name}>{item.product?.name ?? `Unavailable product (${item.product_id})`}</Text>
            <Text style={styles.meta}>Expected: {item.quantity_sent}</Text>
            <Text style={styles.received}>Received: {item.received}</Text>
            <Text style={item.difference === 0 ? styles.complete : styles.warning}>
              {item.difference === 0 ? 'Complete' : item.difference > 0 ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}
            </Text>
          </View>
        ))}
        {review.notes ? <Text style={styles.meta}>Notes: {review.notes}</Text> : null}
        {mutation.error ? <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text> : null}
        <AppButton label="Confirm receipt" loading={mutation.isPending} onPress={() => mutation.mutate({
          transferId: transfer.id,
          items: reviewItems.map((item) => ({ stock_transfer_item_id: item.id, quantity_received: item.received })),
          notes: review.notes?.trim() || null,
          idempotencyKey: requestKey.current,
        }, { onSuccess: () => { setReview(null); Alert.alert('Receipt confirmed', 'Branch inventory was updated using the actual quantities received.'); void query.refetch(); } })} />
        <AppButton label="Back to counts" variant="secondary" disabled={mutation.isPending} onPress={() => setReview(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Receive stock" subtitle={`${transfer.transfer_number} · ${transfer.from_branch?.name ?? 'Sending branch'} → ${transfer.to_branch?.name ?? 'Receiving branch'}`} />
      <Text style={styles.instructions}>Physically count every product. Do not assume the sent quantity was received.</Text>
      {fields.map((field, index) => {
        const item = transfer.items[index];
        if (!item) return null;
        return (
          <View key={field.id} style={styles.card}>
            <Text style={styles.name}>{item.product?.name ?? `Unavailable product (${item.product_id})`}</Text>
            <Text style={styles.meta}>{item.product?.sku ?? 'Product details unavailable'} · Expected: {item.quantity_sent}</Text>
            <Controller control={control} name={`items.${index}.quantity_received`} render={({ field: quantity, fieldState }) => (
              <FormField label="Actual received" value={quantity.value} onChangeText={quantity.onChange} keyboardType="number-pad" error={fieldState.error?.message} />
            )} />
          </View>
        );
      })}
      <Controller control={control} name="notes" render={({ field }) => <FormField label="Receipt notes (optional)" value={field.value ?? ''} onChangeText={field.onChange} multiline />} />
      <AppButton label="Review receipt" onPress={handleSubmit(setReview)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  warningCard: { borderColor: '#FCA5A5', backgroundColor: '#FFF7F7' },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  received: { color: colors.primary, fontSize: 17, fontWeight: '800' },
  complete: { color: colors.success, fontSize: 14, fontWeight: '800' },
  warning: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  instructions: { color: colors.text, fontSize: 14, lineHeight: 21 },
});
