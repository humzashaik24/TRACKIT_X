/**
 * Trackit X — AI Gateway HTTP layer.
 *
 * CORS, request parsing, and the reply envelope. Deliberately knows nothing about
 * providers, credentials, or organizations: everything domain-specific arrives
 * already-decided from `index.ts`, and everything secret-shaped is handled in the
 * vault adapter. Keeping this layer free of both is what makes it safe to change
 * without auditing the secret path.
 *
 * ── What must never cross this boundary ──────────────────────────────────────
 * · An API key. Not in a body, not in a header, not in an error string.
 * · A vault handle (`secret_reference`). It is a bearer reference to a secret.
 * · An `Authorization` header, echoed back for debugging. This module is the one
 *   place a request's headers are visible, so the rule is enforced here and
 *   nowhere else has access to them.
 * · A stack trace. An unexpected exception becomes a generic message plus a
 *   request id; the detail goes to the server log.
 */
import { appError, type AppError, type AppErrorCode } from '../../../src/utils/errors.ts';
import { containsSecret, redactFields } from '../../../src/utils/redact.ts';
import {
  GATEWAY_OPERATIONS,
  type GatewayOperation,
  type GatewayReply,
} from '../../../src/domain/ai/gatewayProtocol.ts';

/**
 * Origins allowed to call the gateway.
 *
 * `*` would be simpler and is not acceptable: the gateway is authenticated by
 * bearer token, and pairing a wildcard with bearer auth means any site can spend
 * an organization's provider budget using a token it obtained from a browser it
 * already had access to. The allowlist is explicit and, in this phase, holds the
 * local development origin plus the app's own scheme.
 */
const ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
  'trackitx://',
];

/** Headers a browser requires before it will let JavaScript read the response. */
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin !== null && ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    // A credential response must never be cached by an intermediary.
    'Cache-Control': 'no-store',
  };
}

/** True when the preflight is from an origin we serve. */
export function isOriginAllowed(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.includes(origin);
}

/**
 * Whether a request's `Origin` may proceed.
 *
 * Deliberately different from `isOriginAllowed`, and the difference is the whole
 * point of having two functions.
 *
 * A browser always sends `Origin` on a cross-origin request, so an origin we do
 * not serve means a page on someone else's site is trying to spend an
 * organization's provider budget with a token it took from a browser it already
 * had access to. That is refused.
 *
 * A NATIVE client sends no `Origin` at all. So does `curl`, and so does any
 * server-to-server caller. Requiring one makes the gateway refuse every request
 * from the Expo app on Android and iOS — the platform this product ships on — and
 * the refusal is indistinguishable from "not signed in", so it would be diagnosed
 * as an auth problem and fixed in the wrong place.
 *
 * Absent is therefore allowed, and it is safe: the request is authenticated by a
 * bearer token from the caller's own session, and a browser cannot obtain such a
 * token cross-origin without CORS approval, which is what `isOriginAllowed`
 * governs. The allowlist is a CSRF control, and CSRF requires a browser to exist.
 */
export function isRequestOriginAcceptable(origin: string | null): boolean {
  if (origin === null) return true;
  return isOriginAllowed(origin);
}

/**
 * Answers a CORS preflight.
 *
 * An origin we do not serve gets 403 with `Access-Control-Allow-Origin: null`.
 * That is a refusal the browser enforces on its own, so the request never reaches
 * any handler — the check is here as well so the refusal is recorded rather than
 * being an opaque browser error.
 */
export function handlePreflight(request: Request): Response {
  const origin = request.headers.get('origin');
  const allowed = isOriginAllowed(origin);

  logGateway('info', 'cors_preflight', {
    origin: origin ?? 'absent',
    allowed,
  });

  return new Response(allowed ? null : 'Origin not allowed.', {
    status: allowed ? 204 : 403,
    headers: corsHeaders(origin),
  });
}

/**
 * The bearer token, or null.
 *
 * Only this function reads the `Authorization` header, and it returns a value
 * rather than the header itself so no downstream code can log or echo the whole
 * header set by accident.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** The caller's IP, for the rate limiter. Never used for authorization. */
export function readClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/** The operation named by the final path segment, or null if unrecognised. */
export function readOperation(url: URL): GatewayOperation | null {
  const segment = url.pathname.split('/').filter((part) => part.length > 0).pop();
  if (segment === undefined) return null;
  return (GATEWAY_OPERATIONS as readonly string[]).includes(segment)
    ? (segment as GatewayOperation)
    : null;
}

/**
 * Parses a JSON body.
 *
 * Returns null for anything that is not a JSON object, including a valid JSON
 * array or a bare string. An array body would otherwise reach a parser that
 * expects named fields, and the resulting "field is undefined" error is a worse
 * diagnostic than "not an object".
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** HTTP status for a gateway error code. */
/**
 * The client-visible HTTP status for a code.
 *
 * Exported so the mapping can be asserted directly. The architecture document
 * publishes this table and a client will branch on it, which makes the table part
 * of the contract rather than an implementation detail -- and it had already
 * drifted once.
 */
