/**
 * Trackit X — AI Gateway Edge Function.
 *
 * The single entry point for every AI operation. Trustit X clients cannot reach a
 * provider directly; they can only ask this function, and this function decides
 * what is allowed before a credential is read.
 *
 * ── The order of operations, which is the security property ──────────────────
 * For `generate` and `test-connection`:
 *
 *   1. CORS origin allowlist            — refused before anything is read
 *   2. bearer token → verified session  — establishes WHO is calling
 *   3. request body parsed and bounded   — established WHAT is being asked
 *   4. `ai_gateway_read_config`          — establishes WHICH organization, in SQL
 *   5. pure authorization checks         — role, enabled, credential, model
 *   6. context/config organization agree — catches a stale org switch
 *   7. rate limit
 *   8. `ai_gateway_read_credential`      — the FIRST point a plaintext exists
 *   9. adapter call                      — the ONLY point a provider is named
 *  10. normalized, secret-checked reply
 *
 * Everything that can refuse does so before step 8. A caller who is not a member,
 * whose provider is disabled, or whose model is wrong never causes a vault lookup
 * at all, so a stream of unauthorized requests costs nothing and reveals nothing
 * about the credential.
 *
 * ── What cannot leave this function ─────────────────────────────────────────
 * A plaintext credential (step 8 has no other exit), a `secret_reference` (never
 * read by this function — the RPC returns metadata without it), an authorization
 * header (only `readBearerToken` sees it, and it returns the token alone), a
 * provider response body on failure (dropped in `callProvider`), and a stack trace
 * (reduced to a request id in `unexpectedErrorResponse`).
 */
import { createClient } from '@supabase/supabase-js';
import { err, ok, type ActionResult } from '../../../src/utils/result.ts';
import { appError, type AppError } from '../../../src/utils/errors.ts';
import {
  GATEWAY_OPERATIONS,
  parseGatewayRequest,
  readContextOrganizationId,
  type DeleteCredentialRequestBody,
  type GenerateRequestBody,
  type GatewayStatusData,
  type StoreCredentialRequestBody,
  type TestConnectionRequestBody,
  type GatewayOperation,
} from '../../../src/domain/ai/gatewayProtocol.ts';
import {
  authorizeConnectionTest,
  authorizeCredentialWrite,
  authorizeInvocation,
  type GatewayRequestIntent,
  assertContextAgreesWithConfig,
  type GatewayMembership,
  type GatewayProviderConfigFacts,
} from '../../../src/domain/ai/gatewayAuthz.ts';
import { buildPrompt } from '../../../src/domain/ai/gatewayPrompt.ts';
import { gatewayRateLimiter } from '../../../src/domain/ai/gatewayRateLimit.ts';
import { isSupportedProvider } from '../../../src/domain/ai/registry.ts';
import type { OrganizationRole } from '../../../src/domain/roles.ts';
import type { AIConnectionStatus, AIRequest, AIProviderId } from '../../../src/domain/ai/types.ts';
import {
  failureResponse,
  handlePreflight,
  isRequestOriginAcceptable,
  logGateway,
  readBearerToken,
  readClientIp,
  readJsonObject,
  readOperation,
  successResponse,
  unexpectedErrorResponse,
  unauthenticatedResponse,
} from './http.ts';
import type { AIProviderConfigFactsRow } from './configReader.ts';
import { readProviderConfig } from './configReader.ts';
import { createSupabaseVault } from './vault.ts';
import { selectAdapter, supportedGatewayProviders } from './providers/index.ts';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Reads the service role key, or null.
 *
 * Named `SUPABASE_SERVICE_ROLE_KEY` with no `EXPO_PUBLIC_` prefix on purpose. Any
 * `EXPO_PUBLIC_` variable is inlined into the web bundle at build time, so a
 * service-role key under one of those names would be published to every browser
 * that loads the app. The check below is a tripwire for exactly that mistake: if
 * someone renames the variable, the gateway refuses to start rather than starting
 * with no key and failing every request in a confusing way.
 */
