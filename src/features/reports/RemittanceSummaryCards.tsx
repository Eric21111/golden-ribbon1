import { StyleSheet, View } from 'react-native';

import { StatTile } from '@/components/dashboard/StatTile';
import { OwnerSummaryKpiPair } from '@/features/reports/OwnerSummaryKpiPair';

interface RemittanceSummaryCardsProps {
  combined: string;
  pending: string | number;
  reconciled: string | number;
  cash: string;
  gcash: string;
  hasGcash: boolean;
}

export function RemittanceSummaryCards({
  combined,
  pending,
  reconciled,
  cash,
  gcash,
  hasGcash,
}: RemittanceSummaryCardsProps) {
  return (
    <View style={styles.block}>
      <StatTile
        layout="wide"
        emphasis
        icon="wallet-outline"
        label="Total remitted collections"
        value={combined}
        valueNumberOfLines={2}
      />
      <OwnerSummaryKpiPair
        left={{
          icon: 'hourglass-outline',
          label: 'Pending shifts',
          value: pending,
        }}
        right={{
          icon: 'checkmark-circle-outline',
          label: 'Reconciled shifts',
          value: reconciled,
        }}
      />
      {hasGcash ? (
        <OwnerSummaryKpiPair
          left={{
            icon: 'cash-outline',
            label: 'Cash remitted',
            value: cash,
            valueNumberOfLines: 2,
          }}
          right={{
            icon: 'phone-portrait-outline',
            label: 'GCash remitted',
            value: gcash,
            valueNumberOfLines: 2,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
});
