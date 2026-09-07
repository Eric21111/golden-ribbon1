import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { formatDate } from '@/lib/format';
import type { StockTransferDetails } from '@/types/models';
import { TransferStatusBadge } from './TransferStatusBadge';

function AuditDetail({ label, value }: { label: string; value: string }) {
  return <View style={styles.auditRow}><Text style={styles.label}>{label}</Text><Text style={styles.auditValue}>{value}</Text></View>;
}

export function TransferDetailsView({ transfer }: { transfer: StockTransferDetails }) {
  return (
    <>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.number}>{transfer.transfer_number}</Text>
          <TransferStatusBadge status={transfer.status} />
        </View>
        <AuditDetail label="From" value={transfer.from_branch?.name ?? 'Sending branch'} />
        <AuditDetail label="To" value={transfer.to_branch?.name ?? 'Receiving branch'} />
        <AuditDetail label="Created by" value={transfer.created_by_profile?.full_name ?? 'Staff details unavailable'} />
        <AuditDetail label="Sent by" value={transfer.sent_by_profile?.full_name ?? 'Pending'} />
        <AuditDetail label="Sent" value={formatDate(transfer.sent_at)} />
        <AuditDetail label="Received by" value={transfer.received_by_profile?.full_name ?? 'Pending'} />
        <AuditDetail label="Received" value={formatDate(transfer.received_at)} />
        {transfer.notes ? <AuditDetail label="Notes" value={transfer.notes} /> : null}
      </View>
      <Text style={styles.sectionTitle}>Products</Text>
      {transfer.items.map((item) => {
        const difference = item.quantity_received === null ? null : item.quantity_sent - item.quantity_received;
        return (
          <View key={item.id} style={styles.card}>
            <Text style={styles.product}>{item.product?.name ?? `Unavailable product (${item.product_id})`}</Text>
            <AuditDetail label="Sent" value={String(item.quantity_sent)} />
            <AuditDetail label="Received" value={item.quantity_received === null ? 'Pending' : String(item.quantity_received)} />
            <AuditDetail label="Difference" value={difference === null ? 'Pending' : String(difference)} />
            {difference !== null && difference !== 0 ? (
              <Text style={styles.warning}>{difference > 0 ? `${difference} missing` : `${Math.abs(difference)} excess`}</Text>
            ) : null}
          </View>
        );
      })}
      <Text style={styles.sectionTitle}>Discrepancies</Text>
      {transfer.discrepancies.length === 0 ? <Text style={styles.empty}>No discrepancies found.</Text> : null}
      {transfer.discrepancies.map((item) => (
        <View key={item.id} style={[styles.card, styles.discrepancy]}>
          <Text style={styles.product}>{item.product?.name ?? `Unavailable product (${item.product_id})`}</Text>
          <Text style={styles.warning}>{item.discrepancy_type === 'missing' ? `${item.difference} missing` : `${Math.abs(item.difference)} excess`}</Text>
          <Text style={styles.empty}>Expected {item.quantity_expected} · Received {item.quantity_received}</Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  discrepancy: { borderColor: '#FCA5A5' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  number: { color: colors.text, fontSize: 21, fontWeight: '900' },
  auditRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  label: { color: colors.muted, fontSize: 13 },
  auditValue: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.sm },
  product: { color: colors.text, fontSize: 16, fontWeight: '800' },
  warning: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
