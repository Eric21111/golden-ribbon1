import Ionicons from '@react-native-vector-icons/ionicons';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ListRowCard } from '@/components/dashboard/ListRowCard';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerBottomSheet } from '@/components/dashboard/ManagerBottomSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { alertNotice, confirmAction } from '@/lib/confirmAction';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import { ArchiveInfoButton } from './ArchiveInfoButton';
import { READ_NOTICE_PAGE, useReadNoticePreview } from './readNotices';

const formatRead = (value: string) => new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Data Archive > Read notifications. A checklist of the oldest eligible read notices; one "Delete selected (n)" button appears at the
 * bottom once something is ticked. Unread and in-flight push notices are never listed (the server decides).
 */
export function ReadNoticesScreen() {
  const preview = useReadNoticePreview();
  const [selected, setSelected] = useState<string[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const rows = preview.data ?? [];

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc('owner_cleanup_read_notices', { p_ids: ids });
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (count) => alertNotice('Read notifications removed', `${count} ${count === 1 ? 'notification was' : 'notifications were'} permanently removed.`, 'success'),
    onSettled: () => {
      setSelected([]);
      void preview.refetch();
    },
  });

  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((row) => row.id));
  const failure = remove.error ?? null;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screen}>
      <ConstrainedWidth fill style={styles.layout}>
        <View style={styles.header}>
          <ManagerScreenHeader showBack title="Read notifications" />
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, rows.length === 0 && styles.contentCentered]}
          keyboardShouldPersistTaps="handled"
        >
          {preview.isPending ? <LoadingState label="Loading notifications…" /> : null}
          {preview.error ? <ErrorState message={getErrorMessage(preview.error)} onRetry={() => void preview.refetch()} /> : null}
          {preview.isSuccess && rows.length === 0 ? (
            <EmptyState title="No eligible read notifications" message="Read notifications that can be removed will appear here." />
          ) : null}

          {rows.length > 0 ? (
            <>
              <View style={styles.titleRow}>
                <Text style={styles.sectionTitle}>OLDEST FIRST</Text>
                <ArchiveInfoButton label="About removing read notifications" onPress={() => setInfoOpen(true)} />
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Select all"
                accessibilityState={{ checked: allSelected }}
                disabled={remove.isPending}
                onPress={toggleAll}
                style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
              >
                <Ionicons name={allSelected ? 'checkbox' : 'square-outline'} size={24} color={allSelected ? managerColors.royalBlue : managerColors.subtext} />
                <Text style={styles.selectAllLabel}>Select all</Text>
                <Text style={styles.selectAllCount}>{`${selected.length} of ${rows.length} selected`}</Text>
              </Pressable>
              {rows.map((row) => {
                const checked = selected.includes(row.id);
                return (
                  <ListRowCard
                    key={row.id}
                    icon="notifications-outline"
                    title={row.title}
                    subtitle={`Read ${formatRead(row.read_at)}`}
                    accessibilityLabel={`${row.title}, read ${formatRead(row.read_at)}, ${checked ? 'selected' : 'not selected'}`}
                    onPress={remove.isPending ? undefined : () => toggle(row.id)}
                    trailing={<Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? managerColors.royalBlue : managerColors.subtext} />}
                  />
                );
              })}
            </>
          ) : null}
        </ScrollView>

        {selected.length > 0 ? (
          <View style={styles.footer}>
            {failure ? <Text accessibilityRole="alert" style={styles.error}>{getErrorMessage(failure)}</Text> : null}
            <ManagerActionButton
              label={`Delete selected (${selected.length})`}
              icon="trash-outline"
              variant="danger"
              loading={remove.isPending}
              disabled={remove.isPending}
              onPress={() =>
                confirmAction(
                  'Delete selected notifications?',
                  `Permanently delete ${selected.length} read ${selected.length === 1 ? 'notification' : 'notifications'} and their completed delivery records?`,
                  () => remove.mutate(selected),
                  { confirm: 'Delete selected', tone: 'danger' },
                )
              }
            />
          </View>
        ) : null}
      </ConstrainedWidth>

      <ManagerBottomSheet visible={infoOpen} title="Read notifications" onClose={() => setInfoOpen(false)}>
        <Text style={styles.sheetBody}>
          Choose specific read notifications to delete. The oldest {READ_NOTICE_PAGE} eligible notices appear first. Unread and in-flight push
          notices stay. Deleted notifications cannot be restored.
        </Text>
      </ManagerBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  layout: { flex: 1, minHeight: 0 },
  header: {},
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 10 },
  contentCentered: { flexGrow: 1, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: managerColors.subtext, fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8 },
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  selectAllLabel: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  selectAllCount: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  pressed: { opacity: 0.75 },
  footer: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13 },
  sheetBody: { color: managerColors.ink, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
});