function readServiceRoleKey(): string | null {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (key === undefined || key.length === 0) return null;
  if (key.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY holds a publishable key. A publishable key bypasses no RLS and cannot read the vault.',
    );
  }
  return key;
}

function readSupabaseUrl(): string | null {
  const url = Deno.env.get('SUPABASE_URL');
  return url === undefined || url.length === 0 ? null : url;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('origin');
  const requestId = crypto.randomUUID();

  if (request.method === 'OPTIONS') {
    return handlePreflight(request);
  }

  if (request.method !== 'POST') {
    return failureResponse(
      origin,
      requestId,
      appError('AI_REQUEST_INVALID', `Method ${request.method} is not supported.`, {
        userMessage: 'The request could not be understood.',
      }),
    );
  }

  if (!isRequestOriginAcceptable(origin)) {
    logGateway('warn', 'origin_rejected', { requestId, origin: origin ?? 'absent' });
    return failureResponse(
      origin,
      requestId,
      appError('AI_UNAUTHORIZED', 'Request from an origin that is not allowed.', {
        userMessage: 'Please sign in to use AI features.',
        retryable: false,
      }),
    );
  }

  try {
    const operation = readOperation(new URL(request.url));
    if (operation === null) {
      return failureResponse(
        origin,
        requestId,
        appError('AI_REQUEST_INVALID', 'Unknown gateway operation.', {
          userMessage: 'The request could not be understood.',
        }),
      );
    }

    // Who is calling. A missing or unusable token is a 401 and nothing else runs.
    const token = readBearerToken(request);
    if (token === null) {
      logGateway('info', 'request_without_token', { requestId, operation });
      return unauthenticatedResponse(origin, requestId);
    }

    const supabaseUrl = readSupabaseUrl();
    const serviceRoleKey = readServiceRoleKey();
    if (supabaseUrl === null || serviceRoleKey === null) {
      logGateway('error', 'gateway_not_configured', { requestId, hasUrl: supabaseUrl !== null });
      return failureResponse(
        origin,
        requestId,
        appError('AI_PROVIDER_UNAVAILABLE', 'Gateway environment is incomplete.', {
          userMessage: 'AI features are not available right now.',
          retryable: true,
        }),
      );
    }

    // `auth.getUser(token)` re-validates the JWT against the auth server. A token
    // that merely looks well-formed is not accepted: this is the difference
    // between decoding a JWT and trusting one.
    const authClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError !== null || userData.user === null) {
      logGateway('info', 'session_not_verified', { requestId, operation });
      return unauthenticatedResponse(origin, requestId);
    }
    const callerId = userData.user.id;

    const { vault, client } = createSupabaseVault(supabaseUrl, serviceRoleKey);
    const context: GatewayContext = {
      requestId,
      operation,
      callerId,
      clientIp: readClientIp(request),
      vault,
      admin: client,
    };

    switch (operation) {
      case 'status':
        return await handleStatus(origin, context);
      case 'test-connection':
        return await handleTestConnection(origin, request, context);
      case 'generate':
        return await handleGenerate(origin, request, context);
      case 'store-credential':
        return await handleStoreCredential(origin, request, context);
      case 'delete-credential':
        return await handleDeleteCredential(origin, request, context);
    }
  } catch (thrown) {
    return unexpectedErrorResponse(origin, requestId, thrown);
  }
});

// ---------------------------------------------------------------------------
// Per-request context
// ---------------------------------------------------------------------------

