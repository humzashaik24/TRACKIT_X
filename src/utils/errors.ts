/**
 * Trackit X — typed application errors.
 *
 * Every failure in the product is one of a small, closed set of kinds. Code
 * branches on `code`, never on a message string, because message text is written
 * for humans and changes freely.
 *
 * The central rule here is the split between two messages:
 *
 *  · `message`   — for developers and the structured log. May name the operation
 *                  and the code. Still must not contain credentials or row data.
 *  · `userMessage` — for the screen. Plain language, no implementation detail, no
 *                  provider text, no SQL, no stack. This is the ONLY string a UI
 *                  component is allowed to render.
 *
 * A raw provider error is never rendered. `toAppError` exists so that the unsafe
 * shape at the boundary is converted exactly once, in one place.
 *
 * ── Tenancy note ────────────────────────────────────────────────────────────
 * When a record is invisible because it belongs to another organization, the
 * correct answer is NOT_FOUND, not PERMISSION_DENIED. Saying "you may not see
 * this" confirms the record exists, which is itself a cross-tenant leak. Row
 * Level Security produces exactly this shape — an empty result rather than a
 * refusal — and this module preserves it rather than "helpfully" explaining.
 */

export type AppErrorCode =
  // Identity
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_EMAIL_NOT_CONFIRMED'
  | 'SESSION_EXPIRED'
  // Authorization and tenancy
  | 'PERMISSION_DENIED'
  | 'ORGANIZATION_REQUIRED'
  // Data
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'IMMUTABLE_RECORD'
  // Domain rules
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_STATE_TRANSITION'
  | 'PERIOD_CLOSED'
  // Transport
  | 'NETWORK_UNAVAILABLE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_FAILED'
  // AI
  | 'AI_UNAVAILABLE'
  | 'AI_OUTPUT_INVALID'
  | 'AI_ACTION_NOT_PERMITTED'
  | 'AI_BUDGET_EXCEEDED'
  // AI gateway (Phase 36)
  //
  // These are the codes the AI Gateway returns to the client. They are separate
  // from the four above because the gateway fails for reasons the client has no
  // other vocabulary for: the organization's provider is switched off, the model
  // asked for does not exist, the provider rejected the stored key. A screen
  // branches on the code, so a provider failure has to arrive as a code rather
  // than as a message, and a code a screen can act on.
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_PROVIDER_DISABLED'
  | 'AI_MODEL_NOT_SUPPORTED'
  | 'AI_PROVIDER_AUTH_FAILED'
  | 'AI_PROVIDER_RATE_LIMITED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_REQUEST_INVALID'
  | 'AI_UNAUTHORIZED'
  // Fallback
  | 'UNKNOWN';

/**
 * Non-sensitive detail attached to an error for the log. Values are primitives
 * only, so an entire row (which may carry personal data) cannot be dropped in
 * by accident.
 */
export type ErrorContext = Readonly<Record<string, string | number | boolean | null>>;

interface AppErrorInit {
  code: AppErrorCode;
  /** Developer-facing. Never a credential, never row content. */
  message: string;
  /** Safe to render. Defaults to the copy for `code`. */
  userMessage?: string;
  /** Opaque id shared with the server log, shown to the user for support. */
  correlationId?: string;
  /** Overrides the default for the code. */
  retryable?: boolean;
  context?: ErrorContext;
  cause?: unknown;
}

interface CodeProfile {
  /** Default user-facing copy. Plain language, no implementation detail. */
  readonly userMessage: string;
  /** Whether repeating the same call could plausibly succeed. */
  readonly retryable: boolean;
}

/**
 * Default copy per code. Centralised so the same failure reads identically
 * everywhere, and so a reviewer can audit every string a user might see in one
 * screenful.
 */
