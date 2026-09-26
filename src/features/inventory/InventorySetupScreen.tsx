import Ionicons from '@react-native-vector-icons/ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { FormField } from '@/components/FormField';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
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

type StockFilter = 'all' | 'not_set' | 'has_stock';
type SortOption = 'pending' | 'name-asc' | 'name-desc';

const FILTER_OPTIONS: Array<{ label: string; value: StockFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Not set', value: 'not_set' },
  { label: 'Has stock', value: 'has_stock' },
];

const SORT_OPTIONS: Array<{ label: string; value: SortOption }> = [
  { label: 'Not set first', value: 'pending' },
  { label: 'Name (A–Z)', value: 'name-asc' },
  { label: 'Name (Z–A)', value: 'name-desc' },
];

export function InventorySetupScreen() {
  const productIdsRef = useRef('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<SortOption>('pending');
  const [sortOpen, setSortOpen] = useState(false);
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
      items: inventory.data.map((item) => ({ product_id: item.product.id, quantity: '' })),
      notes: getValues('notes') ?? '',
    });
  }, [getValues, inventory.data, reset]);

  const itemsById = useMemo(() => {
    const map = new Map((inventory.data ?? []).map((item) => [item.product.id, item]));
    return map;
  }, [inventory.data]);

  const displayIndexes = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = fields
      .map((field, index) => ({ field, index, item: itemsById.get(field.product_id) }))
      .filter((row) => {
        if (!row.item) return false;
        if (filter === 'not_set' && row.item.updated_at !== null) return false;
        if (filter === 'has_stock' && row.item.updated_at === null) return false;
        if (!term) return true;
        return `${row.item.product.name} ${row.item.product.sku}`.toLowerCase().includes(term);
      });

    return rows.sort((a, b) => {
      if (sort === 'name-desc') return (b.item?.product.name ?? '').localeCompare(a.item?.product.name ?? '');
      if (sort === 'name-asc') return (a.item?.product.name ?? '').localeCompare(b.item?.product.name ?? '');
      const aPending = a.item?.updated_at === null ? 0 : 1;
      const bPending = b.item?.updated_at === null ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return (a.item?.product.name ?? '').localeCompare(b.item?.product.name ?? '');
    });
  }, [fields, itemsById, search, filter, sort]);

  const pagination = useClientPagination(displayIndexes, `${search}|${filter}|${sort}`, 10);

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

        <View style={styles.filters}>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchInput value={search} onChangeText={setSearch} placeholder="Search name or SKU" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${SORT_OPTIONS.find((option) => option.value === sort)?.label}`}
              onPress={() => setSortOpen(true)}
              style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}
            >
              <Ionicons name="options-outline" size={20} color={managerColors.ink} />
            </Pressable>
          </View>
          <FilterChipRow options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {totalCount > 0 ? (
            <View style={styles.progressBlock}>
              <Text style={styles.progress}>
                {allInitialized
                  ? `${totalCount} product${totalCount === 1 ? '' : 's'} · all have stock`
                  : `${pendingCount} of ${totalCount} product${totalCount === 1 ? '' : 's'} not set`}
              </Text>
              <Text style={styles.hint}>Enter a quantity to add stock for any product.</Text>
            </View>
          ) : null}

          {pagination.pageItems.map(({ field, index, item }) => {
            if (!item) return null;
            const initialized = item.updated_at !== null;

            return (
              <View key={field.id}>
                <View style={styles.card}>
                  <View style={styles.cardLeft}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.name} numberOfLines={2}>{item.product.name}</Text>
                      {!initialized ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeLabel}>Not set</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.product.sku}
                      {'  ·  '}
                      {initialized ? `Current: ${item.quantity_on_hand}` : 'No stock yet'}
                    </Text>
                  </View>
                  <Controller
                    control={control}
                    name={`items.${index}.quantity`}
                    render={({ field: quantity, fieldState }) => (
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
                    )}
                  />
                </View>
                {formState.errors.items?.[index]?.quantity?.message ? (
                  <Text style={styles.rowError}>{formState.errors.items[index]?.quantity?.message}</Text>
                ) : null}
              </View>
            );
          })}

          {pagination.showPagination ? (
            <View style={styles.pager}>
              <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.setPage} />
            </View>
          ) : null}

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

      <ManagerBottomSheet visible={sortOpen} title="Sort" onClose={() => setSortOpen(false)}>
        <View style={styles.sortList}>
          {SORT_OPTIONS.map((option) => {
            const isSelected = option.value === sort;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setSort(option.value);
                  setSortOpen(false);
                }}
                style={({ pressed }) => [
                  styles.sortRow,
                  isSelected && styles.sortRowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.sortRowLabel, isSelected && styles.sortRowLabelSelected]}>
                  {option.label}
                </Text>
                {isSelected ? <Ionicons name="checkmark" size={20} color={managerColors.royalBlue} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ManagerBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  filters: { gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: { flex: 1 },
  sortButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 20,
  },
  progressBlock: { gap: 2 },
  progress: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  hint: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardLeft: { flex: 1, minWidth: 0, gap: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15.5 },
  badge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeLabel: { color: '#92400E', fontFamily: 'Inter_700Bold', fontSize: 11 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  input: {
    width: 90,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    textAlign: 'center',
  },
  inputError: { borderColor: '#B91C1C' },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  rowError: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: -6, textAlign: 'right' },
  pager: { alignItems: 'center', paddingTop: 4 },
  footer: {
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
  },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  sortList: { gap: 8, paddingBottom: 8 },
  sortRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sortRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  sortRowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  sortRowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
});