interface GatewayContext {
  readonly requestId: string;
  readonly operation: GatewayOperation;
  readonly callerId: string;
  readonly clientIp: string;
  readonly vault: ReturnType<typeof createSupabaseVault>['vault'];
  readonly admin: ReturnType<typeof createSupabaseVault>['client'];
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

/**
 * Reports reachability. Safe for any authenticated user.
 *
 * Deliberately says nothing about which providers exist, which are configured, or
 * how many secrets are stored. It exists so a client can distinguish "the gateway
 * is down" from "your provider is misconfigured" and show the right message.
 */
async function handleStatus(origin: string | null, context: GatewayContext): Promise<Response> {
  const data: GatewayStatusData = {
    available: true,
    vaultAvailable: context.vault.availability.available,
    reason: context.vault.availability.available
      ? 'The AI gateway is reachable.'
      : context.vault.availability.reason,
    operations: GATEWAY_OPERATIONS,
  };
  return successResponse(origin, context.requestId, data);
}

// ---------------------------------------------------------------------------
// Shared: load config and derive membership
// ---------------------------------------------------------------------------

/**
 * Loads the configuration through the secure RPC and turns it into the facts the
 * pure authorization core reasons over.
 *
 * Note that the organization comes from the ROW, never from the request. The
 * caller named a `configId`; the row says which organization it is; membership is
 * then checked against that organization. A caller cannot name an organization, so
 * there is no input to get wrong.
 *
 * The row is mapped to camelCase here, once, so that no handler downstream has to
 * know that Postgres uses snake_case. Handlers pass `config` straight to the
 * authorization core and read `config.organizationId`, which is the whole reason
 * this function exists in the middle.
 */
async function loadAuthorizedConfig(
  context: GatewayContext,
  configId: string,
): Promise<ActionResult<{ config: GatewayProviderConfigFacts; membership: GatewayMembership }>> {
  const row = await readProviderConfig(context.admin, context.callerId, configId);
  if (!row.ok) return err(row.error);

  const facts = toConfigFacts(row.value);
  if (!facts.ok) return err(facts.error);

  // The RPC already refused a caller who is not a member of the configuration's
  // organization, so reaching here means membership exists. Its role is read back
  // so the pure core can apply the rank rules without a second query.
  const membership = await readMembership(context, facts.value.organizationId);
  if (!membership.ok) return err(membership.error);

  return ok({ config: facts.value, membership: membership.value });
}

/**
 * The caller's role in one organization, as Postgres returned it.
 *
 * `ai_gateway_role_of` is the gateway's own `SECURITY DEFINER` lookup and exists
 * for this call site specifically. The app's `organization_role_of` is NOT usable
 * here and its absence from this function is deliberate: it resolves the actor from
 * `auth.uid()`, and a `service_role` client has no auth context, so it returns NULL
 * for every call — including for an owner acting on their own organization. No
 * grant fixes that; the function answers "what is my own role" and the gateway is
 * not asking about "self".
 *
 * NULL, or a value outside the enum, is a refusal rather than a default: the
 * credential RPC already proved membership, so reaching here with nothing means the
 * membership was revoked mid-request, and falling back to `member` would grant the
 * authority the revoked membership no longer carries.
 */
async function readMembership(
  context: GatewayContext,
  organizationId: string,
): Promise<ActionResult<GatewayMembership>> {
  const { data, error } = await context.admin.rpc('ai_gateway_role_of', {
    p_actor_id: context.callerId,
    p_organization_id: organizationId,
  });

  if (error !== null) {
    return err(
      appError('AI_UNAUTHORIZED', 'Membership lookup failed.', {
        userMessage: 'Please sign in to use AI features.',
        retryable: false,
      }),
    );
  }

  if (!isOrganizationRole(data)) {
    // null, or a value the enum does not contain. The credential RPC would have
    // refused a non-member first, so reaching here means the two disagree, which
    // is treated as a refusal rather than as a default.
    return err(
      appError('AI_UNAUTHORIZED', 'No membership for this configuration.', {
        userMessage: 'You are not a member of this organization.',
        retryable: false,
      }),
    );
  }

  return ok({ userId: context.callerId, organizationId, role: data });
}

/**
 * Narrows a value from the database to a known organization role.
 *
 * Written out rather than cast, because this is a value crossing into the
 * authorization decision. A cast would let any string become a role, and
 * `hasAtLeastRole` ranks what it is given — so an unexpected value would be
 * ranked rather than refused. An unrecognised role is not a role.
 */
function isOrganizationRole(value: unknown): value is OrganizationRole {
  return value === 'owner' || value === 'admin' || value === 'manager' || value === 'member';
}

/**
 * Maps the RPC's row to the facts the pure authorization core expects.
 *
 * Returns an `ActionResult` rather than a value because of the one field that can
 * legitimately fail to map: `provider`. It is a Postgres enum, so the database
 * accepts any value the enum contains, including one this deployment has no
 * adapter for — after a downgrade, or if an enum value was added ahead of the
 * code. There is no correct `AIProviderId` to substitute, and substituting one
 * (an earlier draft cast the unknown to `'gemini'`) would send a request to the
 * wrong provider and report it under a name the administrator never chose.
 *
 * So an unrecognised provider is refused here, before authorization and long
 * before a credential is read.
 */
function toConfigFacts(row: AIProviderConfigFactsRow): ActionResult<GatewayProviderConfigFacts> {
  if (!isSupportedProvider(row.provider)) {
    logGateway('warn', 'config_holds_unknown_provider', { configId: row.id });
    return err(
      appError('AI_PROVIDER_NOT_CONFIGURED', 'Configuration names a provider this gateway does not serve.', {
        userMessage: 'That AI provider is not supported.',
        retryable: false,
        context: { reason: 'provider_not_in_registry' },
      }),
    );
  }

  return ok({
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    enabled: row.enabled,
    selectedModel: row.selected_model,
    isDefault: row.is_default,
    credentialPresent: row.credential_present,
    connectionStatus: toConnectionStatus(row.connection_status),
  });
}

/**
 * Narrows a `public.ai_connection_status` value.
 *
 * Unknown values become `unverified` rather than throwing. The only field this
 * affects is a status the client already holds through its own RLS-scoped read, so
 * the safe degradation is "we do not know", which is also the truth.
 */
function toConnectionStatus(value: string): AIConnectionStatus {
  return value === 'connected' || value === 'failed' || value === 'unverified' ? value : 'unverified';
}

/**
 * Applies the rate limit.
 *
 * Takes the organization explicitly because it is the dimension that matters most
 * — it is the one that protects the customer who pays the provider bill. The first
 * draft passed a placeholder here, which silently merged every organization's
 * `org` bucket into one shared counter: a busy organization could lock out a
 * quiet one, and a determined caller could exhaust the shared pool to deny
 * service to everyone. Anonymising a rate-limit key is a small thing that turns
 * into a cross-tenant denial of service, so the id is passed in.
 */
function checkRateLimit(
  context: GatewayContext,
  organizationId: string,
  provider: AIProviderId,
): { allowed: true } | { allowed: false; response: Response } {
  const verdict = gatewayRateLimiter.check({
    userId: context.callerId,
    organizationId,
    provider,
    ip: context.clientIp,
    operation: context.operation,
  });

  if (verdict.allowed) return { allowed: true };

  logGateway('warn', 'rate_limited', {
    requestId: context.requestId,
    dimension: verdict.refusedBy,
  });

  const response = failureResponse(
    null,
    context.requestId,
    appError('AI_PROVIDER_RATE_LIMITED', 'Rate limit exceeded.', {
      userMessage: 'Too many AI requests. Please wait a moment and try again.',
      retryable: true,
      context: { dimension: verdict.refusedBy ?? 'unknown' },
    }),
  );
  // The client is told how long to wait. Refusing without a hint makes a
  // rate-limited client retry immediately, which is the opposite of what the
  // limiter is for.
  response.headers.set('Retry-After', String(verdict.retryAfterSeconds));
  return { allowed: false, response };
}

// ---------------------------------------------------------------------------
// test-connection
// ---------------------------------------------------------------------------

/**
 * Runs a real authenticated provider call and records the outcome.
 *
 * The order is the whole point: the provider call happens first, and
 * `record_ai_connection_test` is called with what actually came back. The reverse
 * order — marking connected, then trying — is how a Settings screen ends up
 * claiming a connection that does not exist, and Phase 35 removed the client's
 * ability to write that column precisely so it could not be papered over.
 */
async function handleTestConnection(
  origin: string | null,
  request: Request,
  context: GatewayContext,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body === null) return invalidBody(context, origin);

