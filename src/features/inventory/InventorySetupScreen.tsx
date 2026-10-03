import Ionicons from '@react-native-vector-icons/ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { LinearGradient } from 'expo-linear-gradient';
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
import { managerColors, managerGradients } from '@/components/dashboard/theme';
import { useBranches } from '@/hooks/useBranches';
import { useClientPagination } from '@/hooks/useClientPagination';
import { useInitializeMainInventory, useInventory } from '@/hooks/useInventory';
import { getInventoryErrorMessage } from '@/lib/errors';
import { formatLiveStock, isValidPieceQuantity, PIECE_QUANTITY_MAX_LENGTH } from '@/lib/format';

const schema = z
  .object({
    items: z.array(
      z.object({
        product_id: z.string(),
        quantity: z.string().regex(/^(\d{1,6}(\.\d{1,3})?)?$/, 'Enter a quantity.'),
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
  const [review, setReview] = useState<Values | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<SortOption>('pending');
  const [sortOpen, setSortOpen] = useState(false);
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState('');
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  // Include inactive products so newly created (inactive) items can receive opening stock.
  const inventory = useInventory(mainBranch, false);
  const mutation = useInitializeMainInventory();
  const { control, handleSubmit, reset, getValues, watch, setValue, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { items: [], notes: '' },
  });
  const { fields } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');
  // "Completed" / "remaining" track this encoding session (a quantity typed in now), not whether
  // the product already had stock before opening this screen — see the progress line above the
  // list for lifetime "Not set" status instead.
  const completedCount = watchedItems.filter((item) => Number(item.quantity) > 0).length;
  const totalSelectedQuantity = watchedItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const indexByProductId = useMemo(() => new Map(fields.map((f, i) => [f.product_id, i])), [fields]);

  const applyQuantityToIds = (ids: string[], value: string) => {
    ids.forEach((id) => {
      const index = indexByProductId.get(id);
      if (index === undefined) return;
      setValue(`items.${index}.quantity`, value, { shouldValidate: false, shouldDirty: true });
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        // "Has stock" means currently holds a positive quantity — not merely "has a balance row",
        // which would also match products already initialized to 0 and defeat the filter.
        if (filter === 'has_stock' && row.item.quantity_on_hand <= 0) return false;
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

  // Bulk actions act on everything matching the current search/filter, not just the current
  // page — pagination is a rendering detail, not a scope limit on "visible" for this purpose.
  const visibleProductIds = useMemo(() => displayIndexes.map((row) => row.field.product_id), [displayIndexes]);
  const allVisibleSelected = visibleProductIds.length > 0 && visibleProductIds.every((id) => selectedIds.has(id));
  const toggleSelectAllVisible = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        visibleProductIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...visibleProductIds]);
    });
  };

  const totalCount = inventory.data?.length ?? 0;

  const selectedItems = useMemo(
    () =>
      review?.items.flatMap((item) => {
        const quantity = Number(item.quantity);
        const inventoryItem = inventory.data?.find((candidate) => candidate.product.id === item.product_id);
        if (quantity <= 0 || !inventoryItem) return [];
        if (!isValidPieceQuantity(item.quantity)) return [];
        return [{ ...inventoryItem, quantity, quantityText: item.quantity.trim() }];
      }) ?? [],
    [inventory.data, review],
  );

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

  const onReview = handleSubmit((values) => {
    const invalid = values.items.some((item) => {
      if (!item.quantity.trim()) return false;
      const product = inventory.data?.find((row) => row.product.id === item.product_id)?.product;
      return !product || !isValidPieceQuantity(item.quantity);
    });
    if (invalid) return;
    setReview(values);
  });

  if (review) {
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
        <View style={styles.layout}>
          <ManagerScreenHeader title="Review opening stock" showBack />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.reviewListCard}>
              {selectedItems.map((item, index) => (
                <View
                  key={item.product.id}
                  style={[styles.reviewRow, index < selectedItems.length - 1 && styles.reviewRowDivider]}
                >
                  <View style={styles.reviewRowInfo}>
                    <Text style={styles.name} numberOfLines={2}>
                      {item.product.name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.product.sku}
                    </Text>
                  </View>
                  <View style={styles.reviewRowStat}>
                    <Text style={styles.reviewRowStatValue}>{formatLiveStock(item.quantity_on_hand)}</Text>
                    <Text style={styles.reviewRowStatLabel}>Current</Text>
                  </View>
                  <View style={styles.reviewRowStat}>
                    <Text style={[styles.reviewRowStatValue, styles.reviewRowStatValueEmphasis]}>
                      {formatLiveStock(item.quantity)}
                    </Text>
                    <Text style={styles.reviewRowStatLabel}>Qty</Text>
                  </View>
                </View>
              ))}
            </View>
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
            {mutation.error ? (
              <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerButtonRow}>
              <View style={styles.footerButton}>
                <ManagerActionButton
                  label="Back to edit"
                  variant="secondary"
                  disabled={mutation.isPending}
                  onPress={() => setReview(null)}
                />
              </View>
              <View style={styles.footerButton}>
                <ManagerActionButton
                  label="Confirm"
                  icon="checkmark-circle-outline"
                  loading={mutation.isPending}
                  disabled={selectedItems.length === 0}
                  onPress={() =>
                    mutation.mutate(
                      {
                        items: selectedItems.map((item) => ({
                          product_id: item.product.id,
                          quantity: item.quantityText,
                        })),
                        notes: getValues('notes')?.trim() || null,
                      },
                      {
                        onSuccess: () => {
                          setReview(null);
                          setSelectedIds(new Set());
                          setBulkValue('');
                          reset({
                            items: getValues('items').map((item) => ({ ...item, quantity: '' })),
                            notes: '',
                          });
                        },
                      },
                    )
                  }
                />
              </View>
            </View>
          </View>
        </View>
      </Screen>
    );
  }

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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open bulk actions"
              onPress={() => setBulkSheetOpen(true)}
              style={({ pressed }) => [styles.bulkTrigger, pressed && styles.pressed]}
            >
              <View style={styles.bulkTriggerLeft}>
                <Ionicons name="layers-outline" size={18} color={managerColors.royalBlue} />
                <Text style={styles.bulkTriggerLabel}>Bulk actions</Text>
                {selectedIds.size > 0 ? (
                  <View style={styles.bulkCountPill}>
                    <Text style={styles.bulkCountText}>{selectedIds.size} selected</Text>
                  </View>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} />
            </Pressable>
          ) : null}

          {pagination.pageItems.map(({ field, index, item }) => {
            if (!item) return null;
            const initialized = item.updated_at !== null;

            return (
              <Controller
                key={field.id}
                control={control}
                name={`items.${index}.quantity`}
                render={({ field: quantity, fieldState }) => {
                  const currentQty = Number.parseInt(quantity.value || '0', 10) || 0;
                  const isFocused = focusedIndex === index;
                  const atMin = currentQty <= 0;
                  const step = (delta: number) => {
                    const next = Math.max(0, currentQty + delta);
                    quantity.onChange(String(next));
                  };
                  return (
                    <View>
                      <View style={[styles.card, currentQty > 0 && styles.cardSelected]}>
                        <View style={styles.cardTop}>
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selectedIds.has(item.product.id) }}
                            accessibilityLabel={`Select ${item.product.name} for bulk actions`}
                            hitSlop={8}
                            onPress={() => toggleSelected(item.product.id)}
                            style={styles.checkbox}
                          >
                            <Ionicons
                              name={selectedIds.has(item.product.id) ? 'checkbox' : 'square-outline'}
                              size={22}
                              color={selectedIds.has(item.product.id) ? managerColors.royalBlue : managerColors.cardBorder}
                            />
                          </Pressable>
                          <View style={styles.cardInfo}>
                            <Text style={styles.name} numberOfLines={2}>{item.product.name}</Text>
                            <Text style={styles.sku}>{item.product.sku}</Text>
                            {!initialized ? (
                              <View style={styles.badge}>
                                <Text style={styles.badgeLabel}>Not set</Text>
                              </View>
                            ) : null}
                          </View>
                          <View style={styles.availablePill}>
                            {initialized ? (
                              <Text style={styles.availableText} numberOfLines={1}>
                                <Text style={styles.availableValue}>{formatLiveStock(item.quantity_on_hand)}</Text>
                                <Text style={styles.availableLabel}> current</Text>
                              </Text>
                            ) : (
                              <Text style={styles.availableLabel} numberOfLines={1}>
                                No stock yet
                              </Text>
                            )}
                          </View>
                        </View>
                        <View style={styles.qtyRow}>
                          <Text style={styles.qtyCaption}>Qty</Text>
                          <View style={[styles.stepperPill, isFocused && styles.stepperPillFocused]}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Decrease quantity for ${item.product.name}`}
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
                              accessibilityLabel={`${initialized ? 'Add quantity' : 'Opening quantity'} for ${item.product.name}`}
                              value={quantity.value}
                              onChangeText={(value) => {
                                if (value === '' || /^\d{0,6}$/.test(value)) quantity.onChange(value);
                              }}
                              keyboardType="number-pad"
                              placeholder="0"
                              placeholderTextColor={managerColors.subtext}
                              maxLength={PIECE_QUANTITY_MAX_LENGTH}
                              selectTextOnFocus
                              underlineColorAndroid="transparent"
                              onFocus={() => setFocusedIndex(index)}
                              onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
                              style={[styles.input, fieldState.error && styles.inputError]}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Increase quantity for ${item.product.name}`}
                              hitSlop={6}
                              onPress={() => step(1)}
                              style={({ pressed }) => [styles.stepperButton, pressed && styles.stepperButtonPressed]}
                            >
                              <Text style={styles.stepperSymbol}>+</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                      {fieldState.error?.message ? (
                        <Text style={styles.rowError}>{fieldState.error.message}</Text>
                      ) : null}
                    </View>
                  );
                }}
              />
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
            {totalCount > 0 ? (
              <View style={styles.stickySummary}>
                <View style={styles.stickySummaryItem}>
                  <Text style={styles.stickySummaryValue}>{completedCount}</Text>
                  <Text style={styles.stickySummaryLabel}>completed</Text>
                </View>
                <View style={styles.stickySummaryDivider} />
                <View style={styles.stickySummaryItem}>
                  <Text style={styles.stickySummaryValue}>{totalCount - completedCount}</Text>
                  <Text style={styles.stickySummaryLabel}>remaining</Text>
                </View>
                <View style={styles.stickySummaryDivider} />
                <View style={styles.stickySummaryItem}>
                  <Text style={styles.stickySummaryValue}>{formatLiveStock(totalSelectedQuantity)}</Text>
                  <Text style={styles.stickySummaryLabel}>total units</Text>
                </View>
              </View>
            ) : null}
            <ManagerActionButton
              label="Review opening stock"
              icon="checkmark-circle-outline"
              onPress={onReview}
            />
          </View>
        ) : null}
      </View>

      <ManagerBottomSheet visible={bulkSheetOpen} title="Bulk actions" onClose={() => setBulkSheetOpen(false)}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allVisibleSelected }}
          onPress={toggleSelectAllVisible}
          style={({ pressed }) => [styles.bulkHeaderRow, pressed && styles.pressed]}
        >
          <View style={styles.bulkSelectAll}>
            <Ionicons
              name={allVisibleSelected ? 'checkbox' : 'square-outline'}
              size={22}
              color={allVisibleSelected ? managerColors.royalBlue : managerColors.subtext}
            />
            <Text style={styles.bulkSelectAllLabel}>
              {allVisibleSelected ? 'Clear selection' : `Select all (${visibleProductIds.length})`}
            </Text>
          </View>
          {selectedIds.size > 0 ? (
            <View style={styles.bulkCountPill}>
              <Text style={styles.bulkCountText}>{selectedIds.size} selected</Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.bulkDivider} />

        <View style={styles.bulkStepperPill}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease bulk quantity"
            hitSlop={8}
            onPress={() => {
              const current = Number.parseInt(bulkValue || '0', 10) || 0;
              setBulkValue(String(Math.max(0, current - 1)));
            }}
            style={({ pressed }) => [styles.bulkStepperButton, pressed && styles.bulkStepperButtonPressed]}
          >
            <Text style={styles.bulkStepperSymbol}>−</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Bulk quantity value"
            value={bulkValue}
            onChangeText={(value) => {
              if (value === '' || /^\d{0,6}$/.test(value)) setBulkValue(value);
            }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={managerColors.subtext}
            maxLength={PIECE_QUANTITY_MAX_LENGTH}
            style={styles.bulkStepperInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase bulk quantity"
            hitSlop={8}
            onPress={() => {
              const current = Number.parseInt(bulkValue || '0', 10) || 0;
              setBulkValue(String(current + 1));
            }}
            style={({ pressed }) => [styles.bulkStepperButton, pressed && styles.bulkStepperButtonPressed]}
          >
            <Text style={styles.bulkStepperSymbol}>+</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            applyQuantityToIds(selectedIds.size > 0 ? [...selectedIds] : visibleProductIds, '0');
            setBulkValue('');
            setSelectedIds(new Set());
            setBulkSheetOpen(false);
          }}
          style={({ pressed }) => [styles.bulkResetLink, pressed && styles.pressed]}
        >
          <Text style={styles.bulkResetLinkText}>
            {selectedIds.size > 0 ? 'Reset selected to 0' : 'Reset all to 0'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply quantity to selected products"
          disabled={selectedIds.size === 0 || bulkValue === ''}
          onPress={() => {
            applyQuantityToIds([...selectedIds], bulkValue);
            setBulkValue('');
            setSelectedIds(new Set());
            setBulkSheetOpen(false);
          }}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          {selectedIds.size === 0 || bulkValue === '' ? (
            <View style={[styles.bulkApplyButton, styles.bulkApplyButtonDisabled]}>
              <Ionicons name="checkmark-circle" size={18} color={managerColors.subtext} />
              <Text style={[styles.bulkApplyButtonText, styles.bulkApplyButtonTextDisabled]}>
                Select products to apply
              </Text>
            </View>
          ) : (
            <LinearGradient
              colors={managerGradients.hero}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.bulkApplyButton}
            >
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              <Text style={styles.bulkApplyButtonText}>Apply to {selectedIds.size} selected</Text>
            </LinearGradient>
          )}
        </Pressable>
      </ManagerBottomSheet>

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
  bulkTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  bulkTriggerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  bulkTriggerLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  bulkHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bulkSelectAll: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulkSelectAllLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  bulkCountPill: {
    backgroundColor: '#EAF0FB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bulkCountText: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  bulkDivider: { height: 1, backgroundColor: managerColors.cardBorder, marginVertical: 4 },
  bulkStepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    height: 52,
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: managerColors.cardSurface,
    overflow: 'hidden',
  },
  bulkStepperButton: { width: 48, height: 52, alignItems: 'center', justifyContent: 'center' },
  bulkStepperButtonPressed: { backgroundColor: '#E4E9F2' },
  bulkStepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20, lineHeight: 24 },
  bulkStepperInput: {
    width: 76,
    height: 52,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    textAlign: 'center',
    paddingVertical: 0,
  },
  bulkApplyButton: {
    height: 48,
    flexDirection: 'row',
    gap: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkApplyButtonDisabled: { backgroundColor: managerColors.cardSurface },
  bulkApplyButtonText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  bulkApplyButtonTextDisabled: { color: managerColors.subtext },
  bulkResetLink: { alignSelf: 'center', paddingVertical: 4 },
  bulkResetLinkText: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  checkbox: { paddingTop: 2 },
  card: {
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F8FAFE' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardInfo: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15.5 },
  sku: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  badgeLabel: { color: '#92400E', fontFamily: 'Inter_700Bold', fontSize: 11 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12.5 },
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
  stepperPillFocused: { borderColor: managerColors.royalBlue, backgroundColor: '#FFFFFF' },
  stepperButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperButtonPressed: { backgroundColor: '#E4E9F2' },
  stepperSymbol: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 20 },
  stepperSymbolDisabled: { color: managerColors.cardBorder },
  input: {
    width: 48,
    height: 40,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    textAlign: 'center',
    paddingVertical: 0,
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
  footerButtonRow: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  stickySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAF0FB',
    borderRadius: 12,
    paddingVertical: 10,
  },
  stickySummaryItem: { flex: 1, alignItems: 'center', gap: 1 },
  stickySummaryValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 17 },
  stickySummaryLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  stickySummaryDivider: { width: 1, height: 28, backgroundColor: '#C7D6F2' },
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
  reviewListCard: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16 },
  reviewRowDivider: { borderBottomWidth: 1, borderBottomColor: managerColors.cardBorder },
  reviewRowInfo: { flex: 1, minWidth: 0, gap: 4 },
  reviewRowStat: { alignItems: 'center', gap: 3, minWidth: 48 },
  reviewRowStatValue: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  reviewRowStatValueEmphasis: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 15 },
  reviewRowStatLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 10.5 },
});
