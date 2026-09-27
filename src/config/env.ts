/**
 * Trackit X — client environment.
 *
 * This module is the ONLY place the application reads `process.env`. Everything
 * else imports the validated `env` object. That single choke point is what makes
 * two guarantees enforceable rather than aspirational:
 *
 *  1. The app fails at startup with a readable message when configuration is
 *     missing, instead of failing later as an opaque network error.
 *  2. No secret can reach the client through here. Only the four client-safe
 *     names below are read, and a build whose environment contains a server-only
 *     credential under an `EXPO_PUBLIC_` prefix is refused outright.
 *
 * The validation itself lives in `envSchema.ts`, which is side-effect free and
 * therefore unit-testable. This file is the part that touches the world.
 */
import { resolveClientEnv, type ClientEnv } from './envSchema';

/**
 * Expo's Babel transform substitutes `process.env.EXPO_PUBLIC_FOO` at build
 * time by matching the literal member expression in the source. A computed
 * lookup like `process.env[name]` is NOT substituted and resolves to
 * `undefined` in a release bundle, so every read below is written out in full
 * on purpose. Resist the urge to make this table "cleaner" with a loop.
 */
const rawClientEnv = {
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
  dataMode: process.env.EXPO_PUBLIC_DATA_MODE,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  debugLogging: process.env.EXPO_PUBLIC_DEBUG_LOGGING,
};

/**
 * The ambient environment, scanned for a client-prefixed secret.
 *
 * On web and in dev tooling `process.env` is enumerable, so this catches a real
 * mistake. On a native release build the object is largely inlined away and
 * there is little to enumerate — which is why the scan is a safety net, and
 * `.env.example`, code review and the deny-list carry the real weight.
 */
const ambientEnv: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env !== undefined ? process.env : {};

/**
 * Validated, client-safe configuration.
 *
 * Evaluated once when this module is first imported, so a misconfigured build
 * fails immediately and loudly rather than at the first query.
 */
export const env: ClientEnv = resolveClientEnv({ ...ambientEnv, ...rawClientEnv });

export type { AppEnvironment, ClientEnv, DataMode } from './envSchema';