const profiles: Record<AppErrorCode, CodeProfile> = {
  AUTH_REQUIRED: { userMessage: 'Please sign in to continue.', retryable: false },
  AUTH_INVALID_CREDENTIALS: {
    // Never distinguishes "no such account" from "wrong password" — that
    // difference is an account-enumeration oracle.
    userMessage: 'That email and password combination is not correct.',
    retryable: false,
  },
  AUTH_EMAIL_NOT_CONFIRMED: {
    userMessage: 'Confirm your email address first. Check your inbox for the link.',
    retryable: false,
  },
  SESSION_EXPIRED: { userMessage: 'Your session has expired. Please sign in again.', retryable: false },

  PERMISSION_DENIED: {
    userMessage: 'Your role does not include this action. Ask an administrator if you need it.',
    retryable: false,
  },
  ORGANIZATION_REQUIRED: {
    userMessage: 'Select an organization before continuing.',
    retryable: false,
  },

  NOT_FOUND: {
    userMessage: 'This record could not be found. It may have been removed.',
    retryable: false,
  },
  VALIDATION_FAILED: { userMessage: 'Some details need fixing before saving.', retryable: false },
  CONFLICT: {
    userMessage: 'Someone else changed this while you were editing. Reload and try again.',
    retryable: false,
  },
  IMMUTABLE_RECORD: {
    userMessage: 'This record is finalised and can no longer be edited.',
    retryable: false,
  },

  INSUFFICIENT_STOCK: {
    userMessage: 'There is not enough stock on hand for this movement.',
    retryable: false,
  },
  INVALID_STATE_TRANSITION: {
    userMessage: 'That step is not allowed from the current status.',
    retryable: false,
  },
  PERIOD_CLOSED: {
    userMessage: 'This period is closed. Reopen it before making changes.',
    retryable: false,
  },

  NETWORK_UNAVAILABLE: {
    userMessage: 'No connection. Check your network and try again — nothing has been lost.',
    retryable: true,
  },
  TIMEOUT: { userMessage: 'That took too long to respond. Please try again.', retryable: true },
  RATE_LIMITED: { userMessage: 'Too many requests. Wait a moment and try again.', retryable: true },
  DEPENDENCY_FAILED: {
    userMessage: 'A service we depend on is not responding. Please try again shortly.',
    retryable: true,
  },

  AI_UNAVAILABLE: {
    userMessage: 'The assistant is unavailable right now. Your data is unaffected.',
    retryable: true,
  },
  AI_OUTPUT_INVALID: {
    // The user is told the suggestion was discarded, not why it was malformed.
    userMessage: 'The assistant returned something we could not use, so it was discarded.',
    retryable: true,
  },
  AI_ACTION_NOT_PERMITTED: {
    userMessage: 'The assistant is not permitted to take that action.',
    retryable: false,
  },
  AI_BUDGET_EXCEEDED: {
    userMessage: 'The assistant has reached its usage limit for now.',
    retryable: false,
  },

  // ── AI gateway ──────────────────────────────────────────────────────────────
  // Every one of these is written so that it tells an administrator what to DO,
  // and none of them can be satisfied by showing the user a provider's raw
  // response. The provider's own error body is the single most likely place for
  // a fragment of the submitted key to reappear, so it never reaches this table —
  // see `mapProviderFailure` in `src/domain/ai/providerErrors.ts`.
  AI_PROVIDER_NOT_CONFIGURED: {
    userMessage: 'No AI provider is set up for your organization yet.',
    retryable: false,
  },
  AI_PROVIDER_DISABLED: {
    userMessage: 'That AI provider is switched off. Ask an administrator to turn it on.',
    retryable: false,
  },
  AI_MODEL_NOT_SUPPORTED: {
    userMessage: 'That AI model is not available for the selected provider.',
    retryable: false,
  },
  AI_PROVIDER_AUTH_FAILED: {
    // Deliberately does not say whether the key was missing, wrong, or revoked.
    // The credential is the operator's to fix, and the difference between those
    // three is not information a user of the Copilot needs.
    userMessage: 'The AI provider rejected its stored API key. Ask an administrator to check it.',
    retryable: false,
  },
  AI_PROVIDER_RATE_LIMITED: {
    userMessage: 'The AI provider is busy right now. Please try again in a moment.',
    retryable: true,
  },
  AI_PROVIDER_UNAVAILABLE: {
    userMessage: 'The AI provider could not be reached. Please try again shortly.',
    retryable: true,
  },
  AI_REQUEST_INVALID: {
    userMessage: 'That request could not be understood.',
    retryable: false,
  },
  AI_UNAUTHORIZED: {
    // Used by the gateway, not the client. A user who reaches this has a valid
    // session but no right to the organization or the provider they asked for.
    userMessage: 'You do not have permission to use the AI assistant for this organization.',
    retryable: false,
  },

  UNKNOWN: {
    userMessage: 'Something went wrong. Trying again usually works.',
    retryable: true,
  },
};

/**
 * The application's error type.
 *
 * Construct it through the helpers below rather than directly, so the code and
 * its copy stay in step.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly correlationId: string | undefined;
  readonly context: ErrorContext | undefined;

  constructor(init: AppErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    const profile = profiles[init.code];

    this.name = 'AppError';
    this.code = init.code;
    this.userMessage = init.userMessage ?? profile.userMessage;
    this.retryable = init.retryable ?? profile.retryable;
    this.correlationId = init.correlationId;
    this.context = init.context;

    // Subclassing a built-in loses the prototype under some transpile targets,
    // which would silently break every `instanceof AppError` check.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Creates an `AppError` for `code`, using its default copy unless overridden. */
export function appError(
  code: AppErrorCode,
  message: string,
  options: Omit<AppErrorInit, 'code' | 'message'> = {},
): AppError {
  return new AppError({ code, message, ...options });
}

