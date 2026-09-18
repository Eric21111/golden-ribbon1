import Ionicons from '@react-native-vector-icons/ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { RouteBanner } from '@/components/dashboard/RouteBanner';
import { managerColors } from '@/components/dashboard/theme';
import { useBranchProducts } from '@/hooks/useBranchProducts';
import { useBranches } from '@/hooks/useBranches';
import { useInventory } from '@/hooks/useInventory';
import { useSendTransfer } from '@/hooks/useTransfers';
import { getInventoryErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';

const schema = z
  .object({
    destinationBranchId: z.string().min(1, 'Select a destination branch.'),
    items: z.array(
      z.object({
        product_id: z.string(),
        quantity: z.string().regex(/^\d*$/, 'Enter a whole number.'),
      }),
    ),
    notes: z.string().max(1000).optional(),
  })
  .refine((data) => data.items.some((item) => Number(item.quantity) > 0), {
    message: 'Enter a send quantity for at least one product.',
    path: ['items', 'root'],
  });
type Values = z.infer<typeof schema>;

export function CreateTransferScreen() {
  const [review, setReview] = useState<Values | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const requestKey = useRef(makeIdempotencyKey('send'));
  const formInitialized = useRef(false);
  const branches = useBranches();
  const mainBranch = branches.data?.find((branch) => branch.is_main_branch);
  const destinations = branches.data?.filter((branch) => !branch.is_main_branch && branch.is_active) ?? [];
  const inventory = useInventory(mainBranch, true);
  const mutation = useSendTransfer();
  const { control, handleSubmit, reset, setValue, watch, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { destinationBranchId: '', items: [], notes: '' },
  });
  const { fields } = useFieldArray({ control, name: 'items' });
  const selectedBranchId = watch('destinationBranchId');
  const destinationCatalog = useBranchProducts(selectedBranchId, true);
  const enabledProductIds = useMemo(
    () => new Set((destinationCatalog.data ?? []).map((entry) => entry.product_id)),
    [destinationCatalog.data],
  );

  useEffect(() => {
    if (inventory.data && !formInitialized.current) {
      reset({
        destinationBranchId: '',
        items: inventory.data.map((item) => ({ product_id: item.product.id, quantity: '' })),
        notes: '',
      });
      formInitialized.current = true;
    }
  }, [inventory.data, reset]);

  const selectedItems = useMemo(
    () =>
      review?.items.flatMap((item) => {
        const quantity = Number(item.quantity);
        const inventoryItem = inventory.data?.find((candidate) => candidate.product.id === item.product_id);
        return quantity > 0 && inventoryItem && enabledProductIds.has(item.product_id)
          ? [{ ...inventoryItem, quantity }]
          : [];
      }) ?? [],
    [enabledProductIds, inventory.data, review],
  );

  const selectDestination = (nextBranchId: string) => {
    if (nextBranchId === selectedBranchId) return;
    setValue('destinationBranchId', nextBranchId, { shouldValidate: true });
    fields.forEach((_field, index) => {
      setValue(`items.${index}.quantity`, '', { shouldValidate: false });
    });
  };

  if (branches.isLoading || inventory.isLoading) {
    return <LoadingState label="Preparing stock transfer…" />;
  }
  if (!mainBranch || branches.error || inventory.error) {
    return (
      <Screen backgroundColor="#FFFFFF">
        <ErrorState message="Unable to load Main Branch inventory." />
      </Screen>
    );
  }

  if (review) {
    const destination = destinations.find((branch) => branch.id === review.destinationBranchId);
    return (
      <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
        <View style={styles.layout}>
          <ManagerScreenHeader title="Review transfer" showBack />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <RouteBanner
              from={{ label: 'Main Branch', isMain: true }}
              to={{ label: destination?.name ?? 'Unknown branch', isMain: false }}
              connectorIcon="paper-plane"
            />

            {selectedItems.map((item) => {
              const insufficient = item.quantity > item.quantity_on_hand;
              return (
                <View key={item.product.id} style={styles.reviewCard}>
                  <View style={styles.reviewTop}>
                    <View style={styles.reviewInfo}>
                      <Text style={styles.name} numberOfLines={2}>
                        {item.product.name}
                      </Text>
                      <Text style={styles.sku}>{item.product.sku}</Text>
                    </View>
                    <View style={[styles.sendPill, insufficient && styles.sendPillWarning]}>
                      <Text style={[styles.sendValue, insufficient && styles.sendValueWarning]}>{item.quantity}</Text>
                      <Text style={styles.sendLabel}>to send</Text>
                    </View>
                  </View>
                  <View style={styles.reviewFooter}>
                    <Text style={styles.available}>Available: {item.quantity_on_hand}</Text>
                    {insufficient ? <ManagerBadge label="Insufficient stock" tone="danger" /> : null}
                  </View>
                </View>
              );
            })}
            {review.notes ? <Text style={styles.body}>Notes: {review.notes}</Text> : null}
            {mutation.error ? (
              <Text style={styles.error}>{getInventoryErrorMessage(mutation.error)}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <ManagerActionButton
              label="Confirm and send"
              icon="checkmark-circle-outline"
              loading={mutation.isPending}
              disabled={
                selectedItems.length === 0 ||
                selectedItems.some((item) => item.quantity > item.quantity_on_hand)
              }
              onPress={() =>
                mutation.mutate(
                  {
                    destinationBranchId: review.destinationBranchId,
                    items: selectedItems.map((item) => ({
                      product_id: item.product.id,
                      quantity_sent: item.quantity,
                    })),
                    notes: review.notes?.trim() || null,
                    idempotencyKey: requestKey.current,
                  },
                  {
                    onSuccess: (id) =>
                      router.replace({ pathname: '/manager/transfers/[id]', params: { id } } as never),
                  },
                )
              }
            />
            <ManagerActionButton
              label="Back to edit"
              variant="secondary"
              disabled={mutation.isPending}
              onPress={() => setReview(null)}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <View style={styles.layout}>
        <ManagerScreenHeader title="Send stock" showBack />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.label}>Destination branch</Text>
          <View style={styles.branchOptions}>
            {destinations.map((branch) => {
              const selected = branch.id === selectedBranchId;
              return (
                <Pressable
                  key={branch.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => selectDestination(branch.id)}
                  style={({ pressed }) => [
                    styles.branchOption,
                    selected && styles.branchOptionSelected,
                    pressed && styles.branchOptionPressed,
                  ]}
                >
                  {selected ? (
                    <View style={styles.branchOptionCheck}>
                      <Ionicons name="checkmark-circle" size={18} color={managerColors.royalBlue} />
                    </View>
                  ) : null}
                  <View style={[styles.branchOptionIconChip, selected && styles.branchOptionIconChipSelected]}>
                    <Ionicons
                      name="storefront-outline"
                      size={20}
                      color={selected ? '#FFFFFF' : managerColors.royalBlue}
                    />
                  </View>
                  <Text style={[styles.branchOptionLabel, selected && styles.branchOptionLabelSelected]}>
                    {branch.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {formState.errors.destinationBranchId?.message ? (
            <Text style={styles.error}>{formState.errors.destinationBranchId.message}</Text>
          ) : null}
          {selectedBranchId && destinationCatalog.isLoading ? (
            <LoadingState label="Loading destination catalog…" />
          ) : null}
          {destinationCatalog.error ? (
            <ErrorState
              message="Unable to load the destination branch catalog."
              onRetry={() => void destinationCatalog.refetch()}
            />
          ) : null}
          {selectedBranchId &&
          !destinationCatalog.isLoading &&
          !destinationCatalog.error &&
          enabledProductIds.size === 0 ? (
            <Text style={styles.body}>
              This branch has no enabled products. Configure its branch catalog before sending stock.
            </Text>
          ) : null}
          {fields.map((field, index) => {
            const item = inventory.data?.[index];
            if (!item || !selectedBranchId || !enabledProductIds.has(item.product.id)) return null;
            return (
              <Controller
                key={field.id}
                control={control}
                name={`items.${index}.quantity`}
                render={({ field: quantity }) => {
                  const currentQty = Number.parseInt(quantity.value || '0', 10) || 0;
                  const isFocused = focusedIndex === index;
                  const atMin = currentQty <= 0;
                  const atMax = currentQty >= item.quantity_on_hand;
                  const step = (delta: number) => {
                    const next = Math.min(item.quantity_on_hand, Math.max(0, currentQty + delta));
                    quantity.onChange(String(next));
                  };
                  return (
                    <View style={styles.card}>
                      <View style={styles.cardTop}>
                        <View style={styles.cardInfo}>
                          <Text style={styles.name} numberOfLines={2}>
                            {item.product.name}
                          </Text>
                          <Text style={styles.sku}>{item.product.sku}</Text>
                        </View>
                        <View style={styles.availablePill}>
                          <Text style={styles.availableText} numberOfLines={1}>
                            <Text style={styles.availableValue}>{item.quantity_on_hand}</Text>
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
                              accessibilityLabel={`Send quantity for ${item.product.name}`}
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
                              accessibilityLabel={`Increase quantity for ${item.product.name}`}
                              hitSlop={6}
                              disabled={atMax}
                              onPress={() => step(1)}
                              style={({ pressed }) => [
                                styles.stepperButton,
                                pressed && !atMax && styles.stepperButtonPressed,
                              ]}
                            >
                              <Text style={[styles.stepperSymbol, atMax && styles.stepperSymbolDisabled]}>+</Text>
                            </Pressable>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Send all ${item.quantity_on_hand} available`}
                            disabled={atMax}
                            onPress={() => quantity.onChange(String(item.quantity_on_hand))}
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
                }}
              />
            );
          })}
          {formState.errors.items?.root?.message ? (
            <Text style={styles.error}>{formState.errors.items.root.message}</Text>
          ) : null}
        </ScrollView>

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
            label="Review transfer"
            disabled={
              !selectedBranchId ||
              destinationCatalog.isLoading ||
              Boolean(destinationCatalog.error) ||
              enabledProductIds.size === 0
            }
            onPress={handleSubmit(setReview)}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 20,
  },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: -2 },
  branchOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  branchOption: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  branchOptionSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#F4F7FE' },
  branchOptionPressed: { opacity: 0.8 },
  branchOptionCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
  },
  branchOptionIconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE8FC',
  },
  branchOptionIconChipSelected: { backgroundColor: managerColors.royalBlue },
  branchOptionLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  branchOptionLabelSelected: { color: managerColors.royalBlue },
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
  reviewCard: {
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
  reviewTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reviewInfo: { flex: 1, minWidth: 0, gap: 2 },
  sendPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 76,
  },
  sendPillWarning: { backgroundColor: '#FEE2E2' },
  sendValue: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold', fontSize: 18 },
  sendValueWarning: { color: '#B91C1C' },
  sendLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 11 },
  reviewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingTop: 10,
    gap: 12,
  },
  available: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', color: managerColors.ink },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  fieldError: { fontFamily: 'Inter_500Medium' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
});
