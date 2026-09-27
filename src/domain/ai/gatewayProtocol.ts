/**
 * Trackit X — AI Gateway wire protocol.
 *
 * ── One contract, two runtimes ───────────────────────────────────────────────
 * This module is the only description of what crosses the network between the
 * Trackit X client and the AI Gateway. It is imported by BOTH sides:
 *
 *   · `src/services/aiGatewayService.ts` — the Expo/web client
 *   · `supabase/functions/ai-gateway/`     — the Deno Edge Function
 *
 * That is the whole reason it lives here rather than beside either of them. A
 * contract duplicated between client and server is a contract that will be
 * changed on one side only, and the failure mode is silent: the client sends a
 * field the server ignores, or the server starts returning a field the client
 * spreads straight into a log. Neither fails a type check across the boundary,
 * because there is no shared type across the boundary — only this file is.
 *
 * It is therefore deliberately dependency-free. No Supabase client, no React, no
 * platform API, nothing that exists on only one side. `tsconfig.json` excludes
 * `supabase/functions/**` and the Edge Function resolves `@/` through its own
 * import map, so the same file is valid in all three contexts: tsc, Jest and
 * Deno.
 *
 * ── The credential field, and why it is the only one ─────────────────────────
 * Exactly one operation accepts plaintext: `store-credential`. It exists because
 * an administrator has to be able to type a key somewhere, and the only place
 * that can be safe is a server request that immediately writes it to the vault
 * and returns nothing.
 *
 * Two rules keep that from becoming a general-purpose secret channel:
 *
 *   1. No other operation's request type has a field that can hold one. This is
 *      the type-level guarantee — there is nowhere to put a key, so no adapter,
 *      hook or screen can start accepting one by accident.
 *   2. `credential` is not an `AIRequest` field. The type that reaches a provider
 *      adapter is structurally incapable of carrying a secret to a provider, and
 *      the type that comes back is structurally incapable of carrying one to the
 *      client.
 *
 * ── Why there is no `organizationId` on the request bodies ────────────────────
 * The client is allowed to name a provider and a model. It is not allowed to name
 * an organization. Membership is resolved server-side from the caller's own JWT,
 * so a request that names a tenant is not a request that is silently honoured —
 * it is a request the server has no field to read. The absence is the control.
 */
import { appError, type AppErrorCode } from '../../utils/errors.ts';
import { err, ok, type ActionResult } from '../../utils/result.ts';
import { containsSecret } from '../../utils/redact.ts';
import type { AIProviderId, AIResponse, AIUsage } from './types.ts';
import type { ConnectionTestReport } from './gateway.ts';
import { isSupportedProvider } from './registry.ts';

/** Supabase function name. Also the directory name under `supabase/functions`. */
export const AI_GATEWAY_FUNCTION = 'ai-gateway';

/** Every operation the gateway exposes. The route is `/<operation>`. */
export const GATEWAY_OPERATIONS = [
  'test-connection',
  'generate',
  'store-credential',
  'delete-credential',
  'status',
] as const;

export type GatewayOperation = (typeof GATEWAY_OPERATIONS)[number];

/**
 * Bounds on anything a client can make large.
 *
 * These are not politeness. An endpoint that forwards an unbounded string to a
 * paid provider is a way to spend an organization's money, and the gateway is the
 * only place that can refuse it before the cost is incurred. Sizes are checked
 * before the vault is touched, so an oversized request never becomes a secret
 * lookup.
 */
export const GATEWAY_LIMITS = {
  /** Longest user prompt accepted. */
  maxUserInputChars: 16_000,
  /** Longest client-supplied guidance blob. */
  maxAdditionalGuidanceChars: 4_000,
  /**
   * Longest serialised business context. Serialised because the context is an
   * object whose true cost is only knowable after encoding — a small object with
   * one enormous string in it is small by field count.
   */
  maxBusinessContextChars: 64_000,
  /** Longest credential accepted on the store path. Mirrors Phase 35's ceiling. */
  maxCredentialChars: 512,
  /** Shortest credential that could be real. */
  minCredentialChars: 8,
} as const;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * A client asking to test one stored configuration.
 *
 * `configId` only. The server resolves which organization it belongs to and
 * refuses if the caller is not an admin of that organization — it never asks the
 * client which organization to use.
 */
export interface TestConnectionRequestBody {
  readonly configId: string;
}

/**
 * A client submitting a credential for the first time, or replacing it.
 *
 * The only request in the system that carries plaintext, and it travels exactly
 * once: browser → gateway → vault. The response is a status, never the credential
 * and never the vault handle.
 */
