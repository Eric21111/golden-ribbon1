import { supabase } from '@/lib/supabase';

let cachedCutoverAt: string | null | undefined;

/** Active Egg half-unit cutover timestamp, or null when none. Cached for the app session. */
export async function getEggHalfUnitCutoverAt(): Promise<string | null> {
  if (cachedCutoverAt !== undefined) return cachedCutoverAt;
  const { data, error } = await supabase.rpc('egg_half_unit_cutover_at');
  if (error) throw error;
  cachedCutoverAt = data == null ? null : String(data);
  return cachedCutoverAt;
}

/** Test helper — clears the session cache. */
export function clearEggHalfUnitCutoverAtCache(): void {
  cachedCutoverAt = undefined;
}
