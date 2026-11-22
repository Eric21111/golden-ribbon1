import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useState, type ReactNode } from 'react';
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
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';
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

import { ArchiveInfoButton } from './ArchiveInfoButton';

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type StepState = 'done' | 'now' | 'locked';

/**
 * One step of the cleanup: a numbered card. Only the step that is up shows its controls; a finished one is ticked, a later one says
 * what has to happen first. The last (deleting) step is the red one.
 */
function ArchiveStep({
  index,
  title,
  state,
  summary,
  danger = false,
  headerRight,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  /** The line under the title: what is done, what is next, or what is needed first. */
  summary: string;
  danger?: boolean;
  headerRight?: ReactNode;
  children?: ReactNode;
}) {
  const tint = danger ? '#B91C1C' : managerColors.royalBlue;
  const icon: IoniconsIconName | null = state === 'done' ? 'checkmark' : state === 'locked' ? 'lock-closed-outline' : null;
  return (
    <View
      accessibilityLabel={`Step ${index}, ${title}, ${state === 'done' ? 'done' : state === 'now' ? 'up next' : 'locked'}`}
      style={[styles.step, state === 'now' && { borderColor: tint, backgroundColor: danger ? '#FEF2F2' : '#FFFFFF' }, state === 'locked' && styles.stepLocked]}
    >
      <View style={styles.stepHeader}>
        <View style={[styles.stepBadge, state === 'done' && { backgroundColor: managerColors.green, borderColor: managerColors.green }, state === 'now' && { backgroundColor: tint, borderColor: tint }]}>
          {icon ? (
            <Ionicons name={icon} size={14} color={state === 'done' ? '#FFFFFF' : managerColors.subtext} />
          ) : (
            <Text style={styles.stepNumber}>{index}</Text>
          )}
        </View>
        <View style={styles.stepCopy}>
          <Text style={[styles.stepTitle, state === 'locked' && styles.stepTitleLocked, danger && state === 'now' && { color: tint }]}>{title}</Text>
          <Text style={styles.stepSummary}>{summary}</Text>
        </View>
        {headerRight}
      </View>
      {state === 'now' && children ? <View style={styles.stepBody}>{children}</View> : null}
    </View>
  );
}

/** One numbered line of the "How this works" sheet. */
function HowStep({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <View style={styles.howStep}>
      <View style={styles.howBadge}>
        <Text style={styles.howBadgeText}>{index}</Text>
      </View>
      <View style={styles.howCopy}>
        <Text style={styles.howTitle}>{title}</Text>
        <Text style={styles.howBody}>{body}</Text>
      </View>
    </View>
  );
}

/**
 * Data Archive > Old sales details: the overview (what would be removed, the retention rule) and the three steps, one at a time:
 * Export, Verify, Confirm cleanup. What each step needs and does is unchanged from before.
 */