export interface StoreCredentialRequestBody {
  readonly configId: string;
  readonly credential: string;
}

/** A client revoking a stored credential. */
export interface DeleteCredentialRequestBody {
  readonly configId: string;
}

/**
 * A Copilot generation request.
 *
 * Note the two omissions that matter:
 *
 *   · No `organizationId`. See the file header.
 *   · The field is `additionalGuidance`, not `systemInstructions`. A client can
 *     add context; it cannot address the system role, so there is no value it can
 *     send that would be concatenated into a privileged instruction. Naming it
 *     `systemInstructions` would have been an invitation, and the instruction in
 *     §14 of the phase plan is honoured by making the override inexpressible
 *     rather than by checking for it.
 */
export interface GenerateRequestBody {
  /**
   * Required. The client names WHICH configuration, and the server decides which
   * organization that configuration belongs to.
   *
   * It was optional in the first draft, on the theory that the gateway could fall
   * back to the organization's marked default. It cannot: a user may belong to
   * several organizations and switch between them, so "the default" has no
   * meaning until somebody says which organization is meant — and the only thing
   * that could say so is the field the phase plan forbids. Naming a configuration
   * sidesteps the question entirely, because the row carries its own
   * `organization_id` and membership is checked against that. A client that has
   * not loaded its own organization's configurations has nothing to send and
   * cannot send it.
   */
  readonly configId: string;
  /** Optional. Validated against the organization's own configuration. */
  readonly provider?: AIProviderId;
  /** Optional. Must belong to `provider`, and to a configuration that is enabled. */
  readonly model?: string;
  readonly userInput: string;
  /**
   * Untrusted text appended to the request context. It is placed in the user
   * turn, after a boundary marker, and never in the system turn.
   */
  readonly additionalGuidance?: string;
  /**
   * Phase 34 `DashboardSnapshot` and its rollups, already projected. Arbitrary
   * objects are accepted here, so this is the field most worth bounding — hence
   * `maxBusinessContextChars`, enforced on the serialised form.
   */
  readonly businessContext?: Readonly<Record<string, unknown>>;
}

/**
 * The `status` request. It has no fields, deliberately.
 *
 * A bodyless operation is modelled as an empty object rather than as a
 * `configId: string` faked at the call site with a cast. The cast version had to
 * invent a `configId` and rely on nothing reading it, which is the kind of
 * invariant that stops being true when a sixth operation is added.
 */
export interface StatusRequestBody {
  readonly kind: 'status';
}

export type GatewayRequestBody =
  | TestConnectionRequestBody
  | StoreCredentialRequestBody
  | DeleteCredentialRequestBody
  | GenerateRequestBody
  | StatusRequestBody;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * The gateway's failure envelope.
 *
 * Exactly two fields, and the reasoning is the point:
 *
 *   · `code` — a closed `AppErrorCode`, so a screen branches on a symbol.
 *   · `message` — the vetted `userMessage` for that code. It is not the
 *     developer string, it is not a provider response, and it cannot vary with
 *     what the provider said. `developerMessage` exists in `AppError` and is
 *     deliberately NOT serialised here: it stays in the server log.
 */
