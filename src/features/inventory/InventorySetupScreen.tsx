import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { useBranches } from '@/hooks/useBranches';
import { useInitializeMainInventory, useInventory } from '@/hooks/useInventory';
import { confirmAction } from '@/lib/confirmAction';
import { getInventoryErrorMessage } from '@/lib/errors';

const schema = z
  .object({
    items: z.array(
      z.object({
        product_id: z.string(),
        quantity: z.string().regex(/^\d*$/, 'Enter a whole number.'),
      }),
    ),
    notes: z.string().max(1000).optional(),
  })
  .refine((data) => data.items.some((item) => Number(item.quantity) > 0), {
    message: 'Enter an opening quantity for at least one product.',
    path: ['items', 'root'],
  });
type Values = z.infer<typeof schema>;

function sortSetupItems<T extends { updated_at: string | null; product: { name: string } }>(items: T[]) {
  return [...items].sort((a, b) => {
    const aPending = a.updated_at === null ? 0 : 1;
    const bPending = b.updated_at === null ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return a.product.name.localeCompare(b.product.name);
  });
}

export function InventorySetupScreen() {
  const productIdsRef = useRef('');
  const [search, setSearch] = useState('');
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  // Include inactive products so newly created (inactive) items can receive opening stock.
  const inventory = useInventory(mainBranch, false);
  const mutation = useInitializeMainInventory();
  const { control, handleSubmit, reset, getValues, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { items: [], notes: '' },
  });
  const { fields } = useFieldArray({ control, name: 'items' });

  const refetchBranches = branches.refetch;
  const refetchInventory = inventory.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchBranches();
      void refetchInventory();
    }, [refetchBranches, refetchInventory]),
  );

  useEffect(() => {
    if (!inventory.data) return;
    const nextIds = inventory.data.map((item) => item.product.id).sort().join('|');
    if (nextIds === productIdsRef.current) return;
    productIdsRef.current = nextIds;
    reset({
      items: sortSetupItems(inventory.data).map((item) => ({ product_id: item.product.id, quantity: '' })),
      notes: getValues('notes') ?? '',
    });
  }, [getValues, inventory.data, reset]);

  const itemsById = useMemo(() => {
    const map = new Map((inventory.data ?? []).map((item) => [item.product.id, item]));
    return map;
  }, [inventory.data]);

  const displayIndexes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return fields
      .map((field, index) => ({ field, index, item: itemsById.get(field.product_id) }))
      .filter((row) => {
        if (!row.item) return false;
        if (!term) return true;
        return `${row.item.product.name} ${row.item.product.sku}`.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        const aPending = a.item?.updated_at === null ? 0 : 1;
        const bPending = b.item?.updated_at === null ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return (a.item?.product.name ?? '').localeCompare(b.item?.product.name ?? '');
      });
  }, [fields, itemsById, search]);

  const pendingCount = useMemo(
    () => (inventory.data ?? []).filter((item) => item.updated_at === null).length,
    [inventory.data],
  );
  const totalCount = inventory.data?.length ?? 0;
  const allInitialized = totalCount > 0 && pendingCount === 0;

  if (branches.isLoading || inventory.isLoading) {
    return <LoadingState label="Preparing inventory setup…" />;
  }
  if (!mainBranch || branches.error || inventory.error) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <ErrorState message="Unable to load the active Main Branch inventory." />
      </Screen>
    );
  }

  const submit = (values: Values) => {
    const selected = values.items.flatMap((item) =>
      Number(item.quantity) > 0
        ? [{ product_id: item.product_id, quantity: Number(item.quantity) }]
        : [],
    );
    confirmAction(
      'Confirm opening stock',
      'This adds the entered quantities to Main Branch inventory, activates new products, and cannot be edited later. You can open this screen again to add more units.',
      () =>
        mutation.mutate(
          { items: selected, notes: values.notes?.trim() || null },
          {
            onSuccess: () => {
              reset({
                items: getValues('items').map((item) => ({ ...item, quantity: '' })),
                notes: '',
              });
            },
          },
        ),
    );
  };

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title="Opening stock" showBack />
        <View style={styles.searchWrap}>
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {totalCount > 0 ? (
            <Text style={styles.progress}>
              {allInitialized
                ? 'All products already have stock. Enter a quantity to add more units.'
                : `${pendingCount} of ${totalCount} product${totalCount === 1 ? '' : 's'} still need an opening quantity. You can also add more units to products that already have stock.`}
            </Text>
          ) : null}

          {displayIndexes.map(({ field, index, item }) => {
            if (!item) return null;
            const initialized = item.updated_at !== null;

            return (
              <View key={field.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.name}>{item.product.name}</Text>
                  <Text style={styles.meta}>SKU: {item.product.sku}</Text>
                  <Text style={styles.meta}>
                    {initialized
                      ? `Current quantity: ${item.quantity_on_hand}`
                      : 'Not set'}
                  </Text>
                </View>
                <Controller
                  control={control}
                  name={`items.${index}.quantity`}
                  render={({ field: quantity, fieldState }) => (
                    <>
                      <Text style={styles.inputLabel}>
                        {initialized ? 'Add quantity' : 'Opening quantity'}
                      </Text>
                      <TextInput
                        accessibilityLabel={`${initialized ? 'Add quantity' : 'Opening quantity'} for ${item.product.name}`}
                        value={quantity.value}
                        onChangeText={quantity.onChange}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={managerColors.subtext}
                        maxLength={6}
                        style={[styles.input, fieldState.error && styles.inputError]}
                      />
                      {fieldState.error ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
                    </>
                  )}
                />
              </View>
            );
          })}
          {formState.errors.items?.root?.message ? (
            <Text style={styles.error}>{formState.errors.items.root.message}</Text>
          ) : null}
          {mutation.error ? (
            <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text>
          ) : null}

        </ScrollView>

        {totalCount > 0 ? (
          <View style={styles.footer}>
            <Controller
              control={control}
              name="notes"
              render={({ field, fieldState }) => (
                <FormField
                  label="Notes (optional)"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  error={fieldState.error?.message}
                  multiline
                  labelStyle={styles.fieldLabel}
                  errorStyle={styles.fieldError}
                  accentColor={managerColors.royalBlue}
                  style={styles.fieldInput}
                />
              )}
            />
            <ManagerActionButton
              label="Confirm opening stock"
              icon="checkmark-circle-outline"
              loading={mutation.isPending}
              onPress={handleSubmit(submit)}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  searchWrap: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 20,
  },
  progress: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  card: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    backgroundColor: managerColors.cardSurface,
  },
  cardTop: { gap: 4 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
  inputLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: managerColors.ink,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  inputError: { borderColor: '#B91C1C' },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  footer: {
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
  },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
});
