import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

/** How many eligible read notices the server lists at a time (the oldest first). */
export const READ_NOTICE_PAGE = 50;

/**
 * The read notifications that can be removed. Only a preview: `owner_cleanup_read_notices` without ids deletes nothing. Shared by the
 * Data Archive hub (for the count) and the Read notifications screen (for the list).
 */
export function useReadNoticePreview() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['owner-cleanup-notices', profile?.id],
    enabled: profile?.role === 'owner',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('owner_cleanup_read_notices', {});
      if (error) throw error;
      return data ?? [];
    },
  });
}