export interface GatewayErrorBody {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

/** A gateway reply the client is allowed to act on. */
export interface GatewaySuccessBody<T> {
  readonly ok: true;
  readonly data: T;
  /** Correlates the client log with the server log. Carries no payload. */
  readonly requestId: string;
}

export interface GatewayFailureBody {
  readonly ok: false;
  readonly error: GatewayErrorBody;
  readonly requestId: string;
}

export type GatewayReply<T> = GatewaySuccessBody<T> | GatewayFailureBody;

/** `test-connection` result. Mirrors Phase 35's `ConnectionTestReport`. */
export type TestConnectionReply = GatewayReply<ConnectionTestReport>;

/** `generate` result. `AIResponse` is already secret-free by construction. */
export type GenerateReply = GatewayReply<AIResponse>;

/** What `store-credential` returns. Never the credential, never the handle. */
export interface CredentialStoredData {
  readonly configId: string;
  /** True when a vault entry now exists. The value itself is not disclosed. */
  readonly credentialStored: boolean;
}

export type StoreCredentialReply = GatewayReply<CredentialStoredData>;

export interface CredentialDeletedData {
  readonly configId: string;
}

export type DeleteCredentialReply = GatewayReply<CredentialDeletedData>;

/**
 * What `status` returns, so a client can explain itself before trying.
 *
 * `vaultAvailable` is deliberately coarse. A client is told whether the vault
 * exists, not which provider is in it, not how many secrets are stored, and not
 * anything an administrator of another organization could learn from it.
 */
export interface GatewayStatusData {
  readonly available: boolean;
  readonly vaultAvailable: boolean;
  /** A sentence safe to render. Never an internal error. */
  readonly reason: string;
  readonly operations: readonly GatewayOperation[];
}

export type StatusReply = GatewayReply<GatewayStatusData>;

/** Usage metadata, normalised. Absent fields are genuinely absent, not zero. */
export type { AIUsage };

// ---------------------------------------------------------------------------
// Inbound validation
// ---------------------------------------------------------------------------

/**
 * Field names that must never appear in a request body.
 *
 * Rejected at the edge, before authorization runs, so a request carrying them
 * fails identically whether or not the caller is allowed to do what it asked. A
 * field that is only refused for authorised callers is a field that tells an
 * unauthorised caller their guess was a good one.
 */
const FORBIDDEN_REQUEST_FIELDS: readonly string[] = [
  'secret_reference',
  'secretReference',
  'api_key',
  'apiKey',
  'credential_present',
  'connection_status',
  'is_default',
  'organization_role',
  'role',
  'user_id',
  'service_role_key',
];

function invalid(message: string, context?: Record<string, string | number | boolean>): ActionResult<never> {
  return err(
    appError('AI_REQUEST_INVALID', message, {
      userMessage: 'That request could not be understood.',
      retryable: false,
      ...(context !== undefined ? { context } : {}),
    }),
  );
}

function readObject(source: unknown): Record<string, unknown> | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  return source as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/** A UUID. Checked by shape; whether it exists is the database's business. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readConfigId(source: Record<string, unknown>): ActionResult<string> {
  const configId = readString(source, 'configId');
  if (configId === undefined) return invalid('Request is missing configId.');
  if (!UUID_PATTERN.test(configId)) return invalid('configId is not a UUID.');
  return ok(configId);
}

/**
 * Rejects a body carrying a field the gateway will never honour.
 *
 * Applied to every operation. It is the runtime counterpart of the type-level
 * guarantee: TypeScript stops a well-typed caller, and this stops an untyped one.
 */
function rejectForbiddenFields(source: Record<string, unknown>): ActionResult<true> {
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_REQUEST_FIELDS.includes(key)) {
      return invalid(`Request carried a forbidden field '${key}'.`, { field: key });
    }
  }
  return ok(true);
}

/**
 * Rejects a credential on an operation that is not the credential operation.
 *
 * `credential` cannot join `FORBIDDEN_REQUEST_FIELDS`, because `store-credential`
 * is the one request that legitimately carries one. The alternative to this
 * per-operation check was a global list plus an exception, which is the shape that
 * quietly stops being enforced the next time an operation is added — the new
 * operation inherits "credential is fine" without anyone deciding that.
 *
 * So the rule is stated as its own positive: exactly one operation accepts a
 * credential, and here is that fact, checked at runtime. A caller that puts a key
 * on `generate` is not just malformed — it is trying to send a secret to a
 * provider without the vault, or trying to smuggle one past the store path's
 * admin check. Either way the request never reaches a handler.
 */
function rejectCredentialField(source: Record<string, unknown>): ActionResult<true> {
  if (Object.prototype.hasOwnProperty.call(source, 'credential')) {
    return invalid('This operation does not accept a credential.', { field: 'credential' });
  }
  return ok(true);
}

/** `rejectForbiddenFields` plus `rejectCredentialField`, in that order. */
function rejectDisallowedFields(source: Record<string, unknown>): ActionResult<true> {
  const forbidden = rejectForbiddenFields(source);
  if (!forbidden.ok) return forbidden;
  return rejectCredentialField(source);
}

function boundedString(
  value: string,
  field: string,
  max: number,
): ActionResult<string> {
  if (value.length > max) {
    return invalid(`${field} exceeds the maximum accepted length.`, {
      field,
      max,
      length: value.length,
    });
  }
  return ok(value);
}

export function parseTestConnectionRequest(
  body: unknown,
): ActionResult<TestConnectionRequestBody> {
  const source = readObject(body);
  if (source === null) return invalid('Request body must be an object.');
  const clean = rejectDisallowedFields(source);
  if (!clean.ok) return clean;
  const configId = readConfigId(source);
  if (!configId.ok) return configId;
  return ok({ configId: configId.value });
}

