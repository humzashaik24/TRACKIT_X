/**
 * Trackit X — AI Gateway client service.
 *
 * The only client-side route to a provider. A screen calls this; this calls the
 * Edge Function; the Edge Function decides what is allowed and holds the
 * credential. There is no other path, which is the property that matters — the
 * bundle contains no provider endpoint, no credential, and no code that could
 * read one.
 *
 * ── What this service can send ───────────────────────────────────────────────
 *   `configId`, `model`, `userInput`, bounded `additionalGuidance`, and a
 *   `businessContext` the caller has already projected.
 *
 * ── What this service cannot send, and why there is no argument for it ───────
 *   An API key, a `secret_reference`, a vault handle, a provider token: no
 *   parameter exists for any of them, and the server's own parser rejects those
 *   field names before authorization runs. A credential reaches the vault exactly
 *   once, through `submitCredential`, and that request carries nothing else.
 *
 *   An `organizationId`, for a specific reason. The server derives the
 *   organization from the configuration row, so a client that could name one
 *   would be able to aim a request at another tenant's configuration and rely on
 *   the server to notice. It is better for the server to have no such field to
 *   misread. The `businessContext` does carry an `organizationId` — Phase 33 put it
 *   there — and the server treats it as untrusted data and checks it agrees with
 *   the configuration.
 *
 * ── Availability ─────────────────────────────────────────────────────────────
 * `GATEWAY_AVAILABLE` is false in this phase because the Edge Function is not
 * deployed to a hosted project, and Trackit X ships as a static web bundle. Every
 * method short-circuits on that flag and returns the same "not available" error
 * the Phase 34 stub returned, so no unit test and no screen can make a network
 * call by accident. The call sites below the flag are real and exercised against
 * a locally-served function; see `docs/progress/PHASE_36_COMPLETE.md`.
 */
import { err, ok, type ActionResult } from '../utils/result';
import { appError } from '../utils/errors';
import { containsSecret } from '../utils/redact';
import { logger } from '../utils/logger';
import { supabase } from '../lib/supabase';
import {
  GATEWAY_AVAILABLE,
  GATEWAY_ROUTE_GENERATE,
  GATEWAY_ROUTE_TEST_CONNECTION,
  GATEWAY_UNAVAILABLE_REASON,
  type ConnectionTestReport,
} from '../domain/ai/gateway';
import {
  AI_GATEWAY_FUNCTION,
  GATEWAY_LIMITS,
  type GatewayFailureBody,
  type GatewayOperation,
  type GatewayReply,
  type GatewaySuccessBody,
} from '../domain/ai/gatewayProtocol';
import type { AIRequest, AIResponse } from '../domain/ai/types';

/** The message a caller sees when the gateway is not deployed. */
const GATEWAY_UNAVAILABLE_MESSAGE = 'AI features are not available in this build.';

/** Every line this service writes is tagged, so a log search finds the module. */
const log = logger.child({ module: 'aiGatewayService' });

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Calls one gateway operation.
 *
 * Uses `supabase.functions.invoke` rather than `fetch` so the session token is
 * attached by the existing Supabase client. That matters for more than
 * convenience: a hand-rolled `fetch` would need the token read out of the session
 * and put in a header here, which puts the one piece of code most likely to log a
 * token into the client bundle.
 *
 * The server's reply is parsed into an `ActionResult` and every failure is
 * re-wrapped as a local `AppError`. Nothing from the wire is surfaced verbatim:
 * the reply body is already reduced to `code`/`message`/`retryable` by the
 * server, and anything unrecognised becomes a generic message here.
 */
async function callGateway<T>(
  operation: GatewayOperation,
  body: Record<string, unknown>,
  context: { readonly configId: string },
): Promise<ActionResult<T>> {
  if (!GATEWAY_AVAILABLE) {
    return err(
      appError('AI_UNAVAILABLE', GATEWAY_UNAVAILABLE_REASON, {
        userMessage: GATEWAY_UNAVAILABLE_MESSAGE,
        context: { operation, configId: context.configId, reason: 'gateway_unavailable' },
      }),
    );
  }

  let raw: unknown;
  try {
    // The operation travels in the PATH, not the body. `functions.invoke` posts to
    // `/functions/v1/<name>`, so the name is where the operation has to go for the
    // server's `readOperation` -- which reads the last path segment -- to see it.
    // Sending it in the body instead, as an earlier draft did, produced a URL
    // ending in `ai-gateway`: an unknown operation, refused on every single call
    // rather than on an edge case.
    //
    // The path is the ONLY place the operation appears. Two sources for one value
    // is a request-smuggling hazard, because anything that routed on one and the
    // function that acted on the other would disagree about which handler ran.
    const response = await supabase.functions.invoke(`${AI_GATEWAY_FUNCTION}/${operation}`, {
      body,
    });
    raw = response.data;
    if (response.error !== null) {
      return err(
        appError('AI_PROVIDER_UNAVAILABLE', `Gateway transport failed: ${response.error.message}`, {
          userMessage: 'The AI gateway could not be reached. Please try again shortly.',
          retryable: true,
          context: { operation, transport: true },
        }),
      );
    }
  } catch (thrown) {
    // A thrown error from `invoke` is a transport failure: offline, DNS, a
    // function that crashed before responding. None of those say anything about
    // the provider, so none of them are reported as a provider problem.
    log.warn('AI gateway transport failure', {
      operation,
      configId: context.configId,
      error: thrown instanceof Error ? thrown.message : 'non-error throw',
    });
    return err(
      appError('AI_PROVIDER_UNAVAILABLE', 'Gateway transport threw.', {
        userMessage: 'The AI gateway could not be reached. Please try again shortly.',
        retryable: true,
        context: { operation, transport: true },
      }),
    );
  }

  return interpretReply<T>(raw, operation, context.configId);
}

