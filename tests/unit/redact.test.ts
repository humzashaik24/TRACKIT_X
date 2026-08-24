/**
 * Redaction — the guarantee that no secret reaches a log sink.
 *
 * Two halves are tested separately because they fail differently: missing a
 * secret is a security incident, and redacting ordinary business data makes the
 * logs useless and gets redaction switched off. Both are defects.
 */
import {
  containsSecret,
  isSensitiveKey,
  redact,
  redactFields,
  REDACTED,
  tokeniseKey,
} from '@/utils/redact';

describe('tokeniseKey', () => {
  it('splits camelCase, snake_case and kebab-case alike', () => {
    expect(tokeniseKey('refreshToken')).toEqual(['refresh', 'token']);
    expect(tokeniseKey('refresh_token')).toEqual(['refresh', 'token']);
    expect(tokeniseKey('REFRESH-TOKEN')).toEqual(['refresh', 'token']);
    expect(tokeniseKey('SUPABASE_SERVICE_ROLE_KEY')).toEqual([
      'supabase',
      'service',
      'role',
      'key',
    ]);
  });

  it('handles acronym runs without shattering them', () => {
    expect(tokeniseKey('APIKey')).toEqual(['api', 'key']);
    expect(tokeniseKey('organizationID')).toEqual(['organization', 'id']);
  });
});

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'passwordHash',
    'current_password',
    'accessToken',
    'refresh_token',
    'id_token',
    'apiKey',
    'API_KEY',
    'geminiApiKey',
    'SUPABASE_SERVICE_ROLE_KEY',
    'serviceRoleKey',
    'authorization',
    'Authorization',
    'cookie',
    'sessionId',
    'jwt',
    'clientSecret',
    'privateKey',
    'otp',
    'pin',
    'cvv',
    'iban',
    'signature',
    'card_number',
  ])('redacts the field %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    // The regression this design exists to prevent: an ERP is full of fields
    // whose names contain a sensitive word as a substring.
    'shipping',
    'shippingAddress',
    'authorName',
    'authoredAt',
    'pinnedAt',
    'isPinned',
    'panelWidth',
    'company',
    'hashtags',
    // A bare `key` is a map key far more often than a credential.
    'key',
    'keyExtractor',
    'sortKey',
    'primaryKey',
    'foreign_key',
    'idempotencyKey',
    // Ordinary business columns.
    'organizationId',
    'employeeId',
    'email',
    'quantity',
    'unitCost',
    'status',
    'salary',
  ])('leaves the ordinary field %s alone', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('containsSecret', () => {
  it.each([
    ['a Supabase JWT', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP'],
    ['a Supabase secret key', 'sb_secret_AbCdEfGhIjKlMnOpQrSt'],
    ['a Supabase publishable key', 'sb_publishable_AbCdEfGhIjKlMnOpQrSt'],
    ['a Google API key', 'AIzaSyD-1234567890abcdefghijklmnopqrst'],
    ['a bearer header', 'Bearer abcdefghijklmnopqrstuvwxyz012345'],
    ['a postgres URL with a password', 'postgresql://postgres:hunter2@db.example.supabase.co:5432/postgres'],
    ['basic auth in a URL', 'https://admin:hunter2@api.example.com/v1'],
    ['a PEM private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK'],
  ])('detects %s', (_label, value) => {
    expect(containsSecret(value)).toBe(true);
  });

  it.each([
    'Payroll run PR-2026-08 moved to APPROVED',
    'https://abcdefghijklmnop.supabase.co/rest/v1/employees',
    'employee-9f4c1b2a-2f4e-4a5b-9c1d-8e7f6a5b4c3d',
    'A perfectly ordinary sentence about inventory.',
  ])('does not flag the ordinary string %s', (value) => {
    expect(containsSecret(value)).toBe(false);
  });
});

describe('redact', () => {
  it('redacts by key regardless of the value', () => {
    expect(redact({ password: 'hunter2', email: 'a@b.com' })).toEqual({
      password: REDACTED,
      email: 'a@b.com',
    });
  });

  it('redacts by value shape even in an innocent-looking field', () => {
    const result = redact({
      data: 'AIzaSyD-1234567890abcdefghijklmnopqrst',
      note: 'ok',
    }) as Record<string, unknown>;
    expect(result.data).toBe(REDACTED);
    expect(result.note).toBe('ok');
  });

  it('walks nested structures', () => {
    const result = redact({
      request: { headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz012345' } },
      rows: [{ id: 1, apiKey: 'x' }],
    }) as { request: { headers: Record<string, unknown> }; rows: Record<string, unknown>[] };

    expect(result.request.headers.authorization).toBe(REDACTED);
    expect(result.rows[0]?.apiKey).toBe(REDACTED);
    expect(result.rows[0]?.id).toBe(1);
  });

  it('reduces an Error to identifying fields and redacts its message', () => {
    const error = Object.assign(new Error('failed for AIzaSyD-1234567890abcdefghijklmnopqrst'), {
      code: 'PGRST116',
    });
    const result = redact(error) as Record<string, unknown>;
    expect(result.name).toBe('Error');
    expect(result.message).toBe(REDACTED);
    expect(result.code).toBe('PGRST116');
  });

  it('survives a circular reference instead of hanging', () => {
    const node: Record<string, unknown> = { id: 'a' };
    node.self = node;
    expect(redact(node)).toEqual({ id: 'a', self: '[circular]' });
  });

  it('does not mislabel a shared reference as circular', () => {
    const shared = { id: 'shared' };
    expect(redact({ left: shared, right: shared })).toEqual({
      left: { id: 'shared' },
      right: { id: 'shared' },
    });
  });

  it('caps depth, array length and string length', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'too far' } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[depth limit]');

    const long = Array.from({ length: 60 }, (_, index) => index);
    const redactedArray = redact(long) as unknown[];
    expect(redactedArray).toHaveLength(51);
    expect(redactedArray[50]).toBe('[+10 more]');

    const huge = 'x'.repeat(2500);
    expect(String(redact(huge))).toContain('[truncated 500 chars]');
  });

  it('handles the primitive and exotic cases without throwing', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(10n)).toBe('10n');
    expect(redact(() => undefined)).toBe('[function]');
    expect(redact(Symbol('s'))).toBe('[symbol]');
    expect(redact(new Date('2026-08-23T00:00:00.000Z'))).toBe('2026-08-23T00:00:00.000Z');
    expect(redact(new Map([['token', 'x']]))).toEqual({ token: REDACTED });
    expect(redact(new Set(['a']))).toEqual(['a']);
  });

  it('does not mutate its input', () => {
    const input = { password: 'hunter2', nested: { apiKey: 'k' } };
    redact(input);
    expect(input.password).toBe('hunter2');
    expect(input.nested.apiKey).toBe('k');
  });
});

describe('redactFields', () => {
  it('always returns a plain object, even for odd input', () => {
    expect(redactFields({ a: 1 })).toEqual({ a: 1 });
    expect(redactFields({})).toEqual({});
  });
});
