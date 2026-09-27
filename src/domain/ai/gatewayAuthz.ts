/**
 * Trackit X — AI Gateway authorization.
 *
 * ── Why this file is pure ────────────────────────────────────────────────────
 * Every decision the gateway makes about *who may ask for what* lives here as a
 * function from facts to a verdict. No database, no network, no `Deno`, no
 * `supabase-js`.
 *
 * That is not a style preference, it is what makes the control testable. The
 * alternative — deciding authorization inline in the request handler, where it
 * needs a live request, a valid JWT and a populated database — means the rule
 * that stops user A from spending user B's money is only ever exercised by hand,
 * once, and the next refactor changes it silently.
 *
 * Split this way, the rule is a function of `(membership, config, request)`, and
 * `tests/unit/aiGatewaySecurity.test.ts` calls it with every combination that
 * matters. The handler's job is reduced to gathering facts honestly and refusing
 * to invent them.
 *
 * ── The three facts, and who supplies them ────────────────────────────────────
 *   · `membership` — read from `organization_members` for the CALLER, resolved
 *     from the JWT's subject. The client cannot contribute to it. There is no
 *     `organizationId` parameter anywhere in this file's inputs, because a
 *     function that cannot be handed a tenant cannot be tricked into trusting one.
 *   · `config` — read from `ai_provider_configs` filtered to the membership's
 *     organization.
 *   · `request` — provider/model, which the client MAY name, and which is
 *     validated against the organization's own configuration rather than against
 *     the client's claim.
 *
 * ── Cross-tenant behaviour is indistinguishable from absence ────────────────
 * A configuration belonging to another organization is reported as
 * `AI_PROVIDER_NOT_CONFIGURED`, never as "you may not access this". Confirming
 * that a record exists is itself a disclosure, and RLS already returns an empty
 * set rather than a refusal. This module matches that: no verdict here reveals
 * that a row the caller cannot see is present.
 */
import { hasAtLeastRole, type OrganizationRole } from '../roles.ts';
import { appError } from '../../utils/errors.ts';
import { err, ok, type ActionResult } from '../../utils/result.ts';
import { isModelSupportedForProvider } from './registry.ts';
import type { AIConnectionStatus, AIProviderId } from './types.ts';

/**
 * The minimum rank allowed to invoke the Copilot.
 *
 * `member` — every member of an organization may use the assistant. That is the
 * product intent: a small business buys Trackit X for the people in it, and an
 * employee who cannot ask "how many tasks are overdue" has been bought something
 * for their manager only.
 *
 * A per-member AI permission is deliberately NOT modelled here. When one is
 * wanted, this constant is the single place it changes, and it should become a
 * nullable field on the membership row rather than a role, because "may use AI"
 * and "may administer providers" are different questions and collapsing them into
 * a role would make the common case require an admin.
 */
export const AI_INVOKE_MINIMUM_ROLE: OrganizationRole = 'member';

/** The minimum rank allowed to store, replace or revoke a credential. */
export const AI_CREDENTIAL_MINIMUM_ROLE: OrganizationRole = 'admin';

/** What the gateway learned about the caller from the database. */
export interface GatewayMembership {
  readonly organizationId: string;
  readonly role: OrganizationRole;
}

/**
 * A provider configuration, projected to the fields authorization needs.
 *
 * `credentialPresent` rather than `secretReference`: the boolean is derived in
 * the database from a column the client role cannot read, and authorization only
 * ever needs to know whether a credential exists. The reference itself is never
 * loaded on this path.
 */
export interface GatewayProviderConfigFacts {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: AIProviderId;
  readonly enabled: boolean;
  readonly isDefault: boolean;
  readonly selectedModel: string;
  readonly credentialPresent: boolean;
  readonly connectionStatus: AIConnectionStatus;
}

/** What the client asked for. Only these two fields are client-influenced. */
export interface GatewayRequestIntent {
  readonly configId?: string;
  readonly provider?: AIProviderId;
  readonly model?: string;
}

/**
 * A target that has passed every check and may be used.
 *
 * Constructing one of these is the only way to obtain a configuration for a
 * provider call, which is the point: the handler cannot skip a check without
 * giving up the type it needs to continue.
 */
export interface AuthorizedInvocation {
  readonly config: GatewayProviderConfigFacts;
  readonly model: string;
  /** True when the model came from the organization's configuration, not the client. */
  readonly modelFromOrganization: boolean;
}

/** A credential write that has passed every check. */
export interface AuthorizedCredentialWrite {
  readonly config: GatewayProviderConfigFacts;
}

function unauthorized(reason: string, context?: Record<string, string | number | boolean>) {
  return err(
    appError('AI_UNAUTHORIZED', `Gateway refused the caller: ${reason}.`, {
      userMessage: 'You do not have permission to use the AI assistant for this organization.',
      retryable: false,
      ...(context !== undefined ? { context } : {}),
    }),
  );
}

