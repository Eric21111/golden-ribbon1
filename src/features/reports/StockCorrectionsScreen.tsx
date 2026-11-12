import Ionicons from '@react-native-vector-icons/ionicons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Pagination } from '@/components/Pagination';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/errors';
import { listCorrections, type CorrectionHistory } from '@/services/stockCorrectionService';

import {
  CORRECTIONS_PAGE_SIZE,
  correctionChange,
  correctionDirection,
  correctionPageCount,
  correctionQuantityLine,
  formatCorrectionChange,
  formatCorrectionTime,
} from './stockCorrectionDisplay';

const CHANGE_COLORS = {
  increase: { bg: '#DCFCE7', text: '#15803D' },
  decrease: { bg: '#FEE2E2', text: '#B91C1C' },
  none: { bg: '#EAF0FB', text: managerColors.subtext },
} as const;

function CorrectionCard({ row }: { row: CorrectionHistory }) {
  const change = correctionChange(row.details);
  const tone = CHANGE_COLORS[correctionDirection(change)];
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.iconChip}>
          <Ionicons name="create-outline" size={18} color={managerColors.royalBlue} />
        </View>
        <View style={styles.titleCol}>
          <Text style={styles.product} numberOfLines={2}>{row.product_name}</Text>
          <Text style={styles.meta} numberOfLines={1}>{`${row.branch_name} · ${row.cashier_name}`}</Text>
        </View>
        <View style={[styles.changePill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.changeText, { color: tone.text }]}>{formatCorrectionChange(change)}</Text>
        </View>
      </View>
      <Text style={styles.quantity}>{correctionQuantityLine(row.details, row.stock_unit_code)}</Text>
      <View style={styles.bottom}>
        <View style={styles.reasonPill}>
          <Text style={styles.reasonText} numberOfLines={1}>{row.details.reason}</Text>
        </View>
        <Text style={styles.time}>{formatCorrectionTime(row.created_at)}</Text>
      </View>
    </View>
  );
}

export default function StockCorrectionsScreen() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['stock-corrections', profile?.id, page],
    queryFn: () => listCorrections(page * CORRECTIONS_PAGE_SIZE),
    enabled: !!profile,
    staleTime: 0,
  });
  const rows = query.data ?? [];
  const hasMore = rows.length >= CORRECTIONS_PAGE_SIZE;
  const centered = rows.length === 0;

  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screen}>
      {/* same header as Waste History / Shift remittances: the manager has this in the sidebar (menu icon); the owner drills in from Reports (back) */}
      <ManagerScreenHeader title="Stock corrections" showBack={!isManager} />
      {/* nothing to list (loading, error, empty): the message sits in the middle of the screen instead of under the header */}
      <ConstrainedWidth fill={centered} style={[styles.column, centered && styles.centered]}>
        {query.isPending ? <LoadingState label="Loading stock corrections…" /> : null}
        {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
        {!query.isPending && !query.error && rows.length === 0 ? (
          <EmptyState
            title="No corrections"
            message={page === 0 ? 'No stock counts have been corrected yet.' : 'There are no more corrections.'}
          />
        ) : null}

        {rows.map((row) => <CorrectionCard key={row.id} row={row} />)}

        <Pagination
          page={page}
          totalPages={correctionPageCount(page, rows.length)}
          visible={page > 0 || hasMore}
          onPageChange={setPage}
        />
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 0, gap: 0 },
  column: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  centered: { flexGrow: 1, justifyContent: 'center', paddingBottom: 64 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3EBFA' },
  titleCol: { flex: 1, minWidth: 0, gap: 1 },
  product: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  meta: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
  changePill: { minWidth: 44, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignItems: 'center' },
  changeText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  quantity: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 17 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reasonPill: { flexShrink: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#EAF0FB' },
  reasonText: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  time: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 12 },
});
