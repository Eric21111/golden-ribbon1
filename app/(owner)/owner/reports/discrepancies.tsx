import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DashboardCard } from '@/components/DashboardCard';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { spacing } from '@/constants/theme';

export default function OwnerDiscrepancyAnalytics() {
  return (
    <Screen constrain>
      <PageHeader
        title="Discrepancy Analytics"
        subtitle="Missing and excess quantities from transfers and returns"
      />
      <View style={styles.list}>
        <DashboardCard
          title="Transfer discrepancies"
          description="Sent versus actually received at selling branches"
          onPress={() => router.push('/owner/reports/transfer-discrepancies')}
        />
        <DashboardCard
          title="Return discrepancies"
          description="Declared returns versus Main Branch received counts"
          onPress={() => router.push('/owner/reports/return-discrepancies')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
