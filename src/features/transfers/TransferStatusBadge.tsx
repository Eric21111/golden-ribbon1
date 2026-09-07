import { StyleSheet, Text } from 'react-native';

import { formatTransferStatus } from '@/lib/format';
import type { TransferStatus } from '@/types/models';

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <Text style={[styles.base, styles[status]]}>{formatTransferStatus(status)}</Text>;
}

const styles = StyleSheet.create({
  base: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 11, fontWeight: '800' },
  draft: { color: '#57534E', backgroundColor: '#F5F5F4' },
  pending_receipt: { color: '#92400E', backgroundColor: '#FEF3C7' },
  received: { color: '#166534', backgroundColor: '#DCFCE7' },
  received_with_discrepancy: { color: '#B91C1C', backgroundColor: '#FEE2E2' },
  cancelled: { color: '#57534E', backgroundColor: '#E7E5E4' },
});