/** Default user-facing copy for a code, for callers that need the string alone. */
export function userMessageFor(code: AppErrorCode): string {
  return profiles[code].userMessage;
}

export function isRetryable(code: AppErrorCode): boolean {
  return profiles[code].retryable;
}

/**
 * Postgres and PostgREST error codes that have a precise meaning worth keeping.
 *
 * `42501` (insufficient_privilege) maps to PERMISSION_DENIED because it is a
 * genuine refusal from a policy the user hit knowingly — e.g. writing a column
 * they may read. Cross-tenant invisibility never reaches here at all: RLS
 * filters those rows out, so they arrive as PGRST116 / no rows.
 */
const postgresCodeMap: Readonly<Record<string, AppErrorCode>> = {
  // PostgREST
  PGRST116: 'NOT_FOUND', // no rows returned where exactly one was required
  PGRST301: 'SESSION_EXPIRED', // JWT expired
  // Postgres
  '23502': 'VALIDATION_FAILED', // not_null_violation
  '23503': 'CONFLICT', // foreign_key_violation
  '23505': 'CONFLICT', // unique_violation
  '23514': 'VALIDATION_FAILED', // check_violation
  '22P02': 'VALIDATION_FAILED', // invalid_text_representation
  '40001': 'CONFLICT', // serialization_failure
  '40P01': 'CONFLICT', // deadlock_detected
  '42501': 'PERMISSION_DENIED', // insufficient_privilege
  '57014': 'TIMEOUT', // query_canceled
  '53300': 'DEPENDENCY_FAILED', // too_many_connections
  // Raised by our own PL/pgSQL guards.
  TKX01: 'INSUFFICIENT_STOCK',
  TKX02: 'INVALID_STATE_TRANSITION',
  TKX03: 'IMMUTABLE_RECORD',
  TKX04: 'PERIOD_CLOSED',
  TKX05: 'PERMISSION_DENIED',
};

/** Narrow structural read of an unknown value, without trusting its shape. */
function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

/** Maps an HTTP status to a code, for boundaries that report nothing better. */
function codeForStatus(status: number): AppErrorCode {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status >= 500) return 'DEPENDENCY_FAILED';
  return 'UNKNOWN';
}

/**
 * Recognises the handful of auth failures whose wording matters to the user.
 * Matching on provider message text is unavoidable here — Supabase Auth does not
 * expose a stable machine code for all of them — so it is confined to this one
 * function and defaults safely.
 */
function codeForAuthMessage(message: string): AppErrorCode | undefined {
  const normalised = message.toLowerCase();
  if (normalised.includes('invalid login credentials')) return 'AUTH_INVALID_CREDENTIALS';
  if (normalised.includes('email not confirmed')) return 'AUTH_EMAIL_NOT_CONFIRMED';
  if (normalised.includes('jwt expired') || normalised.includes('token is expired')) {
    return 'SESSION_EXPIRED';
  }
  if (normalised.includes('failed to fetch') || normalised.includes('network request failed')) {
    return 'NETWORK_UNAVAILABLE';
  }
  return undefined;
}

/**
 * Normalises anything thrown anywhere into an `AppError`.
 *
 * This is the boundary function: provider text goes in, and only vetted copy
 * comes out. The original message is preserved on `message` for the log and is
 * deliberately NOT promoted to `userMessage`.
 *
 * @param cause        the unknown thrown value
 * @param fallbackCode the code to assume when nothing more specific is found
 */
export function toAppError(cause: unknown, fallbackCode: AppErrorCode = 'UNKNOWN'): AppError {
  if (isAppError(cause)) return cause;

  const providerMessage = readString(cause, 'message') ?? '';
  const providerCode = readString(cause, 'code');
  const status = readNumber(cause, 'status') ?? readNumber(cause, 'statusCode');

  const mapped =
    (providerCode !== undefined ? postgresCodeMap[providerCode] : undefined) ??
    codeForAuthMessage(providerMessage) ??
    (status !== undefined ? codeForStatus(status) : undefined) ??
    fallbackCode;

  // `message` keeps the provider's wording for diagnosis; `userMessage` comes
  // from the vetted table and is the only thing a screen may render.
  return new AppError({
    code: mapped,
    message:
      providerMessage.length > 0 ? providerMessage : `Unrecognised failure (${String(mapped)})`,
    cause,
    ...(providerCode !== undefined || status !== undefined
      ? {
          context: {
            ...(providerCode !== undefined ? { providerCode } : {}),
            ...(status !== undefined ? { status } : {}),
          },
        }
      : {}),
  });
}

/**
 * The user-safe message for any thrown value.
 *
 * UI code should call this rather than touching `error.message`, which is the
 * developer string. This is the function that makes "never render a raw error"
 * easy to comply with.
 */
export function userMessage(cause: unknown): string {
  return toAppError(cause).userMessage;
}
