import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { useAuth } from '@/features/auth/AuthProvider';
import { readPendingCorrection, savePendingCorrection } from '@/features/pos/stockCorrection';
import { correctStock } from '@/services/stockCorrectionService';
import { getErrorMessage } from '@/lib/errors';

// A previous APK may have sent a correction and lost the response.
export default function LegacyCorrectionReceipt() {
  const userId = useAuth().profile?.id ?? '';
  const client = useQueryClient();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let pending;
  try { pending = readPendingCorrection(userId); }
  catch { return <Screen><Text>Unable to read your last stock correction. Ask your manager to check stock history.</Text></Screen>; }
  if (!pending) return <Redirect href={'/cashier/inventory' as never} />;
  const request = pending;
  async function checkReceipt() {
    if (sending.current) return;
    sending.current = true; setBusy(true);
    try {
      await correctStock(request);
      savePendingCorrection(userId, null);
      await client.invalidateQueries({queryKey:['inventory']});
    } catch (e) {
      if (['40001','22023','42501','55000','23514'].includes((e as {code?: string}).code ?? '')) {
        savePendingCorrection(userId, null);
      }
      setError(getErrorMessage(e));
    } finally { sending.current = false; setBusy(false); }
  }
  return <Screen>
    <Text>A stock correction from your previous app session is awaiting confirmation.</Text>
    <ManagerActionButton label="Check last correction" loading={busy} onPress={() => void checkReceipt()} />
    {!!error && <Text accessibilityRole="alert">{error}</Text>}
  </Screen>;
}
