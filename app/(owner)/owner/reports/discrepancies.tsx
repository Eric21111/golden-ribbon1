import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { NavTile } from '@/components/dashboard/NavTile';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { spacing } from '@/constants/theme';

export default function OwnerDiscrepancyAnalytics() {
  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} scroll={false} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader title="Discrepancy Analytics" showBack />
      <ConstrainedWidth style={styles.column}>
        <View style={styles.list}>
          <NavTile
            icon="swap-horizontal-outline"
            accent="blue"
            title="Transfer discrepancies"
            description="Sent versus actually received at selling branches"
            onPress={() => router.push('/owner/reports/transfer-discrepancies')}
          />
          <NavTile
            icon="return-up-back-outline"
            accent="lilac"
            title="Return discrepancies"
            description="Declared returns versus Main Branch received counts"
            onPress={() => router.push('/owner/reports/return-discrepancies')}
          />
        </View>
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20 },
  list: { gap: spacing.sm },
});
