import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ErrorState, LoadingState } from '@/components/Feedback';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuditLogDetail } from '@/hooks/useAudit';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

// Map entity_type to a navigable route (best-effort)
function getRelatedRoute(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'sale':
      return `/owner/sales/${entityId}`;
    case 'stock_transfer':
      return `/owner/transfers/${entityId}`;
    case 'stock_return':
      return `/owner/returns/${entityId}`;
    case 'shift':
      return `/owner/shifts/${entityId}`;
    case 'product':
      return `/owner/products/${entityId}`;
    case 'employee':
      return `/owner/employees/${entityId}`;
    default:
      return null;
  }
}

export function AuditDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useAuditLogDetail(id ?? '');
  const entry = query.data;

  if (query.isLoading) return <Screen constrain><LoadingState label="Loading audit event…" /></Screen>;
  if (query.error) return (
    <Screen constrain>
      <ErrorState
        message={getErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    </Screen>
  );
  if (!entry) return null;

  const relatedRoute = getRelatedRoute(entry.entity_type, entry.entity_id);

  return (
    <Screen constrain>
      <PageHeader title="Audit Event" subtitle="Read-only activity detail" />

      {/* Actor */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Actor</Text>
        <Row label="Name" value={entry.actor_name_snapshot} />
        <Row label="Role" value={entry.actor_role_snapshot.toUpperCase()} />
        {entry.branch_name && <Row label="Branch" value={entry.branch_name} />}
        <Row label="User ID" value={entry.actor_user_id ?? 'Account deleted'} mono />
      </View>

      {/* Action */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Action</Text>
        <Row label="Action" value={entry.action} />
        <Row label="Entity Type" value={entry.entity_type} />
        {entry.entity_id && <Row label="Entity ID" value={entry.entity_id} mono />}
        <Row label="Timestamp" value={formatDate(entry.created_at)} />
      </View>

      {/* Metadata */}
      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          {Object.entries(entry.metadata).map(([k, v]) => (
            <Row
              key={k}
              label={k.replace(/_/g, ' ')}
              value={String(v)}
            />
          ))}
        </View>
      )}

      {/* Related Record Navigation */}
      {relatedRoute && (
        <Pressable
          style={styles.navBtn}
          onPress={() => {
            try {
              router.push(relatedRoute as any);
            } catch {
              // Record may have been deleted; silently ignore
            }
          }}
        >
          <Text style={styles.navBtnText}>View Related {entry.entity_type.replace(/_/g, ' ')} →</Text>
        </Pressable>
      )}
    </Screen>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  rowLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
    flex: 1,
  },
  rowValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    flex: 2,
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 10,
  },
  navBtn: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  navBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