  const parsed = parseGatewayRequest('test-connection', body);
  if (!parsed.ok) return refuse(context, origin, parsed.error);
  const input = parsed.value as TestConnectionRequestBody;

  const loaded = await loadAuthorizedConfig(context, input.configId);
  if (!loaded.ok) return refuse(context, origin, loaded.error);
  const { config, membership } = loaded.value;

  const authorized = authorizeConnectionTest({
    membership,
    configs: [config],
    configId: input.configId,
  });
  if (!authorized.ok) return refuse(context, origin, authorized.error);

  const limited = checkRateLimit(context, config.organizationId, config.provider as AIProviderId);
  if (!limited.allowed) return limited.response;

  // Read the credential. This is the first and only point a plaintext exists.
  const credential = await context.vault.getProviderCredential({
    userId: context.callerId,
    organizationId: config.organizationId,
    configId: config.id,
  });
  if (!credential.ok) return refuse(context, origin, credential.error);

  const adapter = selectAdapter(config.provider);
  if (adapter === null) {
    return failureResponse(
      origin,
      context.requestId,
      appError('AI_PROVIDER_NOT_CONFIGURED', 'No adapter for this provider.', {
        userMessage: 'That AI provider is not supported.',
        context: { provider: config.provider },
      }),
    );
  }

