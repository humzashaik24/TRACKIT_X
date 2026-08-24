/**
 * Typed errors — the boundary between provider failures and what a user reads.
 *
 * Two properties are load-bearing and are asserted directly here:
 *
 *  · A provider's message never becomes a user-facing message. Supabase and
 *    Postgres text leaks schema names, constraint names and SQL.
 *  · Cross-tenant invisibility reports NOT_FOUND, never PERMISSION_DENIED.
 *    "You may not see this" confirms the record exists, which is the leak.
 */
import {
  AppError,
  appError,
  isAppError,
  isRetryable,
  toAppError,
  userMessage,
  userMessageFor,
  type AppErrorCode,
} from '@/utils/errors';

const allCodes: readonly AppErrorCode[] = [
  'AUTH_REQUIRED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_EMAIL_NOT_CONFIRMED',
  'SESSION_EXPIRED',
  'PERMISSION_DENIED',
  'ORGANIZATION_REQUIRED',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'IMMUTABLE_RECORD',
  'INSUFFICIENT_STOCK',
  'INVALID_STATE_TRANSITION',
  'PERIOD_CLOSED',
  'NETWORK_UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
  'DEPENDENCY_FAILED',
  'AI_UNAVAILABLE',
  'AI_OUTPUT_INVALID',
  'AI_ACTION_NOT_PERMITTED',
  'AI_BUDGET_EXCEEDED',
  'UNKNOWN',
];

