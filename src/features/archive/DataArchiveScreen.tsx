import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { managerColors } from '@/components/dashboard/theme';
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
  const [workflowInfoOpen, setWorkflowInfoOpen] = useState(false);
  const [cleanupInfoOpen, setCleanupInfoOpen] = useState(false);

  const status = statusQuery.data;
  const archive = status?.active_archive ?? null;
  const busy = prepare.isPending || exportArchive.isPending || verify.isPending || cleanup.isPending;
  const canCleanup =
    archive?.status === 'verified' && confirmation === ARCHIVE_CLEANUP_CONFIRMATION && !busy;

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
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
      refreshing={statusQuery.isRefetching}
      onRefresh={() => void statusQuery.refetch()}
    >
      <ConstrainedWidth>
        <ManagerScreenHeader showBack title="Data Archive" />

        <View style={styles.body}>
          {statusQuery.error ? (
            <ErrorState message={getArchiveErrorMessage(statusQuery.error)} onRetry={() => void statusQuery.refetch()} />
          ) : !status ? (
            <LoadingState label="Loading archive status…" />
          ) : (
            <>
              {status.archive_due ? (
                <View style={styles.warningCard}>
                  <Text style={styles.warningTitle}>Data cleanup recommended</Text>
                  <Text style={styles.warningBody}>
                    {status.eligible_sales_count.toLocaleString()} sales are older than {status.retention_days} days.
                    Export and verify the archive before cleaning old records.
                  </Text>
                </View>
              ) : (
                <Text style={styles.quiet}>
                  No detailed sales are currently older than {status.retention_days} days.
                </Text>
              )}

              <View style={styles.statsRow}>
                <StatTile
                  style={styles.statHalf}
                  emphasis
                  icon="trash-outline"
                  label="Estimated records to remove"
                  value={status.estimated_records}
                />
                <StatTile style={styles.statHalf} icon="receipt-outline" label="Sales eligible" value={status.eligible_sales_count} />
              </View>
              <View style={styles.statsRow}>
                <StatTile style={styles.statHalf} icon="pricetags-outline" label="Items eligible" value={status.eligible_sale_items_count} />
                <StatTile style={styles.statHalf} icon="checkmark-done-outline" label="Shifts eligible" value={status.eligible_shift_count} />
              </View>

              <SummaryCard
                title="RETENTION"
                rows={[
                  { label: 'Detailed sales retention', value: `${status.retention_days} days`, icon: 'calendar-outline' },
                  {
                    label: 'Oldest sale',
                    value: status.oldest_detailed_sale_at ? formatDate(status.oldest_detailed_sale_at) : 'None',
                    icon: 'time-outline',
                  },
                  {
                    label: 'Last archive',
                    value: status.last_successful_archive_at ? formatDate(status.last_successful_archive_at) : 'Never',
                    icon: 'archive-outline',
                  },
                  {
                    label: 'Next archive',
                    value: formatDate(status.next_archive_recommended_at),
                    icon: 'calendar-outline',
                  },
                  { label: 'Database size', value: formatBytes(status.database_size_bytes), icon: 'server-outline' },
                  {
                    label: 'Archive status',
                    value: archive?.status ?? (status.archive_due ? 'due' : 'current'),
                    icon: 'information-circle-outline',
                  },
                  ...(archive
                    ? [
                        {
                          label: 'Active period revenue',
                          value: `${formatMoney(archive.revenue_total)} · ${archive.units_sold} units`,
                          icon: 'cash-outline' as const,
                        },
                      ]
                    : []),
                ]}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="How data archiving works"
                onPress={() => setWorkflowInfoOpen(true)}
                style={({ pressed }) => [styles.infoRow, pressed && styles.pressed]}
              >
                <Ionicons name="information-circle-outline" size={16} color={managerColors.subtext} />
                <Text style={styles.infoRowLabel}>How this works</Text>
              </Pressable>

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
              {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

              <View style={styles.actions}>
                <ManagerActionButton
                  label="Generate export"
                  icon="cloud-upload-outline"
                  loading={prepare.isPending || exportArchive.isPending}
                  disabled={busy || !status.archive_due}
                  onPress={() => void exportAndSave()}
                />
                <ManagerActionButton
                  label="Verify export"
                  icon="shield-checkmark-outline"
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
              </View>

              <View style={styles.dangerCard}>
                <View style={styles.dangerCardHeader}>
                  <Text style={styles.dangerCardTitle}>Confirm cleanup</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="What does confirming cleanup do?"
                    hitSlop={8}
                    onPress={() => setCleanupInfoOpen(true)}
                  >
                    <Ionicons name="information-circle-outline" size={18} color="#B91C1C" />
                  </Pressable>
                </View>
                <FormField
                  label={`Type ${ARCHIVE_CLEANUP_CONFIRMATION}`}
                  value={confirmation}
                  onChangeText={setConfirmation}
                  autoCapitalize="characters"
                  editable={!busy}
                  labelStyle={styles.dangerFieldLabel}
                  accentColor="#B91C1C"
                  style={styles.fieldInput}
                />
                <ManagerActionButton
                  label="Delete archived data"
                  icon="trash-outline"
                  variant="danger"
                  loading={cleanup.isPending}
                  disabled={!canCleanup}
                  onPress={() =>
                    void run(async () => {
                      if (!archive) return;
                      await cleanup.mutateAsync({ archiveId: archive.id, confirmation });
                      setConfirmation('');
                      setNotice('Eligible detailed sales were removed. Historical summaries and inventory remain.');
                    })
                  }
                />
              </View>

              <ManagerBottomSheet
                visible={workflowInfoOpen}
                title="How this works"
                onClose={() => setWorkflowInfoOpen(false)}
              >
                <Text style={styles.sheetBody}>
                  Workflow: Export → Save Copy → Verify → Confirm Cleanup. Inventory, transfers, returns, and open
                  shifts are never removed.
                </Text>
              </ManagerBottomSheet>

              <ManagerBottomSheet
                visible={cleanupInfoOpen}
                title="Confirm cleanup"
                onClose={() => setCleanupInfoOpen(false)}
              >
                <Text style={styles.sheetBody}>
                  This will permanently remove detailed sales data that has already been archived. Historical
                  analytics will remain available from summary data.
                </Text>
              </ManagerBottomSheet>
            </>
          )}
        </View>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 14 },
  warningCard: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  warningTitle: { color: '#92400E', fontFamily: 'Inter_700Bold', fontSize: 15 },
  warningBody: { color: '#92400E', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  quiet: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statHalf: { flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  infoRowLabel: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 13 },
  pressed: { opacity: 0.7 },
  actions: { gap: 10 },
  dangerCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  dangerCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dangerCardTitle: { color: '#B91C1C', fontFamily: 'Inter_700Bold', fontSize: 15 },
  dangerFieldLabel: { fontFamily: 'Inter_600SemiBold', color: '#991B1B' },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  sheetBody: { color: managerColors.ink, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  notice: { color: managerColors.green, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
});
