import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const configuredKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(configuredUrl && configuredKey);

// Valid placeholders let the shell render a useful setup message before an env file exists.
const supabaseUrl = configuredUrl ?? 'https://example.supabase.co';
const supabaseKey = configuredKey ?? 'development-placeholder-key';

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: globalThis.localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Marks this build as half-egg capable after Egg unit cutover. Outdated clients
  // omit the header and are refused for direct Egg stock writes (see migration).
  global: {
    headers: {
      'x-gr-half-egg': '1',
    },
  },
});