describe('the code catalogue', () => {
  it('gives every code renderable copy', () => {
    for (const code of allCodes) {
      const message = userMessageFor(code);
      expect(message.length).toBeGreaterThan(0);
      // Implementation detail in user copy is the failure this guards.
      expect(message).not.toMatch(/undefined|null|\[object|PGRST|SQL|postgres/i);
      // Copy is a sentence, not a code name.
      expect(message).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it('marks transport failures retryable and rule violations not', () => {
    expect(isRetryable('NETWORK_UNAVAILABLE')).toBe(true);
    expect(isRetryable('TIMEOUT')).toBe(true);
    expect(isRetryable('RATE_LIMITED')).toBe(true);
    expect(isRetryable('DEPENDENCY_FAILED')).toBe(true);

    expect(isRetryable('PERMISSION_DENIED')).toBe(false);
    expect(isRetryable('VALIDATION_FAILED')).toBe(false);
    expect(isRetryable('INSUFFICIENT_STOCK')).toBe(false);
    expect(isRetryable('IMMUTABLE_RECORD')).toBe(false);
  });

  it('never reveals whether an account exists', () => {
    const copy = userMessageFor('AUTH_INVALID_CREDENTIALS').toLowerCase();
    expect(copy).not.toContain('no account');
    expect(copy).not.toContain('not found');
    expect(copy).not.toContain('wrong password');
    expect(copy).not.toContain('incorrect password');
  });
});

describe('AppError', () => {
  it('survives instanceof across the transpile boundary', () => {
    const error = appError('NOT_FOUND', 'employee 42 missing');
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('not an error')).toBe(false);
  });

  it('keeps the developer message and the user message separate', () => {
    const error = appError('CONFLICT', 'duplicate key value violates "employees_email_key"');
    expect(error.message).toContain('employees_email_key');
    expect(error.userMessage).not.toContain('employees_email_key');
  });

  it('accepts overrides for copy and retryability', () => {
    const error = appError('UNKNOWN', 'odd', {
      userMessage: 'Payroll could not be recalculated.',
      retryable: false,
      correlationId: 'req_123',
      context: { runId: 'PR-2026-08', attempt: 2 },
    });
    expect(error.userMessage).toBe('Payroll could not be recalculated.');
    expect(error.retryable).toBe(false);
    expect(error.correlationId).toBe('req_123');
    expect(error.context).toEqual({ runId: 'PR-2026-08', attempt: 2 });
  });
});

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = appError('PERIOD_CLOSED', 'august is closed');
    expect(toAppError(original)).toBe(original);
  });

  it.each([
    ['PGRST116', 'NOT_FOUND'],
    ['PGRST301', 'SESSION_EXPIRED'],
    ['23502', 'VALIDATION_FAILED'],
    ['23503', 'CONFLICT'],
    ['23505', 'CONFLICT'],
    ['23514', 'VALIDATION_FAILED'],
    ['22P02', 'VALIDATION_FAILED'],
    ['40001', 'CONFLICT'],
    ['40P01', 'CONFLICT'],
    ['42501', 'PERMISSION_DENIED'],
    ['57014', 'TIMEOUT'],
    ['53300', 'DEPENDENCY_FAILED'],
    ['TKX01', 'INSUFFICIENT_STOCK'],
    ['TKX02', 'INVALID_STATE_TRANSITION'],
    ['TKX03', 'IMMUTABLE_RECORD'],
    ['TKX04', 'PERIOD_CLOSED'],
    ['TKX05', 'PERMISSION_DENIED'],
  ])('maps provider code %s to %s', (providerCode, expected) => {
    expect(toAppError({ code: providerCode, message: 'db said no' }).code).toBe(expected);
  });

  it('reads a row-not-visible result as NOT_FOUND, not a refusal', () => {
    // This is the tenancy rule: RLS hides another organization's rows, and the
    // honest answer is that the record is not there.
    const error = toAppError({
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    });
    expect(error.code).toBe('NOT_FOUND');
    expect(error.code).not.toBe('PERMISSION_DENIED');
    expect(error.userMessage.toLowerCase()).not.toContain('permission');
    expect(error.userMessage.toLowerCase()).not.toContain('organization');
  });

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [408, 'TIMEOUT'],
    [409, 'CONFLICT'],
    [422, 'VALIDATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [500, 'DEPENDENCY_FAILED'],
    [503, 'DEPENDENCY_FAILED'],
    [504, 'TIMEOUT'],
  ])('maps HTTP %s to %s', (status, expected) => {
    expect(toAppError({ status, message: 'http' }).code).toBe(expected);
  });

  it('recognises the auth failures whose wording matters', () => {
    expect(toAppError({ message: 'Invalid login credentials' }).code).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(toAppError({ message: 'Email not confirmed' }).code).toBe('AUTH_EMAIL_NOT_CONFIRMED');
    expect(toAppError({ message: 'JWT expired' }).code).toBe('SESSION_EXPIRED');
    expect(toAppError({ message: 'Network request failed' }).code).toBe('NETWORK_UNAVAILABLE');
    expect(toAppError({ message: 'TypeError: Failed to fetch' }).code).toBe('NETWORK_UNAVAILABLE');
  });

  it('prefers a provider code over an HTTP status', () => {
    // A 400 carrying a Postgres code is more specific than the status.
    expect(toAppError({ code: '23505', status: 400, message: 'dupe' }).code).toBe('CONFLICT');
  });

  it('falls back to the caller-supplied code, then UNKNOWN', () => {
    expect(toAppError({ message: 'something odd' }, 'AI_OUTPUT_INVALID').code).toBe(
      'AI_OUTPUT_INVALID',
    );
    expect(toAppError({ message: 'something odd' }).code).toBe('UNKNOWN');
  });

  it('normalises values that are not objects at all', () => {
    expect(toAppError(undefined).code).toBe('UNKNOWN');
    expect(toAppError('a bare string').code).toBe('UNKNOWN');
    expect(toAppError(null).message.length).toBeGreaterThan(0);
    expect(toAppError(42).userMessage).toBe(userMessageFor('UNKNOWN'));
  });

  it('records the provider code and status as context for the log', () => {
    const error = toAppError({ code: '42501', status: 403, message: 'no' });
    expect(error.context).toEqual({ providerCode: '42501', status: 403 });
  });
});

describe('userMessage', () => {
  it('is safe to render for any thrown value', () => {
    const provider = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "inventory_items_org_sku_key" DETAIL: Key (organization_id, sku)=(…) already exists.',
    };
    const rendered = userMessage(provider);
    expect(rendered).toBe(userMessageFor('CONFLICT'));
    expect(rendered).not.toContain('organization_id');
    expect(rendered).not.toContain('unique constraint');
  });
});
