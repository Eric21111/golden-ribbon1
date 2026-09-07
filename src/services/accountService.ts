import { supabase } from '@/lib/supabase';

/**
 * Changes the password of the currently authenticated Auth user only.
 * Does not accept a target user id. Passwords never leave Supabase Auth.
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) {
    throw new Error('Your session has expired. Sign in again.');
  }

  const { data: verified, error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) throw verifyError;
  if (!verified.user || verified.user.id !== user.id) {
    throw new Error('Your session has expired. Sign in again.');
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) throw updateError;
}
