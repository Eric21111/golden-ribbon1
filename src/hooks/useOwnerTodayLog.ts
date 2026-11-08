import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { getOwnerTodayActivityLog } from '@/services/activityLogService';

/** Keyed under the owner dashboard so shift, transfer, and return mutations that invalidate it refresh the log too. */
export function useOwnerTodayActivityLog() {
  return useQuery({
    queryKey: queryKeys.ownerTodayActivityLog,
    queryFn: getOwnerTodayActivityLog,
  });
}
