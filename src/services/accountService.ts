import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type ChangeOwnEmailResult = {
  currentEmail: string;
  pendingEmail: string | null;
  confirmed: boolean;
};

export function pendingEmailFromUser(user: User | null | undefined): string | null {
  if (!user) return null;
  const pending = (user as User & { new_email?: string | null }).new_email;
  return typeof pending === 'string' && pending.trim() ? pending.trim() : null;
}

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

/**
 * Requests an email change for the currently authenticated Auth user only.
 * Authorization is enforced server-side for Owner / Main Branch Manager.
 */
export async function changeOwnEmail(currentPassword: string, newEmail: string): Promise<ChangeOwnEmailResult> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) {
    throw new Error('Your session has expired. Sign in again.');
  }

  const { error: authzError } = await supabase.rpc('assert_can_change_own_email');
  if (authzError) throw authzError;

  const nextEmail = newEmail.trim().toLowerCase();
  if (!nextEmail) {
    throw new Error('Enter a valid email address.');
  }
  if (nextEmail.toLowerCase() === user.email.trim().toLowerCase()) {
    throw new Error('New email must be different from the current email.');
  }

  const { data: verified, error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) throw verifyError;
  if (!verified.user || verified.user.id !== user.id) {
    throw new Error('Your session has expired. Sign in again.');
  }

  const { data: updated, error: updateError } = await supabase.auth.updateUser({
    email: nextEmail,
  });
  if (updateError) throw updateError;

  const nextUser = updated.user ?? verified.user;
  const currentEmail = nextUser.email?.trim() || user.email;
  const pendingEmail = pendingEmailFromUser(nextUser);
  const confirmed = currentEmail.toLowerCase() === nextEmail.toLowerCase();

  return {
    currentEmail,
    pendingEmail: confirmed ? null : (pendingEmail ?? nextEmail),
    confirmed,
  };
}