function notConfigured(reason: string, context?: Record<string, string | number | boolean>) {
  return err(
    appError('AI_PROVIDER_NOT_CONFIGURED', `No usable provider configuration: ${reason}.`, {
      userMessage: 'No AI provider is set up for your organization yet.',
      retryable: false,
      ...(context !== undefined ? { context } : {}),
    }),
  );
}

/**
 * May this member invoke the assistant for this organization at all?
 *
 * Separate from the configuration checks because the two failures mean different
 * things to the user: "you cannot use this" is a permissions problem the user may
 * escalate, while "no provider is set up" is a setup problem an administrator has
 * to fix. Collapsing them into one message would leave a user retrying something
 * that will never work.
 */
export function assertMayInvokeAI(
  membership: GatewayMembership,
): ActionResult<GatewayMembership> {
  if (!hasAtLeastRole(membership.role, AI_INVOKE_MINIMUM_ROLE)) {
    return unauthorized('role below the AI invoke minimum', { role: membership.role });
  }
  return ok(membership);
}

/**
 * Chooses which configuration to use.
 *
 * Resolution order, and the reasoning for it:
 *
 *   1. `configId` if given — the only unambiguous selector, and the one the
 *      Settings screen's "Test Connection" uses.
 *   2. `provider` if given — the Copilot asking for OpenAI when Gemini is the
 *      default. Still organization-scoped: the search is over THIS
 *      organization's configurations only.
 *   3. The marked default.
 *   4. Nothing. Reported as not configured rather than falling back to "the first
 *      one alphabetically" — an organization that enabled two providers and
 *      marked neither as default has not chosen, and guessing would spend
 *      whichever account happened to sort first.
 *
 * A `configId` that is not in the supplied list is treated as absent, which is
 * what makes a cross-tenant `configId` behave exactly like a nonexistent one.
 */
export function selectProviderConfig(
  configs: readonly GatewayProviderConfigFacts[],
  organizationId: string,
  intent: GatewayRequestIntent,
): ActionResult<GatewayProviderConfigFacts> {
  // The organization filter is applied first and unconditionally. Everything
  // below it may assume the list is already this organization's, so no later
  // branch can accidentally search across tenants.
  const owned = configs.filter((config) => config.organizationId === organizationId);

  if (intent.configId !== undefined) {
    const match = owned.find((config) => config.id === intent.configId);
    if (match === undefined) return notConfigured('requested configuration not found');
    return ok(match);
  }

  if (intent.provider !== undefined) {
    const match = owned.find((config) => config.provider === intent.provider);
    if (match === undefined) return notConfigured('provider not configured for this organization');
    return ok(match);
  }

  const fallback = owned.find((config) => config.isDefault);
  if (fallback !== undefined) return ok(fallback);

  return notConfigured('no marked default provider');
}

/**
 * The control. Decides whether one member may run one AI request against one
 * configuration.
 *
 * Checks, in order, each of which can only make the answer more restrictive:
 *
 *   1. the caller is a member and may invoke AI;
 *   2. the configuration belongs to that membership's organization — the
 *      cross-tenant gate, stated explicitly even though `selectProviderConfig`
 *      already filtered, because this is the check a reader looks for and a
 *      defence-in-depth assert that survives a future caller skipping step 4;
 *   3. any provider the client named is the one this configuration actually is;
 *   4. the provider is enabled;
 *   5. a credential exists;
 *   6. the model, whether from the client or the configuration, belongs to the
 *      provider in the registry.
 */
