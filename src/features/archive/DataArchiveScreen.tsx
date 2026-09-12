import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import {
  useArchiveExport,
  useArchiveStatus,
  useCleanupArchivedSales,
  usePrepareSalesArchive,
  useVerifySalesArchive,
} from '@/hooks/useArchive';
import { saveArchivePackage } from '@/lib/archiveExport';
import { getArchiveErrorMessage } from '@/lib/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { ARCHIVE_CLEANUP_CONFIRMATION } from '@/types/models';

function formatBytes(bytes: number | null): string {
  if (bytes == null) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DataArchiveScreen() {
  const statusQuery = useArchiveStatus();
  const prepare = usePrepareSalesArchive();
  const exportArchive = useArchiveExport();
  const verify = useVerifySalesArchive();
  const cleanup = useCleanupArchivedSales();
  const [confirmation, setConfirmation] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = statusQuery.data;
  const archive = status?.active_archive ?? null;
  const busy = prepare.isPending || exportArchive.isPending || verify.isPending || cleanup.isPending;
  const canCleanup =
    archive?.status === 'verified' &&
    confirmation === ARCHIVE_CLEANUP_CONFIRMATION &&
    !busy;

  const run = async (work: () => Promise<void>) => {
    setActionError(null);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setActionError(getArchiveErrorMessage(error));
    }
  };

  const exportAndSave = () =>
    run(async () => {
      const prepared = archive ?? (await prepare.mutateAsync());
      const pack = await exportArchive.mutateAsync(prepared.id);
      await saveArchivePackage(pack);
      setNotice(`Saved ${pack.manifest.package_name}. Store this copy before verifying cleanup.`);
    });

  return (
    <Screen
      constrain
      refreshing={statusQuery.isRefetching}
      onRefresh={() => void statusQuery.refetch()}
    >
      <PageHeader
        title="Data Archive"
        subtitle="Export old detailed sales, verify the copy, then confirm cleanup"
      />

      {statusQuery.error ? (
        <ErrorState message={getArchiveErrorMessage(statusQuery.error)} onRetry={() => void statusQuery.refetch()} />
      ) : !status ? (
        <LoadingState label="Loading archive status…" />
      ) : (
        <View style={styles.content}>
          {status.archive_due ? (
            <View style={styles.banner}>
              <Text style={styles.bannerTitle}>Data cleanup recommended</Text>
              <Text style={styles.bannerBody}>
                {status.eligible_sales_count.toLocaleString()} sales are older than {status.retention_days} days.
                Export and verify the archive before cleaning old records.
              </Text>
            </View>
          ) : (
            <Text style={styles.quiet}>No detailed sales are currently older than {status.retention_days} days.</Text>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Retention</Text>
            <Text style={styles.row}>Detailed sales retention: {status.retention_days} days</Text>
            <Text style={styles.row}>
              Oldest detailed sale: {status.oldest_detailed_sale_at ? formatDate(status.oldest_detailed_sale_at) : 'None'}
            </Text>
            <Text style={styles.row}>Sales eligible: {status.eligible_sales_count.toLocaleString()}</Text>
            <Text style={styles.row}>Sale items eligible: {status.eligible_sale_items_count.toLocaleString()}</Text>
            <Text style={styles.row}>Closed shifts eligible: {status.eligible_shift_count.toLocaleString()}</Text>
            <Text style={styles.row}>Estimated records to remove: {status.estimated_records.toLocaleString()}</Text>
            <Text style={styles.row}>
              Last successful archive:{' '}
              {status.last_successful_archive_at ? formatDate(status.last_successful_archive_at) : 'Never'}
            </Text>
            <Text style={styles.row}>
              Next archive recommended: {formatDate(status.next_archive_recommended_at)}
            </Text>
            <Text style={styles.row}>Database size: {formatBytes(status.database_size_bytes)}</Text>
            <Text style={styles.row}>Archive status: {archive?.status ?? (status.archive_due ? 'due' : 'current')}</Text>
            {archive ? (
              <Text style={styles.row}>
                Active period revenue {formatMoney(archive.revenue_total)} · {archive.units_sold} units
              </Text>
            ) : null}
          </View>

          <Text style={styles.steps}>
            Workflow: Export → Save Copy → Verify → Confirm Cleanup. Inventory, transfers, returns, and open
            shifts are never removed.
          </Text>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

          <AppButton
            label="Generate Export"
            loading={prepare.isPending || exportArchive.isPending}
            disabled={busy || !status.archive_due}
            onPress={() => void exportAndSave()}
          />
          <AppButton
            label="Verify Export"
            variant="secondary"
            loading={verify.isPending}
            disabled={busy || !archive || !archive.export_generated_at}
            onPress={() =>
              void run(async () => {
                if (!archive) return;
                await verify.mutateAsync(archive.id);
                setNotice('Archive verification passed. Historical analytics are ready.');
              })
            }
          />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Confirm cleanup</Text>
            <Text style={styles.row}>
              This will permanently remove detailed sales data that has already been archived. Historical
              analytics will remain available from summary data.
            </Text>
            <FormField
              label={`Type ${ARCHIVE_CLEANUP_CONFIRMATION}`}
              value={confirmation}
              onChangeText={setConfirmation}
              autoCapitalize="characters"
              editable={!busy}
            />
            <AppButton
              label="Delete archived data"
              variant="danger"
              loading={cleanup.isPending}
              disabled={!canCleanup}
              onPress={() =>
                void run(async () => {
                  if (!archive) return;
                  await cleanup.mutateAsync({
                    archiveId: archive.id,
                    confirmation,
                  });
                  setConfirmation('');
                  setNotice('Eligible detailed sales were removed. Historical summaries and inventory remain.');
                })
              }
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  banner: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bannerTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  bannerBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  row: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  steps: { color: colors.text, fontSize: 14, lineHeight: 20 },
  quiet: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  notice: { color: colors.success, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
