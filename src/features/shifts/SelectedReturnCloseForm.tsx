import Ionicons from '@react-native-vector-icons/ionicons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { FormField } from '@/components/FormField';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { SearchInput } from '@/components/dashboard/SearchInput';
import { managerColors } from '@/components/dashboard/theme';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { categoryRowProps } from '@/features/products/productCategoryIndicator';
import { formatCashResultLabel } from '@/features/shifts/closeDisplay';
import { alertNotice } from '@/lib/confirmAction';
import { formatLiveStock, formatMoney, PIECE_QUANTITY_MAX_LENGTH, previewCashResult } from '@/lib/format';
import {
  acceptsPieceOpsQuantityText,
  formatHalfStepDisplay,
  nudgePieceOpsQuantity,
} from '@/lib/halfStepQuantity';
import { listCashierProductCategories } from '@/services/inventoryService';
import type { CashReconciliationResult, ShiftClosePreview, ShiftReturnSelection } from '@/types/models';

const RETURN_ITEMS_HELP =
  'Select stock going back to Main Branch. The manager will count it on arrival. Unselected items stay here.';
const WASTE_HELP =
  'Enter only waste that has not already been recorded. Waste reduces the quantity available to return.';

function cashDiffColor(result: CashReconciliationResult | null, entered: string): string {
  if (!entered.trim() || result == null) return managerColors.subtext;
  if (result === 'exact') return managerColors.green;
  if (result === 'shortage') return '#B91C1C';
  return '#92400E';
}

/** Typing filter: digits + optional decimal, at most two places. */
function acceptMoneyInput(value: string): boolean {
  return /^\d*(\.\d{0,2})?$/.test(value);
}

function disabledReason({
  cashResult,
  gcashResult,
  split,
  invalidWaste,
  productIds,
}: {
  cashResult: CashReconciliationResult | null;
  gcashResult: CashReconciliationResult | null;
  split: boolean;
  invalidWaste: boolean;
  productIds: string[];
}): string | null {
  if (invalidWaste) return 'Fix waste quantities that exceed available stock.';
  if (productIds.length > 200) return 'Select up to 200 products.';
  if (cashResult == null) return split ? 'Enter cash on hand to continue.' : 'Enter collections to continue.';
  if (split && gcashResult == null) return 'Enter GCash received to continue.';
  return null;
}

