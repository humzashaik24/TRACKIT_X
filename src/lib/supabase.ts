/**
 * Trackit X — the Supabase client.
 *
 * Supabase is the ONLY backend. There is no Firebase anywhere in this project,
 * and nothing here should ever grow a second data provider.
 *
 * ── What may import this module ─────────────────────────────────────────────
 * Nothing under `app/`, `src/components/` or `src/design-system/`. The ESLint
 * config enforces that, and the reason is worth stating: a screen that queries
 * directly ends up with tenancy and error handling copied into it, and copies
 * drift. UI calls a service; services call this.
 *
 * ── Why shipping the publishable key is safe ────────────────────────────────
 * It is compiled into the bundle and is public by design. It authorises nothing
 * on its own — every request it signs is still evaluated by Row Level Security
 * in Postgres against the caller's JWT. The service role key, which does bypass
 * RLS, is never read on the client, never given an `EXPO_PUBLIC_` prefix, and is
 * not referenced anywhere under `src/`. It belongs to Edge Functions alone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { env } from '@/config/env';
import type { Database } from '@/types/database';

/**
 * The session store contract, written out rather than imported: supabase-js does
 * not re-export `SupportedStorage` from its entry point, and reaching into its
 * `dist/` for a type is worse than restating four lines.
 */
interface SessionStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/**
 * Used when no persistent store exists — Node during unit tests, or any
 * pre-hydration render. Sessions then live for the process only, which is the
 * right failure mode: better a sign-in that does not survive a reload than a
 * crash at import time.
 */
function createMemoryStorage(): SessionStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/**
 * AsyncStorage is backed by localStorage on web and by native storage on device,
 * so one adapter covers every platform. The guard is for environments with
 * neither.
 */
function resolveStorage(): SessionStorage {
  if (Platform.OS === 'web' && typeof window === 'undefined') {
    return createMemoryStorage();
  }
  return AsyncStorage;
}

/**
 * Namespaced so a second Supabase project on the same origin during development
 * cannot silently overwrite this app's session.
 */
export const authStorageKey = 'trackitx.auth.session';

/**
 * The single client instance.
 *
 * A module singleton on purpose. Two clients would mean two GoTrue instances
 * racing to refresh the same token, which produces intermittent sign-outs that
 * are painful to reproduce.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      storage: resolveStorage(),
      storageKey: authStorageKey,
      persistSession: true,
      autoRefreshToken: true,

      /**
       * On web the browser lands back on the app with the auth code in the URL,
       * so the client should consume it. On native the redirect arrives as a
       * `trackitx://` deep link, which Expo Router hands to us instead — see
       * `exchangeAuthCode` below.
       */
      detectSessionInUrl: Platform.OS === 'web',

      /**
       * PKCE rather than the implicit flow. The implicit flow puts the access
       * token in the URL fragment, where it reaches browser history and any
       * referrer. PKCE puts a single-use code there instead.
       */
      flowType: 'pkce',

      // Auth internals are verbose and include token material in some paths.
      // Never enabled by a public flag.
      debug: false,
    },
    global: {
      headers: {
        // Lets a request be attributed in Supabase logs without carrying
        // anything about the user.
        'x-application-name': 'trackitx',
      },
    },
  },
);

/**
 * Resumes background token refresh. Called when the app returns to the
 * foreground; on native, timers are unreliable while backgrounded, so a session
 * can otherwise appear valid and then fail on the first query.
 */
export function startAutoRefresh(): void {
  void supabase.auth.startAutoRefresh();
}

/** Suspends background token refresh while the app is backgrounded. */
export function stopAutoRefresh(): void {
  void supabase.auth.stopAutoRefresh();
}

/**
 * Completes a PKCE exchange from a deep link on native.
 *
 * Web handles this itself via `detectSessionInUrl`. Exposed as a named function
 * so the one screen that needs it does not have to reach into `supabase.auth`.
 */
export async function exchangeAuthCode(code: string): Promise<void> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null) throw error;
}
