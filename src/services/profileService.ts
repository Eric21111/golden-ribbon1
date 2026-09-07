import { supabase } from '@/lib/supabase';
import type { ProfileWithBranch } from '@/types/models';

export async function getMyProfile(userId: string): Promise<ProfileWithBranch> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, branch:branches(*)')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data as ProfileWithBranch;
}
