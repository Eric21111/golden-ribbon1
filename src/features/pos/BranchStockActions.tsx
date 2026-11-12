import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { FormField } from '@/components/FormField';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { getErrorMessage } from '@/lib/errors';
import { makeIdempotencyKey } from '@/lib/format';
import { stockUnit } from '@/lib/stockUnits';
import type { listCashierDayStock } from '@/services/inventoryService';
import { recordBranchStockAction, type BranchStockRequest } from '@/services/stockCorrectionService';

const addReasons = ['Wrong stock count', 'Other'];
const wasteReasons = ['Spoiled', 'Expired', 'Damaged', 'Spilled', 'Other'];

export type StockRow = Awaited<ReturnType<typeof listCashierDayStock>>[number];
export function BranchStockActions({ row, userId, shiftId, onClose }: {
  row: StockRow | null; userId: string; shiftId?: string; onClose: () => void;
}) {
  const client = useQueryClient();
  const storageKey = 'golden-ribbons-branch-action:' + userId;
  const [pending, setPending] = useState<BranchStockRequest | null>(null);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    try {
      setPending(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
      setStorageError('');
    } catch { setStorageError('Unable to read the last stock change. Reopen Branch inventory before trying again.'); }
  }, [storageKey]);
  const [action, setAction] = useState<'add' | 'waste' | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reasonChoice, setReasonChoice] = useState('');
  const [choosingReason, setChoosingReason] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sending = useRef(false);
  const amount = /^[1-9][0-9]{0,5}$/.test(quantity) ? Number(quantity) : 0;
  const available = Number(row?.available ?? 0);
  const after = available + (action === 'add' ? amount : -amount);
  const unit = stockUnit(row?.stock_unit_code)?.plural ?? 'pcs';
  function close() {
    setReasonChoice(''); setChoosingReason(false);
    setAction(null); setQuantity(''); setReason(''); setError(''); onClose();
  }
  async function submit() {
    if (sending.current || storageError) return;
    const request = pending ?? (row && shiftId && action && amount && after >= 0 && reason.trim() ? {
      p_shift_id: shiftId, p_product_id: row.product_id, p_quantity: amount, p_action: action,
      p_expected_available: available, p_reason: action === 'add' && reasonChoice === 'Wrong stock count' ? 'Wrong stock count: ' + reason.trim() : reason.trim(), p_key: makeIdempotencyKey('branch-stock'),
    } : null);
    if (!request) return;
    sending.current = true; setBusy(true); setError('');
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      await recordBranchStockAction(request);
      localStorage.removeItem(storageKey); setPending(null);
      close(); setNotice(request.p_action === 'add' ? 'Stock added.' : 'Waste recorded.');
      await Promise.all(['cashier-day-stock', 'inventory', 'inventory-movements', 'stock-corrections', 'reports'].map(key =>
        client.invalidateQueries({queryKey: [key]})));
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (['40001','42501','55000','22023','23514'].includes(code)) {
        localStorage.removeItem(storageKey); setPending(null); close();
        setNotice(getErrorMessage(e)); void client.invalidateQueries({ queryKey: ['cashier-day-stock'] });
      } else setError(getErrorMessage(e));
    } finally { sending.current = false; setBusy(false); }
  }
  return <>
    {!!(notice || storageError) && <Text accessibilityLiveRegion="polite">{storageError || notice}</Text>}
    {pending && !row && <ManagerActionButton label="Check last stock change" loading={busy} onPress={() => void submit()} />}
    <ManagerBottomSheet visible={!!row} title={row?.product_name ?? 'Stock'} onClose={() => { if (!sending.current) close(); }} scroll>
      <View style={{gap: 14}}>
        {pending ? <ManagerActionButton label="Check last stock change" loading={busy} onPress={() => void submit()} /> : <>
          <Text>Available now: {available} {unit}</Text>
          {!shiftId ? <Text>Open your shift to add stock or record waste.</Text> : !action ? <>
            <ManagerActionButton label="Add stock" onPress={() => setAction('add')} />
            <ManagerActionButton label="Record waste" variant="secondary" onPress={() => setAction('waste')} />
          </> : <>
            <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
              <Pressable accessibilityRole="button" accessibilityLabel="Decrease quantity" disabled={amount===0}
                style={{padding:12}} onPress={()=>setQuantity(String(Math.max(0,amount-1)))}><Text>−</Text></Pressable>
              <View style={{flex:1}}><FormField label={action === 'add' ? 'Quantity to add' : 'Quantity to record as waste'}
                value={quantity} onChangeText={value=>{if (/^[0-9]*$/.test(value)) setQuantity(value);}} keyboardType="number-pad" maxLength={6} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Increase quantity"
                disabled={amount >= (action==='waste' ? Math.min(available,999999) : 999999)} style={{padding:12}}
                onPress={()=>setQuantity(String(amount+1))}><Text>+</Text></Pressable>
            </View>
            {(action==='waste' || action==='add') && <>
              <Text>{action === 'waste' ? 'Reason for waste' : 'Reason for adding stock'}</Text>
              <ManagerActionButton variant="secondary" label={reasonChoice || 'Select a reason'} onPress={()=>setChoosingReason(!choosingReason)} />
              {choosingReason && (action === 'add' ? addReasons : wasteReasons).map(choice=><ManagerActionButton key={choice} variant="secondary" label={choice}
                onPress={()=>{setReasonChoice(choice); setReason(action==='add' || choice==='Other' ? '' : choice); setChoosingReason(false);}} />)}
            </>}
            {((action==='add' && !!reasonChoice) || reasonChoice==='Other') && <FormField label={action==='add'?'Explain the stock change':'Enter your reason'}
              value={reason} onChangeText={setReason} maxLength={reasonChoice==='Wrong stock count' ? 275 : 300} />}
            <Text>{after < 0 ? 'Waste exceeds available stock.' : 'Available after change: ' + after + ' ' + unit}</Text>
            <ManagerActionButton label={action === 'add' ? 'Confirm add stock' : 'Confirm waste'} disabled={choosingReason || !amount || after < 0 || !reason.trim() || !!storageError} loading={busy} onPress={() => void submit()} />
            <ManagerActionButton label="Cancel" variant="secondary" disabled={busy} onPress={close} />
          </>}
        </>}
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
      </View>
    </ManagerBottomSheet>
    {!row && !!error && <Text accessibilityRole="alert">{error}</Text>}
  </>;
}
