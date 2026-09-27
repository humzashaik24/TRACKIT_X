/**
 * Trackit X — environment schema and guards.
 *
 * Deliberately side-effect free. Everything here is a pure function or a schema,
 * so it can be unit-tested directly. The module that actually *reads* the
 * ambient environment and can therefore throw at import time is `env.ts`.
 *
 * The security model in one line: `EXPO_PUBLIC_*` values are compiled into the
 * JavaScript bundle that ships to phones and browsers, so they are public the
 * moment the app is distributed. The Supabase service role key, the database
 * password and the Gemini API key are therefore never read on the client, never
 * given an `EXPO_PUBLIC_` prefix, and never referenced anywhere under `src/`.
 * They exist only inside Supabase Edge Functions, which run on the server.
 *
 * The anon/publishable key IS safe to ship. It grants no privileges by itself —
 * every request it signs is still evaluated by Row Level Security in Postgres.
 */
import { z } from 'zod';

export type AppEnvironment = 'development' | 'staging' | 'production';

/**
 * Where the application's business records come from.
 *
 * `live` reads Postgres. `demo` reads the fixed fixture set in `src/domain/demo`,
 * which is a Phase 38 development convenience. The AI half of the application is
 * identical in both modes — same gateway, same adapter, same provider — so this
 * switch decides where a *task* comes from and never whether an *answer* is real.
 */
export type DataMode = 'live' | 'demo';

/** The client-safe configuration keys, in the shape the app consumes them. */
export type ClientEnvKey =
  | 'appEnv'
  | 'dataMode'
  | 'supabaseUrl'
  | 'supabasePublishableKey'
  | 'debugLogging';

/** Maps an internal key back to the variable a developer must actually set. */
export const variableNames: Record<ClientEnvKey, string> = {
  appEnv: 'EXPO_PUBLIC_APP_ENV',
  dataMode: 'EXPO_PUBLIC_DATA_MODE',
  supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
  supabasePublishableKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  debugLogging: 'EXPO_PUBLIC_DEBUG_LOGGING',
};

/**
 * An unset variable in a `.env` file arrives as an empty string rather than
 * `undefined`, which would otherwise satisfy a `string` schema and produce a
 * confusing failure much later.
 */
export function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/**
 * Only the exact strings `true` and `false` are accepted. Coercing by
 * truthiness would silently turn `EXPO_PUBLIC_DEBUG_LOGGING=false` into `true`,
 * which is precisely the flag you do not want wrong.
 */
const booleanFlag = z
  .union([z.literal('true'), z.literal('false')])
  .default('false')
  .transform((value) => value === 'true');

export const clientEnvSchema = z.object({
  appEnv: z.preprocess(
    blankToUndefined,
    z.enum(['development', 'staging', 'production']).default('development'),
  ),

  /*
   * Optional, because "unset" is a meaningful value rather than a missing one: it
   * means demo in development and live everywhere else, which `effectiveDataMode`
   * below decides. A `.default()` here would collapse those two cases into one and
   * make the development default impossible to express without a variable.
   */
  dataMode: z.preprocess(blankToUndefined, z.enum(['live', 'demo']).optional()),

  supabaseUrl: z.preprocess(
    blankToUndefined,
    z
      .url('must be a full URL, e.g. https://<project-ref>.supabase.co')
      // `z.url()` accepts any scheme, so a pasted `postgres://user:pass@host/db`
      // would pass. That string is a credential and must never reach a client.
      .refine(
        (value) => value.startsWith('http://') || value.startsWith('https://'),
        'must use http or https — a database connection string is not a Supabase URL',
      ),
  ),

  supabasePublishableKey: z.preprocess(
    blankToUndefined,
    z.string('is required').min(20, 'looks truncated — copy the full publishable (anon) key'),
  ),

  debugLogging: z.preprocess(blankToUndefined, booleanFlag),
});

export type ParsedClientEnv = z.output<typeof clientEnvSchema>;

export interface ClientEnv {
  readonly appEnv: AppEnvironment;
  /**
   * The effective mode, after the production lockout below. Never `demo` when
   * `appEnv` is `production`, whatever the variable said.
   */
  readonly dataMode: DataMode;
  readonly supabaseUrl: string;
  /** Anon/publishable key. Public by design; RLS is the actual boundary. */
  readonly supabasePublishableKey: string;
  readonly debugLogging: boolean;
  readonly isDevelopment: boolean;
  readonly isStaging: boolean;
  readonly isProduction: boolean;
  /** True only when `dataMode` is `demo` *and* the build is not production. */
  readonly isDemoData: boolean;
}