export function parseStoreCredentialRequest(
  body: unknown,
): ActionResult<StoreCredentialRequestBody> {
  const source = readObject(body);
  if (source === null) return invalid('Request body must be an object.');
  const clean = rejectForbiddenFields(source);
  if (!clean.ok) return clean;
  const configId = readConfigId(source);
  if (!configId.ok) return configId;

  const credential = readString(source, 'credential');
  if (credential === undefined) return invalid('Request is missing credential.');

  // A credential is never trimmed-and-returned here beyond the length gate; the
  // vault adapter stores exactly what arrives after the caller's own trim. The
  // value is never logged, echoed, or placed in the error context.
  if (credential.length < GATEWAY_LIMITS.minCredentialChars) {
    return invalid('Credential is shorter than any provider issues.');
  }
  const bounded = boundedString(
    credential,
    'credential',
    GATEWAY_LIMITS.maxCredentialChars,
  );
  if (!bounded.ok) return bounded;

  return ok({ configId: configId.value, credential: bounded.value });
}

export function parseDeleteCredentialRequest(
  body: unknown,
): ActionResult<DeleteCredentialRequestBody> {
  const source = readObject(body);
  if (source === null) return invalid('Request body must be an object.');
  const clean = rejectDisallowedFields(source);
  if (!clean.ok) return clean;
  const configId = readConfigId(source);
  if (!configId.ok) return configId;
  return ok({ configId: configId.value });
}

export function parseGenerateRequest(body: unknown): ActionResult<GenerateRequestBody> {
  const source = readObject(body);
  if (source === null) return invalid('Request body must be an object.');
  const clean = rejectDisallowedFields(source);
  if (!clean.ok) return clean;

  // configId — required. See the note on GenerateRequestBody: it is the only
  // thing that tells the server which organization is meant, and the organization
  // itself is never taken from the client.
  const rawConfigId = readString(source, 'configId');
  if (rawConfigId === undefined || !UUID_PATTERN.test(rawConfigId)) {
    return invalid('configId is required and must be a UUID.');
  }
  const configId = rawConfigId;

  // provider — narrowed with the registry's own predicate, not against a list
  // restated here. The two used to disagree: this file carried
  // `['gemini', 'openai', 'anthropic']` while claiming to be registry-driven, so
  // adding a fourth provider to the registry would have been silently rejected
  // here. A duplicate list in a validator is a list that will go stale.
  let provider: AIProviderId | undefined;
  if (source.provider !== undefined) {
    const raw = readString(source, 'provider');
    if (raw === undefined || !isSupportedProvider(raw)) {
      return invalid('provider is not a supported provider id.', { provider: String(raw) });
    }
    provider = raw as AIProviderId;
  }

  // model — shape only. Whether the model belongs to the provider is a
  // registry decision the server repeats; a client-side check would be a
  // courtesy, not a control.
  let model: string | undefined;
  if (source.model !== undefined) {
    const raw = readString(source, 'model');
    if (raw === undefined || raw.length === 0 || raw.length > 128) {
      return invalid('model is missing or implausibly long.');
    }
    model = raw;
  }

  // userInput
  const userInput = readString(source, 'userInput');
  if (userInput === undefined) return invalid('Request is missing userInput.');
  if (userInput.trim().length === 0) return invalid('userInput is empty.');
  const boundedInput = boundedString(
    userInput,
    'userInput',
    GATEWAY_LIMITS.maxUserInputChars,
  );
  if (!boundedInput.ok) return boundedInput;

  // additionalGuidance
  let additionalGuidance: string | undefined;
  if (source.additionalGuidance !== undefined) {
    const raw = readString(source, 'additionalGuidance');
    if (raw === undefined) return invalid('additionalGuidance must be a string.');
    const bounded = boundedString(
      raw,
      'additionalGuidance',
      GATEWAY_LIMITS.maxAdditionalGuidanceChars,
    );
    if (!bounded.ok) return bounded;
    additionalGuidance = bounded.value;
  }

  // businessContext — bounded on its serialised form, not its field count.
  let businessContext: Record<string, unknown> | undefined;
  if (source.businessContext !== undefined) {
    const raw = readObject(source.businessContext);
    if (raw === null) return invalid('businessContext must be an object.');
    let serialised: string;
    try {
      serialised = JSON.stringify(raw);
    } catch {
      return invalid('businessContext could not be serialised.');
    }
    if (serialised.length > GATEWAY_LIMITS.maxBusinessContextChars) {
      return invalid('businessContext exceeds the maximum accepted size.', {
        max: GATEWAY_LIMITS.maxBusinessContextChars,
        length: serialised.length,
      });
    }
    businessContext = raw;
  }

  return ok({
    configId,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    userInput: boundedInput.value,
    ...(additionalGuidance !== undefined ? { additionalGuidance } : {}),
    ...(businessContext !== undefined ? { businessContext } : {}),
  });
}

