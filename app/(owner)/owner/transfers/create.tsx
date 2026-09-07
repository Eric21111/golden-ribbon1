import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { BranchSelector } from '@/features/inventory/BranchSelector';
import { useBranches } from '@/hooks/useBranches';
import { useInventory } from '@/hooks/useInventory';
import { useSendTransfer } from '@/hooks/useTransfers';
import { getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';

const schema = z.object({
  destinationBranchId: z.string().min(1, 'Select a destination branch.'),
  items: z.array(z.object({ product_id: z.string(), quantity: z.string().regex(/^\d*$/, 'Enter a whole number.') })),
  notes: z.string().max(1000).optional(),
}).refine((data) => data.items.some((item) => Number(item.quantity) > 0), { message: 'Enter a send quantity for at least one product.', path: ['items', 'root'] });
type Values = z.infer<typeof schema>;

export default function CreateTransferScreen() {
  const [review, setReview] = useState<Values | null>(null);
  const requestKey = useRef(makeIdempotencyKey('send'));
  const formInitialized = useRef(false);
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const destinations = branches.data?.filter((branch) => !branch.is_main_branch && branch.is_active) ?? [];
  const inventory = useInventory(mainBranch, true);
  const mutation = useSendTransfer();
  const { control, handleSubmit, reset, setValue, watch, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { destinationBranchId: '', items: [], notes: '' } });
  const { fields } = useFieldArray({ control, name: 'items' });
  const selectedBranchId = watch('destinationBranchId');

  useEffect(() => {
    if (inventory.data && !formInitialized.current) {
      reset({ destinationBranchId: '', items: inventory.data.map((item) => ({ product_id: item.product.id, quantity: '' })), notes: '' });
      formInitialized.current = true;
    }
  }, [inventory.data, reset]);

  const selectedItems = useMemo(() => review?.items.flatMap((item) => {
    const quantity = Number(item.quantity);
    const inventoryItem = inventory.data?.find((candidate) => candidate.product.id === item.product_id);
    return quantity > 0 && inventoryItem ? [{ ...inventoryItem, quantity }] : [];
  }) ?? [], [inventory.data, review]);

  if (branches.isLoading || inventory.isLoading) return <LoadingState label="Preparing stock transfer…" />;
  if (!mainBranch || branches.error || inventory.error) return <Screen><ErrorState message="Unable to load Main Branch inventory." /></Screen>;

  if (review) {
    const destination = destinations.find((branch) => branch.id === review.destinationBranchId);
    return (
      <Screen>
        <PageHeader title="Review transfer" subtitle={`Main Branch → ${destination?.name ?? 'Unknown branch'}`} />
        {selectedItems.map((item) => (
          <View key={item.product.id} style={styles.card}>
            <Text style={styles.name}>{item.product.name}</Text>
            <Text style={styles.meta}>Available: {item.quantity_on_hand}</Text>
            <Text style={styles.quantity}>Send: {item.quantity}</Text>
            {item.quantity > item.quantity_on_hand ? <Text style={styles.error}>Insufficient stock</Text> : null}
          </View>
        ))}
        {review.notes ? <Text style={styles.notes}>Notes: {review.notes}</Text> : null}
        {mutation.error ? <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text> : null}
        <AppButton label="Confirm and send" loading={mutation.isPending} disabled={selectedItems.some((item) => item.quantity > item.quantity_on_hand)} onPress={() => mutation.mutate({
          destinationBranchId: review.destinationBranchId,
          items: selectedItems.map((item) => ({ product_id: item.product.id, quantity_sent: item.quantity })),
          notes: review.notes?.trim() || null,
          idempotencyKey: requestKey.current,
        }, { onSuccess: (id) => router.replace({ pathname: '/owner/transfers/[id]', params: { id } }) })} />
        <AppButton label="Back to edit" variant="secondary" disabled={mutation.isPending} onPress={() => setReview(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Send stock" subtitle="Choose a selling branch and enter quantities from current Main Branch stock." />
      <Text style={styles.label}>Destination branch</Text>
      <BranchSelector branches={destinations} value={selectedBranchId} onChange={(id) => setValue('destinationBranchId', id, { shouldValidate: true })} />
      {formState.errors.destinationBranchId?.message ? <Text style={styles.error}>{formState.errors.destinationBranchId.message}</Text> : null}
      {fields.map((field, index) => {
        const item = inventory.data?.[index];
        if (!item) return null;
        return (
          <View key={field.id} style={styles.card}>
            <Text style={styles.name}>{item.product.name}</Text>
            <Text style={styles.meta}>{item.product.sku} · Available: {item.quantity_on_hand}</Text>
            <Controller control={control} name={`items.${index}.quantity`} render={({ field: quantity, fieldState }) => <FormField label="Send quantity" value={quantity.value} onChangeText={quantity.onChange} keyboardType="number-pad" error={fieldState.error?.message} />} />
          </View>
        );
      })}
      <Controller control={control} name="notes" render={({ field }) => <FormField label="Transfer notes (optional)" value={field.value ?? ''} onChangeText={field.onChange} multiline />} />
      {formState.errors.items?.root?.message ? <Text style={styles.error}>{formState.errors.items.root.message}</Text> : null}
      <AppButton label="Review transfer" onPress={handleSubmit(setReview)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  quantity: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  notes: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