/**
 * Demo data is refused in production, whatever the variable says.
 *
 * Not a warning and not a lint rule: the value is overwritten. A staging build that
 * somebody flipped to demo, promoted to production by copying `.env`, would otherwise
 * show five invented employees and three invented projects as a customer's business —
 * and every screen would render it successfully, because nothing about the fixture is
 * invalid. Overwriting means the failure mode of getting this wrong is "reads the real
 * database", which is the safe direction.
 *
 * A production organization with genuine sample data should load a seed through
 * Postgres instead, where RLS applies to it exactly as it applies to everything else.
 *
 * Unset means demo in development and live in staging, which is the asymmetry that
 * makes the mode useful: a developer who has just cloned the repository gets a working
 * Copilot over a realistic business with no database and no setup, which is the entire
 * reason the mode exists, and the same unset variable in staging means the opposite.
 */
export function effectiveDataMode(appEnv: AppEnvironment, requested: DataMode | undefined): DataMode {
  if (appEnv === 'production') return 'live';
  // An explicit choice outranks the per-environment default in both directions. The
  // default is a convenience for the common case, not a policy: a developer pointing
  // the app at a real database has to be able to say so, and a staging build that
  // genuinely wants the fixture has to be able to ask for it.
  if (requested !== undefined) return requested;
  return appEnv === 'development' ? 'demo' : 'live';
}

/**
 * Suffixes that must never appear on a client-prefixed variable. This list
 * exists so that a well-meaning `EXPO_PUBLIC_GEMINI_API_KEY` added during
 * debugging fails the build rather than shipping. Defence in depth: the schema
 * already ignores unknown names, but ignoring a leaked secret is not the same
 * as refusing it.
 */
export const forbiddenPublicSuffixes: readonly string[] = [
  'SERVICE_ROLE_KEY',
  'SERVICE_KEY',
  'SECRET_KEY',
  'SECRET',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'DATABASE_URL',
  'DB_PASSWORD',
  'PASSWORD',
  'PRIVATE_KEY',
  'ACCESS_TOKEN',
];

/** Names in `source` that expose a server-only secret to the client bundle. */
export function findLeakedSecrets(source: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(source).filter((name) => {
    if (!name.startsWith('EXPO_PUBLIC_')) return false;
    return forbiddenPublicSuffixes.some((suffix) => name.endsWith(suffix));
  });
}

/** The message thrown when a secret is found under an `EXPO_PUBLIC_` prefix. */
export function describeLeak(leaked: readonly string[]): string {
  return [
    'Refusing to start: server-only secrets are exposed to the client bundle.',
    '',
    ...leaked.map((name) => `  · ${name}`),
    '',
    'Anything prefixed EXPO_PUBLIC_ is compiled into the app and is public.',
    'Remove the prefix and set these as Supabase Edge Function secrets instead:',
    '  supabase secrets set <NAME>=<value> --project-ref <ref>',
  ].join('\n');
}

/**
 * Builds a message that tells a developer exactly which variable to fix without
 * ever printing its current value — an error report is not a place to echo
 * credentials, not even partially.
 */
export function describeFailure(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path[0];
    const name =
      typeof key === 'string' && key in variableNames
        ? variableNames[key as ClientEnvKey]
        : String(key ?? 'unknown');
    return `  · ${name} — ${issue.message}`;
  });

  return [
    'Invalid environment configuration. The app cannot start.',
    '',
    ...lines,
    '',
    'Fix: copy the template and fill in the values.',
    '  cp .env.example .env',
    '',
    'Local Supabase prints the URL and publishable key when you run `supabase start`.',
  ].join('\n');
}

/**
 * Validates a raw record and derives the convenience flags. Pure: it neither
 * reads `process.env` nor caches, so tests can drive every branch.
 */
export function resolveClientEnv(raw: Readonly<Record<string, unknown>>): ClientEnv {
  const leaked = findLeakedSecrets(raw);
  if (leaked.length > 0) {
    throw new Error(describeLeak(leaked));
  }

  const parsed = clientEnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(describeFailure(parsed.error));
  }

  const value = parsed.data;

  const appEnv: AppEnvironment = value.appEnv;
  const dataMode = effectiveDataMode(appEnv, value.dataMode);

  return {
    appEnv,
    dataMode,
    supabaseUrl: value.supabaseUrl,
    supabasePublishableKey: value.supabasePublishableKey,
    debugLogging: value.debugLogging,
    isDevelopment: appEnv === 'development',
    isStaging: appEnv === 'staging',
    isProduction: appEnv === 'production',
    isDemoData: dataMode === 'demo',
  };
}