export function statusForCode(code: AppErrorCode): number {
  switch (code) {
    case 'AI_UNAUTHORIZED':
      return 401;
    case 'AI_REQUEST_INVALID':
      return 400;
    // A permission denial is a client fact, not a server fault. Reporting it as
    // 500 would put "the user may not do this" into the same bucket as an
    // unhandled exception, and every alert threshold built on 5xx would fire for
    // a denied request.
    case 'AI_ACTION_NOT_PERMITTED':
      return 403;
    case 'AI_PROVIDER_RATE_LIMITED':
      return 429;
    case 'AI_PROVIDER_NOT_CONFIGURED':
    case 'AI_PROVIDER_DISABLED':
    case 'AI_MODEL_NOT_SUPPORTED':
      return 409;
    case 'AI_PROVIDER_UNAVAILABLE':
    case 'AI_PROVIDER_AUTH_FAILED':
      return 502;
    default:
      return 500;
  }
}

/**
 * Builds the client-facing failure envelope.
 *
 * Only `code`, the vetted `userMessage`, and `retryable` are serialised. The
 * developer message is written to the log instead, because it is the one field
 * that can name an internal detail — and the whole point of the log is that the
 * operator has it and the browser does not.
 */
export function failureResponse(
  origin: string | null,
  requestId: string,
  error: AppError,
): Response {
  const code = error.code;
  const safeBody: GatewayReply<never> = {
    ok: false,
    requestId,
    error: {
      code,
      message: error.userMessage,
      retryable: error.retryable,
    },
  };

  const serialised = JSON.stringify(safeBody);

  // Last-ditch check on the way out. Everything that reaches here has already been
  // reduced to vetted fields, so this should never fire — which is the point. A
  // control that cannot fire is worthless, and this one is asserted by a test that
  // feeds it a poisoned error, so a future `AppError` field carrying provider
  // text is caught by the test rather than by an incident.
  if (containsSecret(serialised)) {
    logGateway('error', 'outbound_secret_detected', { requestId, code });
    return new Response(
      JSON.stringify({
        ok: false,
        requestId,
        error: {
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: 'The response could not be produced safely.',
          retryable: false,
        },
      }),
      { status: 500, headers: corsHeaders(origin) },
    );
  }

  return new Response(serialised, {
    status: statusForCode(code),
    headers: corsHeaders(origin),
  });
}

/** Builds the client-facing success envelope. */
export function successResponse<T>(
  origin: string | null,
  requestId: string,
  data: T,
): Response {
  const body: GatewayReply<T> = { ok: true, requestId, data };
  return new Response(JSON.stringify(body), { status: 200, headers: corsHeaders(origin) });
}

/** A 401 for a request with no usable session. */
export function unauthenticatedResponse(origin: string | null, requestId: string): Response {
  return failureResponse(
    origin,
    requestId,
    appError('AI_UNAUTHORIZED', 'No verified Supabase session on the request.', {
      userMessage: 'Please sign in to use AI features.',
      retryable: false,
    }),
  );
}

/**
 * Turns an unexpected throw into a safe response.
 *
 * A stack trace is a map of the server's internals, and exception messages
 * routinely carry the values that were in scope when it was thrown — which here
 * can include a credential. So the detail is logged and the client gets a fixed
 * sentence and the request id.
 */
export function unexpectedErrorResponse(
  origin: string | null,
  requestId: string,
  thrown: unknown,
): Response {
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  logGateway('error', 'unhandled_exception', { requestId, detail });
  return failureResponse(
    origin,
    requestId,
    appError('AI_PROVIDER_UNAVAILABLE', 'Unhandled gateway error.', {
      userMessage: 'Something went wrong. Please try again shortly.',
      retryable: true,
    }),
  );
}

/**
 * The gateway's own log line.
 *
 * A hand-rolled writer rather than the shared `logger`, for one reason: the
 * shared logger is configured for the app's console sinks and its redaction runs
 * over a `LogFields` record, which is the wrong shape for a Deno function whose
 * output is captured by the platform. The no-secret guarantee is enforced the
 * same way — every field goes through `containsSecret` before it is written, and
 * a field that looks like a credential is replaced rather than printed.
 */
export function logGateway(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  // The shared recursive redactor, not a loop over top-level strings.
  //
  // The loop this replaced checked `typeof value === 'string'` and nothing else,
  // so a credential one level down — `context: { provider: { apiKey } }`, or an
  // `Error` whose message held one, or an array of provider responses — passed
  // through untouched and was written to the log in full. Depth is exactly where
  // a real leak hides, because the top level is the part everyone remembers to
  // check. `redactFields` also redacts by field NAME, so a field called
  // `apiKey` is withheld even when its value matches no known pattern.
  const safe = redactFields(fields);
  const line = JSON.stringify({ level, event, ...safe });

  // Backstop. The recursion above is the control; this is the check that notices
  // if a future shape slips past it, and it fires before the write rather than
  // after — a log line is written the instant it is serialised.
  if (containsSecret(line)) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'log_field_blocked',
        reason: 'serialised_fields_matched_a_credential_pattern',
      }),
    );
    return;
  }

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