export function authorizeInvocation(params: {
  readonly membership: GatewayMembership;
  readonly configs: readonly GatewayProviderConfigFacts[];
  readonly intent: GatewayRequestIntent;
}): ActionResult<AuthorizedInvocation> {
  const { membership, configs, intent } = params;

  const mayInvoke = assertMayInvokeAI(membership);
  if (!mayInvoke.ok) return mayInvoke;

  const selected = selectProviderConfig(configs, membership.organizationId, intent);
  if (!selected.ok) return selected;
  const config = selected.value;

  if (config.organizationId !== membership.organizationId) {
    return notConfigured('configuration belongs to another organization');
  }

  // A client may name a model; it may not effectively name a provider. The
  // protocol still carries an optional `provider` field, so a client that supplies
  // one that disagrees with the configuration is asking for a model belonging to a
  // different account. Checked before the model so the answer is the provider
  // mismatch rather than whatever the model check makes of a model the caller
  // chose for a different provider.
  if (intent.provider !== undefined && intent.provider !== config.provider) {
    return err(
      appError('AI_MODEL_NOT_SUPPORTED', 'Requested provider does not match the configuration.', {
        userMessage: 'That AI model is not available for the selected provider.',
        retryable: false,
        context: { reason: 'provider_does_not_match_config', provider: config.provider },
      }),
    );
  }

  if (!config.enabled) {
    return err(
      appError('AI_PROVIDER_DISABLED', 'The selected provider configuration is disabled.', {
        userMessage: 'That AI provider is switched off. Ask an administrator to turn it on.',
        retryable: false,
        context: { provider: config.provider, reason: 'provider_disabled' },
      }),
    );
  }

  if (!config.credentialPresent) {
    return err(
      appError('AI_PROVIDER_NOT_CONFIGURED', 'The selected provider has no stored credential.', {
        userMessage: 'No AI provider is set up for your organization yet.',
        retryable: false,
        context: { provider: config.provider, reason: 'credential_absent' },
      }),
    );
  }

  // A requested model must be one the provider actually declares. A model from a
  // different provider is rejected here rather than being sent on and failing
  // with a provider error that says nothing useful to an administrator.
  if (intent.model !== undefined) {
    if (!isModelSupportedForProvider(config.provider, intent.model)) {
      return err(
        appError('AI_MODEL_NOT_SUPPORTED', 'The requested model is not declared for this provider.', {
          userMessage: 'That AI model is not available for the selected provider.',
          retryable: false,
          context: { provider: config.provider, reason: 'model_not_in_registry' },
        }),
      );
    }
    return ok({ config, model: intent.model, modelFromOrganization: false });
  }

  // No model requested: use the organization's own selection. A stored value the
  // registry does not declare is a configuration problem — the registry can move
  // on from a model, or a row can predate an edit to the registry — and the
  // honest answer is to say so rather than to substitute a model the
  // administrator never chose and may not be billed for.
  const stored = config.selectedModel;
  if (isModelSupportedForProvider(config.provider, stored)) {
    return ok({ config, model: stored, modelFromOrganization: true });
  }

  return err(
    appError('AI_MODEL_NOT_SUPPORTED', 'The stored model is not declared for this provider.', {
      userMessage: 'That AI model is not available for the selected provider.',
      retryable: false,
      context: { provider: config.provider, reason: 'stored_model_unknown' },
    }),
  );
}

/**
 * Does the business context claim to belong to the same organization as the
 * configuration?
 *
 * The `organizationId` inside `businessContext` is untrusted: it arrived from a
 * client and is quoted into the prompt as data. Authorization never reads it —
 * the configuration row's own `organization_id` is the only thing that decides
 * anything. This check exists so the field is not merely ignored but *checked*.
 *
 * Why bother, when the field has no authority? Because the alternative failure is
 * quiet. A client holding a stale view — an organization switcher that has not
 * reloaded, a cached config id from the previous tenant, a Copilot panel mounted
 * before the switch completed — would send organization B's business data to a
 * provider billed on organization A's credential, and every individual check
 * would pass. The one thing that is actually wrong is the disagreement, and this
 * is where it is caught.
 *
 * Absent context organization means no claim to contradict, so it passes.
 */
export function assertContextAgreesWithConfig(
  contextOrganizationId: string | undefined,
  configOrganizationId: string,
): ActionResult<undefined> {
  if (contextOrganizationId === undefined) return ok(undefined);

  if (contextOrganizationId === configOrganizationId) return ok(undefined);

  return err(
    appError('AI_UNAUTHORIZED', 'The business context names a different organization.', {
      userMessage: 'That request does not match the organization you are viewing.',
      retryable: false,
      context: {
        reason: 'context_organization_mismatch',
        contextOrganizationPresent: true,
        matchesConfig: false,
      },
    }),
  );
}

/**
 * May this member store, replace or revoke a credential?
 *
 * Admin, not member. A credential is money: storing one is the action that lets
 * an organization be billed, so it sits with the same rank as editing the
 * organization itself. Reusing `canEditOrganization` rather than inventing a
 * second ladder keeps "who can spend money" and "who can rename the company" from
 * drifting apart.
 *
 * The cross-tenant check is present for the same reason as in
 * `authorizeInvocation`: it is the assertion a reader looks for, and it holds
 * even if the caller passes a list it built wrongly.
 */
export function authorizeCredentialWrite(params: {
  readonly membership: GatewayMembership;
  readonly configs: readonly GatewayProviderConfigFacts[];
  readonly configId: string;
}): ActionResult<AuthorizedCredentialWrite> {
  const { membership, configs, configId } = params;

  if (!hasAtLeastRole(membership.role, AI_CREDENTIAL_MINIMUM_ROLE)) {
    return unauthorized('role below the credential-write minimum', { role: membership.role });
  }

  const config = configs.find(
    (candidate) => candidate.id === configId && candidate.organizationId === membership.organizationId,
  );
  if (config === undefined) {
    return notConfigured('configuration not found for this organization');
  }

  return ok({ config });
}

/**
 * May this member run a connection test?
 *
 * Admin, like a credential write. A connection test spends a real request against
 * a paid provider using a stored key, so it is the same privilege as storing one:
 * it is a small, free-form oracle into someone else's account.
 */
export function authorizeConnectionTest(params: {
  readonly membership: GatewayMembership;
  readonly configs: readonly GatewayProviderConfigFacts[];
  readonly configId: string;
}): ActionResult<AuthorizedCredentialWrite> {
  return authorizeCredentialWrite(params);
}