export function OldSalesDetailsScreen() {
  const statusQuery = useArchiveStatus();
  const prepare = usePrepareSalesArchive();
  const exportArchive = useArchiveExport();
  const verify = useVerifySalesArchive();
  const cleanup = useCleanupArchivedSales();
  const [confirmation, setConfirmation] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backupSavedAcknowledged, setBackupSavedAcknowledged] = useState(false);
  const [help, setHelp] = useState<'overview' | 'steps' | 'cleanup' | null>(null);

  const status = statusQuery.data;
  const archive = status?.active_archive ?? null;
  const busy = prepare.isPending || exportArchive.isPending || verify.isPending || cleanup.isPending;
  const canVerify =
    Boolean(archive?.export_generated_at) &&
    (archive?.export_format_version ?? 0) >= 2 &&
    backupSavedAcknowledged &&
    !busy;
  const canCleanup =
    archive?.status === 'verified' && confirmation === ARCHIVE_CLEANUP_CONFIRMATION && !busy;

  const exported = Boolean(archive?.export_generated_at);
  const verified = archive?.status === 'verified';
  const exportState: StepState = exported ? 'done' : 'now';
  const verifyState: StepState = !exported ? 'locked' : verified ? 'done' : 'now';
  const cleanupState: StepState = verified ? 'now' : 'locked';

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
      setBackupSavedAcknowledged(false);
      const prepared = archive ?? (await prepare.mutateAsync());
      const pack = await exportArchive.mutateAsync(prepared.id);
      const offer = await saveArchivePackage(pack);
      setNotice(offer.message);
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
        <ManagerScreenHeader showBack title="Old sales details" />

        <View style={styles.body}>
          {statusQuery.error ? (
            <ErrorState message={getArchiveErrorMessage(statusQuery.error)} onRetry={() => void statusQuery.refetch()} />
          ) : !status ? (
            <LoadingState label="Loading archive status…" />
          ) : (
            <>
              {status.archive_due ? (
                <View style={styles.warningCard}>
                  <Text style={styles.warningTitle}>Old sales cleanup recommended</Text>
                  <Text style={styles.warningBody}>
                    {status.eligible_sales_count.toLocaleString()} sales are older than {status.retention_days} days.
                    Export and verify before deleting sales details. Shifts and remittances are kept.
                  </Text>
                </View>
              ) : null}

              <View style={styles.titleRow}>
                <Text style={styles.sectionTitle}>OVERVIEW</Text>
                <ArchiveInfoButton label="About this overview" onPress={() => setHelp('overview')} />
              </View>
              <StatTile layout="wide" emphasis icon="trash-outline" label="Sales details to remove" value={status.estimated_records} />
              <OwnerSummaryKpiPair
                left={{ icon: 'receipt-outline', label: 'Sales eligible', value: status.eligible_sales_count }}
                right={{ icon: 'pricetags-outline', label: 'Items eligible', value: status.eligible_sale_items_count }}
              />
              <SummaryCard
                title="RETENTION"
                rows={[
                  { label: 'Detailed sales retention', value: `${status.retention_days} days`, icon: 'calendar-outline' },
                  { label: 'Oldest sale', value: status.oldest_detailed_sale_at ? formatDate(status.oldest_detailed_sale_at) : 'None', icon: 'time-outline' },
                  { label: 'Last archive', value: status.last_successful_archive_at ? formatDate(status.last_successful_archive_at) : 'Never', icon: 'archive-outline' },
                  { label: 'Next archive', value: formatDate(status.next_archive_recommended_at), icon: 'calendar-outline' },
                ]}
              />

              <View style={styles.titleRow}>
                <Text style={styles.sectionTitle}>STEPS</Text>
                <ArchiveInfoButton label="How this works" onPress={() => setHelp('steps')} />
              </View>

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
              {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}

              <ArchiveStep
                index={1}
                title="Export"
                state={exportState}
                summary={exported ? 'Backup files generated' : status.archive_due ? 'Generate the backup files and save a copy' : `No detailed sales are older than ${status.retention_days} days yet`}
              >
                <ManagerActionButton
                  label="Generate export"
                  icon="cloud-upload-outline"
                  loading={prepare.isPending || exportArchive.isPending}
                  disabled={busy || !status.archive_due}
                  onPress={() => void exportAndSave()}
                />
              </ArchiveStep>
              {exportState === 'done' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Generate the export again"
                  disabled={busy || !status.archive_due}
                  onPress={() => void exportAndSave()}
                  style={({ pressed }) => [styles.again, (busy || !status.archive_due) && styles.disabled, pressed && styles.pressed]}
                >
                  <Ionicons name="refresh-outline" size={16} color={managerColors.royalBlue} />
                  <Text style={styles.againLabel}>Generate export again</Text>
                </Pressable>
              ) : null}

              <ArchiveStep
                index={2}
                title="Verify"
                state={verifyState}
                summary={verified ? 'Backup verified' : exported ? 'Confirm you saved the files, then verify' : 'Export first'}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: backupSavedAcknowledged }}
                  accessibilityLabel="I saved and checked the archive backup files"
                  disabled={busy}
                  onPress={() => setBackupSavedAcknowledged((current) => !current)}
                  style={({ pressed }) => [styles.ackRow, pressed && styles.pressed]}
                >
                  <Ionicons name={backupSavedAcknowledged ? 'checkbox' : 'square-outline'} size={24} color={backupSavedAcknowledged ? managerColors.royalBlue : managerColors.subtext} />
                  <Text style={styles.ackLabel}>
                    I saved the backup files and checked that they include sales, sale items, void_events, and the manifest.
                  </Text>
                </Pressable>
                <ManagerActionButton
                  label="Verify export"
                  icon="shield-checkmark-outline"
                  loading={verify.isPending}
                  disabled={!canVerify}
                  onPress={() =>
                    void run(async () => {
                      if (!archive) return;
                      await verify.mutateAsync(archive.id);
                      setNotice('Archive verification passed. Historical analytics are ready.');
                    })
                  }
                />
              </ArchiveStep>

              <ArchiveStep
                index={3}
                title="Confirm cleanup"
                state={cleanupState}
                danger
                summary={verified ? 'Permanently removes the archived sales details' : 'Verify first'}
                headerRight={
                  <ArchiveInfoButton label="What does confirming cleanup do?" color="#B91C1C" size={18} onPress={() => setHelp('cleanup')} />
                }
              >
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
                  label="Delete archived sales details"
                  icon="trash-outline"
                  variant="danger"
                  loading={cleanup.isPending}
                  disabled={!canCleanup}
                  onPress={() =>
                    void run(async () => {
                      if (!archive) return;
                      await cleanup.mutateAsync({ archiveId: archive.id, confirmation });
                      setConfirmation('');
                      setNotice('Eligible sales details were removed. Shifts, remittances, summaries, and inventory remain.');
                    })
                  }
                />
              </ArchiveStep>

              <ManagerBottomSheet visible={help === 'overview'} title="Old sales details" onClose={() => setHelp(null)}>
                <View style={styles.helpBody}>
                  <Text style={styles.sheetBody}>
                    Export → Save Copy → Verify → Confirm Cleanup. Removes sale rows older than the retention window.
                    Related shifts stay for remittance and audit history.
                  </Text>
                  {!status.archive_due ? (
                    <Text style={styles.sheetBody}>No detailed sales are currently older than {status.retention_days} days.</Text>
                  ) : null}
                  <SummaryCard
                    rows={[
                      { label: 'Related shifts (kept)', value: String(status.eligible_shift_count), icon: 'checkmark-done-outline' },
                      { label: 'Database size', value: formatBytes(status.database_size_bytes), icon: 'server-outline' },
                      { label: 'Archive status', value: archive?.status ?? (status.archive_due ? 'due' : 'current'), icon: 'information-circle-outline' },
                      ...(archive
                        ? [{ label: 'Active period revenue', value: `${formatMoney(archive.revenue_total)} · ${archive.units_sold} units`, icon: 'cash-outline' as const }]
                        : []),
                    ]}
                  />
                </View>
              </ManagerBottomSheet>

              <ManagerBottomSheet visible={help === 'steps'} title="How this works" onClose={() => setHelp(null)}>
                <View style={styles.howSteps}>
                  <HowStep
                    index={1}
                    title="Export"
                    body="Generate the backup files, then save a copy (download or share). Opening the download or share screen does not prove the files were stored, so check that they really are."
                  />
                  <HowStep
                    index={2}
                    title="Verify"
                    body="Check the saved files include sales, sale items, void_events and the manifest. Tick the box to confirm, then tap Verify export."
                  />
                  <HowStep
                    index={3}
                    title="Confirm cleanup"
                    body="Type the phrase and delete. This cannot be undone, and it only works after the backup is verified."
                  />
                  <View style={styles.howNote}>
                    <Text style={styles.howNoteTitle}>DELETED</Text>
                    <Text style={styles.howNoteBody}>Old sales and their items only.</Text>
                  </View>
                  <View style={styles.howNote}>
                    <Text style={styles.howNoteTitle}>ALWAYS KEPT</Text>
                    <Text style={styles.howNoteBody}>
                      Shifts, remittances, waste, inventory movements, transfers, returns, products and accounts.
                    </Text>
                  </View>
                </View>
              </ManagerBottomSheet>

              <ManagerBottomSheet visible={help === 'cleanup'} title="Confirm cleanup" onClose={() => setHelp(null)}>
                <Text style={styles.sheetBody}>
                  This permanently removes archived sales details only. Related shifts remain for remittance and audit history.
                  Historical analytics stay available from daily summary data.
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
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sectionTitle: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8 },
  helpBody: { gap: 12 },
  howSteps: { gap: 14, paddingBottom: 8 },
  howStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  howBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: managerColors.royalBlue },
  howBadgeText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 12 },
  howCopy: { flex: 1, minWidth: 0, gap: 2 },
  // hierarchy: the step names are dark and bold; what each step says is smaller and gray; the notes are quietest
  howTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 16 },
  howBody: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20 },
  howNote: { gap: 2, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: managerColors.cardSurface },
  howNoteTitle: { color: managerColors.subtext, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.8 },
  howNoteBody: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20 },
  warningCard: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 16, padding: 16, gap: 4 },
  warningTitle: { color: '#92400E', fontFamily: 'Inter_700Bold', fontSize: 15 },
  warningBody: { color: '#92400E', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  step: { borderWidth: 1, borderColor: managerColors.cardBorder, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 14, gap: 12 },
  stepLocked: { backgroundColor: managerColors.cardSurface },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: managerColors.cardBorder, backgroundColor: '#FFFFFF' },
  stepNumber: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 13 },
  stepCopy: { flex: 1, minWidth: 0, gap: 1 },
  stepTitle: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  stepTitleLocked: { color: managerColors.subtext },
  stepSummary: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  stepBody: { gap: 12 },
  again: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  againLabel: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 2 },
  ackLabel: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19 },
  dangerFieldLabel: { fontFamily: 'Inter_600SemiBold', color: '#991B1B' },
  fieldInput: { fontFamily: 'Inter_400Regular' },
  sheetBody: { color: managerColors.ink, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  notice: { color: managerColors.green, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
});