  const report = await adapter.testConnection(credential.value, config.selectedModel);
  if (!report.ok) return refuse(context, origin, report.error);

  const result = report.value;

  // The status is derived from the call, never from the request or the UI.
  await recordConnectionTest(context, config.id, result.reachable ? 'connected' : 'failed');

  return successResponse(origin, context.requestId, { ...result, requestId: context.requestId });
}

/**
 * Writes the observed status.
 *
 * Failures here are logged and swallowed: the caller already has the real answer,
 * and turning a bookkeeping write into an error would report a failed connection
 * test for a provider that in fact answered.
 */
async function recordConnectionTest(
  context: GatewayContext,
  configId: string,
  status: AIConnectionStatus,
): Promise<void> {
  const { error } = await context.admin.rpc('record_ai_connection_test', {
    p_config_id: configId,
    p_status: status,
  });
  if (error !== null) {
    logGateway('warn', 'connection_test_not_recorded', {
      requestId: context.requestId,
      sqlstate: error.code ?? 'none',
    });
  }
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

/**
 * The Copilot path.
 *
 * Builds the prompt from the protected constant plus untrusted quoted material,
 * constructs the only `AIRequest` in the system, and hands it to an adapter.
 */
async function handleGenerate(
  origin: string | null,
  request: Request,
  context: GatewayContext,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body === null) return invalidBody(context, origin);

  const parsed = parseGatewayRequest('generate', body);
  if (!parsed.ok) return refuse(context, origin, parsed.error);
  const input = parsed.value as GenerateRequestBody;

  const loaded = await loadAuthorizedConfig(context, input.configId);
  if (!loaded.ok) return refuse(context, origin, loaded.error);
  const { membership } = loaded.value;

  // The client may name a model; it may not name a provider. That rule lives in
  // `authorizeInvocation` (as `provider_does_not_match_config`) so it is decided
  // in the one pure, unit-tested place. This handler's job is to pass the facts
  // honestly and refuse to invent any — including a provider that disagrees with
  // the configuration it just read.
  const intent: GatewayRequestIntent = {
    configId: input.configId,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    // The client-supplied model is passed through so the authorization core can
    // check it against the registry for THIS configuration's provider. Omitting it
    // would not fail safe: `authorizeInvocation` falls back to the organization's
    // stored `selectedModel` when no model is named, so a caller asking for a model
    // that does not exist would silently be served a different one and told
    // nothing.
    ...(input.model !== undefined ? { model: input.model } : {}),
  };

  const authorized = authorizeInvocation({
    membership,
    configs: [loaded.value.config],
    intent,
  });
  if (!authorized.ok) return refuse(context, origin, authorized.error);
  const invocation = authorized.value;
  const config = invocation.config;

  // The context's own organizationId is untrusted prompt data. It is checked
  // against the configuration's organization so a stale organization switch cannot
  // send one tenant's data on another tenant's credential.
  const agreement = assertContextAgreesWithConfig(
    readContextOrganizationId(input),
    config.organizationId,
  );
  if (!agreement.ok) return refuse(context, origin, agreement.error);

  const limited = checkRateLimit(context, config.organizationId, invocation.config.provider);
  if (!limited.allowed) return limited.response;

  // The system prompt is built here and nowhere else. `buildPrompt` has no
  // parameter for a caller to reach `system`, and the adapter re-checks that what
  // arrived is this constant.
  const prompt = buildPrompt({
    userInput: input.userInput,
    ...(input.additionalGuidance !== undefined
      ? { additionalGuidance: input.additionalGuidance }
      : {}),
    ...(input.businessContext !== undefined ? { businessContext: input.businessContext } : {}),
  });

  const credential = await context.vault.getProviderCredential({
    userId: context.callerId,
    organizationId: config.organizationId,
    configId: config.id,
  });
  if (!credential.ok) return refuse(context, origin, credential.error);

  const adapter = selectAdapter(invocation.config.provider);
  if (adapter === null) {
    return failureResponse(
      origin,
      context.requestId,
      appError('AI_PROVIDER_NOT_CONFIGURED', 'No adapter for this provider.', {
        userMessage: 'That AI provider is not supported.',
        context: { provider: invocation.config.provider },
      }),
    );
  }

  logGateway('info', 'generate_started', {
    requestId: context.requestId,
    provider: invocation.config.provider,
    model: invocation.model,
    contextIncluded: prompt.contextIncluded,
    guidanceIncluded: input.additionalGuidance !== undefined,
  });

  // The single construction of an AIRequest in the repository. `organizationId`
  // and `provider` come from the authorized configuration, never from the client.
  const aiRequest: AIRequest = {
    organizationId: config.organizationId,
    provider: invocation.config.provider,
    model: invocation.model,
    systemInstructions: prompt.system,
    userInput: prompt.user,
    ...(input.businessContext !== undefined ? { businessContext: input.businessContext } : {}),
  };

  const generated = await adapter.generate(credential.value, aiRequest);
  if (!generated.ok) {
    // A provider failure is logged with its safe code, then refused with that
    // same code. The provider's own text never enters the reply — it was already
    // dropped in `callProvider`, and `toSafeProviderError` declines to carry it
    // even if it had not been.
    logGateway('warn', 'generate_failed', {
      requestId: context.requestId,
      provider: invocation.config.provider,
      code: generated.error.code,
    });
    return refuse(context, origin, generated.error);
  }

  logGateway('info', 'generate_succeeded', {
    requestId: context.requestId,
    provider: invocation.config.provider,
    model: invocation.model,
    latencyMs: generated.value.latencyMs,
    outputChars: generated.value.output.length,
  });

  return successResponse(origin, context.requestId, {
    ...generated.value,
    requestId: context.requestId,
  });
}

