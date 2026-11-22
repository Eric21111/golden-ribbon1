import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { CategoryIcon } from '@/features/products/CategoryIcon';
import { getErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey, PIECE_QUANTITY_MAX_LENGTH } from '@/lib/format';
import {
  acceptsPieceOpsQuantityText,
  formatHalfStepDisplay,
  isValidPieceOpsQuantity,
  nudgePieceOpsQuantity,
} from '@/lib/halfStepQuantity';
import { stockUnit } from '@/lib/stockUnits';
import type { listCashierDayStock } from '@/services/inventoryService';
import { recordBranchStockAction, type BranchStockRequest } from '@/services/stockCorrectionService';

const addReasons = ['Wrong stock count', 'Other'];
const wasteReasons = ['Spoiled', 'Expired', 'Damaged', 'Spilled', 'Other'];

export type StockRow = Awaited<ReturnType<typeof listCashierDayStock>>[number];
export type BranchStockActionKind = 'add' | 'waste';

export function BranchStockActions({
  row,
  userId,
  shiftId,
  initialAction = null,
  productCategory = null,
  onClose,
}: {
  row: StockRow | null;
  userId: string;
  shiftId?: string;
  /** When set, open directly on that form (from the row action menu). */
  initialAction?: BranchStockActionKind | null;
  productCategory?: string | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const storageKey = 'golden-ribbons-branch-action:' + userId;
  const [pending, setPending] = useState<BranchStockRequest | null>(null);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    try {
      setPending(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
      setStorageError('');
    } catch {
      setStorageError('Unable to read the last stock change. Reopen Branch inventory before trying again.');
    }
  }, [storageKey]);

  const [action, setAction] = useState<BranchStockActionKind | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reasonChoice, setReasonChoice] = useState('');
  const [choosingReason, setChoosingReason] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sending = useRef(false);

  const productId = row?.product_id ?? null;
  useEffect(() => {
    if (!productId) {
      setAction(null);
      setQuantity('');
      setReason('');
      setReasonChoice('');
      setChoosingReason(false);
      setError('');
      return;
    }
    setAction(initialAction);
    setQuantity('');
    setReason('');
    setReasonChoice('');
    setChoosingReason(false);
    setError('');
  }, [productId, initialAction]);

  const parsed = Number(quantity);
  const amount =
    quantity !== '' &&
    !quantity.endsWith('.') &&
    isValidPieceOpsQuantity(parsed, { stockUnitCode: row?.stock_unit_code })
      ? parsed
      : 0;
  const available = Number(row?.available ?? 0);
  const after = available + (action === 'add' ? amount : -amount);
  const unit = stockUnit(row?.stock_unit_code)?.plural ?? 'pcs';
  const sheetTitle =
    action === 'add' ? 'Add Stock / Quantity' : action === 'waste' ? 'Add to Waste' : (row?.product_name ?? 'Stock');
  const canSubmit = !choosingReason && !!amount && after >= 0 && !!reason.trim() && !storageError;

  function close() {
    if (sending.current) return;
    setReasonChoice('');
    setChoosingReason(false);
    setAction(null);
    setQuantity('');
    setReason('');
    setError('');
    onClose();
  }

  async function submit() {
    if (sending.current || storageError) return;
    const request =
      pending ??
      (row && shiftId && action && amount && after >= 0 && reason.trim()
        ? {
            p_shift_id: shiftId,
            p_product_id: row.product_id,
            p_quantity: amount,
            p_action: action,
            p_expected_available: available,
            p_reason:
              action === 'add' && reasonChoice === 'Wrong stock count'
                ? 'Wrong stock count: ' + reason.trim()
                : reason.trim(),
            p_key: makeIdempotencyKey('branch-stock'),
          }
        : null);
    if (!request) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      await recordBranchStockAction(request);
      localStorage.removeItem(storageKey);
      setPending(null);
      close();
      setNotice(request.p_action === 'add' ? 'Stock added.' : 'Waste recorded.');
      await Promise.all(
        ['cashier-day-stock', 'inventory', 'inventory-movements', 'stock-corrections', 'reports'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (['40001', '42501', '55000', '22023', '23514'].includes(code)) {
        localStorage.removeItem(storageKey);
        setPending(null);
        close();
        setNotice(getErrorMessage(e));
        void client.invalidateQueries({ queryKey: ['cashier-day-stock'] });
      } else setError(getErrorMessage(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {!!(notice || storageError) && (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {storageError || notice}
        </Text>
      )}
      {pending && !row && (
        <ManagerActionButton label="Check last stock change" loading={busy} onPress={() => void submit()} />
      )}
      <ManagerBottomSheet visible={!!row} title={sheetTitle} onClose={close} scroll>
        <View style={styles.wrap}>
          {pending ? (
            <ManagerActionButton label="Check last stock change" loading={busy} onPress={() => void submit()} />
          ) : row ? (
            <>
              <Text style={styles.subtitle}>
                {action === 'add'
                  ? 'Increase the stock quantity of an item.'
                  : action === 'waste'
                    ? 'Record items as waste from inventory.'
                    : 'Choose an action for this item.'}
              </Text>

              <View style={styles.productCard}>
                <CategoryIcon category={productCategory} size={40} />
                <View style={styles.productCardBody}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {row.product_name}
                  </Text>
                </View>
                <ManagerBadge
                  label={`Qty: ${available}`}
                  tone={available > 0 ? 'info' : 'neutral'}
                  size="md"
                />
              </View>

              {!shiftId ? (
                <Text style={styles.meta}>Open your shift to add stock or record waste.</Text>
              ) : !action ? (
                <>
                  <ManagerActionButton label="Add stock" icon="add-outline" onPress={() => setAction('add')} />
                  <ManagerActionButton
                    label="Record waste"
                    variant="secondary"
                    icon="trash-outline"
                    onPress={() => setAction('waste')}
                  />
                </>
              ) : (
                <>
                  <View style={styles.fieldBlock}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>
                        {action === 'add' ? 'Quantity to add' : 'Quantity to waste'}
                      </Text>
                      {after < 0 ? (
                        <Text style={styles.danger}>Exceeds available</Text>
                      ) : (
                        <ManagerBadge
                          label={`After: Qty ${after}`}
                          tone={after === 0 ? 'neutral' : 'info'}
                          size="sm"
                        />
                      )}
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Decrease quantity"
                        disabled={amount === 0 || busy}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.stepBtn,
                          pressed && styles.pressed,
                          (amount === 0 || busy) && styles.stepDisabled,
                        ]}
                        onPress={() =>
                          setQuantity(
                            formatHalfStepDisplay(
                              nudgePieceOpsQuantity(
                                amount,
                                -1,
                                row?.stock_unit_code,
                                0,
                                action === 'waste' ? available : 999999,
                              ),
                            ),
                          )
                        }
                      >
                        <Text style={styles.stepText}>−</Text>
                      </Pressable>
                      <TextInput
                        accessibilityLabel={action === 'add' ? 'Quantity to add' : 'Quantity to waste'}
                        value={quantity}
                        onChangeText={(value) => {
                          if (acceptsPieceOpsQuantityText(value, row?.stock_unit_code)) setQuantity(value);
                        }}
                        keyboardType="decimal-pad"
                        maxLength={PIECE_QUANTITY_MAX_LENGTH}
                        editable={!busy}
                        placeholder="0"
                        placeholderTextColor={managerColors.subtext}
                        style={styles.qtyInput}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Increase quantity"
                        disabled={
                          amount >= (action === 'waste' ? Math.min(available, 999999) : 999999) || busy
                        }
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.stepBtn,
                          pressed && styles.pressed,
                          (amount >= (action === 'waste' ? Math.min(available, 999999) : 999999) || busy) &&
                            styles.stepDisabled,
                        ]}
                        onPress={() =>
                          setQuantity(
                            formatHalfStepDisplay(
                              nudgePieceOpsQuantity(
                                amount,
                                1,
                                row?.stock_unit_code,
                                0,
                                action === 'waste' ? available : 999999,
                              ),
                            ),
                          )
                        }
                      >
                        <Text style={styles.stepText}>+</Text>
                      </Pressable>
                      <Text style={styles.unitLabel}>{unit}</Text>
                    </View>
                  </View>

                  <View style={styles.fieldBlock}>
                    <Text style={styles.label}>
                      {action === 'waste' ? 'Reason for waste' : 'Reason for adding stock'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={reasonChoice || 'Select a reason'}
                      disabled={busy}
                      onPress={() => setChoosingReason(!choosingReason)}
                      style={({ pressed }) => [styles.reasonTrigger, pressed && styles.pressed, busy && styles.stepDisabled]}
                    >
                      <Text style={[styles.reasonTriggerLabel, !reasonChoice && styles.reasonPlaceholder]}>
                        {reasonChoice || 'Select a reason'}
                      </Text>
                      <Ionicons
                        name={choosingReason ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={managerColors.subtext}
                      />
                    </Pressable>
                    {choosingReason ? (
                      <View style={styles.reasonList}>
                        {(action === 'add' ? addReasons : wasteReasons).map((choice) => {
                          const selected = choice === reasonChoice;
                          return (
                            <Pressable
                              key={choice}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              onPress={() => {
                                setReasonChoice(choice);
                                setReason(action === 'add' || choice === 'Other' ? '' : choice);
                                setChoosingReason(false);
                              }}
                              style={({ pressed }) => [
                                styles.reasonRow,
                                selected && styles.reasonRowSelected,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={[styles.reasonRowLabel, selected && styles.reasonRowLabelSelected]}>
                                {choice}
                              </Text>
                              {selected ? (
                                <Ionicons name="checkmark" size={18} color={managerColors.royalBlue} />
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>

                  {(action === 'add' && !!reasonChoice) || reasonChoice === 'Other' ? (
                    <FormField
                      label={action === 'add' ? 'Explain the stock change' : 'Enter your reason'}
                      value={reason}
                      onChangeText={setReason}
                      maxLength={reasonChoice === 'Wrong stock count' ? 275 : 300}
                      placeholder={
                        action === 'add' ? 'e.g., Restock, delivery, adjustment…' : undefined
                      }
                    />
                  ) : null}

                  <View style={styles.actions}>
                    <View style={styles.actionHalf}>
                      <ManagerActionButton label="Cancel" variant="secondary" disabled={busy} onPress={close} />
                    </View>
                    <View style={styles.actionHalf}>
                      <ManagerActionButton
                        label={action === 'add' ? 'Confirm add stock' : 'Confirm waste'}
                        icon={action === 'add' ? 'add-outline' : 'trash-outline'}
                        variant={action === 'waste' ? 'destructive' : 'primary'}
                        disabled={!canSubmit}
                        loading={busy}
                        onPress={() => void submit()}
                      />
                    </View>
                  </View>
                </>
              )}
            </>
          ) : null}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.danger}>
              {error}
            </Text>
          )}
        </View>
      </ManagerBottomSheet>
      {!row && !!error && (
        <Text accessibilityRole="alert" style={styles.danger}>
          {error}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16, paddingBottom: 8 },
  notice: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13 },
  subtitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: -4,
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
  productCardBody: { flex: 1, minWidth: 0 },
  productName: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 20 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  fieldBlock: { gap: 8 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 44,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF0FB',
  },
  stepDisabled: { opacity: 0.45 },
  stepText: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 26 },
  qtyInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    textAlign: 'center',
  },
  unitLabel: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    minWidth: 28,
    textAlignVertical: 'center',
  },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  actionHalf: { flex: 1 },
  reasonTrigger: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reasonTriggerLabel: {
    flex: 1,
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  reasonPlaceholder: {
    color: managerColors.subtext,
    fontFamily: 'Inter_500Medium',
  },
  reasonList: { gap: 8 },
  reasonRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reasonRowSelected: { borderColor: managerColors.royalBlue, backgroundColor: '#EAF0FB' },
  reasonRowLabel: { color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  reasonRowLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_700Bold' },
  pressed: { opacity: 0.75 },
  danger: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
});
