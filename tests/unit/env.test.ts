/**
 * Environment configuration — validation and secret containment.
 *
 * These tests exist because the failure they guard against is not a bug that
 * shows up as a broken screen: a leaked service role key or Gemini key in a
 * shipped bundle is silent until it is exploited. The assertions below encode
 * the rules from the security model directly.
 */
import {
  blankToUndefined,
  clientEnvSchema,
  describeFailure,
  describeLeak,
  findLeakedSecrets,
  forbiddenPublicSuffixes,
  resolveClientEnv,
  variableNames,
} from '@/config/envSchema';

const validRaw = {
  appEnv: 'production',
  supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
  supabasePublishableKey: 'sb_publishable_0000000000000000000000',
  debugLogging: 'true',
};

describe('blankToUndefined', () => {
  it('treats an unset .env variable (empty string) as absent', () => {
    expect(blankToUndefined('')).toBeUndefined();
    expect(blankToUndefined('   ')).toBeUndefined();
  });

  it('leaves real values and non-strings alone', () => {
    expect(blankToUndefined('development')).toBe('development');
    expect(blankToUndefined(undefined)).toBeUndefined();
    expect(blankToUndefined(0)).toBe(0);
  });
});

describe('clientEnvSchema', () => {
  it('accepts a complete configuration', () => {
    const parsed = clientEnvSchema.parse(validRaw);
    expect(parsed.appEnv).toBe('production');
    expect(parsed.supabaseUrl).toBe('https://abcdefghijklmnop.supabase.co');
    expect(parsed.debugLogging).toBe(true);
  });

  it('defaults appEnv to development and debug logging to off', () => {
    const parsed = clientEnvSchema.parse({
      appEnv: '',
      supabaseUrl: validRaw.supabaseUrl,
      supabasePublishableKey: validRaw.supabasePublishableKey,
      debugLogging: '',
    });
    expect(parsed.appEnv).toBe('development');
    expect(parsed.debugLogging).toBe(false);
  });

  it('rejects a truthy-but-not-boolean debug flag rather than coercing it', () => {
    const result = clientEnvSchema.safeParse({ ...validRaw, debugLogging: '1' });
    expect(result.success).toBe(false);
  });

  it('reads "false" as false — the flag that must never be coerced by truthiness', () => {
    expect(clientEnvSchema.parse({ ...validRaw, debugLogging: 'false' }).debugLogging).toBe(false);
  });

  it('rejects a postgres connection string pasted into the Supabase URL', () => {
    const result = clientEnvSchema.safeParse({
      ...validRaw,
      supabaseUrl: 'postgres://postgres:hunter2@db.example.supabase.co:5432/postgres',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('http');
  });

  it('rejects a missing or truncated publishable key', () => {
    expect(clientEnvSchema.safeParse({ ...validRaw, supabasePublishableKey: '' }).success).toBe(
      false,
    );
    expect(clientEnvSchema.safeParse({ ...validRaw, supabasePublishableKey: 'sb_pub' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown environment name', () => {
    expect(clientEnvSchema.safeParse({ ...validRaw, appEnv: 'staging-2' }).success).toBe(false);
  });
});

describe('findLeakedSecrets', () => {
  it.each([
    'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'EXPO_PUBLIC_GEMINI_API_KEY',
    'EXPO_PUBLIC_DATABASE_URL',
    'EXPO_PUBLIC_DB_PASSWORD',
    'EXPO_PUBLIC_JWT_SECRET',
    'EXPO_PUBLIC_GOOGLE_API_KEY',
    'EXPO_PUBLIC_SUPABASE_ACCESS_TOKEN',
  ])('flags %s', (name) => {
    expect(findLeakedSecrets({ [name]: 'value' })).toEqual([name]);
  });

  it('does not flag the two variables that are genuinely client-safe', () => {
    expect(
      findLeakedSecrets({
        EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_00000000000000000000',
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_DEBUG_LOGGING: 'false',
      }),
    ).toEqual([]);
  });

  it('ignores server-only names that are correctly left unprefixed', () => {
    expect(
      findLeakedSecrets({
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
        GEMINI_API_KEY: 'server-only',
      }),
    ).toEqual([]);
  });

  it('covers every secret the security model names explicitly', () => {
    expect(forbiddenPublicSuffixes).toContain('SERVICE_ROLE_KEY');
    expect(forbiddenPublicSuffixes).toContain('GEMINI_API_KEY');
    expect(forbiddenPublicSuffixes).toContain('PASSWORD');
    expect(forbiddenPublicSuffixes).toContain('SECRET');
  });
});

describe('resolveClientEnv', () => {
  it('derives the environment flags from appEnv', () => {
    const production = resolveClientEnv(validRaw);
    expect(production.isProduction).toBe(true);
    expect(production.isDevelopment).toBe(false);
    expect(production.isStaging).toBe(false);

    const development = resolveClientEnv({ ...validRaw, appEnv: 'development' });
    expect(development.isDevelopment).toBe(true);
    expect(development.isProduction).toBe(false);
  });

  it('refuses to resolve at all when a secret is exposed to the client', () => {
    expect(() =>
      resolveClientEnv({ ...validRaw, EXPO_PUBLIC_GEMINI_API_KEY: 'AIzaSyTOTALLYSECRET' }),
    ).toThrow(/Refusing to start/);
  });

  it('throws on invalid configuration instead of falling back to a default', () => {
    expect(() => resolveClientEnv({ ...validRaw, supabaseUrl: 'not-a-url' })).toThrow(
      /cannot start/,
    );
  });
});

describe('error messages', () => {
  it('names the variable to fix, using the real EXPO_PUBLIC_ name', () => {
    const result = clientEnvSchema.safeParse({ ...validRaw, supabasePublishableKey: '' });
    expect(result.success).toBe(false);
    const message = describeFailure(result.error!);
    expect(message).toContain(variableNames.supabasePublishableKey);
    expect(message).toContain('cp .env.example .env');
  });

  it('never echoes the offending value — a config error is not a place for credentials', () => {
    const secret = 'postgres://postgres:hunter2@db.example.supabase.co:5432/postgres';
    const result = clientEnvSchema.safeParse({ ...validRaw, supabaseUrl: secret });
    expect(result.success).toBe(false);
    const message = describeFailure(result.error!);
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain(secret);
  });

  it('reports a leak by name only, never by value', () => {
    const message = describeLeak(['EXPO_PUBLIC_GEMINI_API_KEY']);
    expect(message).toContain('EXPO_PUBLIC_GEMINI_API_KEY');
    expect(message).toContain('supabase secrets set');
    expect(message).not.toContain('AIza');
  });
});