/**
 * Turns a gateway reply into an `ActionResult`.
 *
 * The one assertion worth naming: the reply is checked with `containsSecret`
 * before it is trusted, and a reply that looks like it carries a credential is
 * discarded rather than rendered. That is the client's half of a defence whose
 * server half is `assertReplyCarriesNoSecret`. Neither check is expected to fire.
 * A client that renders a leaked key anyway would put it in front of a user, in
 * a screenshot, in a support ticket.
 */
function interpretReply<T>(
  raw: unknown,
  operation: string,
  configId: string,
): ActionResult<T> {
  if (typeof raw === 'string' && containsSecret(raw)) {
    log.error('AI gateway reply matched a credential pattern; discarded', { operation, configId });
    return err(
      appError('AI_PROVIDER_UNAVAILABLE', 'Gateway reply was discarded as unsafe.', {
        userMessage: 'The AI gateway returned an unsafe response. Nothing was displayed.',
        retryable: false,
      }),
    );
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err(
      appError('AI_PROVIDER_UNAVAILABLE', 'Gateway reply was not an object.', {
        userMessage: 'The AI gateway returned an unexpected response.',
        retryable: true,
        context: { operation },
      }),
    );
  }

  const reply = raw as Partial<GatewayReply<T>>;

  if (reply.ok === true) {
    const data = (reply as GatewaySuccessBody<T>).data;
    if (data === undefined || data === null) {
      return err(
        appError('AI_PROVIDER_UNAVAILABLE', 'Gateway success reply carried no data.', {
          userMessage: 'The AI gateway returned an unexpected response.',
          retryable: false,
        }),
      );
    }
    return ok(data);
  }

  if (reply.ok === false) {
    const error = (reply as GatewayFailureBody).error;
    // The server already vetted `message`. It is re-wrapped rather than returned
    // so this service never hands a wire string straight to a screen, which keeps
    // "every user-facing string came from a vetted table" true even if the server
    // is replaced.
    //
    // `requestId` is read defensively: it is the one field in a failure envelope
    // that is not part of the vetted error, and it is included only so a user can
    // quote it in a support request. Absent is a real possibility, so it is
    // filtered out rather than passed as `undefined`.
    const requestId = typeof reply.requestId === 'string' ? reply.requestId : null;
    return err(
      appError(error?.code ?? 'AI_PROVIDER_UNAVAILABLE', `Gateway refused ${operation}.`, {
        userMessage: error?.message ?? 'The request could not be completed.',
        retryable: error?.retryable ?? true,
        context: { operation, configId, ...(requestId !== null ? { requestId } : {}) },
      }),
    );
  }

  return err(
    appError('AI_PROVIDER_UNAVAILABLE', 'Gateway reply had no ok flag.', {
      userMessage: 'The AI gateway returned an unexpected response.',
      retryable: false,
      context: { operation },
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs a connection test for one stored configuration.
 *
 * The client sends a `configId` and nothing else — no provider, no credential, no
 * organization. The server resolves which organization it belongs to, checks the
 * caller is an administrator of that organization, reads the credential itself,
 * makes a real authenticated provider call, and records the outcome.
 *
 * The returned `reachable` flag is the server's observation. The UI must not
 * derive a "Connected" badge from anything else, and cannot: `connection_status`
 * is not a column the client role may write, and is re-read from the database
 * after this call.
 */
export async function testConnection(
  configId: string,
): Promise<ActionResult<ConnectionTestReport>> {
  return callGateway<ConnectionTestReport>(
    'test-connection',
    { configId },
    { configId },
  );
}

/**
 * Sends one Copilot request.
 *
 * `configId` is required. The client names WHICH configuration; the server
 * decides which organization that is, and checks the caller belongs to it. The
 * organization is not a parameter because the client must not be able to aim a
 * request at a tenant it does not belong to.
 *
 * `model` is optional and is validated server-side against the registry and the
 * configuration's provider. A client-side check would be a courtesy — the server
 * repeats it, and the server's is the one that counts.
 *
 * `additionalGuidance` is bounded here as well as on the server. The server's
 * bound is the control; this one exists so an oversized string is refused before
 * it is serialised into a request body, and so the user gets an immediate
 * message rather than a round trip.
 */
export async function generate(params: {
  readonly configId: string;
  readonly userInput: string;
  readonly model?: string;
  /** Untrusted. Bounded, fenced in the user turn, never a system instruction. */
  readonly additionalGuidance?: string;
  /**
   * The caller's already-projected business data. Treated as untrusted prompt
   * data. Its `organizationId` is checked against the configuration's
   * organization server-side, so a stale organization switch is caught rather
   * than sending one tenant's figures on another's credential.
   */
  readonly businessContext?: Readonly<Record<string, unknown>>;
}): Promise<ActionResult<AIResponse>> {
  if (params.userInput.trim().length === 0) {
    return err(
      appError('AI_REQUEST_INVALID', 'Question is empty.', {
        userMessage: 'Type a question first.',
        context: { reason: 'empty_user_input' },
      }),
    );
  }

  if (params.userInput.length > GATEWAY_LIMITS.maxUserInputChars) {
    return err(
      appError('AI_REQUEST_INVALID', 'Question is too long.', {
        userMessage: 'That question is too long to send. Try asking about less at once.',
        context: {
          max: GATEWAY_LIMITS.maxUserInputChars,
          length: params.userInput.length,
        },
      }),
    );
  }

  if (
    params.additionalGuidance !== undefined &&
    params.additionalGuidance.length > GATEWAY_LIMITS.maxAdditionalGuidanceChars
  ) {
    return err(
      appError('AI_REQUEST_INVALID', 'Guidance is too long.', {
        userMessage: 'That extra instruction is too long to send.',
        context: { max: GATEWAY_LIMITS.maxAdditionalGuidanceChars },
      }),
    );
  }

  return callGateway<AIResponse>(
    'generate',
    {
      configId: params.configId,
      userInput: params.userInput,
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.additionalGuidance !== undefined
        ? { additionalGuidance: params.additionalGuidance }
        : {}),
      ...(params.businessContext !== undefined ? { businessContext: params.businessContext } : {}),
    },
    { configId: params.configId },
  );
}

/**
 * Hands a credential to the server-side vault.
 *
 * The only method that carries plaintext, and it carries it exactly once. The
 * reply is a boolean, never the credential and never the vault handle; the caller
 * re-reads the configuration, which will then report `credential_present`.
 *
 * The credential is checked for shape before it is sent, and never logged. Note
 * what is absent from this function: the credential is not put in the `context`
 * of any error, because an error's context is the first thing anyone pastes into
 * a support ticket.
 */
export async function submitCredential(params: {
  readonly configId: string;
  readonly credential: string;
}): Promise<ActionResult<{ readonly credentialStored: boolean }>> {
  const credential = params.credential.trim();

  if (
    credential.length < GATEWAY_LIMITS.minCredentialChars ||
    credential.length > GATEWAY_LIMITS.maxCredentialChars
  ) {
    return err(
      appError('VALIDATION_FAILED', 'Credential is not an acceptable length.', {
        userMessage: 'That does not look like a complete API key.',
        context: {
          min: GATEWAY_LIMITS.minCredentialChars,
          max: GATEWAY_LIMITS.maxCredentialChars,
        },
      }),
    );
  }

  const result = await callGateway<{ readonly credentialStored: boolean }>(
    'store-credential',
    { configId: params.configId, credential },
    { configId: params.configId },
  );

  return result.ok ? ok({ credentialStored: result.value.credentialStored }) : result;
}

/**
 * Revokes a stored credential.
 *
 * Returns `void` on success. Idempotent server-side, so revoking twice is not an
 * error the user has to understand.
 */
export async function revokeCredential(configId: string): Promise<ActionResult<undefined>> {
  const result = await callGateway<{ readonly configId: string }>(
    'delete-credential',
    { configId },
    { configId },
  );
  return result.ok ? ok(undefined) : result;
}

/**
 * Asks the gateway whether it is reachable.
 *
 * The one call that is safe for any signed-in user and is not about a specific
 * configuration, so it is not rate-limited per configuration. It exists so a
 * screen can tell "the gateway is down" apart from "your provider is
 * misconfigured" and show the right message instead of a generic failure.
 */
export async function getGatewayStatus(): Promise<
  ActionResult<{
    readonly available: boolean;
    readonly vaultAvailable: boolean;
    readonly reason: string;
  }>
> {
  return callGateway('status', {}, { configId: 'none' });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * The gateway routes, exported for the Settings screen.
 *
 * Read-only and informational. Nothing in the client fetches these directly —
 * `supabase.functions.invoke` builds the URL from the function name — so a screen
 * showing "the gateway lives at …" cannot be mistaken for a second call path.
 */
export const AI_GATEWAY_ROUTES = {
  testConnection: GATEWAY_ROUTE_TEST_CONNECTION,
  generate: GATEWAY_ROUTE_GENERATE,
} as const;

/** Re-exported so a screen building a request does not import two modules. */
export type { AIRequest, AIResponse, ConnectionTestReport };
