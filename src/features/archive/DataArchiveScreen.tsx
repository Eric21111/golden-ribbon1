import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerBadge } from '@/components/dashboard/ManagerBadge';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { ErrorState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useArchiveStatus } from '@/hooks/useArchive';
import { getArchiveErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';

import { ArchiveInfoButton } from './ArchiveInfoButton';
import { READ_NOTICE_PAGE, useReadNoticePreview } from './readNotices';

/**
 * Data Archive: a short hub with the two Owner cleanup tools as rows, like Reports. Each opens its own screen:
 * Read notifications (a checklist) and Old sales details (export, verify, delete).
 */
export function DataArchiveScreen() {
  const statusQuery = useArchiveStatus();
  const notices = useReadNoticePreview();
  const [infoOpen, setInfoOpen] = useState(false);
  const status = statusQuery.data;

  const count = notices.data?.length ?? 0;
  const noticeSubtitle = notices.isPending
    ? 'Checking…'
    : notices.isError
      ? 'Could not check'
      : count === 0
        ? 'None to remove'
        : `${count}${count >= READ_NOTICE_PAGE ? '+' : ''} can be removed`;

  return (
    <Screen
      backgroundColor="#FFFFFF"
      edges={['top']}
      contentContainerStyle={styles.screenContent}
      refreshing={statusQuery.isRefetching || notices.isRefetching}
      onRefresh={() => {
        void statusQuery.refetch();
        void notices.refetch();
      }}
    >
      <ConstrainedWidth>
        <ManagerScreenHeader showBack title="Data Archive" />

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.sectionTitle}>CLEANUP OPTIONS</Text>
            <ArchiveInfoButton label="About the cleanup options" onPress={() => setInfoOpen(true)} />
          </View>

          <ListRowCard
            icon="notifications-outline"
            iconColor="blue"
            title="Read notifications"
            subtitle={noticeSubtitle}
            onPress={() => router.push('/owner/data-archive/notifications' as never)}
            accessibilityLabel={`Read notifications. ${noticeSubtitle}`}
            accessibilityHint="Opens the list of read notifications that can be removed"
          />

          {statusQuery.error ? (
            <ErrorState message={getArchiveErrorMessage(statusQuery.error)} onRetry={() => void statusQuery.refetch()} />
          ) : (
            <ListRowCard
              icon="archive-outline"
              iconColor="teal"
              title="Old sales details"
              subtitle={status ? `${status.estimated_records.toLocaleString()} to remove` : 'Checking…'}
              meta={status ? `Retention ${status.retention_days} days · Last archive ${status.last_successful_archive_at ? formatDate(status.last_successful_archive_at) : 'never'}` : undefined}
              trailing={status ? <ManagerBadge label={status.archive_due ? 'Cleanup due' : 'Current'} tone={status.archive_due ? 'warning' : 'success'} /> : undefined}
              onPress={() => router.push('/owner/data-archive/sales' as never)}
              accessibilityLabel={`Old sales details. ${status ? `${status.estimated_records} to remove` : 'Checking'}`}
              accessibilityHint="Opens export, verify and cleanup of old sales details"
            />
          )}
        </View>
      </ConstrainedWidth>

      <ManagerBottomSheet visible={infoOpen} title="Cleanup options" onClose={() => setInfoOpen(false)}>
        <Text style={styles.sheetBody}>
          Two Owner tools only: remove eligible read notifications, or archive and delete old sales details.
          Shifts, remittances, inventory, transfers, returns, products, and accounts are never deleted here.
        </Text>
      </ManagerBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8 },
  sheetBody: { color: managerColors.ink, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
});
