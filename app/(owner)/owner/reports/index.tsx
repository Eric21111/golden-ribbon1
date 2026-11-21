import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { NavTile } from '@/components/dashboard/NavTile';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { spacing } from '@/constants/theme';
import { ReportSectionHeading } from '@/features/reports/ReportSectionHeading';

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ReportSectionHeading title={title} />
      <View style={styles.list}>{children}</View>
    </View>
  );
}

export default function OwnerReportsHub() {
  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Reports" />
      <ConstrainedWidth style={styles.column}>
        <ReportSection title="Sales & Finance">
          <NavTile
            icon="stats-chart-outline"
            accent="blue"
            title="Sales Overview"
            onPress={() => router.push('/owner/reports/sales-overview' as never)}
          />
          <NavTile
            icon="pricetag-outline"
            accent="gold"
            title="Product Sales"
            onPress={() => router.push('/owner/reports/product-sales')}
          />
          <NavTile
            icon="cash-outline"
            accent="gold"
            title="Shift Remittances"
            onPress={() => router.push('/owner/reports/shift-remittances' as never)}
          />
        </ReportSection>

        <ReportSection title="Inventory & Operations">
          <NavTile
            icon="checkmark-done-outline"
            accent="green"
            title="Inventory Reconciliation"
            onPress={() => router.push('/owner/reports/inventory-reconciliation')}
          />
          <NavTile
            icon="alert-circle-outline"
            accent="red"
            title="Transfer & Return Issues"
            onPress={() => router.push('/owner/reports/discrepancies' as never)}
          />
          <NavTile
            icon="leaf-outline"
            accent="green"
            title="Waste History"
            onPress={() => router.push('/owner/reports/waste-history' as never)}
          />
          <NavTile
            icon="swap-vertical-outline"
            accent="teal"
            title="Stock correction"
            onPress={() => router.push('/owner/reports/stock-count-changes' as never)}
          />
        </ReportSection>

        <ReportSection title="Audit & Performance">
          <NavTile
            icon="create-outline"
            accent="blue"
            title="Void logs"
            onPress={() => router.push('/owner/reports/void-logs' as never)}
          />
          <NavTile
            icon="git-branch-outline"
            accent="teal"
            title="Branch Operations"
            onPress={() => router.push('/owner/reports/branch-performance' as never)}
          />
        </ReportSection>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, paddingBottom: 40, gap: spacing.lg },
  section: { gap: spacing.sm },
  list: { gap: spacing.sm },
});