export function SelectedReturnCloseForm({
  preview,
  operator,
  loading,
  footerExtra,
  onSubmit,
}: {
  preview: ShiftClosePreview;
  operator: string;
  loading: boolean;
  footerExtra?: ReactNode;
  onSubmit: (cash: string, gcash: string | undefined, selection: ShiftReturnSelection) => void;
}) {
  const [cash, setCash] = useState('');
  const [gcash, setGcash] = useState('');
  const [sheet, setSheet] = useState<'returns' | 'waste' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waste, setWaste] = useState<Record<string, string>>({});
  const [returnQuery, setReturnQuery] = useState('');

  const categories = useQuery({
    queryKey: ['cashier-product-categories'],
    staleTime: 5 * 60 * 1000,
    queryFn: listCashierProductCategories,
  });

  const split = preview.expected_gcash != null;
  const cashResult = previewCashResult(preview.expected_cash, cash);
  const gcashResult = previewCashResult(preview.expected_gcash ?? 0, gcash);

  const rows = preview.products
    .filter((p) => Number(p.system_balance_before_waste) > 0)
    .map((p) => {
      const balance = Number(p.system_balance_before_waste);
    const lost = Number(waste[p.product_id] || 0);
      const available = balance - Number(p.previously_held ?? 0);
      return { ...p, lost, available, remaining: balance - lost };
    });

  // Missing `returnable` (older payloads) means returnable; only explicit false is excluded.
  const eligible = rows.filter((p) => p.returnable !== false && p.remaining > 0);
  const productIds = eligible.filter((p) => selected.has(p.product_id)).map((p) => p.product_id);
  const selectedRows = eligible.filter((p) => selected.has(p.product_id));
  const wasteRows = rows.filter((p) => p.lost > 0);
  const wasteCount = wasteRows.length;
  const wastePcs = wasteRows.reduce((sum, p) => sum + p.lost, 0);
  const allSelected = eligible.length > 0 && productIds.length === eligible.length;
  const invalidWaste = rows.some((p) => p.lost > p.available);
  const ready = cashResult != null && (!split || gcashResult != null) && !invalidWaste && productIds.length <= 200;
  const blockReason = disabledReason({ cashResult, gcashResult, split, invalidWaste, productIds });
  const { height: windowHeight } = useWindowDimensions();
  const wasteSheetMaxHeight = Math.min(Math.round(windowHeight * 0.72), 640);

  const selectedQty = selectedRows.reduce((sum, p) => sum + p.remaining, 0);
  const summaryNames = selectedRows
    .slice(0, 3)
    .map((p) => p.product_name_snapshot)
    .join(' · ');
  const summaryExtra = selectedRows.length > 3 ? ` · +${selectedRows.length - 3} more` : '';

  const filteredEligible = useMemo(() => {
    const q = returnQuery.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((p) => p.product_name_snapshot.toLowerCase().includes(q));
  }, [eligible, returnQuery]);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function closeSheet() {
    setSheet(null);
    setReturnQuery('');
  }

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Return items</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return items help"
              hitSlop={10}
              onPress={() => alertNotice('Return items', RETURN_ITEMS_HELP)}
              style={({ pressed }) => [styles.infoHit, pressed && styles.pressed]}
            >
              <Ionicons name="information-circle-outline" size={20} color={managerColors.royalBlue} />
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <View style={styles.actionButton}>
              <ManagerActionButton
                variant="secondary"
                label={
                  productIds.length > 0
                    ? `Returns (${productIds.length})`
                    : eligible.length > 0
                      ? `Returns · ${eligible.length}`
                      : 'Returns'
                }
                icon="cube-outline"
                onPress={() => setSheet('returns')}
              />
            </View>
            <View style={styles.actionButton}>
              <ManagerActionButton
                variant="secondary"
                label={`Waste (${wasteCount})`}
                icon="trash-outline"
                onPress={() => setSheet('waste')}
              />
            </View>
          </View>

          {productIds.length > 0 ? (
            <ListRowCard
              icon="cube-outline"
              iconColor="blue"
              title={`${productIds.length} selected · ${formatLiveStock(selectedQty)}`}
              subtitle={`${summaryNames}${summaryExtra}`}
              trailing={<ManagerBadge label="Edit" tone="info" />}
              onPress={() => setSheet('returns')}
            />
          ) : null}

          {productIds.length > 200 ? <Text style={styles.error}>Select up to 200 products.</Text> : null}
        </View>

        <View style={styles.section}>
          <View style={styles.remittanceHeader}>
            <Text style={styles.sectionTitle}>Remittance</Text>
            <Text style={styles.operator}>Operator · {operator}</Text>
          </View>

          {!split ? (
            <Text style={styles.note}>
              This shift includes receipts without a payment method. Enter combined collections.
            </Text>
          ) : null}

          <View style={styles.methodCard}>
            <View style={styles.methodTop}>
              <Text style={styles.methodLabel}>
                {split ? 'Cash on hand' : 'Total collections'}
                <Text style={styles.requiredMark}> *</Text>
              </Text>
              <View style={styles.expectedChip}>
                <Text style={styles.expectedChipText}>
                  Expected {formatMoney(preview.expected_cash)}
                </Text>
              </View>
            </View>
            <FormField
              label={split ? 'Cash on hand' : 'Total collections'}
              hideLabel
              keyboardType="decimal-pad"
              value={cash}
              onChangeText={(next) => {
                if (acceptMoneyInput(next)) setCash(next);
              }}
              placeholder="0.00"
              accentColor={managerColors.royalBlue}
              style={styles.amountInput}
            />
            {cash.trim() ? (
              <Text style={[styles.cashDiff, { color: cashDiffColor(cashResult, cash) }]}>
                Difference: {formatCashResultLabel(preview.expected_cash, cash, cashResult)}
              </Text>
            ) : null}
          </View>

          {split ? (
            <View style={styles.methodCard}>
              <View style={styles.methodTop}>
                <Text style={styles.methodLabel}>
                  GCash received
                  <Text style={styles.requiredMark}> *</Text>
                </Text>
                <View style={styles.expectedChip}>
                  <Text style={styles.expectedChipText}>
                    Expected {formatMoney(preview.expected_gcash!)}
                  </Text>
                </View>
              </View>
              <FormField
                label="GCash received"
                hideLabel
                keyboardType="decimal-pad"
                value={gcash}
                onChangeText={(next) => {
                  if (acceptMoneyInput(next)) setGcash(next);
                }}
                placeholder="0.00"
                accentColor={managerColors.royalBlue}
                style={styles.amountInput}
              />
              {gcash.trim() ? (
                <Text style={[styles.cashDiff, { color: cashDiffColor(gcashResult, gcash) }]}>
                  Difference: {formatCashResultLabel(preview.expected_gcash!, gcash, gcashResult)}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
    </ScrollView>

    <View style={styles.footer}>
      {footerExtra}
        {!ready && blockReason ? <Text style={styles.footerHint}>{blockReason}</Text> : null}
        <ManagerActionButton
          label="Complete End Shift"
          loading={loading}
          disabled={!ready || loading}
          onPress={() => {
            if (ready && !loading) {
              onSubmit(cash.trim(), split ? gcash.trim() : undefined, {
                productIds,
                waste: Object.fromEntries(rows.filter((p) => p.lost > 0).map((p) => [p.product_id, p.lost])),
              });
            }
          }}
        />
      </View>

      <ManagerBottomSheet
        visible={sheet !== null}
        title={sheet === 'waste' ? 'Record waste' : 'Return items'}
        onClose={closeSheet}
        scroll={false}
      >
        {sheet === 'returns' ? (
          eligible.length ? (
            <View style={[styles.wasteSheet, { maxHeight: wasteSheetMaxHeight }]}>
              <ScrollView
                style={styles.wasteScroll}
                contentContainerStyle={styles.wasteScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.sectionHeading}>
                  <Text style={styles.sheetLead}>Select items to return</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Return items help"
                    hitSlop={10}
                    onPress={() =>
                      alertNotice(
                        'Return items',
                        'Tap products to include in the leftover return. Quantity is fixed from today’s stock and sales — kitchen verifies counts on arrival.',
                      )
                    }
                    style={({ pressed }) => [styles.infoHit, pressed && styles.pressed]}
                  >
                    <Ionicons name="information-circle-outline" size={20} color={managerColors.royalBlue} />
                  </Pressable>
                </View>
                <SearchInput
                  value={returnQuery}
                  onChangeText={setReturnQuery}
                  placeholder="Search products"
                />
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: allSelected }}
                  accessibilityLabel={allSelected ? 'Clear selection' : 'Select all'}
                  onPress={() =>
                    setSelected(new Set(allSelected ? [] : eligible.map((p) => p.product_id)))
                  }
                  style={({ pressed }) => [styles.selectAllRow, pressed && styles.pressed]}
                >
                  <Ionicons
                    name={allSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={allSelected ? managerColors.royalBlue : managerColors.subtext}
                  />
                  <Text style={styles.selectAllLabel}>
                    {allSelected ? 'Clear selection' : 'Select all'}
                  </Text>
                  <Text style={styles.selectAllMeta}>{eligible.length}</Text>
                </Pressable>
                <View style={styles.list}>
                  {filteredEligible.map((p) => {
                    const isOn = selected.has(p.product_id);
                    const category = categories.data?.get(p.product_id) ?? null;
                    const qtyLabel = formatLiveStock(p.remaining, undefined, p.stock_unit_code);
                    return (
                      <Pressable
                        key={p.product_id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isOn }}
                        accessibilityLabel={`${p.product_name_snapshot}, quantity ${qtyLabel}`}
                        onPress={() => toggle(p.product_id)}
                        style={({ pressed }) => [
                          styles.returnRow,
                          isOn && styles.returnRowSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name={isOn ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={isOn ? managerColors.royalBlue : managerColors.subtext}
                        />
                        <CategoryIcon category={category} size={36} />
                        <View style={styles.returnRowBody}>
                          <Text style={styles.returnRowTitle} numberOfLines={2}>
                            {p.product_name_snapshot}
                          </Text>
                          <Text style={styles.returnRowQty}>Qty: {qtyLabel}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {filteredEligible.length === 0 ? (
                    <Text style={styles.emptyHint}>No products match that search.</Text>
                  ) : null}
                </View>
              </ScrollView>

              <View style={styles.wasteFooter}>
                <Text style={styles.wasteSummary} accessibilityLiveRegion="polite">
                  {productIds.length > 0
                    ? `${productIds.length} selected · ${formatLiveStock(selectedQty)}`
                    : 'No return items selected yet.'}
                </Text>
                <ManagerActionButton label="Done" onPress={closeSheet} />
              </View>
            </View>
          ) : (
            <View style={styles.returnsEmptySheet}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sheetLead}>Select items to return</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Return items help"
                  hitSlop={10}
                  onPress={() =>
                    alertNotice(
                      'Return items',
                      'Tap products to include in the leftover return. Quantity is fixed from today’s stock and sales — kitchen verifies counts on arrival.',
                    )
                  }
                  style={({ pressed }) => [styles.infoHit, pressed && styles.pressed]}
                >
                  <Ionicons name="information-circle-outline" size={20} color={managerColors.royalBlue} />
                </Pressable>
              </View>
              <Text style={styles.emptyHint}>Nothing to return.</Text>
              <ManagerActionButton label="Done" onPress={closeSheet} />
            </View>
          )
        ) : null}

        {sheet === 'waste' ? (
          <View style={[styles.wasteSheet, { maxHeight: wasteSheetMaxHeight }]}>
            <ScrollView
              style={styles.wasteScroll}
              contentContainerStyle={styles.wasteScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sectionHeading}>
                <Text style={styles.sheetLead}>Quantity to waste</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Record waste help"
                  hitSlop={10}
                  onPress={() => alertNotice('Record waste', WASTE_HELP)}
                  style={({ pressed }) => [styles.infoHit, pressed && styles.pressed]}
                >
                  <Ionicons name="information-circle-outline" size={20} color={managerColors.royalBlue} />
                </Pressable>
              </View>
              {preview.products
                .filter((p) => Number(p.already_recorded_waste) > 0)
                .map((p) => (
                  <Text key={p.product_id} style={styles.alreadyWaste}>
                    {p.product_name_snapshot} — already recorded:{' '}
                    {formatLiveStock(Number(p.already_recorded_waste), undefined, p.stock_unit_code)}
                  </Text>
                ))}
              <View style={styles.list}>
                {rows
                  .filter((p) => p.available > 0)
                  .map((p) => {
                    const category = categories.data?.get(p.product_id) ?? null;
                    const raw = waste[p.product_id] ?? '';
                    const amount = Number(raw || 0);
                    const safeAmount = Number.isFinite(amount) ? amount : 0;
                    const atMin = safeAmount <= 0;
                    const atMax = safeAmount >= p.available;
                    const setAmount = (next: number) => {
                      const clamped = Math.max(0, Math.min(p.available, next));
                      setWaste((previous) => ({
                        ...previous,
                        [p.product_id]: clamped === 0 ? '' : formatHalfStepDisplay(clamped),
                      }));
                    };
                    return (
                      <View key={p.product_id} style={styles.wasteBlock}>
                        <View style={styles.productCard}>
                          <CategoryIcon category={category} size={40} />
                          <View style={styles.productCardBody}>
                            <Text style={styles.productName} numberOfLines={2}>
                              {p.product_name_snapshot}
                            </Text>
                            <Text style={styles.productMeta}>
                              {formatLiveStock(p.available, undefined, p.stock_unit_code)} avail.
                            </Text>
                          </View>
                          <ManagerBadge
                            label={`Qty: ${formatLiveStock(p.available, undefined, p.stock_unit_code)}`}
                            tone={p.available > 0 ? 'info' : 'neutral'}
                            size="md"
                          />
                        </View>

                        <View style={styles.fieldBlock}>
                          <View style={styles.labelRow}>
                            <Text style={styles.wasteQtyLabel}>Waste qty</Text>
                            {p.lost > p.available ? (
                              <Text style={styles.danger}>Exceeds available</Text>
                            ) : safeAmount > 0 ? (
                              <ManagerBadge
                                label={`After: Qty ${formatHalfStepDisplay(Math.max(0, p.available - safeAmount))}`}
                                tone={safeAmount >= p.available ? 'neutral' : 'info'}
                                size="sm"
                              />
                            ) : null}
                          </View>
                          <View style={styles.stepper}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Decrease waste for ${p.product_name_snapshot}`}
                              disabled={atMin}
                              hitSlop={8}
                              onPress={() =>
                                setAmount(
                                  nudgePieceOpsQuantity(safeAmount, -1, p.stock_unit_code, 0, p.available),
                                )
                              }
                              style={({ pressed }) => [
                                styles.stepBtn,
                                pressed && !atMin && styles.pressed,
                                atMin && styles.stepDisabled,
                              ]}
                            >
                              <Text style={styles.stepText}>−</Text>
                            </Pressable>
                            <TextInput
                              accessibilityLabel="Waste qty"
                              value={raw}
                              onChangeText={(value) => {
                                if (!acceptsPieceOpsQuantityText(value, p.stock_unit_code)) return;
                                if (value === '' || value.endsWith('.')) {
                                  setWaste((previous) => ({ ...previous, [p.product_id]: value }));
                                  return;
                                }
                                const next = Number(value);
                                if (!Number.isFinite(next)) return;
                                setWaste((previous) => ({
                                  ...previous,
                                  [p.product_id]: formatHalfStepDisplay(Math.min(p.available, next)),
                                }));
                              }}
                              keyboardType="decimal-pad"
                              maxLength={PIECE_QUANTITY_MAX_LENGTH}
                              placeholder="0"
                              placeholderTextColor={managerColors.subtext}
                              style={styles.qtyInput}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Increase waste for ${p.product_name_snapshot}`}
                              disabled={atMax}
                              hitSlop={8}
                              onPress={() =>
                                setAmount(
                                  nudgePieceOpsQuantity(safeAmount, 1, p.stock_unit_code, 0, p.available),
                                )
                              }
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
                              accessibilityLabel={`Set max waste for ${p.product_name_snapshot}`}
                              disabled={atMax || p.available <= 0}
                              hitSlop={8}
                              onPress={() => setAmount(p.available)}
                              style={({ pressed }) => [
                                styles.maxBtn,
                                pressed && !atMax && styles.pressed,
                                (atMax || p.available <= 0) && styles.stepDisabled,
                              ]}
                            >
                              <Text style={styles.maxBtnText}>Max</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
              </View>
            </ScrollView>

            <View style={styles.wasteFooter}>
              <Text style={styles.wasteSummary} accessibilityLiveRegion="polite">
                {wasteCount > 0
                  ? `Waste on ${wasteCount} ${wasteCount === 1 ? 'item' : 'items'} · ${formatLiveStock(wastePcs)}`
                  : 'No waste entered yet.'}
              </Text>
              <ManagerActionButton label="Done" disabled={invalidWaste} onPress={closeSheet} />
            </View>
          </View>
        ) : null}
    </ManagerBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 0, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 24 },
  section: { gap: 12 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  infoHit: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1 },
  selectAllRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectAllLabel: {
    flex: 1,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  selectAllMeta: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  returnRow: {
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
  returnRowSelected: {
    borderColor: managerColors.royalBlue,
    backgroundColor: '#F5F8FF',
  },
  returnRowBody: { flex: 1, minWidth: 0, gap: 2 },
  returnRowTitle: {
    color: managerColors.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  returnRowQty: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.5,
  },
  emptyHint: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  remittanceHeader: { gap: 4 },
  operator: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  methodCard: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
  },
  methodTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  methodLabel: {
    flex: 1,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  requiredMark: {
    color: '#B91C1C',
    fontFamily: 'Inter_600SemiBold',
  },
  expectedChip: {
    maxWidth: '52%',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#EAF0FB',
  },
  expectedChipText: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  amountInput: {
    backgroundColor: '#FFFFFF',
    minHeight: 48,
  },
  cashDiff: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  error: {
    color: '#B91C1C',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  footerHint: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  sheetBody: { gap: 12, paddingBottom: 8 },
  list: { gap: 10 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wasteSheet: { width: '100%', minHeight: 280, flexDirection: 'column' },
  returnsEmptySheet: { width: '100%', gap: 12, paddingBottom: 4 },
  wasteScroll: { flexGrow: 1, flexShrink: 1, minHeight: 120 },
  wasteScrollContent: { gap: 12, paddingBottom: 8, flexGrow: 1 },
  wasteFooter: {
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
  },
  wasteSummary: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  wasteBlock: { gap: 10 },
  sheetLead: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
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
  productCardBody: { flex: 1, minWidth: 0, gap: 2 },
  productName: {
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  wasteQtyLabel: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    flexShrink: 1,
  },
  danger: {
    color: '#B91C1C',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12.5,
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
  maxBtn: {
    minWidth: 52,
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
    flexShrink: 0,
  },
  maxBtnText: {
    color: managerColors.royalBlue,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  alreadyWaste: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.5,
    lineHeight: 18,
  },
  pressed: { opacity: 0.75 },
});
