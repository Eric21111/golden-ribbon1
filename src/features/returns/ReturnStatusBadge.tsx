import { StyleSheet, Text } from 'react-native';

import { formatReturnStatus } from '@/lib/format';
import type { ReturnStatus } from '@/types/returns';

const compactLabels: Record<ReturnStatus, string> = {
  draft: 'Draft',
  in_transit: 'In transit',
  received: 'Received',
  received_with_discrepancy: 'Discrepancy',
  cancelled: 'Cancelled',
};

export function ReturnStatusBadge({ status, compact = false }: { status: ReturnStatus; compact?: boolean }) {
  return (
    <Text style={[styles.base, styles[status]]}>{compact ? compactLabels[status] : formatReturnStatus(status)}</Text>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '800',
  },
  draft: { color: '#57534E', backgroundColor: '#F5F5F4' },
  in_transit: { color: '#1E40AF', backgroundColor: '#DBEAFE' },
  received: { color: '#166534', backgroundColor: '#DCFCE7' },
  received_with_discrepancy: { color: '#B91C1C', backgroundColor: '#FEE2E2' },
  cancelled: { color: '#57534E', backgroundColor: '#E7E5E4' },
});