// ---------------------------------------------------------------------------
// store-credential
// ---------------------------------------------------------------------------

/**
 * Stores a credential. Admin only.
 *
 * The only request in the system carrying plaintext. The credential goes browser →
 * function → vault and is never written to a log, a response, or a database
 * column. The response says whether a credential is now stored and nothing about
 * its value.
 */
async function handleStoreCredential(
  origin: string | null,
  request: Request,
  context: GatewayContext,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body === null) return invalidBody(context, origin);

  const parsed = parseGatewayRequest('store-credential', body);
  if (!parsed.ok) return refuse(context, origin, parsed.error);
  const input = parsed.value as StoreCredentialRequestBody;

  const loaded = await loadAuthorizedConfig(context, input.configId);
  if (!loaded.ok) return refuse(context, origin, loaded.error);
  const { config, membership } = loaded.value;

  const authorized = authorizeCredentialWrite({
    membership,
    configs: [config],
    configId: input.configId,
  });
  if (!authorized.ok) return refuse(context, origin, authorized.error);

  const limited = checkRateLimit(context, config.organizationId, config.provider as AIProviderId);
  if (!limited.allowed) return limited.response;

  const stored = await context.vault.storeProviderCredential({
    userId: context.callerId,
    organizationId: config.organizationId,
    configId: config.id,
    credential: input.credential,
  });
  if (!stored.ok) return refuse(context, origin, stored.error);

  return successResponse(origin, context.requestId, {
    configId: input.configId,
    credentialStored: stored.value.stored,
  });
}