/**
 * The organization the client says the business context belongs to.
 *
 * `CopilotBusinessContext` has carried an `organizationId` since Phase 33, and it
 * stays in the prompt as reference data. This helper exists so the handler can
 * compare it against the configuration's own organization instead of either
 * trusting it or ignoring it.
 *
 * A nested `organizationId` is not looked for. Only the top-level key counts,
 * because a value buried at depth three is not a claim about the request — it is
 * a field in someone's data.
 */
export function readContextOrganizationId(
  body: GenerateRequestBody,
): string | undefined {
  const raw = body.businessContext?.['organizationId'];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** Dispatches to the right parser. Used by the Edge Function's router. */
export function parseGatewayRequest(
  operation: GatewayOperation,
  body: unknown,
): ActionResult<GatewayRequestBody> {
  switch (operation) {
    case 'test-connection':
      return parseTestConnectionRequest(body);
    case 'store-credential':
      return parseStoreCredentialRequest(body);
    case 'delete-credential':
      return parseDeleteCredentialRequest(body);
    case 'generate':
      return parseGenerateRequest(body);
    case 'status':
      // Bodyless by contract, and specifically not given a configId: `status`
      // reports on the caller's own reachability, never on a named
      // configuration, so it cannot become an existence oracle for one.
      //
      // An EMPTY object is accepted, and only an empty one. A POST with no body
      // reaches the server as `{}` rather than as absent — `readJsonObject`
      // cannot tell "no body" from `{}` once the platform has given it a string
      // — so refusing every object made `status` unreachable in practice rather
      // than merely strict. A non-empty body is still refused, which is the part
      // that matters: it keeps a `configId` (or anything else) from being passed
      // in a way that might later be read.
      if (body !== undefined && body !== null) {
        const source = readObject(body);
        if (source === null || Object.keys(source).length > 0) {
          return err(
            appError('AI_REQUEST_INVALID', 'The status operation takes no body.', {
              userMessage: 'The request could not be understood.',
            }),
          );
        }
      }
      return ok({ kind: 'status' });
  }
}

// ---------------------------------------------------------------------------
// Outbound safety
// ---------------------------------------------------------------------------

/**
 * The last gate before a reply leaves the server.
 *
 * `redact.ts` can recognise a credential by its shape. This function serialises
 * the whole reply and refuses it if any value inside matches one of those
 * patterns. It is the belt to the column grants' braces: the grants are the
 * control, and this is the check that would notice if a future change put a
 * secret into a response body.
 *
 * It is deliberately a hard failure rather than a redaction. Silently redacting
 * a leaked key would return a corrupt answer that looks successful, and the
 * operator would never learn their key is being served to browsers.
 */
export function assertReplyCarriesNoSecret<T>(reply: GatewayReply<T>): ActionResult<GatewayReply<T>> {
  let serialised: string;
  try {
    serialised = JSON.stringify(reply);
  } catch {
    return err(
      appError('AI_PROVIDER_UNAVAILABLE', 'Gateway reply could not be serialised.', {
        userMessage: 'The AI provider could not be reached. Please try again shortly.',
      }),
    );
  }

  if (containsSecret(serialised)) {
    // The offending text is deliberately NOT included. Attaching it to the error
    // would put the key in the very log this check exists to keep it out of.
    return err(
      appError('AI_PROVIDER_UNAVAILABLE', 'Gateway reply matched a credential pattern and was withheld.', {
        userMessage: 'The AI provider could not be reached. Please try again shortly.',
        context: { reason: 'secret_in_response_blocked' },
      }),
    );
  }

  return ok(reply);
}

/** Builds the failure envelope from an `AppError`, dropping the developer string. */
export function toFailureBody(
  error: { code: AppErrorCode; userMessage: string; retryable: boolean },
  requestId: string,
): GatewayFailureBody {
  return {
    ok: false,
    error: { code: error.code, message: error.userMessage, retryable: error.retryable },
    requestId,
  };
}

export function toSuccessBody<T>(data: T, requestId: string): GatewaySuccessBody<T> {
  return { ok: true, data, requestId };
}
