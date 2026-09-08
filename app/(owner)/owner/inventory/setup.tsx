import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useBranches } from '@/hooks/useBranches';
import { useInitializeMainInventory, useInventory } from '@/hooks/useInventory';
import { getInventoryErrorMessage } from '@/lib/errors';
import { confirmAction } from '@/lib/confirmAction';

const schema = z.object({
  items: z.array(z.object({ product_id: z.string(), quantity: z.string().regex(/^\d*$/, 'Enter a whole number.') })),
  notes: z.string().max(1000).optional(),
}).refine((data) => data.items.some((item) => Number(item.quantity) > 0), { message: 'Enter an opening quantity for at least one product.', path: ['items', 'root'] });
type Values = z.infer<typeof schema>;

export default function InventorySetupScreen() {
  const formInitialized = useRef(false);
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const inventory = useInventory(mainBranch, true);
  const mutation = useInitializeMainInventory();
  const { control, handleSubmit, reset, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { items: [], notes: '' } });
  const { fields } = useFieldArray({ control, name: 'items' });

  useEffect(() => {
    if (inventory.data && !formInitialized.current) {
      reset({ items: inventory.data.map((item) => ({ product_id: item.product.id, quantity: '' })), notes: '' });
      formInitialized.current = true;
    }
  }, [inventory.data, reset]);

  if (branches.isLoading || inventory.isLoading) return <LoadingState label="Preparing inventory setup…" />;
  if (!mainBranch || branches.error || inventory.error) return <Screen constrain><ErrorState message="Unable to load the active Main Branch inventory." /></Screen>;

  const submit = (values: Values) => {
    const selected = values.items.flatMap((item) => Number(item.quantity) > 0 ? [{ product_id: item.product_id, quantity: Number(item.quantity) }] : []);
    confirmAction('Confirm opening stock', 'This creates permanent inventory movement records and cannot be edited later.',
      () => mutation.mutate(
        { items: selected, notes: values.notes?.trim() || null },
        { onSuccess: () => router.back() },
      ));
  };

  return (
    <Screen constrain>
      <PageHeader title="Opening stock" subtitle="Initialize products once for the Main Branch. Future corrections must use adjustment movements." />
      {fields.map((field, index) => {
        const item = inventory.data?.[index];
        if (!item) return null;
        const initialized = item.updated_at !== null;
        return (
          <View key={field.id} style={styles.card}>
            <Text style={styles.name}>{item.product.name}</Text>
            <Text style={styles.meta}>Current quantity: {item.quantity_on_hand}</Text>
            <Controller control={control} name={`items.${index}.quantity`} render={({ field: quantity, fieldState }) => (
              <FormField label={initialized ? 'Already initialized' : 'Opening quantity'} editable={!initialized} value={initialized ? String(item.quantity_on_hand) : quantity.value} onChangeText={quantity.onChange} keyboardType="number-pad" error={fieldState.error?.message} />
            )} />
          </View>
        );
      })}
      <Controller control={control} name="notes" render={({ field, fieldState }) => <FormField label="Notes (optional)" value={field.value ?? ''} onChangeText={field.onChange} error={fieldState.error?.message} multiline />} />
      {formState.errors.items?.root?.message ? <Text style={styles.error}>{formState.errors.items.root.message}</Text> : null}
      {mutation.error ? <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text> : null}
      <AppButton label="Confirm opening stock" loading={mutation.isPending} onPress={handleSubmit(submit)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
