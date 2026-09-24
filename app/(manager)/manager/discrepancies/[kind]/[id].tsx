import { useLocalSearchParams } from 'expo-router';

import { DiscrepancyDetailScreen } from '@/features/reports/DiscrepancyDetailScreen';
import type { DiscrepancyKind } from '@/services/discrepancyService';

export default function ManagerDiscrepancyDetailRoute() {
  const params = useLocalSearchParams<{ kind: string; id: string }>();
  const kind = params.kind === 'transfer' ? 'transfer' : 'return';
  const id = typeof params.id === 'string' ? params.id : '';
  return <DiscrepancyDetailScreen kind={kind as DiscrepancyKind} id={id} />;
}