// ---------------------------------------------------------------------------
// delete-credential
// ---------------------------------------------------------------------------

/** Removes a stored credential. Admin only. Idempotent. */
async function handleDeleteCredential(
  origin: string | null,
  request: Request,
  context: GatewayContext,
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body === null) return invalidBody(context, origin);

  const parsed = parseGatewayRequest('delete-credential', body);
  if (!parsed.ok) return refuse(context, origin, parsed.error);
  const input = parsed.value as DeleteCredentialRequestBody;

  const loaded = await loadAuthorizedConfig(context, input.configId);
  if (!loaded.ok) return refuse(context, origin, loaded.error);
  const { config, membership } = loaded.value;

  const authorized = authorizeCredentialWrite({
    membership,
    configs: [config],
    configId: input.configId,
  });
  if (!authorized.ok) return refuse(context, origin, authorized.error);

  const limited = checkRateLimit(context, config.organizationId, config.provider as AIProviderId);
  if (!limited.allowed) return limited.response;

  const removed = await context.vault.deleteProviderCredential({
    userId: context.callerId,
    organizationId: config.organizationId,
    configId: config.id,
  });
  if (!removed.ok) return refuse(context, origin, removed.error);

  return successResponse(origin, context.requestId, { configId: input.configId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalidBody(context: GatewayContext, origin: string | null): Response {
  return failureResponse(
    origin,
    context.requestId,
    appError('AI_REQUEST_INVALID', 'Request body is not a JSON object.', {
      userMessage: 'The request could not be understood.',
    }),
  );
}

/**
 * Converts a refusal into the client response, and records that it happened.
 *
 * Every handler funnels its failures through here rather than returning the
 * `ActionResult` directly, for two reasons. First, a `Result` is not a `Response`
 * and the compiler should say so at every site rather than at one. Second, this is
 * the single place a refusal is logged, so "the gateway said no" is always in the
 * log with its code — which is how an administrator chasing a failed Copilot
 * request finds out it was refused rather than lost.
 */
function refuse(context: GatewayContext, origin: string | null, error: AppError): Response {
  logGateway('info', 'request_refused', {
    requestId: context.requestId,
    operation: context.operation,
    code: error.code,
  });
  return failureResponse(origin, context.requestId, error);
}

/** Exported for the security tests, which assert the provider set the gateway serves. */
export { supportedGatewayProviders };
