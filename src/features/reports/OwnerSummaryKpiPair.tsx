import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';

import { StatTilePair } from '@/components/dashboard/StatTilePair';

export type OwnerSummaryKpi = {
  label: string;
  value: string | number;
  icon: IoniconsIconName;
  emphasis?: boolean;
  valueNumberOfLines?: number;
  caption?: string;
  onPress?: () => void;
};

/** Two Owner summary tiles: compact 2-col when figures fit, otherwise full-width rows (see StatTilePair). */
export function OwnerSummaryKpiPair({ left, right }: { left: OwnerSummaryKpi; right: OwnerSummaryKpi }) {
  return <StatTilePair left={left} right={right} />;
}
