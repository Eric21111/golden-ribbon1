import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { managerColors } from '@/components/dashboard/theme';
import { getErrorMessage } from '@/lib/errors';
import { formatLiveStock, makeIdempotencyKey } from '@/lib/format';
import { stockUnit } from '@/lib/stockUnits';
import { recordMainInventoryWaste } from '@/services/stockCorrectionService';
import type { InventoryItem } from '@/types/models';

const wasteReasons = ['Spoiled', 'Expired', 'Damaged', 'Spilled', 'Other'];

export function MainInventoryWasteSheet({
  item,
  onClose,
}: {
  item: InventoryItem | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [quantity, setQuantity] = useState('');
  const [reasonChoice, setReasonChoice] = useState('');
  const [reason, setReason] = useState('');
  const [choosingReason, setChoosingReason] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const onHand = Number(item?.quantity_on_hand ?? 0);
  const amount = /^[1-9][0-9]{0,5}$/.test(quantity) ? Number(quantity) : 0;
  const after = onHand - amount;
  const unit = stockUnit(item?.product.stock_unit_code)?.plural ?? 'pcs';
  const finalReason = reasonChoice === 'Other' ? reason.trim() : reasonChoice;

  function resetAndClose() {
    if (sending.current) return;
    setQuantity('');
    setReasonChoice('');
    setReason('');
    setChoosingReason(false);
    setError('');
    onClose();
  }

  async function submit() {
    if (sending.current || !item || !amount || after < 0 || !finalReason) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await recordMainInventoryWaste({
        p_product_id: item.product.id,
        p_quantity: amount,
        p_expected_on_hand: onHand,
        p_reason: finalReason,
        p_key: makeIdempotencyKey('main-waste'),
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['inventory'] }),
        client.invalidateQueries({ queryKey: ['inventory-movements'] }),
        client.invalidateQueries({ queryKey: ['reports'] }),
      ]);
      sending.current = false;
      setBusy(false);
      resetAndClose();
    } catch (e) {
      setError(getErrorMessage(e));
      sending.current = false;
      setBusy(false);
      if (['40001', '42501', '55000', '22023'].includes((e as { code?: string }).code ?? '')) {
        void client.invalidateQueries({ queryKey: ['inventory'] });
      }
    }
  }

  return (
    <ManagerBottomSheet
      visible={item != null}
      title={item ? `Waste · ${item.product.name}` : 'Add to waste'}
      onClose={resetAndClose}
      scroll
    >
      {item ? (
        <View style={styles.wrap}>
          <Text style={styles.meta}>
            On hand at Main: {formatLiveStock(onHand, undefined, item.product.stock_unit_code)}
          </Text>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease quantity"
              disabled={amount === 0 || busy}
              style={styles.stepBtn}
              onPress={() => setQuantity(String(Math.max(0, amount - 1)))}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <View style={styles.field}>
              <FormField
                label="Quantity to waste"
                value={quantity}
                onChangeText={(value) => {
                  if (/^[0-9]*$/.test(value)) setQuantity(value);
                }}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase quantity"
              disabled={amount >= Math.min(onHand, 999999) || busy}
              style={styles.stepBtn}
              onPress={() => setQuantity(String(amount + 1))}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Reason for waste</Text>
          <ManagerActionButton
            variant="secondary"
            label={reasonChoice || 'Select a reason'}
            disabled={busy}
            onPress={() => setChoosingReason(!choosingReason)}
          />
          {choosingReason
            ? wasteReasons.map((choice) => (
                <ManagerActionButton
                  key={choice}
                  variant="secondary"
                  label={choice}
                  onPress={() => {
                    setReasonChoice(choice);
                    setReason(choice === 'Other' ? '' : choice);
                    setChoosingReason(false);
                  }}
                />
              ))
            : null}
          {reasonChoice === 'Other' ? (
            <FormField
              label="Enter your reason"
              value={reason}
              onChangeText={setReason}
              maxLength={300}
            />
          ) : null}

          <Text style={[styles.meta, after < 0 && styles.danger]}>
            {after < 0
              ? 'Waste exceeds Main stock on hand.'
              : `On hand after waste: ${after} ${unit}`}
          </Text>

          <ManagerActionButton
            label="Confirm waste"
            disabled={choosingReason || !amount || after < 0 || !finalReason}
            loading={busy}
            onPress={() => void submit()}
          />
          <ManagerActionButton label="Cancel" variant="secondary" disabled={busy} onPress={resetAndClose} />
          {error ? (
            <Text accessibilityRole="alert" style={styles.danger}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ManagerBottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, paddingBottom: 8 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { padding: 12 },
  stepText: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 20 },
  field: { flex: 1 },
  danger: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
});
